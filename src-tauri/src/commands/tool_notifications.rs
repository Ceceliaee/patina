use crate::app::tool_notifications::{self, Action, Snapshot};
use crate::domain::tool_notifications::{Preferences, PreferencesPatch};
use tauri::{Manager, WebviewWindow};

#[tauri::command]
pub async fn cmd_get_tool_presentation(
    window: WebviewWindow,
    retry: Option<bool>,
) -> Result<Snapshot, String> {
    tool_notifications::snapshot(window.app_handle(), window.label())?;
    if retry == Some(true) {
        super::window_guard::require_main_window_string(&window)?;
        tool_notifications::retry(window.app_handle()).await?;
    } else {
        tool_notifications::refresh(window.app_handle()).await?;
    }
    tool_notifications::snapshot(window.app_handle(), window.label())
}

#[tauri::command]
pub async fn cmd_save_tool_notification_preferences(
    window: WebviewWindow,
    patch: PreferencesPatch,
) -> Result<Preferences, String> {
    super::window_guard::require_main_window_string(&window)?;
    tool_notifications::save(window.app_handle(), patch).await
}

#[tauri::command]
pub async fn cmd_tool_presentation_action(
    window: WebviewWindow,
    alert_id: String,
    action: Action,
) -> Result<(), String> {
    tool_notifications::action(window.app_handle(), window.label(), &alert_id, action).await
}

#[tauri::command]
pub async fn cmd_tool_presentation_ready(
    window: WebviewWindow,
    alert_id: String,
    width: f64,
    height: f64,
    canvas_height: Option<f64>,
) -> Result<(), String> {
    tool_notifications::ready(
        window.app_handle(),
        window.label(),
        &alert_id,
        width,
        height,
        canvas_height,
    )
    .await
}
