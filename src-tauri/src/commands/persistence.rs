use crate::commands::error::CommandErrorDto;
use crate::data::settings_payload_service::{self, RemoteBackupSettingsPatch};
use crate::data::user_data_maintenance;
use tauri::{AppHandle, Runtime};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackupSettingsPatchDto {
    url: String,
    username: String,
    remote_dir: Option<String>,
    last_backup_at_ms: Option<i64>,
}

impl From<RemoteBackupSettingsPatchDto> for RemoteBackupSettingsPatch {
    fn from(value: RemoteBackupSettingsPatchDto) -> Self {
        Self {
            url: value.url,
            username: value.username,
            remote_dir: value.remote_dir,
            last_backup_at_ms: value.last_backup_at_ms,
        }
    }
}

#[tauri::command]
pub async fn cmd_delete_sessions_before<R: Runtime>(
    cutoff_time: i64,
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    user_data_maintenance::delete_sessions_before(&app, cutoff_time)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_clear_all_session_window_titles<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    user_data_maintenance::clear_all_session_window_titles(&app)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_delete_sessions_by_exe_names<R: Runtime>(
    exe_names: Vec<String>,
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    user_data_maintenance::delete_sessions_by_exe_names(&app, exe_names)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_delete_sessions_by_exe_names_between<R: Runtime>(
    exe_names: Vec<String>,
    start_time: i64,
    end_time: i64,
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    user_data_maintenance::delete_sessions_by_exe_names_between(
        &app, exe_names, start_time, end_time,
    )
    .await
    .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_delete_web_activity_segments_before<R: Runtime>(
    cutoff_time: i64,
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    user_data_maintenance::delete_web_activity_segments_before(&app, cutoff_time)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_delete_web_activity_segments_by_domain<R: Runtime>(
    normalized_domain: String,
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    user_data_maintenance::delete_web_activity_segments_by_domain(&app, normalized_domain)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_save_remote_backup_settings<R: Runtime>(
    patch: RemoteBackupSettingsPatchDto,
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    settings_payload_service::save_remote_backup_settings(&app, patch.into())
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_save_remote_backup_remote_dir<R: Runtime>(
    remote_dir: String,
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    settings_payload_service::save_remote_backup_remote_dir(&app, remote_dir)
        .await
        .map_err(Into::into)
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
pub async fn cmd_clear_remote_backup_settings<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), CommandErrorDto> {
    settings_payload_service::clear_remote_backup_settings(&app)
        .await
        .map_err(Into::into)
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
