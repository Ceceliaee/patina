use crate::platform::app_paths;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

pub const DATA_ANCHOR_FORMAT: &str = "patina.data-anchor.v1";
pub const CACHE_ANCHOR_FORMAT: &str = "patina.cache-anchor.v1";
pub const STORAGE_MIGRATION_PENDING_FORMAT: &str = "patina.storage-restart-operation.v2";
pub const STORAGE_MAINTENANCE_STATE_FORMAT: &str = "patina.storage-maintenance-state.v1";

const DATA_ANCHOR_FILE_NAME: &str = "data-anchor.json";
const CACHE_ANCHOR_FILE_NAME: &str = "cache-anchor.json";
const STORAGE_MIGRATION_PENDING_FILE_NAME: &str = "storage-migration-pending.json";
const STORAGE_MAINTENANCE_STATE_FILE_NAME: &str = "storage-maintenance-state.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataAnchor {
    pub format: String,
    pub profile: String,
    pub data_root: PathBuf,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheAnchor {
    pub format: String,
    pub profile: String,
    pub webview_root: PathBuf,
    pub updated_at_ms: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingStorageMigration {
    pub format: String,
    pub id: String,
    pub source_data_root: PathBuf,
    pub target_data_root: PathBuf,
    pub target_webview_root: PathBuf,
    pub created_at_ms: u64,
    pub state: String,
    pub clear_webview_cache: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMaintenanceState {
    pub format: String,
    pub last_webview_cache_trim_at_ms: Option<u64>,
    pub last_maintenance_error: Option<String>,
}

impl StorageMaintenanceState {
    pub fn new() -> Self {
        Self {
            format: STORAGE_MAINTENANCE_STATE_FORMAT.to_string(),
            ..Self::default()
        }
    }
}

pub fn data_anchor_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app_paths::product_roaming_data_dir(app)
}

pub fn cache_anchor_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app_paths::product_webview_data_dir(app)
}

pub fn anchor_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    data_anchor_dir(app)
}

pub fn data_anchor_path(anchor_dir: &Path) -> PathBuf {
    anchor_dir.join(DATA_ANCHOR_FILE_NAME)
}

pub fn cache_anchor_path(anchor_dir: &Path) -> PathBuf {
    anchor_dir.join(CACHE_ANCHOR_FILE_NAME)
}

pub fn pending_migration_path(anchor_dir: &Path) -> PathBuf {
    anchor_dir.join(STORAGE_MIGRATION_PENDING_FILE_NAME)
}

pub fn maintenance_state_path(anchor_dir: &Path) -> PathBuf {
    anchor_dir.join(STORAGE_MAINTENANCE_STATE_FILE_NAME)
}

pub fn read_data_anchor<R: Runtime>(app: &AppHandle<R>) -> Result<Option<DataAnchor>, String> {
    read_data_anchor_from_dir(&data_anchor_dir(app)?, app_paths::app_profile(app).key())
}

pub fn read_data_anchor_from_dir(
    anchor_dir: &Path,
    expected_profile: &str,
) -> Result<Option<DataAnchor>, String> {
    let Some(anchor) = read_json_optional::<DataAnchor>(&data_anchor_path(anchor_dir))? else {
        return Ok(None);
    };

    if anchor.format != DATA_ANCHOR_FORMAT {
        return Err(format!(
            "unsupported data anchor format `{}`",
            anchor.format
        ));
    }

    if anchor.profile != expected_profile {
        return Ok(None);
    }

    Ok(Some(anchor))
}

pub fn read_cache_anchor<R: Runtime>(app: &AppHandle<R>) -> Result<Option<CacheAnchor>, String> {
    read_cache_anchor_from_dir(&cache_anchor_dir(app)?, app_paths::app_profile(app).key())
}

pub fn read_cache_anchor_from_dir(
    anchor_dir: &Path,
    expected_profile: &str,
) -> Result<Option<CacheAnchor>, String> {
    let Some(anchor) = read_json_optional::<CacheAnchor>(&cache_anchor_path(anchor_dir))? else {
        return Ok(None);
    };

    if anchor.format != CACHE_ANCHOR_FORMAT {
        return Err(format!(
            "unsupported cache anchor format `{}`",
            anchor.format
        ));
    }

    if anchor.profile != expected_profile {
        return Ok(None);
    }

    Ok(Some(anchor))
}

pub fn write_data_anchor<R: Runtime>(app: &AppHandle<R>, data_root: PathBuf) -> Result<(), String> {
    let anchor = DataAnchor {
        format: DATA_ANCHOR_FORMAT.to_string(),
        profile: app_paths::app_profile(app).key().to_string(),
        data_root,
        updated_at_ms: now_ms(),
    };
    write_json_atomic(&data_anchor_path(&data_anchor_dir(app)?), &anchor)
}

pub fn write_cache_anchor<R: Runtime>(
    app: &AppHandle<R>,
    webview_root: PathBuf,
) -> Result<(), String> {
    let anchor = CacheAnchor {
        format: CACHE_ANCHOR_FORMAT.to_string(),
        profile: app_paths::app_profile(app).key().to_string(),
        webview_root,
        updated_at_ms: now_ms(),
    };
    write_json_atomic(&cache_anchor_path(&cache_anchor_dir(app)?), &anchor)
}

pub fn read_pending_migration<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<PendingStorageMigration>, String> {
    read_pending_migration_from_dir(&anchor_dir(app)?)
}

pub fn read_pending_migration_from_dir(
    anchor_dir: &Path,
) -> Result<Option<PendingStorageMigration>, String> {
    let Some(pending) =
        read_json_optional::<PendingStorageMigration>(&pending_migration_path(anchor_dir))?
    else {
        return Ok(None);
    };

    if pending.format != STORAGE_MIGRATION_PENDING_FORMAT {
        return Err(format!(
            "unsupported storage migration format `{}`",
            pending.format
        ));
    }

    Ok(Some(pending))
}

pub fn discard_unreadable_pending_migration<R: Runtime>(
    app: &AppHandle<R>,
    reason: &str,
) -> Result<(), String> {
    remove_pending_migration(app)?;
    record_maintenance_error(
        app,
        format!("Discarded unsupported storage restart operation without applying it: {reason}"),
    )
}

pub fn write_pending_migration<R: Runtime>(
    app: &AppHandle<R>,
    pending: &PendingStorageMigration,
) -> Result<(), String> {
    if pending.format != STORAGE_MIGRATION_PENDING_FORMAT {
        return Err("cannot write unsupported storage migration format".to_string());
    }
    write_json_atomic(&pending_migration_path(&anchor_dir(app)?), pending)
}

pub fn remove_pending_migration<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    remove_file_if_exists(&pending_migration_path(&anchor_dir(app)?))
}

pub fn remove_data_anchor<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    remove_file_if_exists(&data_anchor_path(&data_anchor_dir(app)?))
}

pub fn remove_cache_anchor<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    remove_file_if_exists(&cache_anchor_path(&cache_anchor_dir(app)?))
}

pub struct StorageAnchorSelection {
    pub root: PathBuf,
    pub is_custom: bool,
}

pub fn anchor_selection(root: PathBuf, is_custom: bool) -> StorageAnchorSelection {
    StorageAnchorSelection { root, is_custom }
}

pub fn switch_storage_anchors<R: Runtime>(
    app: &AppHandle<R>,
    source_data: StorageAnchorSelection,
    target_data: StorageAnchorSelection,
    source_webview: StorageAnchorSelection,
    target_webview: StorageAnchorSelection,
) -> Result<(), String> {
    commit_anchor_pair(
        || set_data_anchor(app, target_data.root, !target_data.is_custom),
        || set_cache_anchor(app, target_webview.root, !target_webview.is_custom),
        || set_data_anchor(app, source_data.root, !source_data.is_custom),
        || set_cache_anchor(app, source_webview.root, !source_webview.is_custom),
    )
}

fn commit_anchor_pair<SetData, SetCache, RollbackData, RollbackCache>(
    set_data: SetData,
    set_cache: SetCache,
    rollback_data: RollbackData,
    rollback_cache: RollbackCache,
) -> Result<(), String>
where
    SetData: FnOnce() -> Result<(), String>,
    SetCache: FnOnce() -> Result<(), String>,
    RollbackData: FnOnce() -> Result<(), String>,
    RollbackCache: FnOnce() -> Result<(), String>,
{
    set_data()?;
    if let Err(cache_error) = set_cache() {
        let cache_rollback = rollback_cache();
        let data_rollback = rollback_data();
        if cache_rollback.is_err() || data_rollback.is_err() {
            return Err(format!(
                "failed to switch cache anchor: {cache_error}; rollback failed: cache={:?}, data={:?}",
                cache_rollback.err(),
                data_rollback.err()
            ));
        }
        return Err(format!("failed to switch cache anchor: {cache_error}"));
    }
    Ok(())
}

fn set_data_anchor<R: Runtime>(
    app: &AppHandle<R>,
    root: PathBuf,
    use_default: bool,
) -> Result<(), String> {
    if use_default {
        remove_data_anchor(app)
    } else {
        write_data_anchor(app, root)
    }
}

fn set_cache_anchor<R: Runtime>(
    app: &AppHandle<R>,
    root: PathBuf,
    use_default: bool,
) -> Result<(), String> {
    if use_default {
        remove_cache_anchor(app)
    } else {
        write_cache_anchor(app, root)
    }
}

pub fn read_maintenance_state<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<StorageMaintenanceState, String> {
    read_maintenance_state_from_dir(&anchor_dir(app)?)
}

pub fn read_maintenance_state_from_dir(
    anchor_dir: &Path,
) -> Result<StorageMaintenanceState, String> {
    let Some(state) =
        read_json_optional::<StorageMaintenanceState>(&maintenance_state_path(anchor_dir))?
    else {
        return Ok(StorageMaintenanceState::new());
    };

    if state.format != STORAGE_MAINTENANCE_STATE_FORMAT {
        return Err(format!(
            "unsupported storage maintenance format `{}`",
            state.format
        ));
    }

    Ok(state)
}

pub fn write_maintenance_state<R: Runtime>(
    app: &AppHandle<R>,
    state: &StorageMaintenanceState,
) -> Result<(), String> {
    write_maintenance_state_to_dir(&anchor_dir(app)?, state)
}

pub fn write_maintenance_state_to_dir(
    anchor_dir: &Path,
    state: &StorageMaintenanceState,
) -> Result<(), String> {
    if state.format != STORAGE_MAINTENANCE_STATE_FORMAT {
        return Err("cannot write unsupported storage maintenance format".to_string());
    }
    let path = maintenance_state_path(anchor_dir);
    if !maintenance_state_requires_file(state) {
        return remove_file_if_exists(&path);
    }
    write_json_atomic(&path, state)
}

pub fn record_maintenance_error<R: Runtime>(
    app: &AppHandle<R>,
    message: String,
) -> Result<(), String> {
    let mut state = read_maintenance_state(app).unwrap_or_else(|_| StorageMaintenanceState::new());
    state.last_maintenance_error = Some(message);
    write_maintenance_state(app, &state)
}

pub fn mark_webview_cache_trimmed<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let mut state = read_maintenance_state(app).unwrap_or_else(|_| StorageMaintenanceState::new());
    state.last_webview_cache_trim_at_ms = Some(now_ms());
    state.last_maintenance_error = None;
    write_maintenance_state(app, &state)
}

pub fn now_ms() -> u64 {
    crate::platform::clock::unix_timestamp_millis_u64()
}

fn maintenance_state_requires_file(state: &StorageMaintenanceState) -> bool {
    state.last_maintenance_error.is_some()
}

fn read_json_optional<T: DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let backup_path = path.with_extension("previous");
    let read_path = if path.exists() {
        path
    } else if backup_path.exists() {
        match fs::rename(&backup_path, path) {
            Ok(()) => path,
            Err(_) => backup_path.as_path(),
        }
    } else {
        return Ok(None);
    };
    let raw = fs::read_to_string(read_path)
        .map_err(|error| format!("failed to read `{}`: {error}", read_path.display()))?;
    serde_json::from_str::<T>(&raw)
        .map(Some)
        .map_err(|error| format!("failed to parse `{}`: {error}", read_path.display()))
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create `{}`: {error}", parent.display()))?;
    }

    let raw = serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize `{}`: {error}", path.display()))?;
    let temp_path = path.with_extension("tmp");
    let backup_path = path.with_extension("previous");
    fs::write(&temp_path, raw)
        .map_err(|error| format!("failed to write `{}`: {error}", temp_path.display()))?;

    if path.exists() {
        remove_file_if_exists(&backup_path)?;
        fs::rename(path, &backup_path).map_err(|error| {
            let _ = fs::remove_file(&temp_path);
            format!(
                "failed to preserve `{}` before replacement: {error}",
                path.display()
            )
        })?;
    }

    if let Err(error) = fs::rename(&temp_path, path) {
        let _ = fs::remove_file(&temp_path);
        let restore_error = if backup_path.exists() {
            fs::rename(&backup_path, path).err()
        } else {
            None
        };
        return Err(format!(
            "failed to replace `{}` with `{}`: {error}; restore error: {:?}",
            path.display(),
            temp_path.display(),
            restore_error
        ));
    }

    remove_file_if_exists(&backup_path)
}

fn remove_file_if_exists(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("failed to remove `{}`: {error}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    fn temp_dir(label: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "patina-storage-anchor-{label}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn data_anchor_rejects_unsupported_format() {
        let dir = temp_dir("unsupported-format");
        fs::write(
            data_anchor_path(&dir),
            r#"{"format":"old","profile":"production","dataRoot":"D:\\Patina","updatedAtMs":1}"#,
        )
        .unwrap();

        let error = read_data_anchor_from_dir(&dir, "production").unwrap_err();
        let _ = fs::remove_dir_all(&dir);

        assert!(error.contains("unsupported data anchor format"));
    }

    #[test]
    fn cache_anchor_ignores_other_profiles() {
        let dir = temp_dir("profile");
        fs::write(
            cache_anchor_path(&dir),
            r#"{"format":"patina.cache-anchor.v1","profile":"dev","webviewRoot":"D:\\Patina\\EBWebView","updatedAtMs":1}"#,
        )
        .unwrap();

        let anchor = read_cache_anchor_from_dir(&dir, "production").unwrap();
        let _ = fs::remove_dir_all(&dir);

        assert!(anchor.is_none());
    }

    #[test]
    fn data_and_cache_anchor_paths_are_separate() {
        let dir = temp_dir("separate-paths");

        assert_eq!(data_anchor_path(&dir), dir.join("data-anchor.json"));
        assert_eq!(cache_anchor_path(&dir), dir.join("cache-anchor.json"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cache_anchor_failure_rolls_back_cache_then_data() {
        let events = Mutex::new(Vec::new());
        let result = commit_anchor_pair(
            || {
                events.lock().unwrap().push("set-data");
                Ok(())
            },
            || {
                events.lock().unwrap().push("set-cache");
                Err("cache failed".to_string())
            },
            || {
                events.lock().unwrap().push("rollback-data");
                Ok(())
            },
            || {
                events.lock().unwrap().push("rollback-cache");
                Ok(())
            },
        );

        assert!(result.unwrap_err().contains("cache failed"));
        assert_eq!(
            *events.lock().unwrap(),
            ["set-data", "set-cache", "rollback-cache", "rollback-data"]
        );
    }

    #[test]
    fn atomic_json_replacement_removes_previous_backup() {
        let dir = temp_dir("atomic-replacement");
        let path = dir.join("state.json");
        write_json_atomic(&path, &serde_json::json!({ "value": 1 })).unwrap();
        write_json_atomic(&path, &serde_json::json!({ "value": 2 })).unwrap();

        let value: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(value["value"], 2);
        assert!(!path.with_extension("previous").exists());
        assert!(!path.with_extension("tmp").exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn json_reader_recovers_interrupted_replacement_from_previous_file() {
        let dir = temp_dir("atomic-recovery");
        let path = dir.join("state.json");
        let backup_path = path.with_extension("previous");
        fs::write(&backup_path, r#"{"value":1}"#).unwrap();

        let value = read_json_optional::<serde_json::Value>(&path)
            .unwrap()
            .unwrap();
        assert_eq!(value["value"], 1);
        assert!(path.exists());
        assert!(!backup_path.exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn pending_restart_operation_rejects_legacy_format() {
        let dir = temp_dir("legacy-pending");
        fs::write(
            pending_migration_path(&dir),
            r#"{"format":"patina.storage-migration-pending.v1","id":"old","sourceDataRoot":"C:\\Old","targetDataRoot":"D:\\New","targetWebviewRoot":"C:\\Cache","createdAtMs":1,"state":"pending-restart"}"#,
        )
        .unwrap();

        assert!(read_pending_migration_from_dir(&dir).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn completed_maintenance_state_does_not_create_file() {
        let dir = temp_dir("maintenance-completed");
        let mut state = StorageMaintenanceState::new();
        state.last_webview_cache_trim_at_ms = Some(1);

        write_maintenance_state_to_dir(&dir, &state).unwrap();

        assert!(!maintenance_state_path(&dir).exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
