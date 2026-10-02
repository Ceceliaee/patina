mod file_import;
#[cfg(test)]
mod tests;

use crate::platform::{app_paths, windows::storage_registry};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, Runtime};

pub const STORAGE_MIGRATION_PENDING_FORMAT: &str = "patina.storage-restart-operation.v2";
pub const STORAGE_MAINTENANCE_STATE_FORMAT: &str = "patina.storage-maintenance-state.v1";
const FORMAT: &str = "patina.storage-control.v1";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
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
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageMaintenanceState {
    pub format: String,
    pub last_webview_cache_trim_at_ms: Option<u64>,
    pub last_maintenance_error: Option<String>,
}

impl StorageMaintenanceState {
    pub fn new() -> Self {
        Self {
            format: STORAGE_MAINTENANCE_STATE_FORMAT.into(),
            ..Self::default()
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageControl {
    format: String,
    profile: String,
    pub data_root: Option<PathBuf>,
    pub webview_root: Option<PathBuf>,
    pending: Option<PendingStorageMigration>,
    maintenance: StorageMaintenanceState,
    cleanup_files: Vec<PathBuf>,
}

impl StorageControl {
    fn empty(profile: &str) -> Self {
        Self {
            format: FORMAT.into(),
            profile: profile.into(),
            data_root: None,
            webview_root: None,
            pending: None,
            maintenance: StorageMaintenanceState::new(),
            cleanup_files: vec![],
        }
    }

    fn validate(&self, profile: &str) -> Result<(), String> {
        if self.format != FORMAT || self.profile != profile {
            return Err("unsupported storage control format or profile".into());
        }
        for path in self.data_root.iter().chain(self.webview_root.iter()) {
            validate_path(path)?;
        }
        if let Some(p) = &self.pending {
            if p.format != STORAGE_MIGRATION_PENDING_FORMAT
                || !matches!(
                    p.state.as_str(),
                    "pending-restart" | "preparing-target" | "locations-committed"
                )
                || p.id.is_empty()
                || !p
                    .id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
            {
                return Err("unsupported pending storage operation".into());
            }
            for path in [
                &p.source_data_root,
                &p.target_data_root,
                &p.target_webview_root,
            ] {
                validate_path(path)?;
            }
        }
        if self.maintenance.format != STORAGE_MAINTENANCE_STATE_FORMAT
            || self.cleanup_files.len() > 12
        {
            return Err("invalid storage maintenance state".into());
        }
        Ok(())
    }
}

fn validate_path(path: &Path) -> Result<(), String> {
    let text = path.to_str().ok_or("storage path is not valid Unicode")?;
    if !path.is_absolute() || text.contains('\0') || text.encode_utf16().count() > 32760 {
        return Err(format!(
            "invalid absolute storage path `{}`",
            path.display()
        ));
    }
    Ok(())
}

pub struct StorageControlStore {
    key: String,
    profile: String,
    import_data: PathBuf,
    import_cache: PathBuf,
    lock: Mutex<()>,
}

impl StorageControlStore {
    fn new(key: String, profile: String, import_data: PathBuf, import_cache: PathBuf) -> Self {
        Self {
            key,
            profile,
            import_data,
            import_cache,
            lock: Mutex::new(()),
        }
    }

    fn load(&self) -> Result<StorageControl, String> {
        let raw = storage_registry::read(&self.key)?
            .ok_or("storage control is missing; restart to initialize it")?;
        let state: StorageControl =
            serde_json::from_slice(&raw).map_err(|e| format!("invalid storage control: {e}"))?;
        state.validate(&self.profile)?;
        Ok(state)
    }

    fn save(&self, state: &StorageControl) -> Result<(), String> {
        state.validate(&self.profile)?;
        let bytes = serde_json::to_vec(state).map_err(|e| e.to_string())?;
        storage_registry::write(&self.key, &bytes)
    }

    fn prepare(&self) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "storage control lock poisoned")?;
        let mut state = match storage_registry::read(&self.key)? {
            Some(_) => self.load()?,
            None => {
                let state =
                    file_import::read(&self.profile, &self.import_data, &self.import_cache)?;
                self.save(&state)?;
                state
            }
        };
        if !state.cleanup_files.is_empty() {
            // A previous process may have stopped after SetValue but before FlushKey.
            self.save(&state)?;
            match file_import::cleanup(&state.cleanup_files, &self.import_data, &self.import_cache)
            {
                Ok(()) => {
                    state.cleanup_files.clear();
                    self.save(&state)?;
                }
                Err(error) => {
                    state.maintenance.last_maintenance_error = Some(error);
                    self.save(&state)?;
                }
            }
        }
        Ok(())
    }

    fn update(
        &self,
        change: impl FnOnce(&mut StorageControl) -> Result<(), String>,
    ) -> Result<(), String> {
        let _guard = self
            .lock
            .lock()
            .map_err(|_| "storage control lock poisoned")?;
        let mut state = self.load()?;
        change(&mut state)?;
        self.save(&state)
    }
}

pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let profile = app_paths::app_profile(app).key().to_string();
    let data = app_paths::product_roaming_data_dir(app)?;
    let cache = app_paths::product_webview_data_dir(app)?;
    let key = registry_key(&profile, &data)?;
    let store = StorageControlStore::new(key, profile, data, cache);
    store.prepare()?;
    if !app.manage(store) {
        return Err("storage control already initialized".into());
    }
    Ok(())
}

fn registry_key(profile: &str, _data: &Path) -> Result<String, String> {
    #[cfg(debug_assertions)]
    if std::env::var("PATINA_E2E").as_deref() == Ok("1") {
        if let Ok(id) = std::env::var("PATINA_E2E_STORAGE_ID") {
            if id.is_empty()
                || id.len() > 80
                || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
            {
                return Err("invalid E2E storage identity".into());
            }
            return Ok(format!(r"Software\Patina\Storage\tests\{id}"));
        }
        use std::hash::{Hash, Hasher};
        let mut hash = std::collections::hash_map::DefaultHasher::new();
        _data.hash(&mut hash);
        return Ok(format!(
            r"Software\Patina\Storage\tests\e2e-{:016x}",
            hash.finish()
        ));
    }
    Ok(format!(r"Software\Patina\Storage\{profile}"))
}

pub fn read<R: Runtime>(app: &AppHandle<R>) -> Result<StorageControl, String> {
    app.try_state::<StorageControlStore>()
        .ok_or("storage control is not initialized")?
        .load()
}

fn update<R: Runtime>(
    app: &AppHandle<R>,
    change: impl FnOnce(&mut StorageControl) -> Result<(), String>,
) -> Result<(), String> {
    app.try_state::<StorageControlStore>()
        .ok_or("storage control is not initialized")?
        .update(change)
}

pub fn read_pending_migration<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<PendingStorageMigration>, String> {
    Ok(read(app)?.pending)
}

pub fn write_pending_migration<R: Runtime>(
    app: &AppHandle<R>,
    pending: &PendingStorageMigration,
) -> Result<(), String> {
    update(app, |s| {
        if s.pending.is_some() {
            return Err("another storage operation is pending".into());
        }
        s.pending = Some(pending.clone());
        Ok(())
    })
}

pub fn mark_target_preparing<R: Runtime>(app: &AppHandle<R>, id: &str) -> Result<(), String> {
    update(app, |s| {
        let p = s.pending.as_mut().ok_or("storage operation missing")?;
        if p.id != id {
            return Err("storage operation changed".into());
        }
        p.state = "preparing-target".into();
        Ok(())
    })
}

pub fn remove_pending_migration<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    update(app, |s| {
        s.pending = None;
        Ok(())
    })
}

pub fn commit_locations<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    data: Option<PathBuf>,
    cache: Option<PathBuf>,
) -> Result<(), String> {
    update(app, |s| {
        let pending = s
            .pending
            .as_mut()
            .ok_or("storage operation missing at commit")?;
        if pending.id != id {
            return Err("storage operation changed before commit".into());
        }
        pending.state = "locations-committed".into();
        s.data_root = data;
        s.webview_root = cache;
        Ok(())
    })
}

pub fn read_maintenance_state<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<StorageMaintenanceState, String> {
    Ok(read(app)?.maintenance)
}

pub fn record_maintenance_error<R: Runtime>(
    app: &AppHandle<R>,
    message: String,
) -> Result<(), String> {
    update(app, |s| {
        s.maintenance.last_maintenance_error = Some(message.chars().take(2048).collect());
        Ok(())
    })
}

pub fn mark_webview_cache_trimmed<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    update(app, |s| {
        s.maintenance.last_webview_cache_trim_at_ms = Some(now_ms());
        s.maintenance.last_maintenance_error = None;
        Ok(())
    })
}

pub fn now_ms() -> u64 {
    crate::platform::clock::unix_timestamp_millis_u64()
}
