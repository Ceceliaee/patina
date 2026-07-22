use crate::app::state::{
    AppExitState, DesktopBehaviorState, MainWindowLifecycleSnapshot, MainWindowLifecycleState,
    MainWindowReadyDecision, MainWindowShowDecision, MainWindowTimeoutDecision,
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
const MAIN_WINDOW_GENERATION_PROPERTY: &str = "__PATINA_MAIN_WINDOW_GENERATION__";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MainWindowShowReason {
    Startup(StartupSource),
    StartupRecovery,
    TrayMenu,
    TrayIcon,
    Widget,
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
        "[main-window] event={event} generation={} reason={reason} desired_visible={} render_state={} create_in_progress={} destroy_in_progress={} reveal_in_progress={} elapsed_ms={} result={result}",
        snapshot.generation,
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
            MainWindowShowDecision::Destroying => "queued-during-destroy",
        },
    );

    if decision == MainWindowShowDecision::Destroying {
        return true;
    }

    let ensure_result = match ensure_main_window_once(app) {
        Ok(result) => result,
        Err(error) => {
            eprintln!("[main-window] failed to ensure main window: {error}");
            if let MainWindowShowDecision::Reveal { generation } = decision {
                lifecycle.finish_reveal(generation, false);
            }
            return false;
        }
    };

    match (ensure_result, decision) {
        (
            MainWindowEnsureResult::Existing(window),
            MainWindowShowDecision::Reveal { generation },
        ) => reveal_main_window(app, &window, generation, reason.as_str()).is_ok(),
        (MainWindowEnsureResult::Existing(_), MainWindowShowDecision::Wait)
        | (MainWindowEnsureResult::Created(_), _)
        | (MainWindowEnsureResult::Creating, _) => true,
        (_, MainWindowShowDecision::Destroying) => true,
    }
}

pub(crate) fn mark_main_window_ready<R: Runtime + 'static>(
    app: &AppHandle<R>,
    generation: u64,
) -> Result<MainWindowReadyOutcome, String> {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    let decision = lifecycle.mark_ready(generation);
    let (ready_result, result) = match decision {
        MainWindowReadyDecision::Stale => ("stale", MainWindowReadyOutcome::Stale),
        MainWindowReadyDecision::Duplicate => ("duplicate", MainWindowReadyOutcome::Duplicate),
        MainWindowReadyDecision::Hidden => ("accepted-hidden", MainWindowReadyOutcome::Hidden),
        MainWindowReadyDecision::Reveal { generation } => {
            log_main_window_event(
                "frontend-ready",
                lifecycle.snapshot(),
                "frontend",
                "accepted-reveal",
            );
            let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
                lifecycle.finish_reveal(generation, false);
                return Err("main window disappeared before ready reveal".to_string());
            };
            return if reveal_main_window(app, &window, generation, "frontend-ready")? {
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

fn reveal_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    generation: u64,
    reason: &str,
) -> Result<bool, String> {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    if !lifecycle.can_reveal(generation) {
        lifecycle.finish_reveal(generation, false);
        log_main_window_event(
            "show-suppressed",
            lifecycle.snapshot(),
            reason,
            "state-changed-before-show",
        );
        return Ok(false);
    }

    if let Err(error) = window.show() {
        lifecycle.finish_reveal(generation, false);
        log_main_window_event(
            "show-failed",
            lifecycle.snapshot(),
            reason,
            "window-show-error",
        );
        return Err(format!("failed to show main window: {error}"));
    }

    let _ = window.unminimize();
    // Win+D can leave the HWND outside Tauri's normal minimized/visible path.
    if let Err(error) = window_activation::restore_to_foreground(window) {
        eprintln!("[main-window] failed to restore native foreground window: {error}");
    }
    let _ = window.set_focus();

    if lifecycle.finish_reveal(generation, true) {
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

pub(crate) fn minimize_main_window<R: Runtime + 'static>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };

    let settings = app.state::<DesktopBehaviorState>().snapshot();
    if settings.minimize_behavior == MinimizeBehavior::Widget {
        minimize_main_window_to_widget(app, &window);
        return;
    }

    if let Err(error) = window.minimize() {
        eprintln!("[main-window] failed to minimize main window: {error}");
    }
}

fn minimize_main_window_to_widget<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
) {
    let preferred_monitor = window.current_monitor().ok().flatten();
    let _ = app.state::<MainWindowLifecycleState>().hide();
    let _ = window.hide();
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = widget::show_widget_window(&app_handle, preferred_monitor).await {
            eprintln!("[widget] failed to show widget window: {error}");
        }
    });
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
        return Ok(MainWindowEnsureResult::Existing(window));
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
        .on_page_load(move |_window, payload| {
            let event = match payload.event() {
                PageLoadEvent::Started => "page-load-started",
                PageLoadEvent::Finished => "page-load-finished",
            };
            eprintln!(
                "[main-window] event={event} generation={generation} elapsed_ms={} url_scheme={} result=observed",
                created_at.elapsed().as_millis(),
                payload.url().scheme(),
            );
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
            let should_reveal = lifecycle.finish_window_creation(generation, true);
            log_main_window_event("created", lifecycle.snapshot(), "builder", "hidden");
            schedule_main_window_ready_timeout(app.clone(), generation);
            if should_reveal {
                reveal_main_window(app, &window, generation, "frontend-ready-during-create")?;
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

fn main_window_initialization_script(generation: u64) -> String {
    format!(
        "Object.defineProperty(window, '{MAIN_WINDOW_GENERATION_PROPERTY}', {{ value: {generation}, writable: false, configurable: false }});"
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

fn schedule_main_window_ready_timeout<R: Runtime + 'static>(app: AppHandle<R>, generation: u64) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(MAIN_WINDOW_READY_TIMEOUT_SECS)).await;

        let lifecycle = app.state::<MainWindowLifecycleState>();
        match lifecycle.handle_ready_timeout(generation) {
            MainWindowTimeoutDecision::Stale => {}
            MainWindowTimeoutDecision::Hidden => {
                log_main_window_event(
                    "ready-timeout",
                    lifecycle.snapshot(),
                    "watchdog",
                    "kept-hidden",
                );
            }
            MainWindowTimeoutDecision::Reveal { generation } => {
                log_main_window_event(
                    "ready-timeout",
                    lifecycle.snapshot(),
                    "watchdog",
                    "fallback-reveal",
                );
                let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
                    lifecycle.finish_reveal(generation, false);
                    eprintln!(
                        "[main-window] event=show-failed generation={generation} reason=watchdog result=window-missing"
                    );
                    return;
                };
                if let Err(error) = reveal_main_window(&app, &window, generation, "ready-timeout") {
                    eprintln!("[main-window] ready timeout fallback failed: {error}");
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
