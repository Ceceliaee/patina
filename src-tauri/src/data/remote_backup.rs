use crate::data::backup;
use crate::data::repositories::remote_backup_settings;
use crate::domain::backup::BackupPreview;
use crate::domain::backup_schedule::ScheduledBackupRun;
use crate::platform::credentials;
use crate::platform::storage_paths;
use crate::platform::webdav::{WebDavClient, WebDavConfig};
use chrono::Local;
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};
use std::cmp::Reverse;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::AppHandle;
use tokio::sync::Mutex;

const INDEX_FILE_NAME: &str = "backup-index.json";
const INDEX_VERSION: u32 = 1;
const INDEX_PRODUCT: &str = "Patina";
const MAX_BACKUP_LIST_ITEMS: usize = 50;
const MAX_INDEX_BACKUP_ITEMS: usize = 5_000;
const MAX_INDEX_WRITE_ATTEMPTS: usize = 3;
static REMOTE_BACKUP_COUNTER: AtomicU64 = AtomicU64::new(0);
static REMOTE_INDEX_LOCK: Mutex<()> = Mutex::const_new(());
static REMOTE_TRANSFER_LOCK: Mutex<()> = Mutex::const_new(());

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
    #[serde(default = "legacy_format_kind")]
    pub format_kind: String,
    pub backup_version: u32,
    pub schema_version: u32,
    pub session_count: usize,
    pub title_sample_count: usize,
    #[serde(default)]
    pub import_batch_count: usize,
    #[serde(default)]
    pub import_exact_session_count: usize,
    #[serde(default)]
    pub import_time_bucket_count: usize,
    pub setting_count: usize,
    pub icon_cache_count: usize,
    #[serde(default = "manual_origin")]
    pub origin: String,
    #[serde(default)]
    pub target_generation: Option<String>,
    #[serde(default)]
    pub run_key: Option<String>,
    #[serde(default)]
    pub archive_sha256: Option<String>,
}

fn legacy_format_kind() -> String {
    "legacy_structured".to_string()
}

fn manual_origin() -> String {
    "manual".to_string()
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
    remote_backup_settings::normalize_config(&config.url, &config.username, &config.remote_dir)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn remote_backup_id() -> String {
    format!(
        "{}-{:04}",
        Local::now().format("%Y%m%d-%H%M%S-%3f"),
        REMOTE_BACKUP_COUNTER.fetch_add(1, Ordering::Relaxed) % 10_000
    )
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
    if index.product != INDEX_PRODUCT {
        return Err("WebDAV backup index belongs to another product".to_string());
    }
    if index.backups.len() > MAX_INDEX_BACKUP_ITEMS {
        return Err("WebDAV backup index contains too many entries".to_string());
    }
    for entry in &index.backups {
        validate_backup_file_name(&entry.file_name)?;
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

struct LoadedRemoteBackupIndex {
    index: RemoteBackupIndex,
    etag: Option<String>,
    existed: bool,
}

async fn load_index_snapshot(
    client: &WebDavClient,
    remote_dir: &str,
) -> Result<LoadedRemoteBackupIndex, String> {
    let snapshot = client.read_text_snapshot(&index_path(remote_dir)).await?;
    match snapshot.value {
        Some(raw) => Ok(LoadedRemoteBackupIndex {
            index: parse_index(&raw)?,
            etag: snapshot.etag,
            existed: true,
        }),
        None => Ok(LoadedRemoteBackupIndex {
            index: empty_index(),
            etag: None,
            existed: false,
        }),
    }
}

async fn load_index(client: &WebDavClient, remote_dir: &str) -> Result<RemoteBackupIndex, String> {
    Ok(load_index_snapshot(client, remote_dir).await?.index)
}

async fn save_index_snapshot(
    client: &WebDavClient,
    remote_dir: &str,
    index: &RemoteBackupIndex,
    expected_etag: Option<&str>,
    create_new: bool,
) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(index)
        .map_err(|error| format!("failed to serialize WebDAV backup index: {error}"))?;
    client
        .write_text_conditionally(&index_path(remote_dir), &raw, expected_etag, create_new)
        .await
}

async fn update_index<F, V>(
    client: &WebDavClient,
    remote_dir: &str,
    mutate: F,
    verify: V,
) -> Result<RemoteBackupIndex, String>
where
    F: Fn(&mut RemoteBackupIndex),
    V: Fn(&RemoteBackupIndex) -> bool,
{
    for _ in 0..MAX_INDEX_WRITE_ATTEMPTS {
        let mut loaded = load_index_snapshot(client, remote_dir).await?;
        let original_entries = loaded.index.backups.clone();
        mutate(&mut loaded.index);
        let preserved_entries = original_entries
            .into_iter()
            .filter(|entry| loaded.index.backups.iter().any(|current| current == entry))
            .collect::<Vec<_>>();
        loaded.index.updated_at_ms = now_ms();
        match save_index_snapshot(
            client,
            remote_dir,
            &loaded.index,
            loaded.etag.as_deref(),
            !loaded.existed,
        )
        .await
        {
            Ok(()) => {
                let confirmed = load_index(client, remote_dir).await?;
                if verify(&confirmed)
                    && preserved_entries
                        .iter()
                        .all(|entry| confirmed.backups.iter().any(|current| current == entry))
                {
                    return Ok(confirmed);
                }
            }
            Err(error) if error == "remote_index_conflict" => continue,
            Err(error) => return Err(error),
        }
    }
    Err("remote_index_conflict".to_string())
}

fn temp_backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = storage_paths::resolve_storage_paths(app)?.remote_backup_temp_dir;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("failed to create temp backup dir: {error}"))?;
    Ok(dir)
}

fn temp_backup_path(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    validate_backup_file_name(file_name)?;
    Ok(temp_backup_dir(app)?.join(file_name))
}

fn remove_empty_temp_backup_dir(temp_dir: &Path) -> Result<(), String> {
    match fs::remove_dir(temp_dir) {
        Ok(()) => Ok(()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
            ) =>
        {
            Ok(())
        }
        Err(error) => Err(format!(
            "failed to delete empty remote backup temp directory: {error}"
        )),
    }
}

fn remove_temp_backup_file(path: &Path, temp_dir: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to delete remote backup temp file: {error}")),
    }
    remove_empty_temp_backup_dir(temp_dir)
}

fn validate_backup_file_name(file_name: &str) -> Result<(), String> {
    let path = std::path::Path::new(file_name);
    if file_name.is_empty()
        || !file_name.ends_with(".zip")
        || path.file_name().and_then(|name| name.to_str()) != Some(file_name)
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.chars().any(|character| character.is_control())
    {
        return Err("WebDAV backup index contains an unsafe file name".to_string());
    }
    Ok(())
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
        format_kind: preview.format_kind.clone(),
        backup_version: preview.version,
        schema_version: preview.schema_version,
        session_count: preview.session_count,
        title_sample_count: preview.title_sample_count,
        import_batch_count: preview.import_batch_count,
        import_exact_session_count: preview.import_exact_session_count,
        import_time_bucket_count: preview.import_time_bucket_count,
        setting_count: preview.setting_count,
        icon_cache_count: preview.icon_cache_count,
        origin: manual_origin(),
        target_generation: None,
        run_key: None,
        archive_sha256: None,
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
    let _transfer_guard = REMOTE_TRANSFER_LOCK.lock().await;
    let (config, client) = webdav_client(config)?;
    client.ensure_dir(&config.remote_dir).await?;

    let id = remote_backup_id();
    let file_name = remote_backup_file_name(&id);
    let local_path = temp_backup_path(&app, &file_name)?;
    let temp_dir = local_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "remote backup temp path has no parent directory".to_string())?;
    let local_path_string = local_path.to_string_lossy().to_string();
    let upload_result = async {
        backup::export_backup(Some(local_path_string.clone()), app).await?;
        let preview = backup::preview_backup(local_path_string).await?;
        let size_bytes = fs::metadata(&local_path)
            .map_err(|error| format!("failed to read local backup metadata: {error}"))?
            .len();
        let remote_path = remote_path(&config.remote_dir, &file_name);
        client.upload_file(&local_path, &remote_path).await?;
        Ok::<_, String>(build_entry(
            id,
            file_name,
            remote_path,
            size_bytes,
            &preview,
        ))
    }
    .await;
    let _ = remove_temp_backup_file(&local_path, &temp_dir);
    let entry = upload_result?;
    let _index_guard = REMOTE_INDEX_LOCK.lock().await;
    let entry_for_update = entry.clone();
    match update_index(
        &client,
        &config.remote_dir,
        |index| {
            index.backups.retain(|item| item.id != entry_for_update.id);
            index.backups.insert(0, entry_for_update.clone());
            index
                .backups
                .sort_by_key(|entry| Reverse(entry.created_at_ms));
        },
        |index| index.backups.iter().any(|item| item == &entry_for_update),
    )
    .await
    {
        Ok(_) => Ok(RemoteBackupUploadResult {
            entry,
            index_updated: true,
            index_message: None,
        }),
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
    let mut index = load_index(&client, &config.remote_dir).await?;
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
    let _transfer_guard = REMOTE_TRANSFER_LOCK.lock().await;
    let trimmed_id = id.trim();
    if trimmed_id.is_empty() {
        return Err("remote backup id cannot be empty".to_string());
    }

    let (config, client) = webdav_client(config)?;
    let index = load_index(&client, &config.remote_dir).await?;
    let entry = index
        .backups
        .iter()
        .find(|entry| entry.id == trimmed_id)
        .ok_or_else(|| "remote backup was not found in the WebDAV index".to_string())?;
    validate_backup_file_name(&entry.file_name)?;
    let local_path = temp_backup_path(&app, &entry.file_name)?;
    let temp_dir = local_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "remote backup temp path has no parent directory".to_string())?;
    let trusted_remote_path = remote_path(&config.remote_dir, &entry.file_name);
    if let Err(error) = client
        .download_file(&trusted_remote_path, &local_path)
        .await
    {
        let _ = remove_temp_backup_file(&local_path, &temp_dir);
        return Err(error);
    }
    let local_path_string = local_path.to_string_lossy().to_string();
    let preview = match backup::preview_backup(local_path_string.clone()).await {
        Ok(preview) => preview,
        Err(error) => {
            let _ = remove_temp_backup_file(&local_path, &temp_dir);
            return Err(error);
        }
    };
    Ok(RemoteBackupDownloadResult {
        path: local_path_string,
        preview,
    })
}

pub(crate) fn cleanup_remote_backup_temp_if_owned(
    app: &AppHandle,
    raw_path: &str,
) -> Result<bool, String> {
    let path = PathBuf::from(raw_path);
    let temp_dir = storage_paths::resolve_storage_paths(app)?.remote_backup_temp_dir;
    if path.parent() != Some(temp_dir.as_path()) {
        return Ok(false);
    }
    validate_backup_file_name(
        path.file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| "remote backup temp path has no valid file name".to_string())?,
    )?;
    remove_temp_backup_file(&path, &temp_dir)?;
    Ok(true)
}

pub fn delete_remote_backup_temp(app: AppHandle, raw_path: String) -> Result<(), String> {
    if cleanup_remote_backup_temp_if_owned(&app, &raw_path)? {
        Ok(())
    } else {
        Err("refusing to delete a file outside the remote backup temp directory".to_string())
    }
}

pub(crate) struct ScheduledWebDavTarget {
    pub config: WebDavConfig,
    pub client: WebDavClient,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ScheduledRemotePruneOutcome {
    Pruned,
    Missing,
    Conflict,
}

pub(crate) struct ScheduledRemoteUploadOutcome {
    pub etag: Option<String>,
    pub created_new: bool,
}

pub(crate) async fn load_scheduled_webdav_target(
    pool: &Pool<Sqlite>,
) -> Result<ScheduledWebDavTarget, String> {
    let config = remote_backup_settings::load_config(pool)
        .await?
        .ok_or_else(|| "webdav_not_configured".to_string())?;
    let password = credentials::read_webdav_backup_password()?
        .ok_or_else(|| "credential_missing".to_string())?;
    let client = WebDavClient::new(&config, password)?;
    Ok(ScheduledWebDavTarget { config, client })
}

pub(crate) async fn lock_remote_transfer() -> tokio::sync::MutexGuard<'static, ()> {
    REMOTE_TRANSFER_LOCK.lock().await
}

pub(crate) fn scheduled_target_identity(target: &ScheduledWebDavTarget) -> String {
    remote_backup_settings::target_identity(&target.config)
}

fn scheduled_remote_backup_id(run: &ScheduledBackupRun) -> String {
    let hours = run.logical_time_minutes / 60;
    let minutes = run.logical_time_minutes % 60;
    let date = run.logical_date.replace('-', "");
    let generation = run.target_generation.chars().take(8).collect::<String>();
    format!(
        "scheduled-{date}-{hours:02}{minutes:02}-{generation}-a{}",
        run.attempt_count
    )
}

pub(crate) fn scheduled_remote_backup_path(
    target: &ScheduledWebDavTarget,
    run: &ScheduledBackupRun,
) -> String {
    remote_path(
        &target.config.remote_dir,
        &format!("Patina-{}.zip", scheduled_remote_backup_id(run)),
    )
}

pub(crate) fn scheduled_temp_paths(
    app: &AppHandle,
    run: &ScheduledBackupRun,
) -> Result<(PathBuf, PathBuf), String> {
    let id = scheduled_remote_backup_id(run);
    let staging = temp_backup_path(app, &format!("Patina-{id}.zip"))?;
    let verification = temp_backup_path(app, &format!("Patina-{id}-verify.zip"))?;
    Ok((staging, verification))
}

pub(crate) fn cleanup_scheduled_temp(app: &AppHandle, path: &Path) -> Result<(), String> {
    let temp_dir = storage_paths::resolve_storage_paths(app)?.remote_backup_temp_dir;
    if path.parent() != Some(temp_dir.as_path()) {
        return Err(
            "refusing to clean a scheduled backup outside the controlled temp directory"
                .to_string(),
        );
    }
    remove_temp_backup_file(path, &temp_dir)
}

pub(crate) async fn upload_scheduled_snapshot(
    target: &ScheduledWebDavTarget,
    local_path: &Path,
    remote_path: &str,
    expected_size: u64,
) -> Result<ScheduledRemoteUploadOutcome, String> {
    target.client.ensure_dir(&target.config.remote_dir).await?;
    if let Some(metadata) = target.client.object_metadata(remote_path).await? {
        if metadata
            .size_bytes
            .is_some_and(|size| size != expected_size)
        {
            return Err("remote_name_conflict".to_string());
        }
        return Ok(ScheduledRemoteUploadOutcome {
            etag: metadata.etag,
            created_new: false,
        });
    }
    target
        .client
        .upload_file_create_new(local_path, remote_path)
        .await?;
    let metadata = target
        .client
        .object_metadata(remote_path)
        .await?
        .ok_or_else(|| "uploaded WebDAV backup is not observable".to_string())?;
    if metadata
        .size_bytes
        .is_some_and(|size| size != expected_size)
    {
        return Err("remote_validation_failed".to_string());
    }
    Ok(ScheduledRemoteUploadOutcome {
        etag: metadata.etag,
        created_new: true,
    })
}

pub(crate) async fn verify_scheduled_snapshot(
    target: &ScheduledWebDavTarget,
    remote_path: &str,
    verification_path: &Path,
    expected_hash: &str,
    expected_size: u64,
) -> Result<(), String> {
    let verification_dir = verification_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "scheduled verification path has no parent".to_string())?;
    let result = async {
        target
            .client
            .download_file(remote_path, verification_path)
            .await?;
        let (actual_hash, actual_size) =
            backup::validate_scheduled_snapshot(verification_path).await?;
        if actual_hash != expected_hash || actual_size != expected_size {
            return Err("remote_validation_failed".to_string());
        }
        Ok(())
    }
    .await;
    let _ = remove_temp_backup_file(verification_path, &verification_dir);
    result
}

pub(crate) async fn discard_failed_scheduled_snapshot(
    target: &ScheduledWebDavTarget,
    run: &ScheduledBackupRun,
) -> Result<bool, String> {
    if run.target_kind != "webdav" || run.target_path == "pending://webdav" {
        return Ok(false);
    }
    let file_name = Path::new(&run.target_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "failed scheduled WebDAV path has no safe file name".to_string())?;
    validate_backup_file_name(file_name)?;
    if run.target_path != remote_path(&target.config.remote_dir, file_name) {
        return Err(
            "refusing to discard a failed backup outside the configured directory".to_string(),
        );
    }
    let Some(metadata) = target.client.object_metadata(&run.target_path).await? else {
        return Ok(false);
    };
    let recorded_etag = run.remote_etag.as_deref().ok_or_else(|| {
        "refusing to discard a failed backup without a recorded remote identity".to_string()
    })?;
    if metadata.etag.as_deref() != Some(recorded_etag) {
        return Err(
            "refusing to discard a failed backup whose remote identity changed".to_string(),
        );
    }
    target
        .client
        .delete_file(&run.target_path, Some(recorded_etag))
        .await
}

pub(crate) async fn publish_scheduled_snapshot(
    target: &ScheduledWebDavTarget,
    run: &ScheduledBackupRun,
    staging_path: &Path,
) -> Result<RemoteBackupEntry, String> {
    let preview = backup::preview_backup(staging_path.to_string_lossy().to_string()).await?;
    let hash = run
        .archive_sha256
        .clone()
        .ok_or_else(|| "scheduled backup is missing its verified checksum".to_string())?;
    let size = run
        .size_bytes
        .ok_or_else(|| "scheduled backup is missing its verified size".to_string())?;
    let trusted_remote_path = run.target_path.clone();
    let file_name = Path::new(&trusted_remote_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "scheduled WebDAV path has no safe file name".to_string())?
        .to_string();
    validate_backup_file_name(&file_name)?;
    if trusted_remote_path != remote_path(&target.config.remote_dir, &file_name) {
        return Err("scheduled WebDAV path is outside the configured directory".to_string());
    }
    let mut entry = build_entry(
        scheduled_remote_backup_id(run),
        file_name,
        trusted_remote_path,
        size,
        &preview,
    );
    entry.origin = "scheduled".to_string();
    entry.target_generation = Some(run.target_generation.clone());
    entry.run_key = Some(run.run_key.clone());
    entry.archive_sha256 = Some(hash);

    let _index_guard = REMOTE_INDEX_LOCK.lock().await;
    let entry_for_update = entry.clone();
    update_index(
        &target.client,
        &target.config.remote_dir,
        |index| {
            index.backups.retain(|item| item.id != entry_for_update.id);
            index.backups.insert(0, entry_for_update.clone());
            index
                .backups
                .sort_by_key(|item| Reverse(item.created_at_ms));
        },
        |index| index.backups.iter().any(|item| item == &entry_for_update),
    )
    .await?;
    Ok(entry)
}

fn scheduled_entry_matches_run(entry: &RemoteBackupEntry, run: &ScheduledBackupRun) -> bool {
    run.target_kind == "webdav"
        && run.status == "succeeded"
        && run.file_state == "present"
        && entry.origin == "scheduled"
        && entry.target_generation.as_deref() == Some(run.target_generation.as_str())
        && entry.run_key.as_deref() == Some(run.run_key.as_str())
        && entry.remote_path == run.target_path
        && entry.archive_sha256.as_deref() == run.archive_sha256.as_deref()
        && Some(entry.size_bytes) == run.size_bytes
}

pub(crate) async fn prune_scheduled_snapshot(
    target: &ScheduledWebDavTarget,
    run: &ScheduledBackupRun,
) -> Result<ScheduledRemotePruneOutcome, String> {
    if run.target_kind != "webdav" || run.status != "succeeded" || run.file_state != "present" {
        return Ok(ScheduledRemotePruneOutcome::Conflict);
    }
    let file_name = Path::new(&run.target_path)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "scheduled WebDAV path has no safe file name".to_string())?;
    validate_backup_file_name(file_name)?;
    if run.target_path != remote_path(&target.config.remote_dir, file_name) {
        return Ok(ScheduledRemotePruneOutcome::Conflict);
    }

    let _index_guard = REMOTE_INDEX_LOCK.lock().await;
    let index = load_index(&target.client, &target.config.remote_dir).await?;
    let Some(entry) = index
        .backups
        .iter()
        .find(|entry| entry.run_key.as_deref() == Some(run.run_key.as_str()))
        .cloned()
    else {
        return Ok(ScheduledRemotePruneOutcome::Conflict);
    };
    if !scheduled_entry_matches_run(&entry, run) {
        return Ok(ScheduledRemotePruneOutcome::Conflict);
    }
    let metadata = target.client.object_metadata(&run.target_path).await?;
    if metadata
        .as_ref()
        .and_then(|value| value.size_bytes)
        .is_some_and(|size| Some(size) != run.size_bytes)
    {
        return Ok(ScheduledRemotePruneOutcome::Conflict);
    }
    let delete_etag = if let Some(metadata) = metadata.as_ref() {
        let Some(recorded_etag) = run.remote_etag.as_deref() else {
            return Ok(ScheduledRemotePruneOutcome::Conflict);
        };
        if metadata.etag.as_deref() != Some(recorded_etag) {
            return Ok(ScheduledRemotePruneOutcome::Conflict);
        }
        Some(recorded_etag)
    } else {
        None
    };

    let entry_id = entry.id.clone();
    update_index(
        &target.client,
        &target.config.remote_dir,
        |index| index.backups.retain(|item| item.id != entry_id),
        |index| index.backups.iter().all(|item| item.id != entry_id),
    )
    .await?;

    let Some(delete_etag) = delete_etag else {
        return Ok(ScheduledRemotePruneOutcome::Missing);
    };
    match target
        .client
        .delete_file(&run.target_path, Some(delete_etag))
        .await
    {
        Ok(_) => Ok(ScheduledRemotePruneOutcome::Pruned),
        Err(error) => {
            let entry_for_restore = entry.clone();
            let _ = update_index(
                &target.client,
                &target.config.remote_dir,
                |index| {
                    if index
                        .backups
                        .iter()
                        .all(|item| item.id != entry_for_restore.id)
                    {
                        index.backups.push(entry_for_restore.clone());
                    }
                },
                |index| index.backups.iter().any(|item| item == &entry_for_restore),
            )
            .await;
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::backup_schedule::ScheduledBackupRun;
    use std::fs;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;
    use tokio::sync::oneshot;

    async fn spawn_canned_server(
        responses: Vec<String>,
    ) -> (String, oneshot::Receiver<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (sender, receiver) = oneshot::channel();
        tokio::spawn(async move {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().await.unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0_u8; 4096];
                let header_end = loop {
                    let read = stream.read(&mut buffer).await.unwrap();
                    if read == 0 {
                        panic!("mock WebDAV request ended before its headers");
                    }
                    bytes.extend_from_slice(&buffer[..read]);
                    if let Some(position) = bytes.windows(4).position(|value| value == b"\r\n\r\n")
                    {
                        break position + 4;
                    }
                };
                let headers = String::from_utf8_lossy(&bytes[..header_end]);
                let content_length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().ok())
                            .flatten()
                    })
                    .unwrap_or_default();
                while bytes.len() < header_end + content_length {
                    let read = stream.read(&mut buffer).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..read]);
                }
                requests.push(String::from_utf8_lossy(&bytes).into_owned());
                stream.write_all(response.as_bytes()).await.unwrap();
                stream.shutdown().await.unwrap();
            }
            let _ = sender.send(requests);
        });
        (format!("http://{address}/dav"), receiver)
    }

    fn json_response(value: &RemoteBackupIndex, etag: &str) -> String {
        let body = serde_json::to_string(value).unwrap();
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nETag: {etag}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn json_response_without_etag(value: &RemoteBackupIndex) -> String {
        let body = serde_json::to_string(value).unwrap();
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    fn scheduled_target(url: String) -> ScheduledWebDavTarget {
        let config = WebDavConfig {
            url,
            username: "alice".to_string(),
            remote_dir: "/Patina".to_string(),
        };
        let client = WebDavClient::new(&config, "secret".to_string()).unwrap();
        ScheduledWebDavTarget { config, client }
    }

    #[test]
    fn remote_file_name_uses_zip_format() {
        assert_eq!(
            remote_backup_file_name("20260603-213000"),
            "Patina-backup-20260603-213000.zip"
        );
    }

    #[test]
    fn temp_cleanup_removes_file_and_empty_directory() {
        let root = std::env::temp_dir().join(format!(
            "patina-remote-backup-cleanup-empty-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let backup_path = root.join("Patina-backup-test.zip");
        fs::write(&backup_path, b"backup").unwrap();

        remove_temp_backup_file(&backup_path, &root).unwrap();

        assert!(!backup_path.exists());
        assert!(!root.exists());
    }

    #[test]
    fn temp_cleanup_keeps_directory_with_another_transfer() {
        let root = std::env::temp_dir().join(format!(
            "patina-remote-backup-cleanup-nonempty-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let backup_path = root.join("Patina-backup-test.zip");
        let sibling_path = root.join("Patina-backup-other.zip");
        fs::write(&backup_path, b"backup").unwrap();
        fs::write(&sibling_path, b"other").unwrap();

        remove_temp_backup_file(&backup_path, &root).unwrap();

        assert!(!backup_path.exists());
        assert!(root.exists());
        assert!(sibling_path.exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn remote_path_joins_normalized_dir_and_file() {
        assert_eq!(
            remote_path("/Patina/backups", "backup.zip"),
            "/Patina/backups/backup.zip"
        );
    }

    #[test]
    fn parse_index_rejects_time_tracker_product() {
        let raw = r#"{"version":1,"product":"Time Tracker","updatedAtMs":1,"backups":[]}"#;
        assert!(parse_index(raw).is_err());
    }

    #[test]
    fn parse_index_rejects_other_products() {
        let raw = r#"{"version":1,"product":"Other","updatedAtMs":1,"backups":[]}"#;
        assert!(parse_index(raw).is_err());
    }

    #[test]
    fn parse_old_index_defaults_external_counts_to_zero() {
        let raw = r#"{
            "version": 1,
            "product": "Patina",
            "updatedAtMs": 1,
            "backups": [{
                "id": "old",
                "fileName": "Patina-backup-old.zip",
                "remotePath": "/Patina/Patina-backup-old.zip",
                "createdAtMs": 1,
                "sizeBytes": 2,
                "appVersion": "1.8.3",
                "backupVersion": 1,
                "schemaVersion": 6,
                "sessionCount": 3,
                "titleSampleCount": 4,
                "settingCount": 5,
                "iconCacheCount": 6
            }]
        }"#;

        let index = parse_index(raw).unwrap();
        let entry = &index.backups[0];
        assert_eq!(entry.import_batch_count, 0);
        assert_eq!(entry.import_exact_session_count, 0);
        assert_eq!(entry.import_time_bucket_count, 0);
        assert_eq!(entry.origin, "manual");
        assert_eq!(entry.target_generation, None);
        assert_eq!(entry.run_key, None);
        assert_eq!(entry.archive_sha256, None);
    }

    #[test]
    fn backup_file_name_rejects_path_traversal() {
        assert!(validate_backup_file_name("../outside.zip").is_err());
        assert!(validate_backup_file_name("C:\\outside.zip").is_err());
        assert!(validate_backup_file_name("safe.zip").is_ok());
    }

    fn scheduled_run() -> ScheduledBackupRun {
        ScheduledBackupRun {
            run_key: "scheduled-backup:g:2026-08-09:0200".to_string(),
            target_generation: "g".to_string(),
            target_kind: "webdav".to_string(),
            logical_date: "2026-08-09".to_string(),
            logical_time_minutes: 120,
            target_path: "/Patina/owned.zip".to_string(),
            staging_path: None,
            phase: "succeeded".to_string(),
            remote_etag: Some("\"object-v1\"".to_string()),
            status: "succeeded".to_string(),
            file_state: "present".to_string(),
            attempt_count: 1,
            retry_at_ms: None,
            started_at_ms: 1,
            completed_at_ms: Some(2),
            archive_sha256: Some("a".repeat(64)),
            size_bytes: Some(42),
            error_code: None,
            error_message: None,
            cleanup_warning: None,
            updated_at_ms: 2,
        }
    }

    fn scheduled_entry(run: &ScheduledBackupRun) -> RemoteBackupEntry {
        RemoteBackupEntry {
            id: "scheduled-owned".to_string(),
            file_name: "owned.zip".to_string(),
            remote_path: run.target_path.clone(),
            created_at_ms: 2,
            size_bytes: run.size_bytes.unwrap(),
            app_version: "1.9.2".to_string(),
            format_kind: "sqlite_snapshot".to_string(),
            backup_version: 2,
            schema_version: 11,
            session_count: 1,
            title_sample_count: 0,
            import_batch_count: 0,
            import_exact_session_count: 0,
            import_time_bucket_count: 0,
            setting_count: 1,
            icon_cache_count: 0,
            origin: "scheduled".to_string(),
            target_generation: Some(run.target_generation.clone()),
            run_key: Some(run.run_key.clone()),
            archive_sha256: run.archive_sha256.clone(),
        }
    }

    #[tokio::test]
    async fn scheduled_upload_does_not_claim_a_preexisting_object_as_new() {
        let (url, captured) = spawn_canned_server(vec![
            "HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
            "HTTP/1.1 200 OK\r\nContent-Length: 42\r\nETag: \"preexisting\"\r\nConnection: close\r\n\r\n"
                .to_string(),
        ])
        .await;
        let path = std::env::temp_dir().join(format!(
            "patina-scheduled-upload-{}.zip",
            uuid::Uuid::new_v4().simple()
        ));
        fs::write(&path, vec![0_u8; 42]).unwrap();
        let outcome =
            upload_scheduled_snapshot(&scheduled_target(url), &path, "/Patina/owned.zip", 42)
                .await
                .unwrap();
        let _ = fs::remove_file(path);

        assert!(!outcome.created_new);
        assert_eq!(outcome.etag.as_deref(), Some("\"preexisting\""));
        let requests = captured.await.unwrap();
        assert_eq!(requests.len(), 2);
        assert!(requests[0].starts_with("MKCOL "));
        assert!(requests[1].starts_with("HEAD "));
    }

    #[test]
    fn scheduled_cleanup_requires_every_piece_of_ownership_evidence() {
        let run = scheduled_run();
        let entry = scheduled_entry(&run);
        assert!(scheduled_entry_matches_run(&entry, &run));

        let mut manual = entry.clone();
        manual.origin = "manual".to_string();
        assert!(!scheduled_entry_matches_run(&manual, &run));

        let mut other_generation = entry.clone();
        other_generation.target_generation = Some("other".to_string());
        assert!(!scheduled_entry_matches_run(&other_generation, &run));

        let mut other_run = entry.clone();
        other_run.run_key = Some("scheduled-backup:other".to_string());
        assert!(!scheduled_entry_matches_run(&other_run, &run));

        let mut wrong_path = entry.clone();
        wrong_path.remote_path = "/Patina/lookalike.zip".to_string();
        assert!(!scheduled_entry_matches_run(&wrong_path, &run));

        let mut wrong_hash = entry.clone();
        wrong_hash.archive_sha256 = Some("b".repeat(64));
        assert!(!scheduled_entry_matches_run(&wrong_hash, &run));

        let mut wrong_size = entry;
        wrong_size.size_bytes += 1;
        assert!(!scheduled_entry_matches_run(&wrong_size, &run));

        let mut unfinished = run;
        unfinished.status = "failed".to_string();
        assert!(!scheduled_entry_matches_run(
            &scheduled_entry(&unfinished),
            &unfinished,
        ));
    }

    #[tokio::test]
    async fn scheduled_cleanup_removes_only_the_verified_index_entry_and_object() {
        let run = scheduled_run();
        let owned = scheduled_entry(&run);
        let mut manual = owned.clone();
        manual.id = "manual-backup".to_string();
        manual.file_name = "manual.zip".to_string();
        manual.remote_path = "/Patina/manual.zip".to_string();
        manual.origin = "manual".to_string();
        manual.target_generation = None;
        manual.run_key = None;
        manual.archive_sha256 = None;
        let initial = RemoteBackupIndex {
            version: INDEX_VERSION,
            product: INDEX_PRODUCT.to_string(),
            updated_at_ms: 1,
            backups: vec![owned, manual.clone()],
        };
        let confirmed = RemoteBackupIndex {
            version: INDEX_VERSION,
            product: INDEX_PRODUCT.to_string(),
            updated_at_ms: 2,
            backups: vec![manual],
        };
        let (url, captured) = spawn_canned_server(vec![
            json_response(&initial, "\"index-v1\""),
            "HTTP/1.1 200 OK\r\nContent-Length: 42\r\nETag: \"object-v1\"\r\nConnection: close\r\n\r\n"
                .to_string(),
            json_response(&initial, "\"index-v1\""),
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
            json_response(&confirmed, "\"index-v2\""),
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
        ])
        .await;

        let outcome = prune_scheduled_snapshot(&scheduled_target(url), &run)
            .await
            .unwrap();
        assert_eq!(outcome, ScheduledRemotePruneOutcome::Pruned);
        let requests = captured.await.unwrap();
        assert_eq!(requests.len(), 6);
        assert!(requests[3]
            .to_ascii_lowercase()
            .contains("\r\nif-match: \"index-v1\"\r\n"));
        let published_index = requests[3].split("\r\n\r\n").nth(1).unwrap();
        assert!(!published_index.contains("scheduled-owned"));
        assert!(published_index.contains("manual-backup"));
        let delete = requests[5].to_ascii_lowercase();
        assert!(delete.starts_with("delete /dav/patina/owned.zip "));
        assert!(delete.contains("\r\nif-match: \"object-v1\"\r\n"));
    }

    #[tokio::test]
    async fn manual_index_entries_are_never_accepted_as_cleanup_ownership() {
        let run = scheduled_run();
        let mut manual = scheduled_entry(&run);
        manual.origin = "manual".to_string();
        let index = RemoteBackupIndex {
            version: INDEX_VERSION,
            product: INDEX_PRODUCT.to_string(),
            updated_at_ms: 1,
            backups: vec![manual],
        };
        let (url, captured) =
            spawn_canned_server(vec![json_response(&index, "\"index-v1\"")]).await;
        let outcome = prune_scheduled_snapshot(&scheduled_target(url), &run)
            .await
            .unwrap();
        assert_eq!(outcome, ScheduledRemotePruneOutcome::Conflict);
        let requests = captured.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("GET "));
    }

    #[tokio::test]
    async fn index_merge_reloads_and_retries_after_an_etag_conflict() {
        let run = scheduled_run();
        let entry = scheduled_entry(&run);
        let initial = RemoteBackupIndex {
            version: INDEX_VERSION,
            product: INDEX_PRODUCT.to_string(),
            updated_at_ms: 1,
            backups: Vec::new(),
        };
        let confirmed = RemoteBackupIndex {
            version: INDEX_VERSION,
            product: INDEX_PRODUCT.to_string(),
            updated_at_ms: 2,
            backups: vec![entry.clone()],
        };
        let (url, captured) = spawn_canned_server(vec![
            json_response(&initial, "\"index-v1\""),
            "HTTP/1.1 412 Precondition Failed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                .to_string(),
            json_response(&initial, "\"index-v2\""),
            "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string(),
            json_response(&confirmed, "\"index-v3\""),
        ])
        .await;
        let target = scheduled_target(url);
        let entry_for_mutation = entry.clone();
        let entry_for_verification = entry.clone();
        let result = update_index(
            &target.client,
            &target.config.remote_dir,
            |index| index.backups.push(entry_for_mutation.clone()),
            |index| {
                index
                    .backups
                    .iter()
                    .any(|item| item == &entry_for_verification)
            },
        )
        .await
        .unwrap();
        assert_eq!(result.backups, vec![entry]);

        let requests = captured.await.unwrap();
        assert_eq!(requests.len(), 5);
        assert!(requests[1]
            .to_ascii_lowercase()
            .contains("\r\nif-match: \"index-v1\"\r\n"));
        assert!(requests[3]
            .to_ascii_lowercase()
            .contains("\r\nif-match: \"index-v2\"\r\n"));
    }

    #[tokio::test]
    async fn index_verification_rejects_lost_unknown_entries_without_an_etag() {
        let run = scheduled_run();
        let scheduled = scheduled_entry(&run);
        let mut manual = scheduled.clone();
        manual.id = "manual-preserved".to_string();
        manual.file_name = "manual.zip".to_string();
        manual.remote_path = "/Patina/manual.zip".to_string();
        manual.origin = "manual".to_string();
        manual.target_generation = None;
        manual.run_key = None;
        manual.archive_sha256 = None;
        let initial = RemoteBackupIndex {
            version: INDEX_VERSION,
            product: INDEX_PRODUCT.to_string(),
            updated_at_ms: 1,
            backups: vec![manual],
        };
        let lossy_confirmation = RemoteBackupIndex {
            version: INDEX_VERSION,
            product: INDEX_PRODUCT.to_string(),
            updated_at_ms: 2,
            backups: vec![scheduled.clone()],
        };
        let mut responses = Vec::new();
        for _ in 0..MAX_INDEX_WRITE_ATTEMPTS {
            responses.push(json_response_without_etag(&initial));
            responses.push(
                "HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    .to_string(),
            );
            responses.push(json_response_without_etag(&lossy_confirmation));
        }
        let (url, captured) = spawn_canned_server(responses).await;
        let target = scheduled_target(url);
        let scheduled_for_mutation = scheduled.clone();
        let scheduled_for_verification = scheduled.clone();
        let error = update_index(
            &target.client,
            &target.config.remote_dir,
            |index| index.backups.push(scheduled_for_mutation.clone()),
            |index| {
                index
                    .backups
                    .iter()
                    .any(|item| item == &scheduled_for_verification)
            },
        )
        .await
        .unwrap_err();
        assert_eq!(error, "remote_index_conflict");
        assert_eq!(captured.await.unwrap().len(), MAX_INDEX_WRITE_ATTEMPTS * 3);
    }

    #[tokio::test]
    async fn failed_object_cleanup_refuses_an_object_whose_etag_changed() {
        let run = scheduled_run();
        let (url, captured) = spawn_canned_server(vec![
            "HTTP/1.1 200 OK\r\nContent-Length: 42\r\nETag: \"replacement\"\r\nConnection: close\r\n\r\n"
                .to_string(),
        ])
        .await;
        let error = discard_failed_scheduled_snapshot(&scheduled_target(url), &run)
            .await
            .unwrap_err();
        assert!(error.contains("remote identity changed"));
        let requests = captured.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("HEAD "));
    }

    #[tokio::test]
    async fn failed_object_cleanup_requires_a_conditional_delete_identity() {
        let mut run = scheduled_run();
        run.remote_etag = None;
        let (url, captured) = spawn_canned_server(vec![
            "HTTP/1.1 200 OK\r\nContent-Length: 42\r\nConnection: close\r\n\r\n".to_string(),
        ])
        .await;
        let error = discard_failed_scheduled_snapshot(&scheduled_target(url), &run)
            .await
            .unwrap_err();
        assert!(error.contains("without a recorded remote identity"));
        let requests = captured.await.unwrap();
        assert_eq!(requests.len(), 1);
        assert!(requests[0].starts_with("HEAD "));
    }
}
