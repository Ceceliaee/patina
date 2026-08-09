use crate::domain::backup_schedule::{ScheduledBackupConfigInput, ScheduledBackupSnapshot};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, Notify, OwnedMutexGuard};
use tokio::time::{sleep, Duration};

const SCHEDULER_POLL_SECONDS: u64 = 30;

#[derive(Debug, Default)]
pub struct ScheduledBackupRuntimeState {
    wake: Notify,
    run_lock: Arc<Mutex<()>>,
}

impl ScheduledBackupRuntimeState {
    pub fn wake(&self) {
        self.wake.notify_one();
    }
}

pub async fn get_snapshot(app: &AppHandle) -> Result<ScheduledBackupSnapshot, String> {
    crate::data::scheduled_backup::get_snapshot(app).await
}

pub async fn save_config(
    app: &AppHandle,
    input: ScheduledBackupConfigInput,
) -> Result<ScheduledBackupSnapshot, String> {
    let state = app.state::<ScheduledBackupRuntimeState>();
    let _run_guard = state.run_lock.lock().await;
    let snapshot = crate::data::scheduled_backup::save_config(app, input).await?;
    state.wake();
    emit_changed(app);
    Ok(snapshot)
}

pub fn pick_directory(initial_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(path) = initial_path.filter(|path| !path.trim().is_empty()) {
        dialog = dialog.set_directory(path);
    }
    dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

pub async fn run(app: AppHandle) -> Result<(), String> {
    loop {
        if let Err(error) = tick(&app).await {
            eprintln!(
                "[scheduled-backup] tick failed: category={}",
                crate::data::scheduled_backup::classify_error(&error)
            );
        }
        let state = app.state::<ScheduledBackupRuntimeState>();
        tokio::select! {
            _ = state.wake.notified() => {},
            _ = sleep(Duration::from_secs(SCHEDULER_POLL_SECONDS)) => {},
        }
    }
}

pub async fn tick(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ScheduledBackupRuntimeState>();
    let _run_guard = state.run_lock.lock().await;
    if crate::data::scheduled_backup::tick(app).await? {
        emit_changed(app);
    }
    Ok(())
}

pub(crate) async fn lock_for_restore(app: &AppHandle) -> OwnedMutexGuard<()> {
    let state = app.state::<ScheduledBackupRuntimeState>();
    state.run_lock.clone().lock_owned().await
}

pub(crate) async fn lock_for_configuration(app: &AppHandle) -> OwnedMutexGuard<()> {
    let state = app.state::<ScheduledBackupRuntimeState>();
    state.run_lock.clone().lock_owned().await
}

pub(crate) async fn refresh_webdav_target_while_locked(app: &AppHandle) -> Result<(), String> {
    let changed =
        crate::data::scheduled_backup::refresh_webdav_target_after_settings_change(app).await?;
    let state = app.state::<ScheduledBackupRuntimeState>();
    state.wake();
    if changed {
        emit_changed(app);
    }
    Ok(())
}

pub(crate) async fn reset_after_replace_restore_while_locked(
    app: &AppHandle,
) -> Result<(), String> {
    let state = app.state::<ScheduledBackupRuntimeState>();
    crate::data::scheduled_backup::reset_after_replace_restore(app).await?;
    state.wake();
    emit_changed(app);
    Ok(())
}

fn emit_changed(app: &AppHandle) {
    if let Err(error) = app.emit("scheduled-backup-changed", serde_json::json!({})) {
        eprintln!("[scheduled-backup] failed to emit state change: {error}");
    }
}
