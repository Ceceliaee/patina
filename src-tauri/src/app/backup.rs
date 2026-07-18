use std::path::PathBuf;

use crate::app::desktop_behavior;
use crate::data::backup::{self, RestoreStrategy};
use crate::data::remote_backup;
use crate::engine::import::tai;
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
    if let Err(error) =
        desktop_behavior::sync_desktop_behavior_from_storage(app.clone(), false, false).await
    {
        eprintln!("[backup] restore committed but desktop behavior refresh failed: {error}");
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

pub(crate) async fn parse_tai_file(
    app: AppHandle,
    file_path: String,
) -> Result<tai::TaiParsePreview, String> {
    let path = PathBuf::from(file_path.trim());
    if path.as_os_str().is_empty() {
        return Err("tai parse path cannot be empty".to_string());
    }
    tai::parse_file(&app, &path).await
}

pub(crate) async fn import_tai_file(
    app: AppHandle,
    file_path: String,
    options: tai::TaiImportOptions,
) -> Result<tai::ImportTaiReport, String> {
    let path = PathBuf::from(file_path.trim());
    if path.as_os_str().is_empty() {
        return Err("tai import path cannot be empty".to_string());
    }

    let conversion = tai::import_file(&app, &path, options).await?;
    if !conversion.skipped.is_empty() {
        eprintln!(
            "[tai-import] skipped {} row(s): {}",
            conversion.skipped.len(),
            conversion
                .skipped
                .iter()
                .map(|s| format!("line {} ({})", s.line, s.reason))
                .collect::<Vec<_>>()
                .join(", ")
        );
    }

    // No auto-refresh or emit here — the dialog owns reload via its refresh
    // button, and reporting emit errors as a failed import was a false alarm.
    Ok(tai::ImportTaiReport::from_stats(&conversion.stats))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
