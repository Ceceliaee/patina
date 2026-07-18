use crate::app;
use crate::data::backup::{self, RestoreStrategy};
use crate::data::remote_backup::{
    self, RemoteBackupDownloadResult, RemoteBackupEntry, RemoteBackupUploadResult,
    WebDavBackupConfigDto, WebDavTestResult,
};
use crate::domain::backup::BackupPreview;
use crate::engine::import::tai;
use tauri::AppHandle;

#[tauri::command]
pub fn cmd_pick_backup_save_file(initial_path: Option<String>) -> Option<String> {
    backup::pick_backup_save_file(initial_path)
}

#[tauri::command]
pub fn cmd_pick_backup_file(initial_path: Option<String>) -> Option<String> {
    backup::pick_backup_file(initial_path)
}

#[tauri::command]
pub fn cmd_pick_tai_file(initial_path: Option<String>) -> Option<String> {
    backup::pick_tai_file(initial_path)
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
) -> Result<(), String> {
    app::backup::restore_backup_and_refresh(app, backup_path, hash, restore_strategy).await
}

#[tauri::command]
pub async fn cmd_preview_backup(backup_path: String) -> Result<BackupPreview, String> {
    backup::preview_backup(backup_path).await
}

#[tauri::command]
pub async fn cmd_parse_tai_file(
    file_path: String,
    app: AppHandle,
) -> Result<tai::TaiParsePreview, String> {
    app::backup::parse_tai_file(app, file_path).await
}

#[tauri::command]
pub async fn cmd_import_tai_file(
    file_path: String,
    options: tai::TaiImportOptions,
    app: AppHandle,
) -> Result<tai::ImportTaiReport, String> {
    app::backup::import_tai_file(app, file_path, options).await
}

#[tauri::command]
pub fn cmd_save_webdav_backup_secret(username: String, password: String) -> Result<(), String> {
    remote_backup::save_webdav_backup_secret(username, password)
}

#[tauri::command]
pub fn cmd_delete_webdav_backup_secret() -> Result<(), String> {
    remote_backup::delete_webdav_backup_secret()
}

#[tauri::command]
pub fn cmd_has_webdav_backup_secret() -> Result<bool, String> {
    remote_backup::has_webdav_backup_secret()
}

#[tauri::command]
pub fn cmd_reveal_webdav_backup_secret() -> Result<Option<String>, String> {
    remote_backup::reveal_webdav_backup_secret()
}

#[tauri::command]
pub async fn cmd_test_webdav_backup_target(
    config: WebDavBackupConfigDto,
    password: Option<String>,
) -> Result<WebDavTestResult, String> {
    remote_backup::test_webdav_backup_target(config, password).await
}

#[tauri::command]
pub async fn cmd_upload_webdav_backup(
    config: WebDavBackupConfigDto,
    app: AppHandle,
) -> Result<RemoteBackupUploadResult, String> {
    remote_backup::upload_webdav_backup(app, config).await
}

#[tauri::command]
pub async fn cmd_list_webdav_backups(
    config: WebDavBackupConfigDto,
) -> Result<Vec<RemoteBackupEntry>, String> {
    remote_backup::list_webdav_backups(config).await
}

#[tauri::command]
pub async fn cmd_download_webdav_backup(
    config: WebDavBackupConfigDto,
    id: String,
    app: AppHandle,
) -> Result<RemoteBackupDownloadResult, String> {
    remote_backup::download_webdav_backup(app, config, id).await
}

#[tauri::command]
pub fn cmd_delete_remote_backup_temp(path: String, app: AppHandle) -> Result<(), String> {
    remote_backup::delete_remote_backup_temp(app, path)
}
