use crate::domain::export_schedule::{ScheduledExportConfigInput, ScheduledExportSnapshot};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{Mutex, Notify, OwnedMutexGuard};
use tokio::time::{sleep, Duration};

const SCHEDULER_POLL_SECONDS: u64 = 30;

#[derive(Debug, Default)]
pub struct ScheduledExportRuntimeState {
    wake: Notify,
    run_lock: Arc<Mutex<()>>,
}

impl ScheduledExportRuntimeState {
    pub fn wake(&self) {
        self.wake.notify_one();
    }
}

pub async fn get_snapshot(app: &AppHandle) -> Result<ScheduledExportSnapshot, String> {
    crate::data::scheduled_export::get_snapshot(app).await
}

pub async fn save_config(
    app: &AppHandle,
    input: ScheduledExportConfigInput,
) -> Result<ScheduledExportSnapshot, String> {
    let state = app.state::<ScheduledExportRuntimeState>();
    let _guard = state.run_lock.lock().await;
    let snapshot = crate::data::scheduled_export::save_config(app, input).await?;
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
                "[scheduled-export] tick failed: category={}",
                crate::data::scheduled_export::classify_error(&error)
            );
        }
        let state = app.state::<ScheduledExportRuntimeState>();
        tokio::select! {
            _ = state.wake.notified() => {},
            _ = sleep(Duration::from_secs(SCHEDULER_POLL_SECONDS)) => {},
        }
    }
}

pub async fn tick(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<ScheduledExportRuntimeState>();
    let _guard = state.run_lock.lock().await;
    if crate::data::scheduled_export::tick(app).await? {
        emit_changed(app);
    }
    Ok(())
}

pub(crate) async fn lock_for_restore(app: &AppHandle) -> OwnedMutexGuard<()> {
    let state = app.state::<ScheduledExportRuntimeState>();
    state.run_lock.clone().lock_owned().await
}

pub(crate) async fn reset_after_replace_restore_while_locked(
    app: &AppHandle,
) -> Result<(), String> {
    let state = app.state::<ScheduledExportRuntimeState>();
    crate::data::scheduled_export::reset_after_replace_restore(app).await?;
    state.wake();
    emit_changed(app);
    Ok(())
}

fn emit_changed(app: &AppHandle) {
    if let Err(error) = app.emit("scheduled-export-changed", serde_json::json!({})) {
        eprintln!("[scheduled-export] failed to emit state change: {error}");
    }
}
