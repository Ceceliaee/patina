use crate::commands::error::CommandErrorDto;
use crate::commands::window_guard::require_main_window;
use crate::data::remote_backup_config::{self, ConfigSnapshot, SaveConfigInput};
use crate::data::settings_payload_service;
use crate::data::user_data_maintenance;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

#[tauri::command]
pub async fn cmd_delete_sessions_before<R: Runtime>(
    cutoff_time: i64,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), CommandErrorDto> {
    require_main_window(&window)?;
    user_data_maintenance::delete_sessions_before(&app, cutoff_time)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_delete_sessions_by_exe_names<R: Runtime>(
    exe_names: Vec<String>,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), CommandErrorDto> {
    require_main_window(&window)?;
    let tracking =
        app.state::<crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState>();
    let _transition = tracking.transition.lock().await;
    user_data_maintenance::delete_sessions_by_exe_names(&app, exe_names)
        .await
        .map_err(CommandErrorDto::from)?;
    // This deletion also removes application overrides.
    app.state::<crate::engine::tracking::title_state::TitleRecordingRuntimeState>()
        .invalidate_app_overrides();
    Ok(())
}

#[tauri::command]
pub async fn cmd_delete_sessions_by_exe_names_between<R: Runtime>(
    exe_names: Vec<String>,
    start_time: i64,
    end_time: i64,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), CommandErrorDto> {
    require_main_window(&window)?;
    user_data_maintenance::delete_sessions_by_exe_names_between(
        &app, exe_names, start_time, end_time,
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_delete_web_activity_segments_by_domain<R: Runtime>(
    normalized_domain: String,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<(), CommandErrorDto> {
    require_main_window(&window)?;
    user_data_maintenance::delete_web_activity_segments_by_domain(&app, normalized_domain)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_save_remote_backup_settings(
    patch: SaveConfigInput,
    app: AppHandle,
    window: WebviewWindow,
) -> Result<ConfigSnapshot, String> {
    crate::commands::window_guard::require_main_window_string(&window)?;
    let _guard = crate::app::scheduled_backup::lock_for_configuration(&app).await;
    let mut saved = remote_backup_config::save(&app, patch).await?;
    if crate::app::scheduled_backup::refresh_webdav_target_while_locked(&app)
        .await
        .is_err()
    {
        saved.runtime_refresh_pending = true;
    }
    Ok(saved)
}

#[tauri::command]
pub async fn cmd_save_remote_backup_last_backup_at<R: Runtime>(
    timestamp_ms: i64,
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    settings_payload_service::save_remote_backup_last_backup_at(&app, timestamp_ms)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_clear_remote_backup_settings(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<ConfigSnapshot, String> {
    crate::commands::window_guard::require_main_window_string(&window)?;
    let _guard = crate::app::scheduled_backup::lock_for_configuration(&app).await;
    let mut saved = remote_backup_config::clear(&app).await?;
    if crate::app::scheduled_backup::refresh_webdav_target_while_locked(&app)
        .await
        .is_err()
    {
        saved.runtime_refresh_pending = true;
    }
    Ok(saved)
}

#[tauri::command]
pub async fn cmd_save_data_bootstrap_snapshot_payload<R: Runtime>(
    payload: String,
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    settings_payload_service::save_data_bootstrap_snapshot_payload(&app, payload)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_clear_data_bootstrap_snapshot_payload<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    settings_payload_service::clear_data_bootstrap_snapshot_payload(&app)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_save_history_bootstrap_snapshot_payload<R: Runtime>(
    payload: String,
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    settings_payload_service::save_history_bootstrap_snapshot_payload(&app, payload)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_clear_history_bootstrap_snapshot_payload<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    settings_payload_service::clear_history_bootstrap_snapshot_payload(&app)
        .await
        .map_err(Into::into)
}
