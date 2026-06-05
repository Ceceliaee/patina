use crate::domain::tracking::TrackingStatusSnapshot;
use crate::platform::windows::foreground::WindowInfo;
use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TrackingRuntimeProbeStatus {
    Ok,
    TimeoutFallback,
    TimeoutInactive,
    BackingOffFallback,
    BackingOffInactive,
    TaskFailedFallback,
    TaskFailedInactive,
}

#[derive(Clone, Debug, Serialize)]
pub struct TrackingRuntimeSnapshot {
    pub window: WindowInfo,
    pub status: TrackingStatusSnapshot,
    pub sampled_at_ms: i64,
    pub probe_status: TrackingRuntimeProbeStatus,
    pub degraded_reason: Option<String>,
}

#[derive(Debug, Default)]
pub struct TrackingRuntimeSnapshotState {
    inner: Mutex<Option<TrackingRuntimeSnapshot>>,
}

impl TrackingRuntimeSnapshotState {
    pub fn replace(&self, snapshot: TrackingRuntimeSnapshot) {
        match self.inner.lock() {
            Ok(mut guard) => {
                *guard = Some(snapshot);
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = Some(snapshot);
            }
        }
    }

    pub fn snapshot(&self) -> Option<TrackingRuntimeSnapshot> {
        match self.inner.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_window() -> WindowInfo {
        WindowInfo {
            hwnd: "0x100".into(),
            root_owner_hwnd: "0x100".into(),
            process_id: 123,
            window_class: "Chrome_WidgetWin_1".into(),
            title: "Window".into(),
            exe_name: "QQ.exe".into(),
            process_path: r"C:\Program Files\QQ\QQ.exe".into(),
            is_afk: false,
            idle_time_ms: 0,
        }
    }

    #[test]
    fn snapshot_state_returns_latest_runtime_snapshot() {
        let state = TrackingRuntimeSnapshotState::default();
        let snapshot = TrackingRuntimeSnapshot {
            window: make_window(),
            status: TrackingStatusSnapshot::default(),
            sampled_at_ms: 123,
            probe_status: TrackingRuntimeProbeStatus::Ok,
            degraded_reason: None,
        };

        state.replace(snapshot.clone());

        let loaded = state.snapshot().unwrap();
        assert_eq!(loaded.sampled_at_ms, 123);
        assert_eq!(loaded.probe_status, TrackingRuntimeProbeStatus::Ok);
        assert_eq!(loaded.window.exe_name, snapshot.window.exe_name);
    }
}
