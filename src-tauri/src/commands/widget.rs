use crate::app::{main_window, tray, widget};
use crate::data::{
    icon_cache_service, repositories::widget_runtime::WidgetBootstrapSnapshot, widget_store,
};
use crate::domain::widget::{WidgetPhysicalPoint, WidgetPlacement};
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
pub async fn cmd_finalize_widget_drag(
    release_position: Option<WidgetPhysicalPoint>,
    expanded: bool,
    tool_slot_count: u8,
    app: AppHandle,
) -> Result<WidgetPlacement, String> {
    widget::finalize_widget_drag(&app, release_position, expanded, tool_slot_count).await
}

#[tauri::command]
pub async fn cmd_set_widget_expanded(
    expanded: bool,
    tool_slot_count: u8,
    app: AppHandle,
) -> Result<(), String> {
    widget::set_widget_window_expanded(&app, expanded, tool_slot_count).await
}

#[tauri::command]
pub fn cmd_get_widget_status_snapshot(
    app: AppHandle,
) -> Result<widget::WidgetPresentationSnapshot, String> {
    widget::get_widget_presentation_snapshot(&app)
}

#[tauri::command]
pub async fn cmd_set_widget_pinned(
    pinned: bool,
    tool_slot_count: u8,
    app: AppHandle,
) -> Result<(), String> {
    widget::set_widget_pinned(&app, pinned, tool_slot_count).await
}

#[tauri::command]
pub fn cmd_show_main_window(app: AppHandle) {
    tray::show_main_window(&app, crate::app::main_window::MainWindowShowReason::Widget);
}

#[tauri::command]
pub fn cmd_hide_widget_window(app: AppHandle) {
    main_window::close_widget_for_main_activity(&app);
}

#[tauri::command]
pub fn cmd_is_primary_mouse_button_down() -> bool {
    input::is_primary_mouse_button_down()
}
