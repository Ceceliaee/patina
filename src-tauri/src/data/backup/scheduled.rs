use super::{snapshot, BACKUP_SNAPSHOT_LOCK};
use crate::data::sqlite_pool::{acquire_sqlite_maintenance, wait_for_sqlite_pool};
use std::path::Path;
use tauri::AppHandle;
pub(crate) async fn export_scheduled_backup_create_new(
    app: &AppHandle,
    target_path: &Path,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let _snapshot = BACKUP_SNAPSHOT_LOCK.lock().await;
    let _maintenance = acquire_sqlite_maintenance().await;
    snapshot::write_snapshot_archive_create_new(
        &pool,
        &[target_path.to_path_buf()],
        env!("CARGO_PKG_VERSION"),
    )
    .await?;
    Ok(())
}
