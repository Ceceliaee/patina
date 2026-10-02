use crate::data::storage_migration::{checkpoint_current_database, timestamp_for_file};
use crate::platform::{storage_control, storage_paths};
use tauri::{AppHandle, Runtime};

const RESTART_OPERATION_PREPARED: &str = "pending-restart";

pub fn commit_storage_locations<R: Runtime>(
    app: &AppHandle<R>,
    pending: &storage_control::PendingStorageMigration,
    target_data_is_custom: bool,
    target_webview_is_custom: bool,
) -> Result<(), String> {
    storage_control::commit_locations(
        app,
        &pending.id,
        target_data_is_custom.then(|| pending.target_data_root.clone()),
        target_webview_is_custom.then(|| pending.target_webview_root.clone()),
    )
}

pub async fn schedule_webview_cache_clear(app: AppHandle) -> Result<(), String> {
    let current = storage_paths::resolve_storage_paths(&app)?;
    if storage_control::read_pending_migration(&app)?.is_some() {
        return Err("another storage restart operation is already pending".to_string());
    }

    checkpoint_current_database(&app).await?;
    let pending = storage_control::PendingStorageMigration {
        format: storage_control::STORAGE_MIGRATION_PENDING_FORMAT.to_string(),
        id: timestamp_for_file(),
        source_data_root: current.data_root.clone(),
        target_data_root: current.data_root,
        target_webview_root: current.webview_root,
        created_at_ms: storage_control::now_ms(),
        state: RESTART_OPERATION_PREPARED.to_string(),
        clear_webview_cache: true,
    };
    storage_control::write_pending_migration(&app, &pending)?;

    let persisted = storage_control::read_pending_migration(&app)?
        .ok_or_else(|| "cache clear restart operation was not persisted".to_string())?;
    if persisted.id != pending.id || !persisted.clear_webview_cache {
        let _ = storage_control::remove_pending_migration(&app);
        return Err("cache clear restart operation verification failed".to_string());
    }
    Ok(())
}
