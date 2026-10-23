use super::state::AppExitState;
use crate::platform::windows::webview_health::{self, FailureKind, Signal};
use serde::Serialize;
use std::{
    collections::VecDeque,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, Runtime, WebviewWindow};

const RETRY_WINDOW: Duration = Duration::from_secs(600);
const MAX_ATTEMPTS: usize = 3;
const UNRESPONSIVE_INTERVAL: Duration = Duration::from_secs(10);
const UNRESPONSIVE_EXPIRY: Duration = Duration::from_secs(45);
const LIVENESS_INTERVAL: Duration = Duration::from_secs(15);

#[derive(Clone, Copy)]
pub(crate) enum WindowKind {
    Main,
    Widget,
}

#[derive(Default)]
struct WindowFaultState {
    registration: u64,
    pending: bool,
    attempts: VecDeque<Instant>,
    unresponsive_since: Option<Instant>,
    engine_version: Option<String>,
    last_failure: Option<FailureKind>,
    exhausted: bool,
    exhaustion_handled: bool,
    subscribed: bool,
    available_version: Option<String>,
    browser_process_id: Option<u32>,
    probe_since: Option<Instant>,
}

#[derive(Debug, PartialEq, Eq)]
enum ProbeAction {
    Skip,
    Dispatch,
    TimedOut,
}

impl WindowFaultState {
    fn register(&mut self) -> u64 {
        self.registration = self.registration.wrapping_add(1);
        self.pending = false;
        self.exhaustion_handled = false;
        self.unresponsive_since = None;
        self.engine_version = None;
        self.subscribed = false;
        self.available_version = None;
        self.browser_process_id = None;
        self.probe_since = None;
        self.registration
    }

    fn probe(&mut self, visible: bool, now: Instant) -> ProbeAction {
        self.refresh_budget(now);
        if !visible || self.pending {
            return ProbeAction::Skip;
        }
        match self.probe_since {
            Some(started) if now.saturating_duration_since(started) >= LIVENESS_INTERVAL => {
                ProbeAction::TimedOut
            }
            Some(_) => ProbeAction::Skip,
            None => {
                self.probe_since = Some(now);
                ProbeAction::Dispatch
            }
        }
    }

    fn claim(&mut self, registration: u64, kind: FailureKind, now: Instant) -> Option<Duration> {
        if registration != self.registration {
            return None;
        }
        self.last_failure = Some(kind);
        if kind == FailureKind::Recoverable || self.pending {
            return None;
        }
        if kind == FailureKind::Unresponsive {
            let elapsed = self
                .unresponsive_since
                .map(|started| now.saturating_duration_since(started));
            if elapsed.is_none_or(|age| age > UNRESPONSIVE_EXPIRY) {
                self.unresponsive_since = Some(now);
                return None;
            }
            if elapsed.is_some_and(|age| age < UNRESPONSIVE_INTERVAL) {
                return None;
            }
        }
        self.refresh_budget(now);
        self.exhausted = self.attempts.len() >= MAX_ATTEMPTS;
        if self.exhausted {
            return None;
        }
        self.attempts.push_back(now);
        self.pending = true;
        Some(Duration::from_secs(1 << self.attempts.len()))
    }

    fn refresh_budget(&mut self, now: Instant) {
        self.attempts
            .retain(|attempt| now.saturating_duration_since(*attempt) < RETRY_WINDOW);
        if self.attempts.len() < MAX_ATTEMPTS {
            self.exhausted = false;
            self.exhaustion_handled = false;
        }
    }

    fn claim_exhaustion(&mut self, registration: u64) -> bool {
        if self.registration != registration
            || !self.exhausted
            || self.exhaustion_handled
            || self.pending
        {
            return false;
        }
        self.exhaustion_handled = true;
        self.pending = true;
        true
    }
}

#[derive(Default)]
pub(crate) struct WebviewRecoveryState {
    windows: Mutex<[WindowFaultState; 2]>,
    notice_open: std::sync::atomic::AtomicBool,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct WebviewRecoverySnapshot {
    label: &'static str,
    registration: u64,
    engine_version: Option<String>,
    last_failure: Option<FailureKind>,
    pending: bool,
    exhausted: bool,
    subscribed: bool,
    available_version: Option<String>,
    browser_process_id: Option<u32>,
    update_available_at_creation: Option<bool>,
    liveness_probe_age_ms: Option<u64>,
}

impl WebviewRecoveryState {
    pub(crate) fn accepts_recovery(&self, kind: WindowKind, registration: u64) -> bool {
        self.update(kind, |state| {
            state.registration == registration && state.pending
        })
    }
    fn update<T>(&self, kind: WindowKind, update: impl FnOnce(&mut WindowFaultState) -> T) -> T {
        update(&mut self.windows.lock().unwrap_or_else(|e| e.into_inner())[kind as usize])
    }

    pub(crate) fn snapshot(&self) -> Vec<WebviewRecoverySnapshot> {
        self.windows
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .iter()
            .enumerate()
            .map(|(index, state)| WebviewRecoverySnapshot {
                label: if index == 0 { "main" } else { "widget" },
                registration: state.registration,
                engine_version: state.engine_version.clone(),
                last_failure: state.last_failure,
                pending: state.pending,
                exhausted: state.exhausted,
                subscribed: state.subscribed,
                available_version: state.available_version.clone(),
                browser_process_id: state.browser_process_id,
                update_available_at_creation: state
                    .available_version
                    .as_ref()
                    .zip(state.engine_version.as_ref())
                    .map(|(available, running)| available != running),
                liveness_probe_age_ms: state
                    .probe_since
                    .map(|started| started.elapsed().as_millis() as u64),
            })
            .collect()
    }
}

pub(crate) fn observe<R: Runtime + 'static>(
    window: &WebviewWindow<R>,
    kind: WindowKind,
    main_generation: u64,
) {
    let app = window.app_handle().clone();
    let registration = app
        .state::<WebviewRecoveryState>()
        .update(kind, WindowFaultState::register);
    let (signals, mut received) = tokio::sync::mpsc::channel(8);
    let (responded, mut responses) = tokio::sync::watch::channel(None::<Instant>);
    let (destroyed, mut destruction) = tokio::sync::watch::channel(false);
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = destroyed.send(true);
        }
    });
    let native_signals = signals.clone();
    let subscription = webview_health::observe(window, move |signal| {
        let _ = native_signals.try_send(signal);
    });
    if subscription.is_err() {
        eprintln!("[webview] event registration could not reach UI thread");
    }
    let task: std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send>> = Box::pin(
        async move {
            let mut ticks = tokio::time::interval(LIVENESS_INTERVAL);
            ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                let signal = tokio::select! {
                    _ = destruction.changed() => break,
                    _ = responses.changed() => Signal::Responsive,
                    _ = ticks.tick() => {
                        if app.state::<AppExitState>().is_exit_requested() { break; }
                        let label = match kind { WindowKind::Main => "main", WindowKind::Widget => "widget" };
                        let Some(window) = app.get_webview_window(label) else { continue; };
                        let visible = window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(true);
                        let action = app.state::<WebviewRecoveryState>().update(kind, |state| {
                            if state.registration != registration { ProbeAction::Skip } else { state.probe(visible, Instant::now()) }
                        });
                        match action {
                            ProbeAction::Skip => continue,
                            ProbeAction::Dispatch => {
                                // One native script callback per live window. A timeout
                                // does not enqueue another request behind a stuck renderer.
                                let replies = responded.clone();
                                let _ = window.eval_with_callback("true", move |result| {
                                    if result == "true" { let _ = replies.send(Some(Instant::now())); }
                                });
                                continue;
                            }
                            ProbeAction::TimedOut => Signal::Failed(FailureKind::Unresponsive),
                        }
                    },
                signal = received.recv() => match signal { Some(signal) => signal, None => { let _ = destruction.changed().await; break; } },
                };
                if app.state::<AppExitState>().is_exit_requested() {
                    break;
                }
                match signal {
                    Signal::BrowserProcess(process_id) => {
                        app.state::<WebviewRecoveryState>().update(kind, |state| {
                            if state.registration == registration {
                                state.browser_process_id = Some(process_id);
                            }
                        });
                    }
                    Signal::Responsive => {
                        app.state::<WebviewRecoveryState>().update(kind, |state| {
                            if state.registration == registration {
                                state.probe_since = None;
                                state.unresponsive_since = None;
                            }
                        });
                    }
                    Signal::AvailableVersion(version) => {
                        app.state::<WebviewRecoveryState>().update(kind, |state| {
                            if state.registration == registration {
                                state.available_version = Some(version);
                            }
                        });
                    }
                    Signal::Subscribed => {
                        app.state::<WebviewRecoveryState>().update(kind, |state| {
                            if state.registration == registration {
                                state.subscribed = true;
                            }
                        });
                    }
                    Signal::EngineVersion(version) => {
                        app.state::<WebviewRecoveryState>().update(kind, |state| {
                            if state.registration == registration {
                                state.engine_version = Some(version);
                            }
                        });
                    }
                    Signal::SubscriptionFailed => {
                        app.state::<WebviewRecoveryState>().update(kind, |state| {
                            if state.registration == registration {
                                state.subscribed = false;
                            }
                        });
                    }
                    Signal::Failed(failure) => {
                        eprintln!("[webview] registration={registration} observed={failure:?}");
                        let failed_at = Instant::now();
                        let delay = app
                            .state::<WebviewRecoveryState>()
                            .update(kind, |state| state.claim(registration, failure, failed_at));
                        let Some(delay) = delay else {
                            let stop = app
                                .state::<WebviewRecoveryState>()
                                .update(kind, |state| state.claim_exhaustion(registration));
                            if stop {
                                let result = match kind {
                                    WindowKind::Main => {
                                        super::main_window::stop_failed_webview(
                                            &app,
                                            main_generation,
                                        )
                                        .await
                                    }
                                    WindowKind::Widget => {
                                        super::widget::stop_failed_webview(&app, registration).await
                                    }
                                };
                                eprintln!("[webview] registration={registration} automatic-recovery-exhausted stopped={}", result.is_ok());
                                show_recovery_failure(&app);
                                break;
                            }
                            continue;
                        };
                        let wait = tokio::time::sleep(delay);
                        tokio::pin!(wait);
                        let mut resumed = false;
                        loop {
                            tokio::select! {
                                _ = destruction.changed() => break,
                                _ = &mut wait => break,
                                _ = responses.changed(), if failure == FailureKind::Unresponsive => {
                                    if responses.borrow().is_some_and(|replied| replied >= failed_at) {
                                        resumed = true;
                                        break;
                                    }
                                },
                            }
                        }
                        if *destruction.borrow() {
                            break;
                        }
                        if resumed {
                            app.state::<WebviewRecoveryState>().update(kind, |state| {
                                if state.registration == registration {
                                    state.pending = false;
                                    state.probe_since = None;
                                    state.unresponsive_since = None;
                                    state.attempts.pop_back();
                                }
                            });
                            continue;
                        }
                        if app.state::<AppExitState>().is_exit_requested() {
                            break;
                        }
                        let current = app.state::<WebviewRecoveryState>().update(kind, |state| {
                            state.registration == registration && state.pending
                        });
                        if !current {
                            break;
                        }
                        eprintln!("[webview] registration={registration} recovery-started failure={failure:?}");
                        let result = match kind {
                            WindowKind::Main => {
                                super::main_window::recover_failed_webview(&app, main_generation)
                                    .await
                            }
                            WindowKind::Widget => {
                                super::widget::recover_failed_webview(&app, registration).await
                            }
                        };
                        app.state::<WebviewRecoveryState>().update(kind, |state| {
                            if state.registration == registration {
                                state.pending = false;
                            }
                        });
                        eprintln!("[webview] registration={registration} failure={failure:?} recovery_ok={}", result.is_ok());
                    }
                }
            }
            if *destruction.borrow() && matches!(kind, WindowKind::Main) {
                super::main_window::handle_unexpected_main_window_destroyed(&app, main_generation);
            }
        },
    );
    tauri::async_runtime::spawn(task);
}

fn show_recovery_failure<R: Runtime + 'static>(app: &tauri::AppHandle<R>) {
    use crate::domain::localization::{text, LocalizationState};
    use std::sync::atomic::Ordering;
    if app
        .state::<WebviewRecoveryState>()
        .notice_open
        .swap(true, Ordering::AcqRel)
    {
        return;
    }
    let message = text(
        app.state::<LocalizationState>().locale(),
        "native.webview.recoveryFailed",
    );
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        rfd::AsyncMessageDialog::new()
            .set_title("Patina")
            .set_description(message)
            .set_level(rfd::MessageLevel::Error)
            .show()
            .await;
        app.state::<WebviewRecoveryState>()
            .notice_open
            .store(false, Ordering::Release);
    });
}

pub(crate) async fn destroy_and_wait<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    let (finished, mut destroyed) = tokio::sync::watch::channel(false);
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = finished.send(true);
        }
    });
    let app = window.app_handle();
    let label = window.label();
    eprintln!("[webview] label={label} destruction-requested");
    let request = window.destroy();
    eprintln!(
        "[webview] label={label} destruction-dispatched={}",
        request.is_ok()
    );
    let deadline = tokio::time::Instant::now() + Duration::from_secs(4);
    loop {
        // Destroy dispatch is asynchronous. The label must be released before
        // creating a replacement, even after the native HWND has disappeared.
        if app.get_webview_window(label).is_none() {
            return Ok(());
        }
        if tokio::time::Instant::now() >= deadline {
            return Err(format!(
                "window destruction not confirmed: request_ok={}",
                request.is_ok()
            ));
        }
        if *destroyed.borrow() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        } else {
            tokio::select! {
                _ = destroyed.changed() => (),
                _ = tokio::time::sleep(Duration::from_millis(10)) => (),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hidden_windows_skip_liveness_and_hung_probes_never_accumulate() {
        let mut state = WindowFaultState::default();
        state.register();
        let now = Instant::now();
        assert_eq!(state.probe(false, now), ProbeAction::Skip);
        assert_eq!(state.probe(true, now), ProbeAction::Dispatch);
        assert_eq!(
            state.probe(true, now + Duration::from_secs(1)),
            ProbeAction::Skip
        );
        for seconds in [15, 30, 60] {
            assert_eq!(
                state.probe(true, now + Duration::from_secs(seconds)),
                ProbeAction::TimedOut
            );
        }
        assert_eq!(
            state.probe(false, now + Duration::from_secs(120)),
            ProbeAction::Skip
        );
        state.register();
        assert_eq!(state.probe(true, now), ProbeAction::Dispatch);
    }
    #[test]
    fn stale_duplicate_and_recoverable_events_cannot_rebuild_a_window() {
        let mut state = WindowFaultState::default();
        let first = state.register();
        let now = Instant::now();
        assert!(state.claim(first, FailureKind::Recoverable, now).is_none());
        assert!(state
            .claim(first, FailureKind::RendererExited, now)
            .is_some());
        assert!(state
            .claim(first, FailureKind::BrowserExited, now)
            .is_none());
        let second = state.register();
        assert!(state
            .claim(first, FailureKind::BrowserExited, now)
            .is_none());
        assert!(state
            .claim(second, FailureKind::BrowserExited, now)
            .is_some());
    }
    #[test]
    fn unresponsive_events_require_sustained_evidence_and_retries_are_bounded() {
        let mut state = WindowFaultState::default();
        let mut generation = state.register();
        let now = Instant::now();
        assert!(state
            .claim(generation, FailureKind::Unresponsive, now)
            .is_none());
        assert!(state
            .claim(
                generation,
                FailureKind::Unresponsive,
                now + Duration::from_secs(1)
            )
            .is_none());
        assert_eq!(
            state.claim(
                generation,
                FailureKind::Unresponsive,
                now + Duration::from_secs(15)
            ),
            Some(Duration::from_secs(2))
        );
        for expected in [4, 8] {
            generation = state.register();
            assert_eq!(
                state.claim(
                    generation,
                    FailureKind::BrowserExited,
                    now + Duration::from_secs(20)
                ),
                Some(Duration::from_secs(expected))
            );
        }
        generation = state.register();
        assert!(state
            .claim(
                generation,
                FailureKind::BrowserExited,
                now + Duration::from_secs(30)
            )
            .is_none());
        assert!(state.exhausted);
        assert!(state.claim_exhaustion(generation));
        assert!(!state.claim_exhaustion(generation));
        generation = state.register();
        assert_eq!(
            state.probe(true, now + Duration::from_secs(700)),
            ProbeAction::Dispatch
        );
        assert!(!state.exhausted);
        assert!(state
            .claim(
                generation,
                FailureKind::BrowserExited,
                now + Duration::from_secs(700)
            )
            .is_some());
    }
}
