use super::window_guard::require_main_window_string;
use crate::platform::ai_classification::{self, Config, Payload, Suggestion};
use tauri::{AppHandle, WebviewWindow};

#[tauri::command]
pub fn cmd_get_ai_classification_config(
    window: WebviewWindow,
    app: AppHandle,
) -> Result<Option<Config>, String> {
    require_main_window_string(&window)?;
    ai_classification::config(&app)
}

#[tauri::command]
pub fn cmd_save_ai_classification_config(
    window: WebviewWindow,
    app: AppHandle,
    config: Config,
    api_key: String,
) -> Result<Config, String> {
    require_main_window_string(&window)?;
    ai_classification::save(&app, config, api_key)
}

#[tauri::command]
pub async fn cmd_list_ai_classification_models(
    window: WebviewWindow,
    app: AppHandle,
    url: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    require_main_window_string(&window)?;
    ai_classification::list_models(&app, url, api_key).await
}

#[tauri::command]
pub async fn cmd_suggest_ai_categories(
    window: WebviewWindow,
    app: AppHandle,
    payload: Payload,
) -> Result<Vec<Suggestion>, String> {
    require_main_window_string(&window)?;
    ai_classification::suggest(&app, payload).await
}
