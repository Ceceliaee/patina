use crate::domain::tracking::TrackingStatusSnapshot;
use crate::engine::tracking::runtime_snapshot::{
    TrackingRuntimeProbeStatus, TrackingRuntimeSnapshotState,
};
use crate::platform::windows::foreground::WindowInfo;
use serde::Serialize;
use tauri::Manager;

#[derive(Clone, Debug, Serialize)]
pub struct CurrentTrackingSnapshot {
    pub window: WindowInfo,
    pub status: TrackingStatusSnapshot,
    pub sampled_at_ms: i64,
    pub probe_status: TrackingRuntimeProbeStatus,
    pub degraded_reason: Option<String>,
}

#[tauri::command]
pub fn get_current_active_window(app: tauri::AppHandle) -> Result<WindowInfo, String> {
    app.state::<TrackingRuntimeSnapshotState>()
        .snapshot()
        .map(|snapshot| snapshot.window)
        .ok_or_else(|| "tracking runtime snapshot is not ready".to_string())
}

#[tauri::command]
pub fn get_current_tracking_snapshot(
    app: tauri::AppHandle,
) -> Result<CurrentTrackingSnapshot, String> {
    let snapshot = app
        .state::<TrackingRuntimeSnapshotState>()
        .snapshot()
        .ok_or_else(|| "tracking runtime snapshot is not ready".to_string())?;

    Ok(CurrentTrackingSnapshot {
        window: snapshot.window,
        status: snapshot.status,
        sampled_at_ms: snapshot.sampled_at_ms,
        probe_status: snapshot.probe_status,
        degraded_reason: snapshot.degraded_reason,
    })
}

#[tauri::command]
pub fn cmd_set_afk_threshold(threshold_secs: u64) {
    crate::platform::windows::foreground::cmd_set_afk_threshold(threshold_secs);
}
