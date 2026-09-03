use crate::domain::tracking::{ActiveSessionSnapshot, TrackingStatusSnapshot};
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
    RecoveryAttemptedFallback,
    RecoveryAttemptedInactive,
    HardDegradedFallback,
    HardDegradedInactive,
    TaskFailedFallback,
    TaskFailedInactive,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct TrackingRuntimeProbeDiagnostics {
    pub last_successful_sample_at_ms: Option<i64>,
    pub fallback_started_at_ms: Option<i64>,
    pub fallback_count: u64,
    pub consecutive_fallback_count: u64,
    pub recovery_attempt_count: u64,
    pub last_recovery_attempt_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
pub struct TrackingRuntimeSnapshot {
    #[serde(skip)]
    pub(crate) generation: u64,
    pub window: WindowInfo,
    pub status: TrackingStatusSnapshot,
    pub sampled_at_ms: i64,
    pub probe_status: TrackingRuntimeProbeStatus,
    pub degraded_reason: Option<String>,
    pub probe_diagnostics: TrackingRuntimeProbeDiagnostics,
    pub active_session: Option<ActiveSessionSnapshot>,
}

#[derive(Debug, Default)]
pub struct TrackingRuntimeSnapshotState {
    inner: Mutex<Option<TrackingRuntimeSnapshot>>,
    pub(crate) transition: tokio::sync::Mutex<()>,
    lifecycle: Mutex<TrackingLifecycle>,
}

#[derive(Debug, Default)]
struct TrackingLifecycle {
    generation: u64,
    locked: bool,
    suspended: bool,
    pending_stop: Option<(u64, i64, &'static str)>,
}

impl TrackingRuntimeSnapshotState {
    pub(crate) fn note_tracking_policy_change(&self) {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        lifecycle.generation = lifecycle.generation.wrapping_add(1);
        drop(lifecycle);
        self.invalidate_activity();
    }
    pub(crate) fn note_power_event(&self, event: &str, timestamp_ms: i64) {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match event {
            "lock" => lifecycle.locked = true,
            "unlock" => lifecycle.locked = false,
            "suspend" => lifecycle.suspended = true,
            "resume" => lifecycle.suspended = false,
            _ => return,
        }
        lifecycle.generation = lifecycle.generation.wrapping_add(1);
        if matches!(event, "lock" | "suspend") {
            let reason = if event == "lock" { "lock" } else { "suspend" };
            let (_, boundary, reason) = lifecycle
                .pending_stop
                .filter(|(_, time, _)| *time <= timestamp_ms)
                .unwrap_or((lifecycle.generation, timestamp_ms, reason));
            lifecycle.pending_stop = Some((lifecycle.generation, boundary, reason));
        }
        drop(lifecycle);
        self.invalidate_activity();
    }

    pub(crate) fn lifecycle_generation(&self) -> u64 {
        self.lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .generation
    }

    pub(crate) fn accepts_sample(&self, generation: u64) -> bool {
        let lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        lifecycle.generation == generation
            && !lifecycle.locked
            && !lifecycle.suspended
            && lifecycle.pending_stop.is_none()
    }

    pub(crate) fn pending_stop(&self) -> Option<(u64, i64, &'static str)> {
        self.lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .pending_stop
    }

    pub(crate) fn acknowledge_stop(&self, stop: (u64, i64, &'static str)) {
        let mut lifecycle = self
            .lifecycle
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if lifecycle.pending_stop == Some(stop) {
            lifecycle.pending_stop = None;
        }
    }

    pub(crate) fn invalidate_activity(&self) {
        let mut guard = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(snapshot) = guard.as_mut() {
            snapshot.active_session = None;
            snapshot.status.is_tracking_active = false;
        }
    }

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
        let mut snapshot = match self.inner.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }?;
        if !self.accepts_sample(snapshot.generation) {
            snapshot.status.is_tracking_active = false;
            snapshot.active_session = None;
        }
        Some(snapshot)
    }

    pub fn replace_active_session(&self, active_session: Option<ActiveSessionSnapshot>) {
        match self.inner.lock() {
            Ok(mut guard) => {
                if let Some(snapshot) = guard.as_mut() {
                    snapshot.active_session = active_session;
                }
            }
            Err(poisoned) => {
                if let Some(snapshot) = poisoned.into_inner().as_mut() {
                    snapshot.active_session = active_session;
                }
            }
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
            app_user_model_id: String::new(),
            is_afk: false,
            idle_time_ms: 0,
        }
    }

    #[test]
    fn snapshot_state_returns_latest_runtime_snapshot() {
        let state = TrackingRuntimeSnapshotState::default();
        let snapshot = TrackingRuntimeSnapshot {
            generation: 0,
            window: make_window(),
            status: TrackingStatusSnapshot::default(),
            sampled_at_ms: 123,
            probe_status: TrackingRuntimeProbeStatus::Ok,
            degraded_reason: None,
            probe_diagnostics: TrackingRuntimeProbeDiagnostics::default(),
            active_session: None,
        };

        state.replace(snapshot.clone());

        let loaded = state.snapshot().unwrap();
        assert_eq!(loaded.sampled_at_ms, 123);
        assert_eq!(loaded.probe_status, TrackingRuntimeProbeStatus::Ok);
        assert_eq!(loaded.window.exe_name, snapshot.window.exe_name);
    }

    #[test]
    fn old_publications_cannot_restore_activity_after_policy_or_power_changes() {
        let state = TrackingRuntimeSnapshotState::default();
        let mut snapshot = TrackingRuntimeSnapshot {
            generation: 0,
            window: make_window(),
            status: TrackingStatusSnapshot {
                is_tracking_active: true,
                ..Default::default()
            },
            sampled_at_ms: 1_000,
            probe_status: TrackingRuntimeProbeStatus::Ok,
            degraded_reason: None,
            probe_diagnostics: Default::default(),
            active_session: Some(ActiveSessionSnapshot {
                id: 1,
                app_name: "A".into(),
                exe_name: "a.exe".into(),
                start_time: 1_000,
                continuity_group_start_time: 1_000,
                closed_duration_ms: 0,
            }),
        };
        state.replace(snapshot.clone());
        state.note_tracking_policy_change();
        state.replace(snapshot.clone());
        assert!(state.snapshot().unwrap().active_session.is_none());
        assert!(!state.snapshot().unwrap().status.is_tracking_active);
        snapshot.generation = state.lifecycle_generation();
        state.replace(snapshot.clone());
        assert!(state.snapshot().unwrap().active_session.is_some());
        state.note_power_event("lock", 5_000);
        let old_stop = state.pending_stop().unwrap();
        state.note_power_event("suspend", 6_000);
        state.acknowledge_stop(old_stop);
        assert!(
            state.pending_stop().is_some(),
            "an old handler cannot acknowledge a newer stop"
        );
        state.note_power_event("unlock", 7_000);
        let stop = state.pending_stop().unwrap();
        state.acknowledge_stop(stop);
        assert!(
            !state.accepts_sample(state.lifecycle_generation()),
            "unlock does not imply resume"
        );
        state.note_power_event("resume", 8_000);
        assert!(state.accepts_sample(state.lifecycle_generation()));
        state.replace(snapshot);
        assert!(state.snapshot().unwrap().active_session.is_none());
    }
}
