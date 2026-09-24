use super::super::{
    ports::TrackingDataStore, runtime_snapshot::TrackingRuntimeSnapshotState,
    watchdog::RuntimeHealthState,
};
use super::loop_state::{record_committed_sample, TrackerTimestampPersistState};
use tauri::{AppHandle, Emitter, Manager, Runtime};

pub(super) async fn record_sample<R: Runtime>(
    app: &AppHandle<R>,
    data: &dyn TrackingDataStore,
    health: &RuntimeHealthState,
    timestamps: &mut TrackerTimestampPersistState,
    now_ms: i64,
    is_web: bool,
) -> Result<(), String> {
    let changed = data
        .observe_anonymous_activity(now_ms, is_web)
        .await
        .map_err(|error| error.to_string())?;
    record_committed_sample(data, health, now_ms, true, timestamps).await;
    app.state::<TrackingRuntimeSnapshotState>()
        .replace_active_session(None);
    if changed {
        if let Some(snapshot) = app.state::<TrackingRuntimeSnapshotState>().snapshot() {
            let _ = app.emit("active-window-changed", &snapshot.window);
        }
        let _ = super::emit_tracking_data_changed(app, "anonymous-activity-updated", now_ms as u64);
    }
    Ok(())
}
