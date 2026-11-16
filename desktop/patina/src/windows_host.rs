pub(crate) mod eyedropper;

use crate::{
    app_windows::AppWindows,
    window_process::{FromWindow, Query, Target, ToWindow, read_messages, writer},
};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use gpui_kit::{QuitMode, WindowingRequest};
use patina_recorder::{Activity, AppEdit, DaySummary, Locale, Recent};
use serde::de::DeserializeOwned;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    io,
    rc::Rc,
    sync::mpsc,
};

type Reply = Result<serde_json::Value, String>;

pub(super) struct Client {
    shortcuts: RefCell<Vec<patina_recorder::Shortcut>>,
    shortcut_revision: Cell<u64>,
    clock: RefCell<Option<gpui_kit::Task<()>>>,
    pub(super) locale: Cell<Locale>,
    pub(super) theme: Cell<patina_recorder::Theme>,
    pub(super) schemes: RefCell<[String; 2]>,
    pub(super) scheme_preview: Cell<Option<(gpui_kit::WindowId, bool, &'static str)>>,
    activity: RefCell<Activity>,
    paused: Cell<bool>,
    serial: Cell<u64>,
    next: Cell<u64>,
    pending: RefCell<HashMap<u64, async_channel::Sender<Reply>>>,
    tx: mpsc::Sender<FromWindow>,
}

impl Client {
    fn refresh_shortcuts(self: &Rc<Self>, cx: &mut gpui_kit::App) {
        let revision = self.shortcut_revision.get().wrapping_add(1);
        self.shortcut_revision.set(revision);
        let request = self.request(Query::Tools(crate::tool_service::ToolRequest::Shortcuts));
        let client = self.clone();
        cx.spawn(async move |cx| {
            if let Ok(shortcuts) = request.await
                && client.shortcut_revision.get() == revision
            {
                client.shortcuts.replace(shortcuts);
                cx.update(|cx| {
                    client.start_clock(cx);
                    cx.refresh_windows();
                });
            }
        })
        .detach();
    }

    fn start_clock(self: &Rc<Self>, cx: &mut gpui_kit::App) {
        self.clock.borrow_mut().take();
        if self.shortcuts.borrow().is_empty() {
            return;
        }
        let weak = Rc::downgrade(self);
        *self.clock.borrow_mut() = Some(cx.spawn(async move |cx| {
            loop {
                let Some(client) = weak.upgrade() else { break };
                let interval = if client
                    .shortcuts
                    .borrow()
                    .iter()
                    .any(|s| s.target == patina_recorder::ToolTarget::Focus)
                {
                    1000
                } else {
                    60000
                };
                drop(client);
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(interval))
                    .await;
                cx.update(|cx| cx.refresh_windows());
            }
        }));
    }

    pub fn shortcut_buttons(self: &Rc<Self>, compact: bool) -> Vec<gpui_kit::AnyElement> {
        use gpui_kit::{base::Button, prelude::*, *};
        let now = patina_tool_host::now_ms();
        self.shortcuts
            .borrow()
            .iter()
            .filter_map(|s| {
                let target = s.target;
                if target == patina_recorder::ToolTarget::Reminders
                    && !(0..=86_400_000).contains(&(s.at - now))
                {
                    return None;
                }
                let (id, key, icon) = match target {
                    patina_recorder::ToolTarget::Focus => {
                        ("status-focus", "tools.pomodoroTitle", quietpro::Icon::Clock)
                    }
                    patina_recorder::ToolTarget::Reminders => (
                        "status-reminder",
                        "tools.remindersTitle",
                        quietpro::Icon::Bell,
                    ),
                };
                let display = if compact {
                    quietpro::glyph(icon, rgba(0x828999ff)).into_any_element()
                } else {
                    let sec = (if s.counting_up {
                        now - s.at
                    } else {
                        s.at - now
                    })
                    .max(0)
                        / 1000;
                    div()
                        .child(format!("{} {:02}:{:02}", s.label, sec / 60, sec % 60))
                        .into_any_element()
                };
                let client = self.clone();
                let name = format!(
                    "{} · {}",
                    patina_recorder::text(self.locale.get(), key),
                    s.label
                );
                Some(
                    Button::new(id)
                        .accessibility_label(name)
                        .px(px(4.))
                        .child(display)
                        .on_click(move |_, _, _| client.open(Target::Tool(target)))
                        .into_any_element(),
                )
            })
            .collect()
    }
    pub(super) fn dark(&self, win: &gpui_kit::Window) -> bool {
        use patina_recorder::Theme;
        match self.theme.get() {
            Theme::Light => false,
            Theme::Dark => true,
            Theme::System => matches!(
                win.appearance(),
                gpui_kit::WindowAppearance::Dark | gpui_kit::WindowAppearance::VibrantDark
            ),
        }
    }
    pub(super) fn palette(&self, win: &gpui_kit::Window) -> quietpro::Palette {
        if let Some((window, dark, id)) = self.scheme_preview.get()
            && window == win.window_handle().window_id()
        {
            return quietpro::Palette::for_scheme(dark, id);
        }
        let dark = self.dark(win);
        quietpro::Palette::for_scheme(dark, &self.schemes.borrow()[usize::from(dark)])
    }
    pub(super) fn activity(&self) -> Activity {
        self.activity.borrow().clone()
    }
    pub(super) fn paused(&self) -> bool {
        self.paused.get()
    }
    pub(super) fn open(&self, target: Target) {
        let _ = self.tx.send(FromWindow::Open(target));
    }
    pub(super) fn main_opened(&self, window: &gpui_kit::Window) {
        let hwnd = crate::dock::hwnd(window).ok().map(|h| h.0 as usize);
        let _ = self.tx.send(FromWindow::MainOpened(hwnd));
    }
    pub(super) fn close_main(&self, window: &mut gpui_kit::Window) {
        let _ = self.tx.send(FromWindow::MainClosed);
        window.remove_window();
    }
    pub(super) fn request<T: DeserializeOwned>(
        &self,
        query: Query,
    ) -> impl Future<Output = Result<T, String>> + 'static {
        let id = self.next.get();
        self.next.set(id + 1);
        let (tx, rx) = async_channel::bounded(1);
        self.pending.borrow_mut().insert(id, tx);
        if self
            .tx
            .send(FromWindow::Query(id, Box::new(query)))
            .is_err()
        {
            self.pending.borrow_mut().remove(&id);
        }
        async move {
            let value = rx
                .recv()
                .await
                .map_err(|_| "recording host disconnected".to_string())??;
            serde_json::from_value(value).map_err(|e| e.to_string())
        }
    }
    pub(super) fn today(&self) -> impl Future<Output = Result<DaySummary, String>> + 'static {
        self.request(Query::Today)
    }
    pub(super) fn trends(
        &self,
        range: Option<(i64, i64)>,
        kind: patina_recorder::SeriesKind,
    ) -> impl Future<Output = Result<patina_recorder::Trends, String>> + 'static {
        self.request(Query::Trends(range, kind))
    }
    pub(super) fn history(
        &self,
        day: i64,
        app: Option<String>,
        titles: bool,
        web: bool,
    ) -> impl Future<Output = Result<patina_recorder::HistoryDay, String>> + 'static {
        self.request(Query::History {
            day,
            app,
            titles,
            web,
        })
    }
    pub(super) fn recent(&self) -> impl Future<Output = Result<Recent, String>> + 'static {
        self.request(Query::Recent)
    }
    pub(super) fn set_chart_mode(
        &self,
        mode: bool,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::ChartMode(mode))
    }
    pub(super) fn edit_app(
        &self,
        key: String,
        edit: AppEdit,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::Edit(key, edit))
    }
    pub(super) fn icons(
        &self,
        keys: Vec<String>,
    ) -> impl Future<Output = Result<Vec<(String, Vec<u8>)>, String>> + 'static {
        let read = self.request::<Vec<(String, String)>>(Query::Icons(keys));
        async move {
            read.await?
                .into_iter()
                .map(|(k, v)| {
                    STANDARD
                        .decode(v)
                        .map(|b| (k, b))
                        .map_err(|e| e.to_string())
                })
                .collect()
        }
    }
    fn idle(&self) {
        let _ = self.tx.send(FromWindow::Idle(self.serial.get()));
    }
}

pub fn run_if_requested() -> Option<Result<(), Box<dyn std::error::Error>>> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--window-process")) {
        return None;
    }
    let Some(tag) = args.next() else {
        return Some(Err("window process needs the host locale".into()));
    };
    let theme = args
        .next()
        .map(|s| patina_recorder::Theme::read(&s.to_string_lossy()))
        .unwrap_or_default();
    let schemes = std::array::from_fn(|_| {
        args.next()
            .map_or_else(|| "default".into(), |s| s.to_string_lossy().into_owned())
    });
    if args.next().is_some() {
        return Some(Err("unexpected window process argument".into()));
    }
    Some(run(Locale::from_tag(tag.to_str()), theme, schemes))
}

fn run(
    locale: Locale,
    theme: patina_recorder::Theme,
    schemes: [String; 2],
) -> Result<(), Box<dyn std::error::Error>> {
    crate::dock::enable_monitor_dpi()?;
    let tx = writer(io::stdout())?;
    let (inbox, messages) = async_channel::unbounded();
    std::thread::Builder::new()
        .name("recording-pipe-read".into())
        .spawn(move || {
            if let Err(e) = read_messages(io::stdin(), |msg| inbox.send_blocking(msg).is_ok()) {
                eprintln!("read recording host: {e}");
            }
        })?;
    gpui_kit::application()
        .with_assets(quietpro::QuietProAssets)
        .with_windowing(WindowingRequest::Headless)
        .with_quit_mode(QuitMode::Explicit)
        .run(move |cx| {
            gpui_kit::init(cx);
            let client = Rc::new(Client {
                shortcuts: Default::default(),
                shortcut_revision: Cell::new(0),
                clock: Default::default(),
                locale: Cell::new(locale),
                theme: Cell::new(theme),
                schemes: RefCell::new(schemes),
                scheme_preview: Cell::new(None),
                activity: RefCell::new(Activity::Waiting),
                paused: Cell::new(false),
                serial: Cell::new(0),
                next: Cell::new(0),
                pending: Default::default(),
                tx,
            });
            let close = client.clone();
            cx.on_window_closed(move |cx, _| {
                if cx.windows().is_empty() {
                    close.idle();
                }
            })
            .detach();
            let mut windows = AppWindows::default();
            cx.spawn(async move |cx| {
                while let Ok(msg) = messages.recv().await {
                    match msg {
                        ToWindow::Open {
                            serial,
                            target,
                            activity,
                            paused,
                        } => {
                            client.serial.set(serial);
                            client.activity.replace(activity);
                            client.paused.set(paused);
                            match target {
                                Target::Today => windows.open_main(&client, None, cx).await,
                                Target::Tool(target) => {
                                    windows.open_main(&client, Some(target), cx).await
                                }
                                Target::Notice { dialog } => {
                                    let shown = if dialog {
                                        windows.show_dialog(&client, cx).await
                                    } else {
                                        windows.show_notice(&client, cx).await
                                    };
                                    if !shown {
                                        let result = client.request::<()>(Query::Tools(
                                            crate::tool_service::ToolRequest::DisplayFailed,
                                        ));
                                        cx.update(|cx| {
                                            cx.spawn(async move |_| {
                                                let _ = result.await;
                                            })
                                            .detach()
                                        });
                                    }
                                }
                                Target::Mini { focus } => {
                                    windows.open_mini(focus, &client, cx).await
                                }
                            }
                            cx.update(|cx| client.refresh_shortcuts(cx));
                            if cx.update(|cx| cx.windows().is_empty()) {
                                client.idle();
                            }
                        }
                        ToWindow::ToolChanged { background } => {
                            cx.update(|cx| {
                                client.refresh_shortcuts(cx);
                                windows.refresh_notices(cx);
                                if background {
                                    windows.refresh_tools(cx);
                                }
                            });
                        }
                        ToWindow::Changed { activity, paused } => {
                            client.activity.replace(activity);
                            let previous = client.paused.replace(paused);
                            cx.update(|cx| {
                                if previous != paused {
                                    windows.pause_changed(cx)
                                } else {
                                    windows.recording_changed(cx)
                                }
                            });
                        }
                        ToWindow::Answer(id, result) => {
                            if let Some(waiter) = client.pending.borrow_mut().remove(&id) {
                                let _ = waiter.try_send(result);
                            }
                        }
                        ToWindow::Exit => break,
                    }
                }
                client.pending.borrow_mut().clear();
                cx.update(|cx| cx.quit());
            })
            .detach();
        });
    Ok(())
}
