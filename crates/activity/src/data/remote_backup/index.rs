use crate::data::repositories::remote_backup_settings;
use crate::domain::backup::BackupPreview;
use crate::platform::webdav::{WebDavClient, WebDavConfig};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::{fs, path::Path};
use tokio::sync::Mutex;
pub(super) const INDEX_FILE_NAME: &str = "backup-index.json";
pub(super) const INDEX_VERSION: u32 = 1;
pub(super) const INDEX_PRODUCT: &str = "Patina";
pub(super) const MAX_BACKUP_LIST_ITEMS: usize = 50;
pub(super) const MAX_INDEX_BACKUP_ITEMS: usize = 5_000;
pub(super) const MAX_INDEX_WRITE_ATTEMPTS: usize = 3;
pub(super) const MAX_REMOTE_NAME_CANDIDATES: u8 = 99;
pub(super) static REMOTE_INDEX_LOCK: Mutex<()> = Mutex::const_new(());
pub(super) static REMOTE_TRANSFER_LOCK: Mutex<()> = Mutex::const_new(());

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

pub use patina_activity_model::views::dav::{manual_origin, RemoteBackupEntry};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(try_from = "RawRemoteBackupIndex", into = "RawRemoteBackupIndex")]
pub(super) struct RemoteBackupIndex {
    pub(super) version: u32,
    pub(super) product: String,
    pub(super) updated_at_ms: u64,
    pub(super) backups: Vec<RemoteBackupEntry>,
    pub(super) opaque_entries: Vec<serde_json::Value>,
    pub(super) extra: BTreeMap<String, serde_json::Value>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RawRemoteBackupIndex {
    version: u32,
    product: String,
    updated_at_ms: u64,
    backups: Vec<serde_json::Value>,
    #[serde(flatten)]
    pub(super) extra: BTreeMap<String, serde_json::Value>,
}

impl TryFrom<RawRemoteBackupIndex> for RemoteBackupIndex {
    type Error = String;

    fn try_from(raw: RawRemoteBackupIndex) -> Result<Self, String> {
        if raw.backups.len() > MAX_INDEX_BACKUP_ITEMS {
            return Err("WebDAV backup index contains too many entries".into());
        }
        let mut backups = Vec::new();
        let mut opaque_entries = Vec::new();
        for value in raw.backups {
            if value.get("formatKind").and_then(serde_json::Value::as_str)
                == Some("sqlite_snapshot")
            {
                backups.push(
                    serde_json::from_value(value)
                        .map_err(|error| format!("invalid SQLite backup index entry: {error}"))?,
                );
            } else {
                opaque_entries.push(value);
            }
        }
        Ok(Self {
            version: raw.version,
            product: raw.product,
            updated_at_ms: raw.updated_at_ms,
            backups,
            opaque_entries,
            extra: raw.extra,
        })
    }
}

impl From<RemoteBackupIndex> for RawRemoteBackupIndex {
    fn from(index: RemoteBackupIndex) -> Self {
        let mut backups = index
            .backups
            .into_iter()
            .map(|entry| {
                serde_json::to_value(entry).expect("backup entry contains JSON-compatible fields")
            })
            .collect::<Vec<_>>();
        backups.extend(index.opaque_entries);
        Self {
            version: index.version,
            product: index.product,
            updated_at_ms: index.updated_at_ms,
            backups,
            extra: index.extra,
        }
    }
}

impl RemoteBackupIndex {
    pub(super) fn has_other_reference(&self, entry: &RemoteBackupEntry) -> bool {
        self.backups.iter().any(|other| {
            other != entry
                && (other.id == entry.id
                    || other.file_name == entry.file_name
                    || other.remote_path == entry.remote_path)
        }) || self.opaque_entries.iter().any(|value| {
            [
                ("id", &entry.id),
                ("fileName", &entry.file_name),
                ("remotePath", &entry.remote_path),
            ]
            .iter()
            .any(|(key, expected)| {
                value.get(key).and_then(serde_json::Value::as_str) == Some(expected.as_str())
            })
        })
    }
}

pub use patina_activity_model::views::dav::RemoteBackupUploadResult;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackupDownloadResult {
    pub path: String,
    pub preview: BackupPreview,
}

pub(super) fn config_to_webdav(config: WebDavBackupConfigDto) -> Result<WebDavConfig, String> {
    remote_backup_settings::normalize_config(&config.url, &config.username, &config.remote_dir)
}

pub(super) fn now_ms() -> u64 {
    crate::platform::clock::unix_timestamp_millis_u64()
}

pub(super) fn remote_backup_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub(super) fn remote_backup_file_name(id: &str) -> String {
    format!("Patina-backup-{id}.zip")
}

pub(super) fn remote_path(remote_dir: &str, file_name: &str) -> String {
    format!("{remote_dir}/{file_name}")
}

pub(super) fn index_path(remote_dir: &str) -> String {
    remote_path(remote_dir, INDEX_FILE_NAME)
}

pub(super) fn parse_index(raw: &str) -> Result<RemoteBackupIndex, String> {
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

pub(super) fn empty_index() -> RemoteBackupIndex {
    RemoteBackupIndex {
        version: INDEX_VERSION,
        product: INDEX_PRODUCT.to_string(),
        updated_at_ms: now_ms(),
        backups: Vec::new(),
        opaque_entries: Vec::new(),
        extra: BTreeMap::new(),
    }
}

pub(super) struct LoadedRemoteBackupIndex {
    index: RemoteBackupIndex,
    etag: Option<String>,
    existed: bool,
}

pub(super) async fn load_index_snapshot(
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

pub(super) async fn load_index(
    client: &WebDavClient,
    remote_dir: &str,
) -> Result<RemoteBackupIndex, String> {
    Ok(load_index_snapshot(client, remote_dir).await?.index)
}

pub(super) async fn save_index_snapshot(
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

pub(super) async fn update_index<F, V>(
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
        let opaque_entries = loaded.index.opaque_entries.clone();
        let extra = loaded.index.extra.clone();
        mutate(&mut loaded.index);
        if loaded.index.backups.len() + loaded.index.opaque_entries.len() > MAX_INDEX_BACKUP_ITEMS {
            return Err("WebDAV backup index contains too many entries".into());
        }
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
                    && confirmed.opaque_entries == opaque_entries
                    && extra
                        .iter()
                        .all(|(key, value)| confirmed.extra.get(key) == Some(value))
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

pub(crate) fn validate_backup_file_name(file_name: &str) -> Result<(), String> {
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

pub(super) fn validate_upload_file_name(file_name: &str) -> Result<(), String> {
    let stem = file_name.strip_suffix(".zip").unwrap_or_default();
    let device = stem
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    let reserved = matches!(device.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            device.strip_prefix(prefix).is_some_and(|suffix| {
                matches!(
                    suffix,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        });
    if validate_backup_file_name(file_name).is_err()
        || stem.trim().is_empty()
        || file_name.len() > 240
        || file_name.trim() != file_name
        || file_name.chars().any(|c| "<>:\"|?*".contains(c))
        || reserved
    {
        return Err("webdav_invalid_file_name".into());
    }
    Ok(())
}

pub(super) fn build_entry(
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
        extra: BTreeMap::new(),
    }
}

pub(super) async fn publish_manual(
    client: &WebDavClient,
    dir: &str,
    entry: RemoteBackupEntry,
) -> Result<RemoteBackupUploadResult, String> {
    let _index_guard = REMOTE_INDEX_LOCK.lock().await;
    let entry_for_update = entry.clone();
    match update_index(
        client,
        dir,
        |index| {
            index.backups.retain(|item| item.id != entry_for_update.id);
            index.backups.insert(0, entry_for_update.clone());
            index
                .backups
                .sort_by_key(|entry| std::cmp::Reverse(entry.created_at_ms));
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

pub(super) fn remove_empty_temp_backup_dir(temp_dir: &Path) -> Result<(), String> {
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

pub(super) fn remove_temp_backup_file(path: &Path, temp_dir: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("failed to delete remote backup temp file: {error}")),
    }
    remove_empty_temp_backup_dir(temp_dir)
}
