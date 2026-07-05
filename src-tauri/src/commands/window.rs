use crate::app::main_window;
use tauri::AppHandle;

#[tauri::command]
pub fn cmd_minimize_main_window(app: AppHandle) {
    main_window::minimize_main_window(&app);
}

#[tauri::command]
pub fn cmd_frontend_ready(app: AppHandle) {
    main_window::on_frontend_ready(&app);
}
