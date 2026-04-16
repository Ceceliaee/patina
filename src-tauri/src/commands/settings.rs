use crate::app::desktop_behavior;
use crate::app::state::DesktopBehaviorState;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn cmd_set_desktop_behavior(
    close_behavior: String,
    minimize_behavior: String,
    app: AppHandle,
    desktop_behavior_state: State<DesktopBehaviorState>,
) -> Result<(), String> {
    desktop_behavior::set_desktop_behavior(
        &app,
        &desktop_behavior_state,
        &close_behavior,
        &minimize_behavior,
    );
    Ok(())
}

#[tauri::command]
pub fn cmd_set_launch_behavior(
    launch_at_login: bool,
    start_minimized: bool,
    app: AppHandle,
    desktop_behavior_state: State<DesktopBehaviorState>,
) -> Result<(), String> {
    desktop_behavior::set_launch_behavior(
        &app,
        &desktop_behavior_state,
        launch_at_login,
        start_minimized,
    )
}
