use crate::app::mini_window::{self, Action, Snapshot};
use tauri::{AppHandle, Runtime, WebviewWindow};

#[tauri::command]
pub async fn cmd_get_mini_activity_snapshot(
    app: AppHandle,
    window: WebviewWindow,
    kind: crate::data::repositories::mini_activity::MiniActivityKind,
) -> Result<crate::data::repositories::mini_activity::MiniActivitySnapshot, String> {
    if window.label() != "mini" {
        return Err("Mini window access denied".into());
    }
    crate::data::mini_window_store::load_activity(&app, kind).await
}

#[tauri::command]
pub async fn cmd_open_mini_window<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), String> {
    super::window_guard::require_main_window_string(&window)?;
    mini_window::open(&app).await
}

#[tauri::command]
pub async fn cmd_get_mini_window_snapshot<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Snapshot, String> {
    if window.label() != "mini" {
        return Err("Mini window access denied".into());
    }
    Ok(mini_window::snapshot(&app).await)
}

#[tauri::command]
pub async fn cmd_mini_window_action<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
    epoch: u64,
    action: Action,
) -> Result<Snapshot, String> {
    if window.label() != "mini" {
        return Err("Mini window access denied".into());
    }
    mini_window::action(&app, epoch, action).await
}

#[tauri::command]
pub async fn cmd_get_mini_bootstrap_snapshot(
    app: AppHandle,
) -> Result<crate::data::repositories::mini_window::MiniBootstrapSnapshot, String> {
    crate::data::mini_window_store::load_bootstrap(&app).await
}

#[tauri::command]
pub async fn cmd_get_mini_presentation_snapshot(
    app: AppHandle,
) -> Result<mini_window::content::MiniPresentationSnapshot, String> {
    mini_window::content::get_mini_presentation_snapshot(&app).await
}
