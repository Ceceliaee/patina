use crate::app::{desktop_behavior, tray};
use crate::data::backup::{self, RestoreStrategy};
use crate::data::remote_backup;
use crate::engine::tracking::runtime as tracking_runtime;
use tauri::{AppHandle, Emitter};

pub(crate) async fn restore_backup_and_refresh(
    app: AppHandle,
    backup_path: String,
    hash: String,
    strategy: RestoreStrategy,
) -> Result<(), String> {
    backup::restore_backup(backup_path.clone(), hash, app.clone(), strategy).await?;
    if let Err(error) = remote_backup::cleanup_remote_backup_temp_if_owned(&app, &backup_path) {
        eprintln!("[backup] restore committed but remote temp cleanup failed: {error}");
    }
    if let Err(error) = desktop_behavior::refresh_desktop_behavior_from_storage(app.clone()).await {
        eprintln!("[backup] restore committed but desktop behavior refresh failed: {error}");
    }
    if let Err(error) = tray::refresh_tracking_pause_from_storage(&app).await {
        eprintln!("[backup] restore committed but tracking pause refresh failed: {error}");
    }
    if let Err(error) = app.emit("app-settings-changed", serde_json::json!({})) {
        eprintln!("[backup] restore committed but settings refresh event failed: {error}");
    }
    if let Err(error) =
        tracking_runtime::emit_tracking_data_changed(&app, "backup-restored", now_ms())
    {
        eprintln!("[backup] restore committed but tracking refresh event failed: {error}");
    }
    Ok(())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
