use crate::app::state::{DesktopBehaviorState, MainWindowLifecycleState};
use crate::app::widget;
use crate::domain::settings::MinimizeBehavior;
use crate::platform::windows::window_activation;
use crate::platform::{storage_paths, webview_cache};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::webview::Color;
use tauri::{AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window};

pub(crate) const MAIN_WINDOW_LABEL: &str = "main";

const MAIN_WINDOW_TITLE: &str = "Patina";
const MAIN_WINDOW_WIDTH: f64 = 1100.0;
const MAIN_WINDOW_HEIGHT: f64 = 736.0;
const MAIN_WINDOW_MIN_WIDTH: f64 = 900.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 636.0;
const MAIN_WINDOW_DESTROY_AFTER_BACKGROUND_SECS: u64 = 5 * 60;

const WINDOW_BACKGROUND_COLOR: Color = Color(244, 244, 244, 255);

static FRONTEND_READY: AtomicBool = AtomicBool::new(false);
static INITIAL_SHOW_PENDING: AtomicBool = AtomicBool::new(false);

pub(crate) fn show_main_window<R: Runtime + 'static>(app: &AppHandle<R>) {
    app.state::<MainWindowLifecycleState>().show();

    let window = match ensure_main_window(app) {
        Ok(window) => window,
        Err(error) => {
            eprintln!("[main-window] failed to ensure main window: {error}");
            return;
        }
    };

    if FRONTEND_READY.load(Ordering::SeqCst) {
        let _ = window.show();
        let _ = window.unminimize();
        if let Err(error) = window_activation::restore_to_foreground(&window) {
            eprintln!("[main-window] failed to restore native foreground window: {error}");
        }
        let _ = window.set_focus();
    } else {
        INITIAL_SHOW_PENDING.store(true, Ordering::SeqCst);
    }
    widget::close_widget_window(app);
}

pub(crate) fn on_frontend_ready<R: Runtime + 'static>(app: &AppHandle<R>) {
    FRONTEND_READY.store(true, Ordering::SeqCst);
    if INITIAL_SHOW_PENDING.swap(false, Ordering::SeqCst) {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.show();
            let _ = window.unminimize();
            if let Err(error) = window_activation::restore_to_foreground(&window) {
                eprintln!("[main-window] failed to restore native foreground window on ready: {error}");
            }
            let _ = window.set_focus();
        }
    }
}

pub(crate) fn request_initial_show<R: Runtime + 'static>(app: &AppHandle<R>) {
    if FRONTEND_READY.load(Ordering::SeqCst) {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    } else {
        INITIAL_SHOW_PENDING.store(true, Ordering::SeqCst);
    }
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

pub(crate) fn ensure_main_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, String> {
    ensure_main_window_with_initial_visibility(app, true)
}

pub(crate) fn ensure_main_window_with_initial_visibility<R: Runtime>(
    app: &AppHandle<R>,
    visible: bool,
) -> Result<WebviewWindow<R>, String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        return Ok(window);
    }

    webview_cache::trim_webview_cache_before_start(app)?;
    let webview_root = storage_paths::resolve_storage_paths(app)?.webview_root;

    WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, main_window_url())
        .title(MAIN_WINDOW_TITLE)
        .inner_size(MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT)
        .min_inner_size(MAIN_WINDOW_MIN_WIDTH, MAIN_WINDOW_MIN_HEIGHT)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .center()
        .background_color(WINDOW_BACKGROUND_COLOR)
        .visible(visible)
        .data_directory(webview_root)
        .build()
        .map_err(|error| format!("failed to create main window: {error}"))
}

fn main_window_url() -> WebviewUrl {
    #[cfg(debug_assertions)]
    {
        WebviewUrl::External(
            "http://127.0.0.1:1420"
                .parse()
                .expect("valid dev server URL"),
        )
    }

    #[cfg(not(debug_assertions))]
    {
        WebviewUrl::App("index.html".into())
    }
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

        let lifecycle = app.state::<MainWindowLifecycleState>();
        if !lifecycle.should_destroy_hidden_window(hide_generation) {
            return;
        }

        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };

        if window.is_visible().unwrap_or(false) {
            return;
        }

        if let Err(error) = window.destroy() {
            eprintln!("[main-window] failed to destroy idle main window: {error}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::main_window_url;
    use tauri::WebviewUrl;

    #[test]
    fn main_window_url_uses_dev_server_in_debug_builds() {
        let url = main_window_url();

        #[cfg(debug_assertions)]
        assert!(matches!(url, WebviewUrl::External(_)));

        #[cfg(not(debug_assertions))]
        assert!(matches!(url, WebviewUrl::App(_)));
    }
}
