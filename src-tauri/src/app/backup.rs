use crate::app::desktop_behavior;
use crate::data::backup;
use crate::engine::tracking::runtime as tracking_runtime;
use tauri::AppHandle;

pub(crate) async fn restore_backup_and_refresh(
    app: AppHandle,
    backup_path: String,
) -> Result<(), String> {
    backup::restore_backup(backup_path, app.clone()).await?;
    desktop_behavior::sync_desktop_behavior_from_storage(app.clone(), false).await?;
    tracking_runtime::emit_tracking_data_changed(&app, "backup-restored", now_ms())
        .map_err(|error| format!("failed to emit restore refresh event: {error}"))?;
    Ok(())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
