use crate::Action;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use patina_desktop_protocol::Reply;
use patina_recorder::Recorder;
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
    FromWindow, Query, Target, ToWindow, WIRE_VERSION, handshake, read_messages, writer,
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
        preferences: &patina_recorder::TrackingPreferences,
        events: async_channel::Sender<Event>,
    ) -> io::Result<Self> {
        let job =
            patina_windows_integration::windows::job::kill_on_close().map_err(io::Error::other)?;
        let mut child = Command::new(std::env::current_exe()?.with_file_name("patina-ui.exe"))
            .args([
                "--window-process",
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
    fn open(&mut self, target: Target, recorder: &Recorder, revision: u64) -> io::Result<()> {
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
                activity: recorder.activity(),
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

async fn answer(
    recorder: &Recorder,
    tools: &crate::tool_service::ToolService,
    query: Query,
) -> Result<Reply, String> {
    match query {
        Query::OpenExternal(url) => {
            if !url.starts_with("https://") || url.contains('\0') {
                return Err("Invalid external link".into());
            }
            use windows::{
                Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
                core::{PCWSTR, w},
            };
            let wide: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
            let result = unsafe {
                ShellExecuteW(
                    None,
                    w!("open"),
                    PCWSTR(wide.as_ptr()),
                    None,
                    None,
                    SW_SHOWNORMAL,
                )
            };
            if result.0 as isize <= 32 {
                return Err("Could not open external link".into());
            }
            Ok(Reply::Done)
        }
        Query::Storage(request) => recorder.storage(request).await.map(Reply::Storage),
        Query::Tools(request) => tools.request(request, recorder.locale.get().tag()).await,
        Query::DetailZoom(hours) => recorder.detail_zoom(hours).await.map(Reply::Zoom),
        Query::HistoryModes(modes) => recorder.history_modes(modes).await.map(Reply::HistoryModes),
        Query::HistoryZoom(hours) => recorder.history_zoom(hours).await.map(Reply::Zoom),
        Query::HistoryMinimum(d, v) => recorder
            .set_history_minimum(d, v)
            .await
            .map(|()| Reply::Done),
        Query::Rules => recorder.rules().await.map(Reply::Rules),
        Query::ClassificationMode(web) => recorder
            .remember_classification_mode(web)
            .await
            .map(|()| Reply::Done),
        Query::DeleteApplication(exe, confirmed) => {
            let apply = confirmed.is_some();
            let impact = recorder.delete_application(exe, confirmed).await?;
            if apply {
                tools.wake();
            }
            Ok(Reply::Deletion(impact))
        }
        Query::SaveRules(r, w, l, c) => recorder.save_rules(r, w, l, c).await.map(|()| Reply::Done),
        Query::DeleteWebsite(identity, confirmed) => {
            let apply = confirmed.is_some();
            let impact = recorder.delete_website(identity, confirmed).await?;
            if apply {
                tools.wake();
            }
            Ok(Reply::Deletion(impact))
        }
        Query::Preferences => recorder.preferences().await.map(Reply::Preferences),
        Query::SavePreferences(..) | Query::Update(_) | Query::InstallUpdate => {
            unreachable!("host operations are serialized")
        }
        Query::Trends(r, k) => recorder.trends(r, k).await.map(Reply::Trends),
        Query::History {
            day,
            app,
            titles,
            web,
        } => recorder
            .history_source(day, app, titles, web)
            .await
            .map(Reply::History),
        Query::Today => recorder.today().await.map(Reply::Today),
        Query::Recent => recorder.recent().await.map(Reply::Recent),
        Query::Icons(keys) => Ok(Reply::Icons(
            recorder
                .icons(keys)
                .await?
                .into_iter()
                .map(|(key, bytes)| (key, STANDARD.encode(bytes)))
                .collect::<Vec<_>>(),
        )),
        Query::ChartMode(mode) => recorder.set_chart_mode(mode).await.map(|()| Reply::Done),
        Query::Edit(key, edit) => recorder.edit_app(key, edit).await.map(|()| Reply::Done),
    }
}

async fn save_preferences(
    recorder: &Recorder,
    tray: &crate::tray::Tray,
    login: &crate::login::LoginEntry,
    old: patina_recorder::TrackingPreferences,
    next: patina_recorder::TrackingPreferences,
) -> Result<Reply, String> {
    let current = tray.behavior.get();
    if old.desktop != current && old.desktop != next.desktop {
        return Err("resident settings changed since loading".into());
    }
    let desired = if old.desktop == next.desktop {
        current
    } else {
        next.desktop
    };
    let login_changed = desired.launch_at_login != current.launch_at_login;
    if login_changed {
        login
            .apply(desired.launch_at_login)
            .map_err(|e| e.to_string())?;
    }
    let result = async {
        tray.apply_visibility(desired).map_err(|e| e.to_string())?;
        recorder.save_preferences(old, next).await
    }
    .await;
    if let Err(error) = result {
        let icon = tray.apply_visibility(current);
        let registration = if login_changed {
            login.apply(current.launch_at_login)
        } else {
            Ok(())
        };
        if icon.is_err() || registration.is_err() {
            return Err(format!(
                "{error}; restore tray: {icon:?}, restore login: {registration:?}"
            ));
        }
        return Err(error);
    }
    tray.behavior.set(desired);
    Ok(Reply::Done)
}

pub(super) struct Services {
    pub tools: crate::tool_service::ToolService,
    pub tray: crate::tray::Tray,
    pub login: crate::login::LoginEntry,
    pub updater: patina_updater::Service,
}

/// The last-window notification only retires the process if it has handled the latest open request.
pub(super) async fn serve(
    executor: &async_executor::LocalExecutor<'_>,
    actions: async_channel::Receiver<Action>,
    recorder: Rc<Recorder>,
    windows_open: Arc<AtomicBool>,
    revision: Arc<AtomicU64>,
    services: Services,
) {
    let Services {
        tools,
        tray,
        login,
        updater,
    } = services;
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
                    if let Some(w) = &worker {
                        let _ = w.tx.send(ToWindow::Changed {
                            revision: revision.load(Ordering::Acquire),
                            activity: recorder.activity(),
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
                        FromWindow::Query(request, query) => {
                            let tx = current.tx.clone();
                            if let Query::Update(command) = query.as_ref() {
                                let result = updater.request(*command).map(Reply::Update);
                                let _ = tx.send(ToWindow::answer(request, result));
                                continue;
                            }
                            if matches!(query.as_ref(), Query::InstallUpdate) {
                                let result = if current.main_hwnd.is_none() {
                                    Err("Open the main window to install an update".into())
                                } else {
                                    let updater = updater.clone();
                                    blocking::unblock(move || {
                                        let executable =
                                            std::env::current_exe().map_err(|e| e.to_string())?;
                                        updater.begin_install(&executable)
                                    })
                                    .await
                                };
                                let installed = result.is_ok();
                                let _ =
                                    tx.send(ToWindow::answer(request, result.map(|_| Reply::Done)));
                                if installed {
                                    break;
                                }
                                continue;
                            }
                            if let Query::Storage(patina_recorder::StorageRequest::DavReveal(
                                hwnd,
                            )) = query.as_ref()
                            {
                                use windows::Win32::{
                                    Foundation::HWND,
                                    UI::WindowsAndMessaging::{
                                        GetForegroundWindow, GetWindowThreadProcessId,
                                    },
                                };
                                let handle = HWND(*hwnd as _);
                                let mut pid = 0;
                                let foreground = unsafe {
                                    GetWindowThreadProcessId(handle, Some(&mut pid));
                                    GetForegroundWindow()
                                };
                                if current.main_hwnd != Some(*hwnd)
                                    || pid != current.child.id()
                                    || foreground != handle
                                {
                                    let _ = tx.send(ToWindow::answer(
                                        request,
                                        Err(
                                            "Open the main Settings window to reveal this password"
                                                .into(),
                                        ),
                                    ));
                                    continue;
                                }
                            }
                            if matches!(
                                query.as_ref(),
                                Query::Storage(
                                    patina_recorder::StorageRequest::Move(_)
                                        | patina_recorder::StorageRequest::Restore { .. }
                                )
                            ) {
                                for task in active.drain(..) {
                                    task.await;
                                }
                                let result = answer(&recorder, &tools, *query).await;
                                let restart = result.is_ok();
                                let _ = tx.send(ToWindow::answer(request, result));
                                if restart {
                                    crate::RESTART_AFTER_STORAGE.store(true, Ordering::Release);
                                    break;
                                }
                                continue;
                            }
                            if matches!(
                                query.as_ref(),
                                Query::DetailZoom(_)
                                    | Query::HistoryZoom(_)
                                    | Query::HistoryModes(_)
                            ) {
                                let result = answer(&recorder, &tools, *query).await;
                                let _ = tx.send(ToWindow::answer(request, result));
                                continue;
                            }
                            if let Query::SavePreferences(old, next) = *query {
                                let result =
                                    save_preferences(&recorder, &tray, &login, old, next).await;
                                let _ = tx.send(ToWindow::answer(request, result));
                                continue;
                            }
                            active.retain(|task| !task.is_finished());
                            if active.len() >= patina_desktop_protocol::MAX_PENDING {
                                let _ = tx.send(ToWindow::Answer(
                                    request,
                                    Err(patina_desktop_protocol::RequestError::Busy),
                                ));
                                continue;
                            }
                            let recorder = recorder.clone();
                            let tools = tools.clone();
                            active.push(executor.spawn(async move {
                                let result = answer(&recorder, &tools, *query).await;
                                let _ = tx.send(ToWindow::answer(request, result));
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
                    && w.open(target, &recorder, revision.load(Ordering::Acquire))
                        .is_ok()
                {
                    continue;
                }
                drop(worker.take());
                generation += 1;
                windows_open.store(true, Ordering::Release);
                match recorder
                    .preferences()
                    .await
                    .map_err(io::Error::other)
                    .and_then(|preferences| {
                        WindowProcess::start(generation, &preferences, events.clone())
                    })
                    .and_then(|mut w| {
                        w.open(target, &recorder, revision.load(Ordering::Acquire))?;
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
                                    recorder.locale.get().tag(),
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
}
