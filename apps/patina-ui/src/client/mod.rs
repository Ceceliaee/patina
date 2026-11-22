mod requests;
use patina_desktop_protocol::{
    FromWindow, MainNavigation, MainTarget, Target, ToWindow, WindowRequest, handshake,
    read_messages, writer,
};

use crate::windows::AppWindows;
use gpui_kit::{QuitMode, WindowingRequest};
use patina_activity_model::{CurrentActivity, Locale};
use patina_desktop_protocol::{FromReply, MAX_PENDING, RequestError};
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    io,
    rc::Rc,
    sync::mpsc,
};

type Reply = Result<patina_desktop_protocol::Reply, RequestError>;
type Pending = RefCell<HashMap<u64, async_channel::Sender<Reply>>>;

struct PendingRequest {
    id: u64,
    requests: std::rc::Weak<Pending>,
}
impl Drop for PendingRequest {
    fn drop(&mut self) {
        if let Some(requests) = self.requests.upgrade() {
            requests.borrow_mut().remove(&self.id);
        }
    }
}

pub(crate) struct Client {
    pub(crate) navigation: Cell<MainNavigation>,
    shortcuts: RefCell<Vec<patina_activity_model::Shortcut>>,
    shortcut_revision: Cell<u64>,
    clock: RefCell<Option<gpui_kit::Task<()>>>,
    pub(crate) locale: Cell<Locale>,
    pub(crate) activity_revision: Cell<u64>,
    pub(crate) theme: Cell<patina_activity_model::Theme>,
    pub(crate) window_scale: Cell<u16>,
    pub(crate) schemes: RefCell<[String; 2]>,
    pub(crate) scheme_preview: Cell<Option<(gpui_kit::WindowId, bool, &'static str)>>,
    activity: RefCell<CurrentActivity>,
    paused: Cell<bool>,
    serial: Cell<u64>,
    revision: Cell<u64>,
    next_request_id: Cell<u64>,
    pending: Rc<Pending>,
    tx: mpsc::Sender<FromWindow>,
}

impl Client {
    pub(crate) fn new(
        locale: Locale,
        theme: patina_activity_model::Theme,
        schemes: [String; 2],
        tx: mpsc::Sender<FromWindow>,
    ) -> Self {
        Self {
            navigation: Cell::default(),
            shortcuts: Default::default(),
            shortcut_revision: Cell::new(0),
            clock: Default::default(),
            locale: Cell::new(locale),
            activity_revision: Cell::new(0),
            theme: Cell::new(theme),
            window_scale: Cell::new(patina_activity_model::AppPreferences::default_scale()),
            schemes: RefCell::new(schemes),
            scheme_preview: Cell::new(None),
            activity: RefCell::new(CurrentActivity::Waiting),
            paused: Cell::new(false),
            serial: Cell::new(0),
            revision: Cell::new(0),
            next_request_id: Cell::new(0),
            pending: Default::default(),
            tx,
        }
    }

    fn disconnect(&self) {
        self.pending.borrow_mut().clear();
    }

    fn receive_answer(&self, id: u64, result: Reply) {
        if let Some(waiter) = self.pending.borrow_mut().remove(&id) {
            let _ = waiter.try_send(result);
        }
    }

    fn refresh_shortcuts(self: &Rc<Self>, cx: &mut gpui_kit::App) {
        let revision = self.shortcut_revision.get().wrapping_add(1);
        self.shortcut_revision.set(revision);
        let request = self.tool(patina_desktop_protocol::tools::call::shortcuts());
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
                    .any(|s| s.target.is_focus())
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

    pub fn shortcut_buttons(
        self: &Rc<Self>,
        colors: quietpro::Palette,
    ) -> Vec<gpui_kit::AnyElement> {
        use gpui_kit::{prelude::*, *};
        use quietpro::{Icon, IconControl};
        let now = patina_desktop_protocol::tools::now_ms();
        self.shortcuts
            .borrow()
            .iter()
            .filter_map(|s| {
                let target = s.target;
                let (id, key, icon, time) = if target.is_focus() {
                    let seconds = (if s.counting_up {
                        now.saturating_sub(s.at)
                    } else {
                        s.at.saturating_sub(now)
                    })
                    .max(0)
                        / 1000;
                    (
                        "status-focus",
                        "tools.pomodoroTitle",
                        Icon::AlarmClock,
                        format!("{:02}:{:02}", seconds / 60, seconds % 60),
                    )
                } else {
                    if !(0..=86_400_000).contains(&s.at.saturating_sub(now)) {
                        return None;
                    }
                    let due = chrono::DateTime::from_timestamp_millis(s.at)?
                        .with_timezone(&chrono::Local);
                    (
                        "status-reminder",
                        "tools.remindersTitle",
                        Icon::BellRing,
                        due.format("%H:%M").to_string(),
                    )
                };
                let client = self.clone();
                let kind = patina_i18n::text(self.locale.get(), key);
                let name = if s.label.is_empty() || s.label == kind {
                    kind
                } else {
                    format!("{kind} ･ {}", s.label)
                };
                let id = target
                    .generation()
                    .map_or_else(|| id.into(), |g| format!("{id}-{g}"));
                let tip = format!("{name} · {time}");
                let button = IconControl::new(SharedString::from(id), name, icon)
                    .action(colors, move |_, _, _| {
                        client.open(Target::Main(MainTarget::Tool(target)))
                    });
                Some(quietpro::with_text_tooltip(button, tip, colors).into_any_element())
            })
            .collect()
    }
    pub(crate) fn dark(&self, win: &gpui_kit::Window) -> bool {
        use patina_activity_model::Theme;
        match self.theme.get() {
            Theme::Light => false,
            Theme::Dark => true,
            Theme::System => matches!(
                win.appearance(),
                gpui_kit::WindowAppearance::Dark | gpui_kit::WindowAppearance::VibrantDark
            ),
        }
    }
    pub(crate) fn palette(&self, win: &gpui_kit::Window) -> quietpro::Palette {
        if let Some((window, dark, id)) = self.scheme_preview.get()
            && window == win.window_handle().window_id()
        {
            return quietpro::Palette::for_scheme(dark, id);
        }
        let dark = self.dark(win);
        quietpro::Palette::for_scheme(dark, &self.schemes.borrow()[usize::from(dark)])
    }
    pub(crate) fn current_activity(&self) -> CurrentActivity {
        self.activity.borrow().clone()
    }
    pub(crate) fn paused(&self) -> bool {
        self.paused.get()
    }
    pub(crate) fn open(&self, target: Target) {
        let _ = self.tx.send(FromWindow::Open(target));
    }
    pub(crate) fn main_opened(&self, window: &gpui_kit::Window) {
        let hwnd = crate::windows::placement::hwnd(window)
            .ok()
            .map(|h| h.0 as usize);
        let _ = self.tx.send(FromWindow::MainOpened(hwnd));
    }
    pub(crate) fn remember_window_scale(&self, percent: u16) {
        if self.window_scale.replace(percent) != percent {
            let _ = self.tx.send(FromWindow::WindowScale(percent));
        }
    }
    pub(crate) fn remember_navigation(&self, navigation: MainNavigation) {
        self.navigation.set(navigation);
        let _ = self.tx.send(FromWindow::Navigation(navigation));
    }
    pub(crate) fn set_hourly_by_category(&self, hourly_by_category: bool) {
        self.remember_navigation(MainNavigation {
            hourly_by_category,
            ..self.navigation.get()
        });
    }
    pub(crate) fn close_main(&self, window: &mut gpui_kit::Window) {
        let _ = self.tx.send(FromWindow::MainClosed);
        window.remove_window();
    }
    fn request<T: FromReply>(
        &self,
        request: WindowRequest,
    ) -> impl Future<Output = Result<T, RequestError>> + 'static {
        use patina_activity_model::StorageRequest;
        if matches!(
            &request,
            WindowRequest::Edit(..)
                | WindowRequest::SavePreferences(..)
                | WindowRequest::SaveRules(..)
                | WindowRequest::DeleteApplication(_, Some(_))
                | WindowRequest::DeleteWebsite(_, Some(_))
                | WindowRequest::Storage(
                    StorageRequest::Import { .. }
                        | StorageRequest::DeleteBatch(_)
                        | StorageRequest::Restore { .. }
                        | StorageRequest::Cleanup(_)
                        | StorageRequest::Move(_)
                )
        ) {
            self.activity_revision
                .set(self.activity_revision.get().wrapping_add(1));
        }
        let id = self.next_request_id.get();
        let (tx, rx) = async_channel::bounded(1);
        let reservation = if self.pending.borrow().len() >= MAX_PENDING {
            Err(RequestError::Busy)
        } else if let Some(next) = id.checked_add(1) {
            self.next_request_id.set(next);
            self.pending.borrow_mut().insert(id, tx);
            let guard = PendingRequest {
                id,
                requests: Rc::downgrade(&self.pending),
            };
            self.tx
                .send(FromWindow::Request(id, Box::new(request)))
                .map(|()| guard)
                .map_err(|_| RequestError::Disconnected)
        } else {
            Err(RequestError::SequenceExhausted)
        };
        async move {
            let _guard = reservation?;
            let value = rx.recv().await.map_err(|_| RequestError::Disconnected)??;
            T::from_reply(value).map_err(RequestError::Rejected)
        }
    }
    fn idle(&self) {
        let _ = self.tx.send(FromWindow::Idle(self.serial.get()));
    }
}

pub fn run_if_requested() -> Option<Result<(), Box<dyn std::error::Error>>> {
    let mut args = std::env::args_os().skip(1);
    if args.next().as_deref() != Some(std::ffi::OsStr::new("--role"))
        || args.next().as_deref() != Some(std::ffi::OsStr::new("Patina UI"))
    {
        return None;
    }
    if args.next().as_deref() != Some(std::ffi::OsStr::new(patina_desktop_protocol::WIRE_VERSION)) {
        return Some(Err("Unsupported desktop protocol version".into()));
    }
    let Some(tag) = args.next() else {
        return Some(Err("window process needs the host locale".into()));
    };
    let theme = args
        .next()
        .map(|s| patina_activity_model::Theme::read(&s.to_string_lossy()))
        .unwrap_or_default();
    let schemes = std::array::from_fn(|_| {
        args.next()
            .map_or_else(|| "default".into(), |s| s.to_string_lossy().into_owned())
    });
    let scale = args
        .next()
        .and_then(|s| s.to_str()?.parse::<u16>().ok())
        .unwrap_or_else(patina_activity_model::AppPreferences::default_scale);
    if args.next().is_some() {
        return Some(Err("unexpected window process argument".into()));
    }
    Some(run(Locale::from_tag(tag.to_str()), theme, schemes, scale))
}

fn run(
    locale: Locale,
    theme: patina_activity_model::Theme,
    schemes: [String; 2],
    scale: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let host = handshake(io::stdin())?;
    crate::windows::placement::enable_monitor_dpi()?;
    let tx = writer(io::stdout())?;
    let (inbox, messages) = async_channel::unbounded();
    std::thread::Builder::new()
        .name("recording-pipe-read".into())
        .spawn(move || {
            if let Err(e) = read_messages(host, |msg| inbox.send_blocking(msg).is_ok()) {
                eprintln!("read recording host: {e}");
            }
        })?;
    gpui_kit::application()
        .with_assets(quietpro::QuietProAssets)
        .with_windowing(WindowingRequest::Headless)
        .with_quit_mode(QuitMode::Explicit)
        .run(move |cx| {
            gpui_kit::init(cx);
            if let Err(error) = quietpro::init_fonts(cx) {
                eprintln!("Load bundled UI fonts: {error:#}");
            }
            let client = Rc::new(Client::new(locale, theme, schemes, tx));
            client.window_scale.set(scale);
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
                            revision,
                            target,
                            navigation,
                            mini,
                            activity,
                            paused,
                        } => {
                            if client.serial.replace(serial) == 0 {
                                client.navigation.set(navigation);
                            }
                            client.revision.set(revision);
                            client.activity.replace(activity);
                            client.paused.set(paused);
                            match target {
                                Target::Main(target) => {
                                    windows.open_main(&client, target, cx).await
                                }
                                Target::Notice { dialog } => {
                                    let shown = if dialog {
                                        windows.show_dialog(&client, cx).await
                                    } else {
                                        windows.show_notice(&client, cx).await
                                    };
                                    if !shown {
                                        let result = client.tool(
                                            patina_desktop_protocol::tools::call::display_failed(),
                                        );
                                        cx.update(|cx| {
                                            cx.spawn(async move |_| {
                                                let _ = result.await;
                                            })
                                            .detach()
                                        });
                                    }
                                }
                                Target::Mini { focus } => {
                                    windows
                                        .open_mini(
                                            focus,
                                            mini.map(|p| *p).unwrap_or_default(),
                                            &client,
                                            cx,
                                        )
                                        .await
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
                        ToWindow::Changed {
                            revision,
                            activity,
                            paused,
                        } => {
                            if revision <= client.revision.get() {
                                continue;
                            }
                            client.revision.set(revision);
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
                            client.receive_answer(id, result.map(|reply| *reply));
                        }
                        ToWindow::Exit => break,
                    }
                }
                client.disconnect();
                cx.update(|cx| cx.quit());
            })
            .detach();
        });
    Ok(())
}

#[cfg(all(test, feature = "test-support"))]
impl Client {
    pub(crate) fn test_connection() -> (Rc<Self>, mpsc::Receiver<FromWindow>) {
        let (sender, requests) = mpsc::channel();
        (
            Rc::new(Self::new(
                Locale::EnUs,
                patina_activity_model::Theme::System,
                Default::default(),
                sender,
            )),
            requests,
        )
    }

    pub(crate) fn test_reject(&self, id: u64, error: RequestError) {
        self.receive_answer(id, Err(error));
    }

    pub(crate) fn test_answer(&self, id: u64, result: patina_desktop_protocol::Reply) {
        self.receive_answer(id, Ok(result));
    }
}

#[cfg(all(test, feature = "test-support"))]
mod tests {
    use super::*;
    use std::{
        pin::pin,
        task::{Context, Poll, Waker},
    };

    #[test]
    fn request_keeps_the_error_category_until_the_view_handles_it() {
        let (client, _requests) = Client::test_connection();
        let mut cx = Context::from_waker(Waker::noop());
        for (id, conflict) in [(0, true), (1, false)] {
            let pending = client.install_update();
            let error = if conflict {
                RequestError::Conflict("same".into())
            } else {
                RequestError::Rejected("same".into())
            };
            client.receive_answer(id, Err(error));
            let result = pin!(pending).as_mut().poll(&mut cx);
            match result {
                Poll::Ready(Err(RequestError::Conflict(_))) => assert!(conflict),
                Poll::Ready(Err(RequestError::Rejected(_))) => assert!(!conflict),
                other => panic!("unexpected response: {other:?}"),
            }
        }
    }
    #[test]
    fn cancel_releases_request_capacity_and_ignores_late_responses() {
        let (client, _requests) = Client::test_connection();
        let mut pending: Vec<_> = (0..MAX_PENDING).map(|_| client.install_update()).collect();
        let mut cx = Context::from_waker(Waker::noop());
        assert_eq!(
            pin!(client.install_update()).as_mut().poll(&mut cx),
            Poll::Ready(Err(RequestError::Busy))
        );
        drop(pending.pop());
        let replacement = client.install_update();
        let old_id = (MAX_PENDING - 1) as u64;
        client.test_answer(old_id, patina_desktop_protocol::Reply::Done);
        let mut replacement = pin!(replacement);
        assert!(replacement.as_mut().poll(&mut cx).is_pending());
        client.disconnect();
        assert_eq!(
            replacement.as_mut().poll(&mut cx),
            Poll::Ready(Err(RequestError::Disconnected))
        );
        assert!(client.pending.borrow().is_empty());
    }
}
