use crate::app::{desktop_behavior, tray};
use crate::data::backup::{self, RestoreStrategy};
use crate::data::remote_backup;
use crate::engine::tracking::runtime as tracking_runtime;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) async fn restore_backup_and_refresh(
    app: AppHandle,
    backup_path: String,
    hash: String,
    strategy: RestoreStrategy,
) -> Result<(), String> {
    let scheduled_backup_guard = crate::app::scheduled_backup::lock_for_restore(&app).await;
    let scheduled_export_guard = crate::app::scheduled_export::lock_for_restore(&app).await;
    let title_state =
        app.state::<crate::engine::tracking::title_state::TitleRecordingRuntimeState>();
    let _title_guard = title_state.lock_update().await;
    let settings_state = app.state::<crate::app::state::AppSettingsCommitState>();
    let _settings_guard = settings_state.lock().await;
    let tracking =
        app.state::<crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState>();
    let transition_guard = tracking.transition.lock().await;
    tracking.note_tracking_policy_change();
    // Merge keeps destination rows, so end the live destination interval before
    // either restore strategy can replace settings or reuse session identities.
    crate::data::tracking_runtime::shared_from_app(&app)
        .await?
        .end_active_sessions(now_ms() as i64)
        .await
        .map_err(|error| format!("failed to stop tracking before restore: {error}"))?;
    backup::restore_backup(backup_path.clone(), hash, app.clone(), strategy).await?;
    // Restored privacy settings must take effect before tracking resumes.
    title_state.set_enabled(false);
    title_state.invalidate_app_overrides();
    match crate::data::tracking_runtime::shared_from_app(&app).await {
        Ok(data) => {
            if let Err(error) = title_state.initialize(data.as_ref()).await {
                eprintln!("[backup] restore committed but title policy refresh failed: {error}");
            }
        }
        Err(error) => {
            eprintln!("[backup] restore committed but tracking data reload failed: {error}")
        }
    }
    if strategy == RestoreStrategy::Replace {
        crate::app::scheduled_backup::reset_after_replace_restore_while_locked(&app).await?;
        crate::app::scheduled_export::reset_after_replace_restore_while_locked(&app).await?;
    }
    drop(scheduled_export_guard);
    drop(scheduled_backup_guard);
    if let Err(error) = remote_backup::cleanup_remote_backup_temp_if_owned(&app, &backup_path) {
        eprintln!("[backup] restore committed but remote temp cleanup failed: {error}");
    }
    if let Err(error) = desktop_behavior::refresh_desktop_behavior_from_storage(app.clone()).await {
        eprintln!("[backup] restore committed but desktop behavior refresh failed: {error}");
    }
    if let Err(error) = tray::refresh_tracking_pause_from_storage(&app).await {
        eprintln!("[backup] restore committed but tracking pause refresh failed: {error}");
    }
    tracking.note_tracking_policy_change();
    drop(transition_guard);
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
    crate::platform::clock::unix_timestamp_millis_u64()
}
