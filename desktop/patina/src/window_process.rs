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
    Update(patina_updater::Request),
    InstallUpdate,
    OpenExternal(String),
    Storage(patina_recorder::StorageRequest),
    Tools(crate::tool_service::ToolRequest),
    HistoryMinimum(bool, i64),
    DetailZoom(Option<f32>),
    HistoryZoom(Option<f32>),
    HistoryModes(Option<[u8; 3]>),
    Rules,
    ClassificationMode(bool),
    DeleteApplication(String, Option<patina_recorder::DeletionImpact>),
    DeleteWebsite(String, Option<patina_recorder::DeletionImpact>),
    SaveRules(
        Vec<patina_recorder::AppRule>,
        Option<patina_recorder::WebDraft>,
        Vec<patina_recorder::AppLinkEdit>,
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
        web: bool,
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
    MainOpened(Option<usize>),
    MainClosed,
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
            .args(recorder.schemes.borrow().iter())
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
        Query::OpenExternal(url) => {
            if !url.starts_with("https://") || url.contains('\0') {
                return Err("Invalid external link".into());
            }
            use windows::{core::{PCWSTR, w}, Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL}};
            let wide: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
            let result = unsafe { ShellExecuteW(None, w!("open"), PCWSTR(wide.as_ptr()), None, None, SW_SHOWNORMAL) };
            if result.0 as isize <= 32 { return Err("Could not open external link".into()); }
            Ok(Value::Null)
        }
        Query::Storage(request) => return recorder.storage(request).await,
        Query::Tools(request) => return tools.request(request, recorder.locale.get().tag()).await,
        Query::DetailZoom(hours) => serde_json::to_value(recorder.detail_zoom(hours).await?),
        Query::HistoryModes(modes) => serde_json::to_value(recorder.history_modes(modes).await?),
        Query::HistoryZoom(hours) => serde_json::to_value(recorder.history_zoom(hours).await?),
        Query::HistoryMinimum(d, v) => {
            serde_json::to_value(recorder.set_history_minimum(d, v).await?)
        }
        Query::Rules => serde_json::to_value(recorder.rules().await?),
        Query::ClassificationMode(web) => {
            serde_json::to_value(recorder.remember_classification_mode(web).await?)
        }
        Query::DeleteApplication(exe, confirmed) => {
            let apply = confirmed.is_some();
            let impact = recorder.delete_application(exe, confirmed).await?;
            if apply {
                tools.wake();
            }
            serde_json::to_value(impact)
        }
        Query::SaveRules(r, w, l, c) => {
            serde_json::to_value(recorder.save_rules(r, w, l, c).await?)
        }
        Query::DeleteWebsite(identity, confirmed) => {
            let apply = confirmed.is_some();
            let impact = recorder.delete_website(identity, confirmed).await?;
            if apply {
                tools.wake();
            }
            serde_json::to_value(impact)
        }
        Query::Preferences => serde_json::to_value(recorder.preferences().await?),
        Query::SavePreferences(..) | Query::Update(_) | Query::InstallUpdate => {
            unreachable!("host operations are serialized")
        }
        Query::Trends(r, k) => serde_json::to_value(recorder.trends(r, k).await?),
        Query::History {
            day,
            app,
            titles,
            web,
        } => serde_json::to_value(recorder.history_source(day, app, titles, web).await?),
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

async fn save_preferences(
    recorder: &Recorder,
    tray: &crate::tray::Tray,
    login: &crate::login::LoginEntry,
    old: patina_recorder::TrackingPreferences,
    next: patina_recorder::TrackingPreferences,
) -> Result<Value, String> {
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
    Ok(Value::Null)
}

pub(super) struct Services {
    pub tools: crate::tool_service::ToolService,
    pub tray: crate::tray::Tray,
    pub login: crate::login::LoginEntry,
    pub updater: patina_updater::Service,
}

/// The last-window notification only retires the process if it has handled the latest open request.
pub(super) fn serve(
    cx: &mut gpui_kit::App,
    actions: async_channel::Receiver<Action>,
    recorder: Rc<Recorder>,
    windows_open: Arc<AtomicBool>,
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
                                let result = updater.request(*command).and_then(|s| {
                                    serde_json::to_value(s).map_err(|e| e.to_string())
                                });
                                let _ = tx.send(ToWindow::Answer(request, result));
                                continue;
                            }
                            if matches!(query.as_ref(), Query::InstallUpdate) {
                                let result = if current.main_hwnd.is_none() {
                                    Err("Open the main window to install an update".into())
                                } else {
                                    let updater = updater.clone();
                                    cx.background_executor()
                                        .spawn(async move {
                                            let executable = std::env::current_exe()
                                                .map_err(|e| e.to_string())?;
                                            updater.begin_install(&executable)
                                        })
                                        .await
                                };
                                let installed = result.is_ok();
                                let _ =
                                    tx.send(ToWindow::Answer(request, result.map(|_| Value::Null)));
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
                                    let _ = tx.send(ToWindow::Answer(
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
                                let result = answer(&recorder, &tools, *query).await;
                                let restart = result.is_ok();
                                let _ = tx.send(ToWindow::Answer(request, result));
                                if restart {
                                    crate::RESTART_AFTER_STORAGE.store(true, Ordering::Release);
                                    break;
                                }
                                continue;
                            }
                            if matches!(
                                query.as_ref(),
                                Query::DetailZoom(_) | Query::HistoryZoom(_) | Query::HistoryModes(_)
                            ) {
                                let result = answer(&recorder, &tools, *query).await;
                                let _ = tx.send(ToWindow::Answer(request, result));
                                continue;
                            }
                            if let Query::SavePreferences(old, next) = *query {
                                let result =
                                    save_preferences(&recorder, &tray, &login, old, next).await;
                                let _ = tx.send(ToWindow::Answer(request, result));
                                continue;
                            }
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
