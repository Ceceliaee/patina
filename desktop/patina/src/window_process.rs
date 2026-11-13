use crate::Action;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use patina_recorder::{Activity, AppEdit, Recorder};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{
    io::{self, BufRead, BufReader, BufWriter, Write},
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
        atomic::{AtomicBool, Ordering},
    },
};

#[derive(Clone, Copy, Serialize, Deserialize)]
pub(super) enum Target {
    Today,
    Notice { dialog: bool },
    Tool(patina_recorder::ToolTarget),
    Mini { focus: bool },
}

#[derive(Serialize, Deserialize)]
pub(super) enum Query {
    Tools(crate::tool_service::ToolRequest),
    HistoryMinimum(bool, i64),
    Rules,
    SaveRules(
        Vec<patina_recorder::AppRule>,
        Vec<patina_recorder::CategoryEdit>,
    ),
    Preferences,
    SavePreferences(
        patina_recorder::TrackingPreferences,
        patina_recorder::TrackingPreferences,
    ),
    Trends(Option<(i64, i64)>, patina_recorder::SeriesKind),
    History {
        day: i64,
        app: Option<String>,
        titles: bool,
    },
    Today,
    Recent,
    Icons(Vec<String>),
    ChartMode(bool),
    Edit(String, AppEdit),
}

#[derive(Serialize, Deserialize)]
pub(super) enum ToWindow {
    ToolChanged {
        background: bool,
    },
    Open {
        serial: u64,
        target: Target,
        activity: Activity,
        paused: bool,
    },
    Changed {
        activity: Activity,
        paused: bool,
    },
    Answer(u64, Result<Value, String>),
    Exit,
}

#[derive(Serialize, Deserialize)]
pub(super) enum FromWindow {
    Open(Target),
    Idle(u64),
    Query(u64, Box<Query>),
}

enum Event {
    Action(Action),
    Message(u64, FromWindow),
    Disconnected(u64),
}

pub(super) fn read_messages<T: DeserializeOwned>(
    stream: impl io::Read,
    mut deliver: impl FnMut(T) -> bool,
) -> io::Result<()> {
    let mut reader = BufReader::new(stream);
    let mut line = Vec::new();
    loop {
        line.clear();
        if reader.read_until(b'\n', &mut line)? == 0 {
            return Ok(());
        }
        if !deliver(serde_json::from_slice(&line)?) {
            return Ok(());
        }
    }
}

pub(super) fn writer<T: Serialize + Send + 'static>(
    stream: impl Write + Send + 'static,
) -> io::Result<mpsc::Sender<T>> {
    let (tx, rx) = mpsc::channel();
    thread::Builder::new()
        .name("window-pipe-write".into())
        .spawn(move || {
            let mut stream = BufWriter::new(stream);
            for message in rx {
                if serde_json::to_writer(&mut stream, &message).is_err()
                    || stream
                        .write_all(b"\n")
                        .and_then(|()| stream.flush())
                        .is_err()
                {
                    break;
                }
            }
        })?;
    Ok(tx)
}

struct WindowProcess {
    child: Child,
    _job: OwnedHandle,
    generation: u64,
    serial: u64,
    tx: mpsc::Sender<ToWindow>,
}

impl WindowProcess {
    fn start(
        generation: u64,
        recorder: &Recorder,
        events: async_channel::Sender<Event>,
    ) -> io::Result<Self> {
        let job = patina_recorder::child_job().map_err(io::Error::other)?;
        let mut child = Command::new(std::env::current_exe()?)
            .args([
                "--window-process",
                recorder.locale.get().tag(),
                recorder.theme.get().tag(),
            ])
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
                    if let Err(e) = read_messages(stdout, |msg| {
                        events
                            .send_blocking(Event::Message(generation, msg))
                            .is_ok()
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
                tx,
            }),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                Err(e)
            }
        }
    }
    fn open(&mut self, target: Target, recorder: &Recorder) -> io::Result<()> {
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
) -> Result<Value, String> {
    let encoded = match query {
        Query::Tools(request) => return tools.request(request, recorder.locale.get().tag()).await,
        Query::HistoryMinimum(d, v) => {
            serde_json::to_value(recorder.set_history_minimum(d, v).await?)
        }
        Query::Rules => serde_json::to_value(recorder.rules().await?),
        Query::SaveRules(r, c) => serde_json::to_value(recorder.save_rules(r, c).await?),
        Query::Preferences => serde_json::to_value(recorder.preferences().await?),
        Query::SavePreferences(old, p) => {
            serde_json::to_value(recorder.save_preferences(old, p).await?)
        }
        Query::Trends(r, k) => serde_json::to_value(recorder.trends(r, k).await?),
        Query::History { day, app, titles } => {
            serde_json::to_value(recorder.history(day, app, titles).await?)
        }
        Query::Today => serde_json::to_value(recorder.today().await?),
        Query::Recent => serde_json::to_value(recorder.recent().await?),
        Query::Icons(keys) => serde_json::to_value(
            recorder
                .icons(keys)
                .await?
                .into_iter()
                .map(|(key, bytes)| (key, STANDARD.encode(bytes)))
                .collect::<Vec<_>>(),
        ),
        Query::ChartMode(mode) => serde_json::to_value(recorder.set_chart_mode(mode).await?),
        Query::Edit(key, edit) => serde_json::to_value(recorder.edit_app(key, edit).await?),
    };
    encoded.map_err(|e| e.to_string())
}

/// The last-window notification only retires the process if it has handled the latest open request.
pub(super) fn serve(
    cx: &mut gpui_kit::App,
    actions: async_channel::Receiver<Action>,
    recorder: Rc<Recorder>,
    windows_open: Arc<AtomicBool>,
    tools: crate::tool_service::ToolService,
) {
    let (events, inbox) = async_channel::unbounded();
    let tray_events = events.clone();
    cx.spawn(async move |_| {
        while let Ok(action) = actions.recv().await {
            if tray_events.send(Event::Action(action)).await.is_err() {
                break;
            }
        }
    })
    .detach();
    cx.spawn(async move |cx| {
        let mut worker: Option<WindowProcess> = None;
        let mut generation = 0;
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
                            activity: recorder.activity(),
                            paused: recorder.paused(),
                        });
                    }
                    None
                }
                Event::Message(id, msg) if worker.as_ref().is_some_and(|w| w.generation == id) => {
                    let current = worker.as_ref().unwrap();
                    match msg {
                        FromWindow::Open(target) => Some(target),
                        FromWindow::Idle(serial) => {
                            if serial == current.serial {
                                windows_open.store(false, Ordering::Release);
                                worker = None;
                            }
                            None
                        }
                        FromWindow::Query(request, query) => {
                            let tx = current.tx.clone();
                            let recorder = recorder.clone();
                            let tools = tools.clone();
                            cx.spawn(async move |_| {
                                let result = answer(&recorder, &tools, *query).await;
                                let _ = tx.send(ToWindow::Answer(request, result));
                            })
                            .detach();
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
                    && w.open(target, &recorder).is_ok()
                {
                    continue;
                }
                drop(worker.take());
                generation += 1;
                match WindowProcess::start(generation, &recorder, events.clone()).and_then(
                    |mut w| {
                        w.open(target, &recorder)?;
                        Ok(w)
                    },
                ) {
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
                                    crate::tool_service::ToolRequest::DisplayFailed,
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
        cx.update(|cx| cx.quit());
    })
    .detach();
}
