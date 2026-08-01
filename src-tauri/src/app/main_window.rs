use crate::app::state::{
    AppExitState, DesktopBehaviorState, MainWindowLifecycleSnapshot, MainWindowLifecycleState,
    MainWindowReadyDecision, MainWindowRenderToken, MainWindowShowDecision,
    MainWindowTimeoutDecision,
};
use crate::app::widget;
use crate::domain::settings::{MinimizeBehavior, StartupSource};
use crate::platform::storage_paths;
use crate::platform::windows::window_activation;
use std::time::{Duration, Instant};
use tauri::{
    webview::PageLoadEvent, AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window,
};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

const MAIN_WINDOW_TITLE: &str = "Patina";
const MAIN_WINDOW_WIDTH: f64 = 1100.0;
const MAIN_WINDOW_HEIGHT: f64 = 736.0;
const MAIN_WINDOW_MIN_WIDTH: f64 = 900.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 636.0;
const MAIN_WINDOW_DESTROY_AFTER_BACKGROUND_SECS: u64 = 3 * 60;
const MAIN_WINDOW_READY_TIMEOUT_SECS: u64 = 8;
const MAIN_WINDOW_LIVENESS_TIMEOUT_MILLIS: u64 = 1_500;
const MAIN_WINDOW_GENERATION_PROPERTY: &str = "__PATINA_MAIN_WINDOW_GENERATION__";
const MAIN_WINDOW_LIVENESS_CALLBACK: &str = "__PATINA_MAIN_WINDOW_LIVENESS_REQUEST__";
const WIDGET_SHOW_MAX_ATTEMPTS: usize = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MainWindowShowReason {
    Startup(StartupSource),
    StartupRecovery,
    TrayMenu,
    TrayIcon,
    Widget,
    MinimizeRollback,
    #[cfg(all(desktop, not(debug_assertions)))]
    SingleInstance,
    ToolAlert,
    DestroyRecovery,
}

impl MainWindowShowReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Startup(source) => source.as_str(),
            Self::StartupRecovery => "startup-recovery",
            Self::TrayMenu => "tray-menu",
            Self::TrayIcon => "tray-icon",
            Self::Widget => "widget",
            Self::MinimizeRollback => "minimize-rollback",
            #[cfg(all(desktop, not(debug_assertions)))]
            Self::SingleInstance => "single-instance",
            Self::ToolAlert => "tool-alert",
            Self::DestroyRecovery => "destroy-recovery",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MainWindowReadyOutcome {
    Stale,
    Duplicate,
    Hidden,
    Revealed,
}

impl MainWindowReadyOutcome {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Stale => "stale",
            Self::Duplicate => "duplicate",
            Self::Hidden => "hidden",
            Self::Revealed => "revealed",
        }
    }
}

fn log_main_window_event(
    event: &str,
    snapshot: MainWindowLifecycleSnapshot,
    reason: &str,
    result: &str,
) {
    eprintln!(
        "[main-window] event={event} generation={} load_epoch={} reason={reason} desired_visible={} render_state={} create_in_progress={} destroy_in_progress={} reveal_in_progress={} elapsed_ms={} result={result}",
        snapshot.generation,
        snapshot.load_epoch,
        snapshot.desired_visible,
        snapshot.render_state.as_str(),
        snapshot.create_in_progress,
        snapshot.destroy_in_progress,
        snapshot.reveal_in_progress,
        snapshot.elapsed_ms.unwrap_or(0),
    );
}

pub(crate) fn show_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
    reason: MainWindowShowReason,
) -> bool {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    let decision = lifecycle.request_show();
    log_main_window_event(
        "show-requested",
        lifecycle.snapshot(),
        reason.as_str(),
        match decision {
            MainWindowShowDecision::Wait => "waiting-for-ready",
            MainWindowShowDecision::Reveal { .. } => "reveal-claimed",
            MainWindowShowDecision::Probe { .. } => "liveness-probe-claimed",
            MainWindowShowDecision::Recreate => "recreate-after-timeout",
            MainWindowShowDecision::Destroying => "queued-during-destroy",
        },
    );

    if decision == MainWindowShowDecision::Destroying {
        return true;
    }

    if decision == MainWindowShowDecision::Recreate {
        return recreate_main_window(app, "ready-timeout").is_ok();
    }

    let ensure_result = match ensure_main_window_once(app) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("[main-window] failed to ensure main window: {error}");
            if let MainWindowShowDecision::Reveal { token } = decision {
                lifecycle.finish_reveal(token, false);
            }
            return false;
        }
    };

    match (ensure_result, decision) {
        (MainWindowEnsureResult::Existing(window), MainWindowShowDecision::Reveal { token }) => {
            reveal_main_window(app, &window, token, reason.as_str()).is_ok()
        }
        (MainWindowEnsureResult::Existing(window), MainWindowShowDecision::Probe { token }) => {
            probe_main_window_liveness(app, &window, token, reason.as_str()).is_ok()
        }
        (MainWindowEnsureResult::Existing(_), MainWindowShowDecision::Wait)
        | (MainWindowEnsureResult::Created(_), _)
        | (MainWindowEnsureResult::Creating, _) => true,
        (_, MainWindowShowDecision::Recreate) => true,
        (_, MainWindowShowDecision::Destroying) => true,
    }
}

fn probe_main_window_liveness<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    token: MainWindowRenderToken,
    reason: &str,
) -> Result<(), String> {
    let script = format!("window.{MAIN_WINDOW_LIVENESS_CALLBACK}?.();");
    if let Err(error) = window.eval(&script) {
        log_main_window_event(
            "liveness-probe-failed",
            app.state::<MainWindowLifecycleState>().snapshot(),
            reason,
            "eval-error-recreate",
        );
        recreate_main_window(app, "liveness-eval-error")?;
        return Err(format!("failed to probe hidden main window: {error}"));
    }

    log_main_window_event(
        "liveness-probe-started",
        app.state::<MainWindowLifecycleState>().snapshot(),
        reason,
        "waiting-for-frontend",
    );
    schedule_main_window_liveness_timeout(app.clone(), token);
    Ok(())
}

pub(crate) fn mark_main_window_ready<R: Runtime + 'static>(
    app: &AppHandle<R>,
    token: MainWindowRenderToken,
) -> Result<MainWindowReadyOutcome, String> {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    let decision = lifecycle.mark_ready(token);
    let (ready_result, result) = match decision {
        MainWindowReadyDecision::Stale => ("stale", MainWindowReadyOutcome::Stale),
        MainWindowReadyDecision::Duplicate => ("duplicate", MainWindowReadyOutcome::Duplicate),
        MainWindowReadyDecision::Hidden => ("accepted-hidden", MainWindowReadyOutcome::Hidden),
        MainWindowReadyDecision::Reveal { token } => {
            log_main_window_event(
                "frontend-ready",
                lifecycle.snapshot(),
                "frontend",
                "accepted-reveal",
            );
            let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
                lifecycle.finish_reveal(token, false);
                return Err("main window disappeared before ready reveal".to_string());
            };
            return if reveal_main_window(app, &window, token, "frontend-ready")? {
                Ok(MainWindowReadyOutcome::Revealed)
            } else {
                Ok(MainWindowReadyOutcome::Hidden)
            };
        }
    };
    log_main_window_event(
        "frontend-ready",
        lifecycle.snapshot(),
        "frontend",
        ready_result,
    );
    Ok(result)
}

pub(crate) fn current_main_window_render_token<R: Runtime>(
    app: &AppHandle<R>,
) -> Option<MainWindowRenderToken> {
    app.state::<MainWindowLifecycleState>()
        .current_render_token()
}

fn reveal_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    token: MainWindowRenderToken,
    reason: &str,
) -> Result<bool, String> {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    if !lifecycle.can_reveal(token) {
        lifecycle.finish_reveal(token, false);
        log_main_window_event(
            "show-suppressed",
            lifecycle.snapshot(),
            reason,
            "state-changed-before-show",
        );
        return Ok(false);
    }

    if let Err(error) = window.show() {
        lifecycle.finish_reveal(token, false);
        log_main_window_event(
            "show-failed",
            lifecycle.snapshot(),
            reason,
            "window-show-error",
        );
        eprintln!("[main-window] failed to show main window: {error}");
        recreate_main_window(app, "window-show-error")?;
        return Ok(false);
    }

    let _ = window.unminimize();
    // Win+D can leave the HWND outside Tauri's normal minimized/visible path.
    if let Err(error) = window_activation::restore_to_foreground(window) {
        lifecycle.finish_reveal(token, false);
        log_main_window_event(
            "show-failed",
            lifecycle.snapshot(),
            reason,
            "native-restore-error",
        );
        eprintln!("[main-window] failed to restore native foreground window: {error}");
        recreate_main_window(app, "native-restore-error")?;
        return Ok(false);
    }
    let _ = window.set_focus();

    if window_activation::is_native_window_visible(window) != Ok(true) {
        lifecycle.finish_reveal(token, false);
        log_main_window_event(
            "show-failed",
            lifecycle.snapshot(),
            reason,
            "native-window-not-visible",
        );
        recreate_main_window(app, "native-window-not-visible")?;
        return Ok(false);
    }

    if lifecycle.finish_reveal(token, true) {
        let _ = window.hide();
        log_main_window_event(
            "show-suppressed",
            lifecycle.snapshot(),
            reason,
            "hidden-race-won",
        );
        return Ok(false);
    }

    widget::close_widget_window(app);
    crate::app::tray::on_main_window_revealed(app);
    log_main_window_event("show-succeeded", lifecycle.snapshot(), reason, "visible");
    Ok(true)
}

pub(crate) async fn minimize_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err("main window is unavailable".to_string());
    };

    let settings = app.state::<DesktopBehaviorState>().snapshot();
    if settings.minimize_behavior == MinimizeBehavior::Widget {
        return minimize_main_window_to_widget(app, &window).await;
    }

    window
        .minimize()
        .map_err(|error| format!("failed to minimize main window: {error}"))
}

pub(crate) fn close_widget_for_main_activity<R: Runtime + 'static>(app: &AppHandle<R>) {
    if app
        .state::<MainWindowLifecycleState>()
        .should_close_widget_for_main_activity()
    {
        widget::close_widget_window(app);
    }
}

async fn minimize_main_window_to_widget<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    let Some(intent_generation) = lifecycle.begin_minimize_to_widget() else {
        return Ok(());
    };
    let preferred_monitor = window.current_monitor().ok().flatten();
    if let Err(error) = show_widget_for_minimize_with_retry(app, preferred_monitor.clone()).await {
        lifecycle.cancel_minimize_to_widget(intent_generation);
        return Err(error);
    }

    let Some(hide_generation) = lifecycle.commit_minimize_to_widget(intent_generation) else {
        widget::close_widget_window(app);
        return Ok(());
    };

    if let Err(error) = window.hide() {
        let rollback_error = rollback_widget_minimize(app, window).err();
        return Err(format!(
            "widget was shown but the main window could not be hidden: {error}{}",
            rollback_error
                .map(|rollback| format!("; main-window rollback also failed: {rollback}"))
                .unwrap_or_default()
        ));
    }

    if !lifecycle.is_current_hide(hide_generation) {
        return rollback_widget_minimize(app, window);
    }

    if !widget::is_widget_window_visible(app) {
        if let Err(error) = show_widget_for_minimize_with_retry(app, preferred_monitor).await {
            let rollback_error = rollback_widget_minimize(app, window).err();
            return Err(format!(
                "main window was hidden but widget recovery failed: {error}{}",
                rollback_error
                    .map(|rollback| format!("; main-window rollback also failed: {rollback}"))
                    .unwrap_or_default()
            ));
        }
    }

    if !widget::is_widget_window_visible(app) {
        let rollback_error = rollback_widget_minimize(app, window).err();
        return Err(format!(
            "widget window was not visible after minimizing the main window{}",
            rollback_error
                .map(|rollback| format!("; main-window rollback also failed: {rollback}"))
                .unwrap_or_default()
        ));
    }

    Ok(())
}

fn rollback_widget_minimize<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) -> Result<(), String> {
    widget::close_widget_window(app);
    let _ = show_main_window(app, MainWindowShowReason::MinimizeRollback);
    if window.is_visible().ok() == Some(true) {
        return Ok(());
    }

    window
        .show()
        .map_err(|error| format!("failed to restore the main window: {error}"))?;
    let _ = window.unminimize();
    let _ = window.set_focus();
    crate::app::tray::on_main_window_revealed(app);
    Ok(())
}

async fn show_widget_for_minimize_with_retry<R: Runtime + 'static>(
    app: &AppHandle<R>,
    preferred_monitor: Option<tauri::Monitor>,
) -> Result<(), String> {
    let mut last_error = None;
    for attempt in 1..=WIDGET_SHOW_MAX_ATTEMPTS {
        match widget::show_widget_window_for_minimize(app, preferred_monitor.clone()).await {
            Ok(()) => return Ok(()),
            Err(error) => {
                eprintln!(
                    "[widget] minimize show attempt {attempt}/{WIDGET_SHOW_MAX_ATTEMPTS} failed: {error}"
                );
                last_error = Some(error);
                if attempt < WIDGET_SHOW_MAX_ATTEMPTS {
                    tokio::task::yield_now().await;
                }
            }
        }
    }

    Err(format!(
        "failed to show widget after {WIDGET_SHOW_MAX_ATTEMPTS} attempts: {}",
        last_error.unwrap_or_else(|| "unknown widget show failure".to_string())
    ))
}

pub(crate) fn hide_main_window_for_background<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &Window<R>,
) {
    let hide_generation = app.state::<MainWindowLifecycleState>().hide();
    let _ = window.hide();

    if app
        .state::<DesktopBehaviorState>()
        .snapshot()
        .should_optimize_background_resources()
    {
        schedule_main_window_destroy_after_background(app.clone(), hide_generation);
    }
}

pub(crate) fn register_hidden_main_window_startup<R: Runtime + 'static>(
    app: &AppHandle<R>,
    optimize_background_resources: bool,
) -> bool {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return false;
    };

    if window.is_visible().unwrap_or(false) {
        return false;
    }

    let Some(hide_generation) = app
        .state::<MainWindowLifecycleState>()
        .try_hide_for_startup()
    else {
        return false;
    };

    if optimize_background_resources {
        schedule_main_window_destroy_after_background(app.clone(), hide_generation);
    }

    true
}

pub(crate) fn ensure_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, String> {
    match ensure_main_window_once(app)? {
        MainWindowEnsureResult::Existing(window) | MainWindowEnsureResult::Created(window) => {
            Ok(window)
        }
        MainWindowEnsureResult::Creating => {
            Err("main window creation is already in progress".to_string())
        }
    }
}

enum MainWindowEnsureResult<R: Runtime> {
    Existing(WebviewWindow<R>),
    Created(WebviewWindow<R>),
    Creating,
}

fn ensure_main_window_once<R: Runtime + 'static>(
    app: &AppHandle<R>,
) -> Result<MainWindowEnsureResult<R>, String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if window_activation::is_native_window_alive(&window) == Ok(true) {
            return Ok(MainWindowEnsureResult::Existing(window));
        }

        eprintln!("[main-window] stale Tauri window found without a live native HWND; recreating");
        recreate_existing_main_window(app, &window, "stale-native-window")?;
    }

    let webview_root = storage_paths::resolve_storage_paths(app)?.webview_root;
    let lifecycle = app.state::<MainWindowLifecycleState>();
    let Some(generation) = lifecycle.begin_window_creation() else {
        return Ok(MainWindowEnsureResult::Creating);
    };
    let created_at = Instant::now();
    log_main_window_event(
        "creation-started",
        lifecycle.snapshot(),
        "window-missing",
        "hidden",
    );
    let initialization_script = main_window_initialization_script(generation);

    let builder = WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, main_window_url())
        .title(MAIN_WINDOW_TITLE)
        .inner_size(MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT)
        .min_inner_size(MAIN_WINDOW_MIN_WIDTH, MAIN_WINDOW_MIN_HEIGHT)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .center()
        .visible(false)
        .data_directory(webview_root)
        .initialization_script(initialization_script)
        .on_page_load(move |window, payload| {
            match payload.event() {
                PageLoadEvent::Started => {
                    let app = window.app_handle();
                    let lifecycle = app.state::<MainWindowLifecycleState>();
                    let Some(token) = lifecycle.begin_page_load(generation) else {
                        log_main_window_event(
                            "page-load-started",
                            lifecycle.snapshot(),
                            "webview",
                            "stale",
                        );
                        return;
                    };

                    let _ = window.hide();
                    log_main_window_event(
                        "page-load-started",
                        lifecycle.snapshot(),
                        payload.url().scheme(),
                        "hidden-until-ready",
                    );
                    schedule_main_window_ready_timeout(app.clone(), token);
                }
                PageLoadEvent::Finished => {
                    eprintln!(
                        "[main-window] event=page-load-finished generation={generation} elapsed_ms={} url_scheme={} result=observed",
                        created_at.elapsed().as_millis(),
                        payload.url().scheme(),
                    );
                }
            }
        });

    #[cfg(debug_assertions)]
    let builder = if std::env::var("PATINA_E2E").as_deref() == Ok("1") {
        let devtools_port = std::env::var("PATINA_E2E_DEVTOOLS_PORT")
            .expect("PATINA_E2E_DEVTOOLS_PORT is required when PATINA_E2E=1")
            .parse::<u16>()
            .expect("PATINA_E2E_DEVTOOLS_PORT must be a valid TCP port");
        builder.additional_browser_args(&format!(
            "--remote-debugging-port={devtools_port} \
             --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        ))
    } else {
        builder
    };

    match builder.build() {
        Ok(window) => {
            let reveal_token = lifecycle.finish_window_creation(generation, true);
            log_main_window_event("created", lifecycle.snapshot(), "builder", "hidden");
            if let Some(token) = lifecycle.current_render_token() {
                schedule_main_window_ready_timeout(app.clone(), token);
            }
            if let Some(token) = reveal_token {
                reveal_main_window(app, &window, token, "frontend-ready-during-create")?;
            }
            Ok(MainWindowEnsureResult::Created(window))
        }
        Err(error) => {
            lifecycle.finish_window_creation(generation, false);
            log_main_window_event("creation-failed", lifecycle.snapshot(), "builder", "error");
            Err(format!("failed to create main window: {error}"))
        }
    }
}

fn recreate_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
    reason: &str,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        recreate_existing_main_window(app, &window, reason)?;
    } else {
        let lifecycle = app.state::<MainWindowLifecycleState>();
        if lifecycle.begin_unavailable_window_recovery() {
            lifecycle.finish_unavailable_window_recovery();
        }
    }

    match ensure_main_window_once(app)? {
        MainWindowEnsureResult::Existing(_) | MainWindowEnsureResult::Created(_) => Ok(()),
        MainWindowEnsureResult::Creating => Ok(()),
    }
}

fn recreate_existing_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    reason: &str,
) -> Result<(), String> {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    if !lifecycle.begin_unavailable_window_recovery() {
        return Ok(());
    }

    let destroy_result = window.destroy();
    lifecycle.finish_unavailable_window_recovery();
    log_main_window_event(
        "native-window-recovery",
        lifecycle.snapshot(),
        reason,
        if destroy_result.is_ok() {
            "destroyed-stale-window"
        } else {
            "discarded-stale-window"
        },
    );

    if let Err(error) = destroy_result {
        eprintln!("[main-window] stale window destroy returned an error: {error}");
    }

    Ok(())
}

pub(crate) fn handle_unexpected_main_window_destroyed<R: Runtime + 'static>(app: &AppHandle<R>) {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    if !lifecycle.handle_unexpected_window_destroyed()
        || app.state::<AppExitState>().is_exit_requested()
    {
        return;
    }

    log_main_window_event(
        "destroyed",
        lifecycle.snapshot(),
        "native-window-event",
        "recreating-visible-window",
    );
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::task::yield_now().await;
        if let Err(error) = recreate_main_window(&app, "unexpected-destroy") {
            eprintln!("[main-window] failed to recover destroyed visible window: {error}");
        }
    });
}

fn main_window_initialization_script(generation: u64) -> String {
    format!(
        "(() => {{ Object.defineProperty(window, '{MAIN_WINDOW_GENERATION_PROPERTY}', {{ value: {generation}, writable: false, configurable: false }}); const applyPatinaMainWindowLabel = () => document.documentElement?.setAttribute('data-window-label', '{MAIN_WINDOW_LABEL}'); applyPatinaMainWindowLabel(); if (!document.documentElement) {{ document.addEventListener('DOMContentLoaded', applyPatinaMainWindowLabel, {{ once: true }}); }} }})();"
    )
}

fn main_window_url() -> WebviewUrl {
    #[cfg(debug_assertions)]
    {
        let e2e_frontend_url = (std::env::var("PATINA_E2E").as_deref() == Ok("1")).then(|| {
            std::env::var("PATINA_E2E_FRONTEND_URL")
                .expect("PATINA_E2E_FRONTEND_URL is required when PATINA_E2E=1")
        });
        debug_main_window_url(e2e_frontend_url.as_deref())
    }

    #[cfg(not(debug_assertions))]
    {
        WebviewUrl::App("index.html".into())
    }
}

#[cfg(debug_assertions)]
fn debug_main_window_url(e2e_frontend_url: Option<&str>) -> WebviewUrl {
    WebviewUrl::External(
        e2e_frontend_url
            .unwrap_or("http://127.0.0.1:1420")
            .parse()
            .expect("valid dev server URL"),
    )
}

fn schedule_main_window_destroy_after_background<R: Runtime + 'static>(
    app: AppHandle<R>,
    hide_generation: u64,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(
            MAIN_WINDOW_DESTROY_AFTER_BACKGROUND_SECS,
        ))
        .await;

        if !app
            .state::<DesktopBehaviorState>()
            .snapshot()
            .should_optimize_background_resources()
        {
            return;
        }

        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };

        if window.is_visible().unwrap_or(false) {
            return;
        }

        let lifecycle = app.state::<MainWindowLifecycleState>();
        if !lifecycle.begin_destroy_hidden_window(hide_generation) {
            return;
        }

        let destroyed = match window.destroy() {
            Ok(()) => {
                log_main_window_event(
                    "destroyed",
                    lifecycle.snapshot(),
                    "background-idle",
                    "success",
                );
                true
            }
            Err(error) => {
                eprintln!("[main-window] failed to destroy idle main window: {error}");
                false
            }
        };

        let should_reopen = lifecycle.finish_destroy_hidden_window(destroyed);
        if should_reopen && !app.state::<AppExitState>().is_exit_requested() {
            let _ = crate::app::tray::show_main_window(&app, MainWindowShowReason::DestroyRecovery);
        }
    });
}

fn schedule_main_window_ready_timeout<R: Runtime + 'static>(
    app: AppHandle<R>,
    token: MainWindowRenderToken,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(MAIN_WINDOW_READY_TIMEOUT_SECS)).await;

        let lifecycle = app.state::<MainWindowLifecycleState>();
        match lifecycle.handle_ready_timeout(token) {
            MainWindowTimeoutDecision::Stale => {}
            MainWindowTimeoutDecision::Hidden => {
                log_main_window_event(
                    "ready-timeout",
                    lifecycle.snapshot(),
                    "watchdog",
                    "kept-hidden",
                );
            }
        }
    });
}

fn schedule_main_window_liveness_timeout<R: Runtime + 'static>(
    app: AppHandle<R>,
    token: MainWindowRenderToken,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(MAIN_WINDOW_LIVENESS_TIMEOUT_MILLIS)).await;

        let lifecycle = app.state::<MainWindowLifecycleState>();
        match lifecycle.handle_ready_timeout(token) {
            MainWindowTimeoutDecision::Stale => {}
            MainWindowTimeoutDecision::Hidden => {
                let snapshot = lifecycle.snapshot();
                log_main_window_event(
                    "liveness-probe-timeout",
                    snapshot,
                    "watchdog",
                    if snapshot.desired_visible {
                        "recreate-hidden-window"
                    } else {
                        "cancelled-while-hidden"
                    },
                );
                if snapshot.desired_visible && !app.state::<AppExitState>().is_exit_requested() {
                    if let Err(error) = recreate_main_window(&app, "liveness-timeout") {
                        eprintln!(
                            "[main-window] failed to recreate unresponsive hidden window: {error}"
                        );
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[cfg(debug_assertions)]
    use super::debug_main_window_url;
    use super::{main_window_initialization_script, main_window_url};
    use tauri::WebviewUrl;

    #[test]
    fn main_window_url_uses_dev_server_in_debug_builds() {
        let url = main_window_url();

        #[cfg(debug_assertions)]
        assert!(matches!(url, WebviewUrl::External(_)));

        #[cfg(not(debug_assertions))]
        assert!(matches!(url, WebviewUrl::App(_)));
    }

    #[test]
    fn main_window_generation_script_is_immutable_and_numeric() {
        let script = main_window_initialization_script(42);

        assert!(script.contains("__PATINA_MAIN_WINDOW_GENERATION__"));
        assert!(script.contains("value: 42"));
        assert!(script.contains("writable: false"));
        assert!(script.contains("configurable: false"));
        assert!(script.contains("document.documentElement?.setAttribute"));
        assert!(
            script.find("Object.defineProperty").unwrap()
                < script.find("document.documentElement").unwrap()
        );
    }

    #[cfg(debug_assertions)]
    #[test]
    fn debug_main_window_url_accepts_isolated_e2e_frontend() {
        let url = debug_main_window_url(Some("http://127.0.0.1:43123"));

        match url {
            WebviewUrl::External(url) => assert_eq!(url.as_str(), "http://127.0.0.1:43123/"),
            _ => panic!("expected external E2E frontend URL"),
        }
    }
}
