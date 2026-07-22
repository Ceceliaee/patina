use crate::app::main_window;
use crate::app::state::DesktopBehaviorState;
use crate::app::tray::{apply_tray_visibility, ensure_tray_visible, show_main_window};
use crate::data::app_settings_service;
use crate::domain::settings::{DesktopBehaviorSettings, StartupSource, StartupUiStrategy};
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

pub(crate) fn set_background_optimization(
    state: &DesktopBehaviorState,
    background_optimization: bool,
) {
    let _ = state.update_background_optimization(background_optimization);
}

fn replace_desktop_behavior_settings<R: Runtime>(
    app: &AppHandle<R>,
    settings: DesktopBehaviorSettings,
) -> DesktopBehaviorSettings {
    let state = app.state::<DesktopBehaviorState>();
    state.replace(settings)
}

pub(crate) fn apply_startup_desktop_behavior<R: Runtime + 'static>(
    app: &AppHandle<R>,
    settings: DesktopBehaviorSettings,
    source: StartupSource,
) -> bool {
    let next = replace_desktop_behavior_settings(app, settings);
    if should_sync_autostart(source) {
        if let Err(error) = apply_autostart(app, next.launch_at_login) {
            eprintln!("[tray] failed to apply autostart setting: {error}");
        }
    }
    let strategy = next.startup_ui_strategy(source);
    eprintln!(
        "[startup] source={} strategy={}",
        source.as_str(),
        strategy.as_str()
    );

    match strategy {
        StartupUiStrategy::Show => {
            show_main_window(app, main_window::MainWindowShowReason::Startup(source))
        }
        StartupUiStrategy::KeepHidden => start_in_tray(app, false),
        StartupUiStrategy::OptimizeHidden => start_in_tray(app, true),
    }
}

fn should_sync_autostart(source: StartupSource) -> bool {
    source != StartupSource::SettingsRecovery
}

fn start_in_tray<R: Runtime + 'static>(
    app: &AppHandle<R>,
    optimize_background_resources: bool,
) -> bool {
    if let Err(error) = ensure_tray_visible(app) {
        eprintln!("[startup] failed to expose tray recovery entry: {error}");
        return show_main_window(app, main_window::MainWindowShowReason::StartupRecovery);
    }

    if !main_window::register_hidden_main_window_startup(app, optimize_background_resources) {
        eprintln!("[startup] hidden main window registration was rejected; showing main window");
        return show_main_window(app, main_window::MainWindowShowReason::StartupRecovery);
    }

    true
}

pub(crate) async fn refresh_desktop_behavior_from_storage<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), String> {
    let settings = app_settings_service::load_desktop_behavior_settings(&app).await?;
    let next = replace_desktop_behavior_settings(&app, settings);
    if let Err(error) = apply_autostart(&app, next.launch_at_login) {
        eprintln!("[tray] failed to apply autostart setting after settings refresh: {error}");
    }
    apply_tray_visibility(&app, next);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::should_sync_autostart;
    use crate::domain::settings::StartupSource;

    #[test]
    fn settings_recovery_never_applies_unknown_autostart_values() {
        assert!(!should_sync_autostart(StartupSource::SettingsRecovery));
        assert!(should_sync_autostart(StartupSource::Manual));
        assert!(should_sync_autostart(StartupSource::Autostart));
        assert!(should_sync_autostart(StartupSource::UpdateRestart));
        assert!(should_sync_autostart(StartupSource::StorageRestart));
    }
}
