use crate::data::sqlite_pool;
use crate::engine::screenshots::{
    get_screenshot_data, get_screenshot_file_path, load_settings, query_screenshots,
    reveal_screenshot_in_folder, save_settings, ScreenshotEntry, ScreenshotSettings,
};
use tauri::AppHandle;

#[tauri::command]
pub async fn cmd_get_screenshot_settings(app: AppHandle) -> Result<ScreenshotSettings, String> {
    let pool = sqlite_pool::wait_for_sqlite_pool(&app)
        .await
        .map_err(|e| format!("db pool: {e}"))?;
    Ok(load_settings(&pool).await)
}

#[tauri::command]
pub async fn cmd_set_screenshot_settings(
    settings: ScreenshotSettings,
    app: AppHandle,
) -> Result<(), String> {
    let pool = sqlite_pool::wait_for_sqlite_pool(&app)
        .await
        .map_err(|e| format!("db pool: {e}"))?;
    save_settings(&pool, &settings).await
}

#[tauri::command]
pub async fn cmd_query_screenshots(
    start_time: i64,
    end_time: i64,
    app: AppHandle,
) -> Result<Vec<ScreenshotEntry>, String> {
    let pool = sqlite_pool::wait_for_sqlite_pool(&app)
        .await
        .map_err(|e| format!("db pool: {e}"))?;
    query_screenshots(&pool, start_time, end_time).await
}

#[tauri::command]
pub async fn cmd_get_screenshot_data(
    id: i64,
    app: AppHandle,
) -> Result<String, String> {
    let pool = sqlite_pool::wait_for_sqlite_pool(&app)
        .await
        .map_err(|e| format!("db pool: {e}"))?;
    get_screenshot_data(&pool, id).await
}

#[tauri::command]
pub async fn cmd_get_screenshot_file_path(
    id: i64,
    app: AppHandle,
) -> Result<String, String> {
    let pool = sqlite_pool::wait_for_sqlite_pool(&app)
        .await
        .map_err(|e| format!("db pool: {e}"))?;
    get_screenshot_file_path(&pool, id).await
}

#[tauri::command]
pub async fn cmd_reveal_screenshot_in_folder(
    id: i64,
    app: AppHandle,
) -> Result<(), String> {
    let pool = sqlite_pool::wait_for_sqlite_pool(&app)
        .await
        .map_err(|e| format!("db pool: {e}"))?;
    reveal_screenshot_in_folder(&pool, id).await
}
