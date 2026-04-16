use crate::app::desktop_behavior;
use crate::app::runtime_tasks;
use crate::app::state::DesktopBehaviorState;
use crate::app::tray::{apply_tray_visibility, setup_tray, MAIN_WINDOW_LABEL};
use crate::engine::tracking::watchdog::RuntimeHealthState;
use crate::platform::windows::power;
use std::sync::Arc;
use tauri::Manager;

pub const AUTOSTART_ARG: &str = "--autostart";

pub fn was_launched_by_autostart() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_ARG)
}

pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

pub fn setup(
    app: &mut tauri::App,
    runtime_health: Arc<RuntimeHealthState>,
    launched_by_autostart: bool,
) -> tauri::Result<()> {
    power::start(app.handle().clone());

    let app_handle = app.handle().clone();
    setup_tray(&app_handle)?;
    let desktop_behavior = app_handle.state::<DesktopBehaviorState>().snapshot();
    apply_tray_visibility(&app_handle, desktop_behavior);
    if launched_by_autostart {
        if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
            let _ = window.hide();
        }
    }

    desktop_behavior::spawn_sync_from_storage(app.handle().clone(), launched_by_autostart);
    runtime_tasks::spawn_updater_startup_auto_check(app.handle().clone());
    runtime_tasks::spawn_tracking_runtime_restart_loop(app.handle().clone(), runtime_health.clone());
    runtime_tasks::spawn_tracking_watchdog_restart_loop(app.handle().clone(), runtime_health);

    Ok(())
}
