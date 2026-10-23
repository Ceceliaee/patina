use crate::app;
use crate::commands::error::CommandErrorDto;
use crate::commands::window_guard::{require_main_window, require_main_window_string};
use crate::data::backup::{self, RestoreStrategy};
use crate::data::remote_backup::{
    self, RemoteBackupDownloadResult, RemoteBackupEntry, RemoteBackupUploadResult,
    WebDavBackupConfigDto, WebDavTestResult,
};
use crate::domain::backup::BackupPreview;
use crate::domain::backup_schedule::{ScheduledBackupConfigInput, ScheduledBackupSnapshot};
use tauri::{AppHandle, WebviewWindow};

#[tauri::command]
pub fn cmd_pick_backup_save_file(initial_path: Option<String>) -> Option<String> {
    backup::pick_backup_save_file(initial_path)
}

#[tauri::command]
pub fn cmd_pick_backup_file(initial_path: Option<String>) -> Option<String> {
    backup::pick_backup_file(initial_path)
}

#[tauri::command]
pub async fn cmd_get_scheduled_backup_snapshot(
    app: AppHandle,
) -> Result<ScheduledBackupSnapshot, String> {
    app::scheduled_backup::get_snapshot(&app).await
}

#[tauri::command]
pub fn cmd_pick_scheduled_backup_directory(initial_path: Option<String>) -> Option<String> {
    app::scheduled_backup::pick_directory(initial_path)
}

#[tauri::command]
pub async fn cmd_save_scheduled_backup_config(
    input: ScheduledBackupConfigInput,
    app: AppHandle,
    window: WebviewWindow,
) -> Result<ScheduledBackupSnapshot, String> {
    require_main_window_string(&window)?;
    app::scheduled_backup::save_config(&app, input).await
}

#[tauri::command]
pub async fn cmd_export_backup(
    backup_path: Option<String>,
    app: AppHandle,
) -> Result<String, String> {
    backup::export_backup(backup_path, app).await
}

#[tauri::command]
pub async fn cmd_restore_backup(
    backup_path: String,
    hash: String,
    restore_strategy: RestoreStrategy,
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), CommandErrorDto> {
    require_main_window(&window)?;
    app::backup::restore_backup_and_refresh(app, backup_path, hash, restore_strategy)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_preview_backup(backup_path: String) -> Result<BackupPreview, CommandErrorDto> {
    backup::preview_backup(backup_path)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub async fn cmd_get_remote_backup_config_snapshot(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<crate::data::remote_backup_config::ConfigSnapshot, String> {
    require_main_window_string(&window)?;
    crate::data::remote_backup_config::snapshot(&app).await
}

#[tauri::command]
pub async fn cmd_reveal_webdav_backup_secret(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<Option<String>, String> {
    require_main_window_string(&window)?;
    crate::data::remote_backup_config::reveal(&app).await
}

#[tauri::command]
pub async fn cmd_test_webdav_backup_target(
    config: WebDavBackupConfigDto,
    password: Option<String>,
    app: AppHandle,
) -> Result<WebDavTestResult, String> {
    remote_backup::test_webdav_backup_target(&app, config, password).await
}

#[tauri::command]
pub async fn cmd_upload_webdav_backup(
    config: WebDavBackupConfigDto,
    file_name: String,
    app: AppHandle,
) -> Result<RemoteBackupUploadResult, String> {
    remote_backup::upload_webdav_backup(app, config, file_name).await
}

#[tauri::command]
pub async fn cmd_list_webdav_backups(
    config: WebDavBackupConfigDto,
    app: AppHandle,
) -> Result<Vec<RemoteBackupEntry>, String> {
    remote_backup::list_webdav_backups(&app, config).await
}

#[tauri::command]
pub async fn cmd_download_webdav_backup(
    config: WebDavBackupConfigDto,
    id: String,
    app: AppHandle,
) -> Result<RemoteBackupDownloadResult, CommandErrorDto> {
    remote_backup::download_webdav_backup(app, config, id)
        .await
        .map_err(Into::into)
}

#[tauri::command]
pub fn cmd_delete_remote_backup_temp(path: String, app: AppHandle) -> Result<(), String> {
    remote_backup::delete_remote_backup_temp(app, path)
}
