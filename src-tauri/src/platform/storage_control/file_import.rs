use super::{
    PendingStorageMigration, StorageControl, StorageMaintenanceState,
    STORAGE_MAINTENANCE_STATE_FORMAT,
};
use serde::Deserialize;
use std::fs;
use std::io::{ErrorKind, Read};
use std::path::{Path, PathBuf};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DataAnchor {
    format: String,
    profile: String,
    data_root: PathBuf,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheAnchor {
    format: String,
    profile: String,
    webview_root: PathBuf,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MaintenanceImport {
    format: String,
    last_webview_cache_trim_at_ms: Option<u64>,
    last_maintenance_error: Option<String>,
    #[serde(default)]
    pending_webview_cache_clear: bool,
    pending_webview_cache_clear_source: Option<String>,
}

fn paths(data: &Path, cache: &Path) -> Vec<PathBuf> {
    vec![
        data.join("data-anchor.json"),
        cache.join("cache-anchor.json"),
        data.join("storage-migration-pending.json"),
        data.join("storage-maintenance-state.json"),
    ]
}

// Only the released JSON formats are read here. No runtime caller reads these files.
// Remove this importer only when the supported direct-upgrade boundary no longer needs it.
pub(super) fn read(profile: &str, data: &Path, cache: &Path) -> Result<StorageControl, String> {
    let paths = paths(data, cache);
    let mut state = StorageControl::empty(profile);
    let mut imported = vec![];
    if let Some(anchor) = read_optional::<DataAnchor>(&paths[0])? {
        if anchor.format != "patina.data-anchor.v1" {
            return Err("unsupported data anchor format".into());
        }
        if anchor.profile == profile {
            state.data_root = Some(anchor.data_root);
            imported.push(paths[0].clone());
        }
    }
    if let Some(anchor) = read_optional::<CacheAnchor>(&paths[1])? {
        if anchor.format != "patina.cache-anchor.v1" {
            return Err("unsupported cache anchor format".into());
        }
        if anchor.profile == profile {
            state.webview_root = Some(anchor.webview_root);
            imported.push(paths[1].clone());
        }
    }
    if let Some(mut pending) = read_optional::<serde_json::Value>(&paths[2])? {
        // v1.8.0–v1.8.2 stored cache clearing separately from the migration operation.
        if pending.get("format").and_then(|v| v.as_str())
            == Some("patina.storage-migration-pending.v1")
        {
            pending["format"] = super::STORAGE_MIGRATION_PENDING_FORMAT.into();
            pending["clearWebviewCache"] = false.into();
        }
        state.pending = Some(
            serde_json::from_value::<PendingStorageMigration>(pending)
                .map_err(|e| format!("invalid pending storage operation: {e}"))?,
        );
        imported.push(paths[2].clone());
    }
    if let Some(maintenance) = read_optional::<MaintenanceImport>(&paths[3])? {
        if maintenance.format != STORAGE_MAINTENANCE_STATE_FORMAT {
            return Err("unsupported maintenance state".into());
        }
        if maintenance.pending_webview_cache_clear
            && maintenance.pending_webview_cache_clear_source.as_deref() == Some("user")
        {
            let pending = state
                .pending
                .get_or_insert_with(|| PendingStorageMigration {
                    format: super::STORAGE_MIGRATION_PENDING_FORMAT.into(),
                    id: format!("import-cache-clear-{}", super::now_ms()),
                    source_data_root: state.data_root.clone().unwrap_or_else(|| data.into()),
                    target_data_root: state.data_root.clone().unwrap_or_else(|| data.into()),
                    target_webview_root: state.webview_root.clone().unwrap_or_else(|| cache.into()),
                    created_at_ms: super::now_ms(),
                    state: "pending-restart".into(),
                    clear_webview_cache: true,
                });
            pending.clear_webview_cache = true;
        }
        state.maintenance = StorageMaintenanceState {
            format: maintenance.format,
            last_webview_cache_trim_at_ms: maintenance.last_webview_cache_trim_at_ms,
            last_maintenance_error: maintenance.last_maintenance_error,
        };
        imported.push(paths[3].clone());
    }
    state.cleanup_files = imported
        .into_iter()
        .flat_map(|p| {
            [
                p.clone(),
                p.with_extension("previous"),
                p.with_extension("tmp"),
            ]
        })
        .collect();
    state.validate(profile)?;
    Ok(state)
}

fn read_optional<T: serde::de::DeserializeOwned>(path: &Path) -> Result<Option<T>, String> {
    let open = |p: &Path| -> Result<Option<fs::File>, String> {
        match fs::File::open(p) {
            Ok(f) => Ok(Some(f)),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!(
                "cannot read storage configuration `{}`: {e}",
                p.display()
            )),
        }
    };
    let file = match open(path)? {
        Some(f) => Some(f),
        None => open(&path.with_extension("previous"))?,
    };
    let Some(file) = file else {
        return Ok(None);
    };
    let mut bytes = vec![];
    file.take((super::storage_registry::MAX_STATE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("cannot read `{}`: {e}", path.display()))?;
    if bytes.len() > super::storage_registry::MAX_STATE_BYTES {
        return Err("old storage configuration is too large".into());
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|e| format!("invalid storage configuration `{}`: {e}", path.display()))
}

pub(super) fn cleanup(files: &[PathBuf], data: &Path, cache: &Path) -> Result<(), String> {
    let allowed: Vec<_> = paths(data, cache)
        .into_iter()
        .flat_map(|p| {
            [
                p.clone(),
                p.with_extension("previous"),
                p.with_extension("tmp"),
            ]
        })
        .collect();
    for path in files {
        if !allowed.contains(path) {
            return Err("old configuration cleanup path is outside the allowed files".into());
        }
        for part in path.ancestors() {
            match fs::symlink_metadata(part) {
                Ok(meta) => {
                    use std::os::windows::fs::MetadataExt;
                    if meta.file_attributes() & 0x400 != 0 {
                        return Err(format!(
                            "refusing storage configuration cleanup through reparse point `{}`",
                            part.display()
                        ));
                    }
                }
                Err(e) if e.kind() == ErrorKind::NotFound => {}
                Err(e) => {
                    return Err(format!(
                        "cannot inspect old configuration `{}`: {e}",
                        part.display()
                    ))
                }
            }
        }
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => {
                return Err(format!(
                    "cannot remove old configuration `{}`: {e}",
                    path.display()
                ))
            }
        }
    }
    Ok(())
}
