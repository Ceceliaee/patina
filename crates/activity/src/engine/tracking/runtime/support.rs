use crate::engine::tracking::host::TrackingHost;

pub(super) fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}

pub fn emit_tracking_data_changed<H: TrackingHost>(
    app: &H,
    reason: &str,
    changed_at_ms: u64,
) -> Result<(), String> {
    app.data_changed(reason, changed_at_ms)
}

pub(super) fn log_tracker_error(message: impl AsRef<str>) {
    eprintln!("[tracker] {}", message.as_ref());
}
