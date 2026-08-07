use crate::data::screenshots_store;
use crate::engine::screenshots::{
    get_screenshot_data, get_screenshot_file_path, get_screenshot_thumbnail, load_settings,
    query_screenshot_metadata, query_screenshots, reveal_screenshot_in_folder, save_settings,
    ScreenshotEntry, ScreenshotSettings,
};
use tauri::AppHandle;

#[tauri::command]
pub async fn cmd_get_screenshot_settings(app: AppHandle) -> Result<ScreenshotSettings, String> {
    let store = screenshots_store::shared_from_app(&app).await?;
    load_settings(&store).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_set_screenshot_settings(
    settings: ScreenshotSettings,
    app: AppHandle,
) -> Result<(), String> {
    let store = screenshots_store::shared_from_app(&app).await?;
    save_settings(&store, &settings)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_query_screenshots(
    start_time: i64,
    end_time: i64,
    limit: Option<i64>,
    app: AppHandle,
) -> Result<Vec<ScreenshotEntry>, String> {
    let store = screenshots_store::shared_from_app(&app).await?;
    query_screenshots(&store, start_time, end_time, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_query_screenshot_metadata(
    start_time: i64,
    end_time: i64,
    limit: Option<i64>,
    app: AppHandle,
) -> Result<Vec<ScreenshotEntry>, String> {
    let store = screenshots_store::shared_from_app(&app).await?;
    query_screenshot_metadata(&store, start_time, end_time, limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_get_screenshot_thumbnail(id: i64, app: AppHandle) -> Result<String, String> {
    let store = screenshots_store::shared_from_app(&app).await?;
    get_screenshot_thumbnail(&store, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_get_screenshot_data(id: i64, app: AppHandle) -> Result<String, String> {
    let store = screenshots_store::shared_from_app(&app).await?;
    get_screenshot_data(&store, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_get_screenshot_file_path(id: i64, app: AppHandle) -> Result<String, String> {
    let store = screenshots_store::shared_from_app(&app).await?;
    get_screenshot_file_path(&store, id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cmd_reveal_screenshot_in_folder(id: i64, app: AppHandle) -> Result<(), String> {
    let store = screenshots_store::shared_from_app(&app).await?;
    reveal_screenshot_in_folder(&store, id)
        .await
        .map_err(|e| e.to_string())
}
