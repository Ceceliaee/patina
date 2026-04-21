use crate::domain::tracking::TrackingDataChangedPayload;
use tauri::{AppHandle, Emitter, Runtime};

pub(super) fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

pub fn emit_tracking_data_changed<R: Runtime>(
    app: &AppHandle<R>,
    reason: &str,
    changed_at_ms: u64,
) -> tauri::Result<()> {
    app.emit(
        "tracking-data-changed",
        TrackingDataChangedPayload::new(reason, changed_at_ms),
    )
}

pub(super) fn log_tracker_error(message: impl AsRef<str>) {
    eprintln!("[tracker] {}", message.as_ref());
}
