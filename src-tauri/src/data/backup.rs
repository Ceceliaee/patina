use crate::data::sqlite_pool::{acquire_sqlite_maintenance, wait_for_sqlite_pool};
use crate::domain::backup::{BackupError, BackupPreview};
use tauri::AppHandle;
use tokio::sync::Mutex;

mod import_data;
mod merge;
#[cfg(test)]
mod merge_tests;
mod paths;
mod prepared_source;
mod records;
mod snapshot;

static BACKUP_SNAPSHOT_LOCK: Mutex<()> = Mutex::const_new(());
use paths::resolve_backup_path;
pub use paths::{pick_backup_file, pick_backup_save_file};
use prepared_source::{prepare_snapshot_source, PreparedBackupSource};
pub use records::RestoreStrategy;
pub(crate) use snapshot::{export_scheduled_backup_create_new, validate_scheduled_snapshot};

pub(crate) struct PreparedBackupRestore {
    _source: PreparedBackupSource,
    snapshot: snapshot::ExtractedSnapshot,
    strategy: RestoreStrategy,
}

pub async fn export_backup(backup_path: Option<String>, app: AppHandle) -> Result<String, String> {
    let target_path = resolve_backup_path(&app, backup_path)?;
    let pool = wait_for_sqlite_pool(&app).await?;
    let _snapshot = BACKUP_SNAPSHOT_LOCK.lock().await;
    let _maintenance = acquire_sqlite_maintenance().await;
    snapshot::write_snapshot_archive(&pool, &target_path, env!("CARGO_PKG_VERSION")).await?;

    Ok(target_path.to_string_lossy().to_string())
}

pub(crate) async fn prepare_backup_restore(
    path: &str,
    expected_content_sha256: &str,
    strategy: RestoreStrategy,
) -> Result<PreparedBackupRestore, BackupError> {
    let source = prepare_snapshot_source(path, Some(expected_content_sha256.trim()))?;
    let snapshot = snapshot::prepare_snapshot_backup(&source.path, strategy).await?;
    Ok(PreparedBackupRestore {
        _source: source,
        snapshot,
        strategy,
    })
}

pub(crate) async fn restore_prepared_backup(
    prepared: PreparedBackupRestore,
    app: &AppHandle,
) -> Result<(), String> {
    let _maintenance = acquire_sqlite_maintenance().await;
    snapshot::restore_snapshot_backup(prepared.snapshot, app, prepared.strategy).await
}

pub async fn preview_backup(path: String) -> Result<BackupPreview, BackupError> {
    let source = prepare_snapshot_source(&path, None)?;
    let mut preview = snapshot::extract_snapshot_archive(&source.path, false)
        .await?
        .preview
        .clone();
    preview.hash = source.content_sha256.clone();
    Ok(preview)
}
