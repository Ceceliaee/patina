use crate::app::desktop_behavior;
use crate::app::main_window;
use crate::app::runtime_tasks;
use crate::app::tray::setup_tray;
use crate::domain::settings::{DesktopBehaviorSettings, StartupSource};
use crate::engine::tracking::watchdog::RuntimeHealthState;
use crate::platform::windows::{audio, media, power};
#[cfg(any(test, all(not(debug_assertions), not(patina_local_build))))]
use std::path::Path;
use std::sync::Arc;

pub const AUTOSTART_ARG: &str = "--autostart";

#[derive(Clone, Copy, Debug)]
pub(crate) struct StartupContext {
    pub(crate) settings: DesktopBehaviorSettings,
    pub(crate) source: StartupSource,
}

impl StartupContext {
    pub(crate) fn new(settings: DesktopBehaviorSettings, source: StartupSource) -> Self {
        Self { settings, source }
    }
}

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
    startup: StartupContext,
) -> tauri::Result<()> {
    tauri::async_runtime::block_on(crate::app::remote_status_bridge::ensure_machine_id(
        &app.handle().clone(),
    ))
    .map_err(std::io::Error::other)?;
    crate::app::tracking::register_power_lifecycle_handler(app);
    crate::app::tools::register_alert_handler(app);
    power::start(app.handle().clone());
    audio::start_signal_source();
    media::start_signal_source();
    crate::app::web_activity_bridge::start(app.handle().clone());
    crate::app::remote_status_bridge::start(app.handle().clone());
    crate::app::web_activity::spawn_startup_repair(app.handle().clone());
    crate::data::activity_read_model::spawn_background_worker(app.handle().clone());

    let app_handle = app.handle().clone();
    main_window::ensure_main_window(&app_handle).map_err(std::io::Error::other)?;
    setup_tray(&app_handle)?;
    if !desktop_behavior::apply_startup_desktop_behavior(
        &app_handle,
        startup.settings,
        startup.source,
    ) {
        return Err(std::io::Error::other("failed to establish startup UI recovery path").into());
    }
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
