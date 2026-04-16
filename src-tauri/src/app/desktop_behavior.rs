use crate::app::state::DesktopBehaviorState;
use crate::app::tray::{apply_tray_visibility, MAIN_WINDOW_LABEL};
use crate::data::repositories::app_settings;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_autostart::ManagerExt as AutostartManagerExt;

pub(crate) fn apply_autostart<R: Runtime>(
    app: &AppHandle<R>,
    launch_at_login: bool,
) -> Result<(), String> {
    let autostart_manager = app.autolaunch();

    if launch_at_login {
        #[cfg(all(debug_assertions, target_os = "windows"))]
        {
            let executable_path = std::env::current_exe()
                .ok()
                .map(|path| path.display().to_string())
                .unwrap_or_else(|| "<unknown>".to_string());
            return Err(format!(
                "autostart enable blocked in debug build on Windows to avoid registering a debug executable path ({executable_path}). Please enable launch-at-login from the installed release build."
            ));
        }

        #[cfg(not(all(debug_assertions, target_os = "windows")))]
        autostart_manager
            .enable()
            .map_err(|error| format!("failed to enable autostart: {error}"))?;
    } else {
        autostart_manager
            .disable()
            .map_err(|error| format!("failed to disable autostart: {error}"))?;
    }

    Ok(())
}

pub(crate) fn set_desktop_behavior<R: Runtime>(
    app: &AppHandle<R>,
    state: &DesktopBehaviorState,
    close_behavior: &str,
    minimize_behavior: &str,
) {
    let next = state.update_desktop_from_raw(close_behavior, minimize_behavior);
    apply_tray_visibility(app, next);
}

pub(crate) fn set_launch_behavior<R: Runtime>(
    app: &AppHandle<R>,
    state: &DesktopBehaviorState,
    launch_at_login: bool,
    start_minimized: bool,
) -> Result<(), String> {
    let next = state.update_launch(launch_at_login, start_minimized);
    apply_autostart(app, next.launch_at_login)?;
    Ok(())
}

pub(crate) async fn sync_desktop_behavior_from_storage<R: Runtime>(
    app: AppHandle<R>,
    launched_by_autostart: bool,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(&app).await?;
    let loaded = app_settings::load_desktop_behavior_settings(&pool)
        .await
        .map_err(|error| format!("failed to load desktop behavior settings: {error}"))?;

    let state = app.state::<DesktopBehaviorState>();
    let next = state.replace(loaded);

    if let Err(error) = apply_autostart(&app, next.launch_at_login) {
        eprintln!("[tray] failed to apply autostart setting: {error}");
    }
    apply_tray_visibility(&app, next);

    if launched_by_autostart {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            if next.should_start_minimized_on_autostart() {
                let _ = window.hide();
            } else {
                let _ = window.show();
                let _ = window.unminimize();
            }
        }
    }

    Ok(())
}

pub(crate) fn spawn_sync_from_storage<R: Runtime + 'static>(
    app: AppHandle<R>,
    launched_by_autostart: bool,
) {
    tauri::async_runtime::spawn(async move {
        if let Err(error) = sync_desktop_behavior_from_storage(app, launched_by_autostart).await {
            eprintln!("[tray] failed to sync desktop behavior from storage: {error}");
        }
    });
}
