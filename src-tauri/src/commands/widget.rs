use crate::app::{tray, widget};
use crate::data::{
    icon_cache_service, repositories::widget_runtime::WidgetBootstrapSnapshot, widget_store,
};
use crate::domain::widget::WidgetPlacement;
use crate::platform::windows::input;
use tauri::AppHandle;

#[tauri::command]
pub async fn cmd_get_widget_bootstrap_snapshot(
    app: AppHandle,
) -> Result<WidgetBootstrapSnapshot, String> {
    widget_store::load_widget_bootstrap_snapshot(&app).await
}

#[tauri::command]
pub async fn cmd_get_widget_placement(app: AppHandle) -> Result<WidgetPlacement, String> {
    widget::load_widget_placement(&app).await
}

#[tauri::command]
pub async fn cmd_get_widget_icon(
    exe_name: String,
    app: AppHandle,
) -> Result<Option<String>, String> {
    icon_cache_service::load_icon_for_exe(&app, &exe_name).await
}

#[tauri::command]
pub async fn cmd_finalize_widget_drag(app: AppHandle) -> Result<WidgetPlacement, String> {
    widget::finalize_widget_drag(&app).await
}

#[tauri::command]
pub async fn cmd_set_widget_expanded(
    expanded: bool,
    show_object_slot: bool,
    app: AppHandle,
) -> Result<(), String> {
    widget::set_widget_window_expanded(&app, expanded, show_object_slot).await
}

#[tauri::command]
pub fn cmd_show_main_window(app: AppHandle) {
    tray::show_main_window(&app, crate::app::main_window::MainWindowShowReason::Widget);
}

#[tauri::command]
pub fn cmd_hide_widget_window(app: AppHandle) {
    widget::close_widget_window(&app);
}

#[tauri::command]
pub async fn cmd_toggle_tracking_paused(app: AppHandle) -> Result<(), String> {
    tray::toggle_tracking_paused(app).await
}

#[tauri::command]
pub fn cmd_is_primary_mouse_button_down() -> bool {
    input::is_primary_mouse_button_down()
}
