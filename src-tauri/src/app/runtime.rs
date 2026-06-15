use crate::app::desktop_behavior;
use crate::app::main_window;
use crate::app::runtime_tasks;
use crate::app::state::DesktopBehaviorState;
use crate::app::tray::{apply_tray_visibility, setup_tray, MAIN_WINDOW_LABEL};
use crate::engine::tracking::watchdog::RuntimeHealthState;
use crate::platform::windows::{audio, media, power};
#[cfg(any(test, all(not(debug_assertions), not(patina_local_build))))]
use std::path::Path;
use std::sync::Arc;
use tauri::Manager;

pub const AUTOSTART_ARG: &str = "--autostart";

pub fn was_launched_by_autostart() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_ARG)
}

#[cfg(any(test, all(not(debug_assertions), not(patina_local_build))))]
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn should_use_local_build_context() -> bool {
    match std::env::current_exe() {
        Ok(path) => is_workspace_target_binary(&path),
        Err(_) => false,
    }
}

#[cfg(any(test, all(not(debug_assertions), not(patina_local_build))))]
fn is_workspace_target_binary(path: &Path) -> bool {
    let components = path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .map(|component| component.to_ascii_lowercase())
        .collect::<Vec<_>>();

    components.windows(3).any(|window| {
        window == ["src-tauri", "target", "release"] || window == ["src-tauri", "target", "debug"]
    })
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
    audio::start_signal_source();
    media::start_signal_source();
    crate::app::local_api::start(app.handle().clone());
    crate::app::web_activity::spawn_startup_repair(app.handle().clone());

    let app_handle = app.handle().clone();
    main_window::ensure_main_window_with_initial_visibility(&app_handle, !launched_by_autostart)
        .map_err(std::io::Error::other)?;
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
    runtime_tasks::spawn_tracking_runtime_restart_loop(
        app.handle().clone(),
        runtime_health.clone(),
    );
    runtime_tasks::spawn_tracking_watchdog_restart_loop(app.handle().clone(), runtime_health);
    runtime_tasks::spawn_tools_runtime_restart_loop(app.handle().clone());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_workspace_target_binary;
    use std::path::Path;

    #[test]
    fn detects_workspace_target_binary_on_windows_path() {
        assert!(is_workspace_target_binary(Path::new(
            r"C:\Users\SYBao\Documents\Code\Patina\src-tauri\target\release\patina.exe"
        )));
    }

    #[test]
    fn detects_workspace_target_binary_on_unix_path() {
        assert!(is_workspace_target_binary(Path::new(
            "/home/user/project/src-tauri/target/debug/patina"
        )));
    }

    #[test]
    fn ignores_installed_binary_path() {
        assert!(!is_workspace_target_binary(Path::new(
            r"C:\Users\SYBao\AppData\Local\Patina\patina.exe"
        )));
    }
}
