use crate::data::backup;
use crate::domain::backup::BackupPreview;
use crate::platform::credentials;
use crate::platform::webdav::{normalize_remote_dir, WebDavClient, WebDavConfig};
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const INDEX_FILE_NAME: &str = "backup-index.json";
const INDEX_VERSION: u32 = 1;
const INDEX_PRODUCT: &str = "Patina";
const LEGACY_INDEX_PRODUCT: &str = "Time Tracker";
const DEFAULT_REMOTE_DIR: &str = "/Patina";
const LEGACY_REMOTE_DIR: &str = "/TimeTracker";
const MAX_BACKUP_LIST_ITEMS: usize = 50;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavBackupConfigDto {
    pub url: String,
    pub username: String,
    pub remote_dir: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavTestResult {
    pub ok: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackupEntry {
    pub id: String,
    pub file_name: String,
    pub remote_path: String,
    pub created_at_ms: u64,
    pub size_bytes: u64,
    pub app_version: String,
    pub backup_version: u32,
    pub schema_version: u32,
    pub session_count: usize,
    pub title_sample_count: usize,
    pub setting_count: usize,
    pub icon_cache_count: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteBackupIndex {
    version: u32,
    product: String,
    updated_at_ms: u64,
    backups: Vec<RemoteBackupEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackupUploadResult {
    pub entry: RemoteBackupEntry,
    pub index_updated: bool,
    pub index_message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackupDownloadResult {
    pub path: String,
    pub preview: BackupPreview,
}

fn config_to_webdav(config: WebDavBackupConfigDto) -> Result<WebDavConfig, String> {
    let username = config.username.trim().to_string();
    if username.is_empty() {
        return Err("WebDAV username cannot be empty".to_string());
    }

    Ok(WebDavConfig {
        url: config.url.trim().to_string(),
        username,
        remote_dir: normalize_remote_dir(&config.remote_dir)?,
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn remote_backup_id() -> String {
    Local::now().format("%Y%m%d-%H%M%S").to_string()
}

fn remote_backup_file_name(id: &str) -> String {
    format!("Patina-backup-{id}.zip")
}

fn remote_path(remote_dir: &str, file_name: &str) -> String {
    format!("{remote_dir}/{file_name}")
}

fn index_path(remote_dir: &str) -> String {
    remote_path(remote_dir, INDEX_FILE_NAME)
}

fn parse_index(raw: &str) -> Result<RemoteBackupIndex, String> {
    let index: RemoteBackupIndex = serde_json::from_str(raw)
        .map_err(|error| format!("failed to parse WebDAV backup index: {error}"))?;
    if index.version != INDEX_VERSION {
        return Err(format!(
            "unsupported WebDAV backup index version {}",
            index.version
        ));
    }
    if index.product != INDEX_PRODUCT && index.product != LEGACY_INDEX_PRODUCT {
        return Err("WebDAV backup index belongs to another product".to_string());
    }
    Ok(index)
}

fn empty_index() -> RemoteBackupIndex {
    RemoteBackupIndex {
        version: INDEX_VERSION,
        product: INDEX_PRODUCT.to_string(),
        updated_at_ms: now_ms(),
        backups: Vec::new(),
    }
}

async fn load_index(client: &WebDavClient, remote_dir: &str) -> Result<RemoteBackupIndex, String> {
    match client.read_text_optional(&index_path(remote_dir)).await? {
        Some(raw) => parse_index(&raw),
        None => Ok(empty_index()),
    }
}

fn merge_legacy_entries(index: &mut RemoteBackupIndex, legacy: RemoteBackupIndex) -> bool {
    let mut changed = false;
    for entry in legacy.backups {
        if index.backups.iter().any(|item| item.id == entry.id) {
            continue;
        }
        index.backups.push(entry);
        changed = true;
    }

    if changed {
        index
            .backups
            .sort_by_key(|entry| Reverse(entry.created_at_ms));
        index.updated_at_ms = now_ms();
        index.product = INDEX_PRODUCT.to_string();
    }

    changed
}

async fn load_legacy_index(client: &WebDavClient) -> Result<Option<RemoteBackupIndex>, String> {
    match client
        .read_text_optional(&index_path(LEGACY_REMOTE_DIR))
        .await?
    {
        Some(raw) => parse_index(&raw).map(Some),
        None => Ok(None),
    }
}

async fn load_index_with_legacy_merge(
    client: &WebDavClient,
    remote_dir: &str,
) -> Result<RemoteBackupIndex, String> {
    let mut index = load_index(client, remote_dir).await?;
    if remote_dir != DEFAULT_REMOTE_DIR {
        return Ok(index);
    }

    match load_legacy_index(client).await {
        Ok(Some(legacy)) => {
            if merge_legacy_entries(&mut index, legacy) {
                if let Err(error) = save_index(client, remote_dir, &index).await {
                    eprintln!("[webdav] failed to persist migrated legacy backup index: {error}");
                }
            }
        }
        Ok(_) => {}
        Err(error) => {
            eprintln!("[webdav] failed to inspect legacy backup index: {error}");
        }
    }

    Ok(index)
}

async fn save_index(
    client: &WebDavClient,
    remote_dir: &str,
    index: &RemoteBackupIndex,
) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(index)
        .map_err(|error| format!("failed to serialize WebDAV backup index: {error}"))?;
    client.write_text(&index_path(remote_dir), &raw).await
}

fn temp_backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?
        .join("remote-backup-temp");
    fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create temp backup dir: {error}"))?;
    Ok(dir)
}

fn temp_backup_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    Ok(temp_backup_dir(app)?.join(file_name))
}

fn build_entry(
    id: String,
    file_name: String,
    remote_path: String,
    size_bytes: u64,
    preview: &BackupPreview,
) -> RemoteBackupEntry {
    RemoteBackupEntry {
        id,
        file_name,
        remote_path,
        created_at_ms: now_ms(),
        size_bytes,
        app_version: preview.app_version.clone(),
        backup_version: preview.version,
        schema_version: preview.schema_version,
        session_count: preview.session_count,
        title_sample_count: preview.title_sample_count,
        setting_count: preview.setting_count,
        icon_cache_count: preview.icon_cache_count,
    }
}

fn webdav_client(config: WebDavBackupConfigDto) -> Result<(WebDavConfig, WebDavClient), String> {
    let config = config_to_webdav(config)?;
    let password = credentials::read_webdav_backup_password()?
        .ok_or_else(|| "WebDAV password is missing".to_string())?;
    let client = WebDavClient::new(&config, password)?;
    Ok((config, client))
}

fn webdav_client_with_password(
    config: WebDavBackupConfigDto,
    password: Option<String>,
) -> Result<(WebDavConfig, WebDavClient), String> {
    let config = config_to_webdav(config)?;
    let password = match password {
        Some(password) if !password.is_empty() => password,
        _ => credentials::read_webdav_backup_password()?
            .ok_or_else(|| "WebDAV password is missing".to_string())?,
    };
    let client = WebDavClient::new(&config, password)?;
    Ok((config, client))
}

pub fn save_webdav_backup_secret(username: String, password: String) -> Result<(), String> {
    let username = username.trim();
    if username.is_empty() {
        return Err("WebDAV username cannot be empty".to_string());
    }
    if password.is_empty() {
        return Err("WebDAV password cannot be empty".to_string());
    }
    credentials::save_webdav_backup_password(username, &password)
}

pub fn delete_webdav_backup_secret() -> Result<(), String> {
    credentials::delete_webdav_backup_password()
}

pub fn has_webdav_backup_secret() -> Result<bool, String> {
    credentials::has_webdav_backup_password()
}

pub fn reveal_webdav_backup_secret() -> Result<Option<String>, String> {
    credentials::read_webdav_backup_password()
}

pub async fn test_webdav_backup_target(
    config: WebDavBackupConfigDto,
    password: Option<String>,
) -> Result<WebDavTestResult, String> {
    let (config, client) = webdav_client_with_password(config, password)?;
    client.ping(&config.remote_dir).await?;
    Ok(WebDavTestResult { ok: true })
}

pub async fn upload_webdav_backup(
    app: AppHandle,
    config: WebDavBackupConfigDto,
) -> Result<RemoteBackupUploadResult, String> {
    let (config, client) = webdav_client(config)?;
    client.ensure_dir(&config.remote_dir).await?;

    let id = remote_backup_id();
    let file_name = remote_backup_file_name(&id);
    let local_path = temp_backup_path(&app, &file_name)?;
    let local_path_string = local_path.to_string_lossy().to_string();
    backup::export_backup(Some(local_path_string.clone()), app).await?;
    let preview = backup::preview_backup(local_path_string).await?;
    let size_bytes = fs::metadata(&local_path)
        .map_err(|error| format!("failed to read local backup metadata: {error}"))?
        .len();
    let remote_path = remote_path(&config.remote_dir, &file_name);

    client.upload_file(&local_path, &remote_path).await?;
    let _ = fs::remove_file(&local_path);

    let entry = build_entry(id, file_name, remote_path, size_bytes, &preview);
    match load_index_with_legacy_merge(&client, &config.remote_dir).await {
        Ok(mut index) => {
            index.backups.retain(|item| item.id != entry.id);
            index.backups.insert(0, entry.clone());
            index
                .backups
                .sort_by_key(|entry| Reverse(entry.created_at_ms));
            index.updated_at_ms = now_ms();
            save_index(&client, &config.remote_dir, &index).await?;
            Ok(RemoteBackupUploadResult {
                entry,
                index_updated: true,
                index_message: None,
            })
        }
        Err(error) => Ok(RemoteBackupUploadResult {
            entry,
            index_updated: false,
            index_message: Some(error),
        }),
    }
}

pub async fn list_webdav_backups(
    config: WebDavBackupConfigDto,
) -> Result<Vec<RemoteBackupEntry>, String> {
    let (config, client) = webdav_client(config)?;
    let mut index = load_index_with_legacy_merge(&client, &config.remote_dir).await?;
    index
        .backups
        .sort_by_key(|entry| Reverse(entry.created_at_ms));
    index.backups.truncate(MAX_BACKUP_LIST_ITEMS);
    Ok(index.backups)
}

pub async fn download_webdav_backup(
    app: AppHandle,
    config: WebDavBackupConfigDto,
    id: String,
) -> Result<RemoteBackupDownloadResult, String> {
    let trimmed_id = id.trim();
    if trimmed_id.is_empty() {
        return Err("remote backup id cannot be empty".to_string());
    }

    let (config, client) = webdav_client(config)?;
    let index = load_index_with_legacy_merge(&client, &config.remote_dir).await?;
    let entry = index
        .backups
        .iter()
        .find(|entry| entry.id == trimmed_id)
        .ok_or_else(|| "remote backup was not found in the WebDAV index".to_string())?;
    let local_path = temp_backup_path(&app, &entry.file_name)?;
    client
        .download_file(&entry.remote_path, &local_path)
        .await?;
    let local_path_string = local_path.to_string_lossy().to_string();
    let preview = backup::preview_backup(local_path_string.clone()).await?;
    Ok(RemoteBackupDownloadResult {
        path: local_path_string,
        preview,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        merge_legacy_entries, parse_index, remote_backup_file_name, remote_path, RemoteBackupEntry,
        RemoteBackupIndex, INDEX_PRODUCT,
    };

    #[test]
    fn remote_file_name_uses_zip_format() {
        assert_eq!(
            remote_backup_file_name("20260603-213000"),
            "Patina-backup-20260603-213000.zip"
        );
    }

    #[test]
    fn remote_path_joins_normalized_dir_and_file() {
        assert_eq!(
            remote_path("/Patina/backups", "backup.zip"),
            "/Patina/backups/backup.zip"
        );
    }

    #[test]
    fn parse_index_accepts_legacy_product() {
        let raw = r#"{"version":1,"product":"Time Tracker","updatedAtMs":1,"backups":[]}"#;
        assert!(parse_index(raw).is_ok());
    }

    #[test]
    fn legacy_entries_merge_without_overwriting_current_entries() {
        let duplicate = RemoteBackupEntry {
            id: "same".to_string(),
            file_name: "Patina-backup-same.zip".to_string(),
            remote_path: "/Patina/Patina-backup-same.zip".to_string(),
            created_at_ms: 2,
            size_bytes: 10,
            app_version: "1.0.0".to_string(),
            backup_version: 1,
            schema_version: 1,
            session_count: 1,
            title_sample_count: 0,
            setting_count: 1,
            icon_cache_count: 0,
        };
        let legacy = RemoteBackupEntry {
            id: "legacy".to_string(),
            file_name: "TimeTracker-backup-legacy.zip".to_string(),
            remote_path: "/TimeTracker/TimeTracker-backup-legacy.zip".to_string(),
            created_at_ms: 1,
            ..duplicate.clone()
        };
        let mut index = RemoteBackupIndex {
            version: 1,
            product: INDEX_PRODUCT.to_string(),
            updated_at_ms: 1,
            backups: vec![duplicate.clone()],
        };
        let legacy_index = RemoteBackupIndex {
            version: 1,
            product: "Time Tracker".to_string(),
            updated_at_ms: 1,
            backups: vec![duplicate, legacy],
        };

        assert!(merge_legacy_entries(&mut index, legacy_index));
        assert_eq!(index.backups.len(), 2);
        assert!(index.backups.iter().any(|entry| entry.id == "legacy"));
        assert_eq!(index.product, INDEX_PRODUCT);
    }

    #[test]
    fn parse_index_rejects_other_products() {
        let raw = r#"{"version":1,"product":"Other","updatedAtMs":1,"backups":[]}"#;
        assert!(parse_index(raw).is_err());
    }
}
