use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;
use tokio::time::{sleep, Duration};

const SCHEDULER_POLL_SECONDS: u64 = 30;

pub(super) fn pick_directory(initial_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(path) = initial_path.filter(|path| !path.trim().is_empty()) {
        dialog = dialog.set_directory(path);
    }
    dialog
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

pub(super) async fn wait_for_wake_or_poll(wake: &Notify) {
    tokio::select! {
        _ = wake.notified() => {},
        _ = sleep(Duration::from_secs(SCHEDULER_POLL_SECONDS)) => {},
    }
}

pub(super) fn emit_changed(app: &AppHandle, event: &str, owner: &str) {
    if let Err(error) = app.emit(event, serde_json::json!({})) {
        eprintln!("[{owner}] failed to emit state change: {error}");
    }
}
