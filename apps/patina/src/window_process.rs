use crate::Action;
use crate::requests::{DesktopRequests, Dispatch, ExitAction, WindowCaller};
use patina_activity::RecordingControl;
use std::{
    io,
    os::windows::{
        io::{AsRawHandle, OwnedHandle},
        process::CommandExt,
    },
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};
use std::{
    rc::Rc,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

use patina_desktop_protocol::{
    FromWindow, Target, ToWindow, WIRE_VERSION, handshake, read_messages, writer,
};

enum Event {
    Action(Action),
    Message(u64, FromWindow),
    Disconnected(u64),
}

struct WindowProcess {
    main_hwnd: Option<usize>,
    child: Child,
    _job: OwnedHandle,
    generation: u64,
    serial: u64,
    tx: mpsc::Sender<ToWindow>,
}

impl WindowProcess {
    fn start(
        generation: u64,
        preferences: &patina_activity::AppPreferences,
        events: async_channel::Sender<Event>,
    ) -> io::Result<Self> {
        let job =
            patina_windows_integration::windows::job::kill_on_close().map_err(io::Error::other)?;
        let mut child = Command::new(std::env::current_exe()?)
            .args([
                "--role",
                "Patina UI",
                WIRE_VERSION,
                preferences.locale.tag(),
                preferences.theme.tag(),
            ])
            .args(&preferences.schemes)
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()?;
        let stdin = child.stdin.take().expect("piped stdin");
        let stdout = child.stdout.take().expect("piped stdout");
        let setup = (|| {
            use windows::Win32::{
                Foundation::HANDLE, System::JobObjects::AssignProcessToJobObject,
            };
            unsafe {
                AssignProcessToJobObject(
                    HANDLE(job.as_raw_handle()),
                    HANDLE(child.as_raw_handle()),
                )?;
            }

            let tx = writer(stdin)?;
            thread::Builder::new()
                .name("window-pipe-read".into())
                .spawn(move || {
                    if let Err(e) = handshake(stdout).and_then(|reader| {
                        read_messages(reader, |msg| {
                            events
                                .send_blocking(Event::Message(generation, msg))
                                .is_ok()
                        })
                    }) {
                        eprintln!("read window process: {e}");
                    }
                    let _ = events.send_blocking(Event::Disconnected(generation));
                })?;
            Ok::<_, io::Error>(tx)
        })();
        match setup {
            Ok(tx) => Ok(Self {
                child,
                _job: job,
                generation,
                serial: 0,
                main_hwnd: None,
                tx,
            }),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(e)
            }
        }
    }
    fn open(
        &mut self,
        target: Target,
        recorder: &RecordingControl,
        revision: u64,
    ) -> io::Result<()> {
        if self.child.try_wait()?.is_some() {
            return Err(io::Error::other("window process has exited"));
        }
        if matches!(
            target,
            Target::Today | Target::Tool(_) | Target::Mini { focus: true }
        ) {
            // Forward the foreground permission granted by a user's tray action.
            let _ = unsafe {
                windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow(self.child.id())
            };
        }
        self.serial += 1;
        self.tx
            .send(ToWindow::Open {
                serial: self.serial,
                revision,
                target,
                activity: recorder.current_activity(),
                paused: recorder.paused(),
            })
            .map_err(|_| io::Error::other("window pipe closed"))
    }
}

impl Drop for WindowProcess {
    fn drop(&mut self) {
        let _ = self.tx.send(ToWindow::Exit);
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => thread::sleep(Duration::from_millis(10)),
                Err(_) => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// The last-window notification only retires the process if it has handled the latest open request.
pub(super) async fn serve(
    executor: &async_executor::LocalExecutor<'_>,
    actions: async_channel::Receiver<Action>,
    windows_open: Arc<AtomicBool>,
    revision: Arc<AtomicU64>,
    requests: DesktopRequests,
) -> ExitAction {
    let requests = Rc::new(requests);
    let recorder = &requests.recording;
    let tray = &requests.tray;
    let tools = &requests.tools;
    let mut exit = ExitAction::Quit;
    let (events, inbox) = async_channel::unbounded();
    let tray_events = events.clone();
    executor
        .spawn(async move {
            while let Ok(action) = actions.recv().await {
                if tray_events.send(Event::Action(action)).await.is_err() {
                    break;
                }
            }
        })
        .detach();
    {
        let mut worker: Option<WindowProcess> = None;
        let mut generation = 0;
        let mut active: Vec<async_executor::Task<()>> = Vec::new();
        while let Ok(event) = inbox.recv().await {
            let target = match event {
                Event::Action(Action::Exit) => break,
                Event::Action(Action::Today) => Some(Target::Today),
                Event::Action(Action::ToolNotice { dialog }) => Some(Target::Notice { dialog }),
                Event::Action(Action::WakeTools) => {
                    tools.wake();
                    None
                }
                Event::Action(Action::ToolChanged { background }) => {
                    if let Some(w) = &worker {
                        let _ = w.tx.send(ToWindow::ToolChanged { background });
                    }
                    None
                }
                Event::Action(Action::Mini { focus }) => Some(Target::Mini { focus }),
                Event::Action(action @ (Action::Refresh | Action::SetPaused(_))) => {
                    if let Action::SetPaused(paused) = action
                        && let Err(e) = recorder.set_paused(paused).await
                    {
                        eprintln!("tracking: {e}");
                    }
                    if let Err(e) = tray.update_recording(recorder.paused()) {
                        eprintln!("tray recording state: {e}");
                    }
                    if let Some(w) = &worker {
                        let _ = w.tx.send(ToWindow::Changed {
                            revision: revision.load(Ordering::Acquire),
                            activity: recorder.current_activity(),
                            paused: recorder.paused(),
                        });
                    }
                    None
                }
                Event::Message(id, msg) if worker.as_ref().is_some_and(|w| w.generation == id) => {
                    let current = worker.as_mut().unwrap();
                    match msg {
                        FromWindow::Open(target) => Some(target),
                        FromWindow::MainOpened(hwnd) => {
                            current.main_hwnd = hwnd;
                            if let Err(e) = tray.main_opened() {
                                eprintln!("apply tray visibility: {e}");
                            }
                            None
                        }
                        FromWindow::MainClosed => {
                            current.main_hwnd = None;
                            if !tray.behavior.get().should_keep_running_in_background() {
                                break;
                            }
                            None
                        }
                        FromWindow::Idle(serial) => {
                            if serial == current.serial {
                                windows_open.store(false, Ordering::Release);
                                worker = None;
                            }
                            None
                        }
                        FromWindow::Request(request_id, request) => {
                            let tx = current.tx.clone();
                            let caller = WindowCaller {
                                main_hwnd: current.main_hwnd,
                                pid: current.child.id(),
                            };
                            if let Err(error) = caller.authorize(&request) {
                                let _ = tx.send(ToWindow::answer(request_id, Err(error)));
                                continue;
                            }
                            let dispatch = Dispatch::for_request(&request);
                            if dispatch != Dispatch::Parallel {
                                if dispatch == Dispatch::ReplaceDatabase {
                                    for task in active.drain(..) {
                                        task.await;
                                    }
                                }
                                let result = requests.handle(*request).await;
                                let next = dispatch.exit_after(&result);
                                let _ = tx.send(ToWindow::answer(request_id, result));
                                if let Some(next) = next {
                                    exit = next;
                                    break;
                                }
                                continue;
                            }
                            active.retain(|task| !task.is_finished());
                            if active.len() >= patina_desktop_protocol::MAX_PENDING {
                                let _ = tx.send(ToWindow::Answer(
                                    request_id,
                                    Err(patina_desktop_protocol::RequestError::Busy),
                                ));
                                continue;
                            }
                            let requests = Rc::clone(&requests);
                            active.push(executor.spawn(async move {
                                let result = requests.handle(*request).await;
                                let _ = tx.send(ToWindow::answer(request_id, result));
                            }));
                            None
                        }
                    }
                }
                Event::Disconnected(id) => {
                    if worker.as_ref().is_some_and(|w| w.generation == id) {
                        worker = None;
                        windows_open.store(false, Ordering::Release);
                    }
                    None
                }
                Event::Message(_, _) => None,
            };
            if let Some(target) = target {
                if let Some(w) = worker.as_mut()
                    && w.open(target, recorder, revision.load(Ordering::Acquire))
                        .is_ok()
                {
                    continue;
                }
                drop(worker.take());
                generation += 1;
                windows_open.store(true, Ordering::Release);
                match requests
                    .preferences
                    .preferences()
                    .await
                    .map_err(io::Error::other)
                    .and_then(|preferences| {
                        WindowProcess::start(generation, &preferences, events.clone())
                    })
                    .and_then(|mut w| {
                        w.open(target, recorder, revision.load(Ordering::Acquire))?;
                        Ok(w)
                    }) {
                    Ok(w) => {
                        worker = Some(w);
                        windows_open.store(true, Ordering::Release);
                    }
                    Err(e) => {
                        windows_open.store(false, Ordering::Release);
                        eprintln!("start window process: {e}");
                        if matches!(target, Target::Notice { .. }) {
                            let _ = tools
                                .request(
                                    patina_desktop_protocol::tools::ToolRequest::DisplayFailed,
                                    requests.preferences.locale().tag(),
                                )
                                .await;
                        }
                    }
                }
            }
        }
        drop(worker);
        windows_open.store(false, Ordering::Release);
        for task in active {
            task.await;
        }
    }
    exit
}
