use super::super::ports::TrackingDataStore;
use super::super::runtime_snapshot::{TrackingRuntimeSnapshot, TrackingRuntimeSnapshotState};
use super::support::log_tracker_error;
use super::window_polling::WindowPollOutcome;
use crate::domain::tracking::{TrackingStatusSnapshot, TRACKING_REASON_STATUS_CHANGED};
use tauri::{AppHandle, Manager, Runtime};

pub(super) fn emit_tracking_loop_change<R: Runtime>(
    app: &AppHandle<R>,
    tracking_data_change_reason: Option<&'static str>,
    did_change_tracking_status: bool,
    changed_at_ms: i64,
) {
    let reason = tracking_data_change_reason
        .or_else(|| did_change_tracking_status.then_some(TRACKING_REASON_STATUS_CHANGED));
    if let Some(reason) = reason {
        let _ = super::support::emit_tracking_data_changed(app, reason, changed_at_ms as u64);
    }
}

pub(super) async fn publish_resolved_names<R: Runtime>(
    app: &AppHandle<R>,
    data: &dyn TrackingDataStore,
    now_ms: i64,
) {
    if data.take_session_name_changed() {
        refresh_active_session_snapshot_if_changed(app, data, true).await;
        let _ =
            super::support::emit_tracking_data_changed(app, "session-name-resolved", now_ms as u64);
    }
}

pub(super) fn clear_active_session_snapshot<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<TrackingRuntimeSnapshotState>() {
        state.invalidate_activity();
    }
}

pub(super) async fn refresh_active_session_snapshot_if_changed<R: Runtime>(
    app: &AppHandle<R>,
    data: &dyn TrackingDataStore,
    tracking_data_changed: bool,
) {
    let missing = app
        .try_state::<TrackingRuntimeSnapshotState>()
        .and_then(|state| state.snapshot())
        .and_then(|snapshot| snapshot.active_session)
        .is_none();
    if !tracking_data_changed && !missing {
        return;
    }

    match data.load_active_session().await {
        Ok(active_session) => {
            if let Some(state) = app.try_state::<TrackingRuntimeSnapshotState>() {
                state.replace_active_session(active_session);
            }
        }
        Err(error) => {
            clear_active_session_snapshot(app);
            log_tracker_error(format!(
                "failed to refresh the in-memory active-session projection: {error}"
            ));
        }
    }
}

pub(super) fn update_runtime_snapshot_state<R: Runtime>(
    app: &AppHandle<R>,
    tracking: &super::loop_state::TrackingLoopState,
    sampled_at_ms: i64,
    poll_outcome: &WindowPollOutcome,
    generation: u64,
) {
    let window = &tracking.tracked_window;
    let anonymous = !tracking.app_tracking_enabled;
    if let Some(state) = app.try_state::<TrackingRuntimeSnapshotState>() {
        let mut public_window = window.clone();
        if !tracking.capture_window_title || anonymous {
            public_window.title.clear();
        }
        let mut snapshot = TrackingRuntimeSnapshot {
            generation,
            window: public_window,
            source_window: Some(window.clone()),
            anonymous,
            status: tracking.tracking_status.clone(),
            sampled_at_ms,
            probe_status: poll_outcome.probe_status,
            degraded_reason: poll_outcome.degraded_reason.clone(),
            probe_diagnostics: poll_outcome.probe_diagnostics.clone(),
            active_session: (!anonymous)
                .then(|| {
                    state
                        .snapshot()
                        .and_then(|snapshot| snapshot.active_session)
                })
                .flatten(),
        };
        if anonymous {
            snapshot.redact_anonymous();
        }
        state.replace(snapshot);
    }
}

pub(super) fn should_emit_tracking_status_changed(
    previous: Option<&TrackingStatusSnapshot>,
    next: &TrackingStatusSnapshot,
) -> bool {
    let Some(previous) = previous else {
        return false;
    };

    previous.is_tracking_active != next.is_tracking_active
        || previous.sustained_participation_eligible != next.sustained_participation_eligible
        || previous.sustained_participation_active != next.sustained_participation_active
        || previous.sustained_participation_kind != next.sustained_participation_kind
        || previous.sustained_participation_state != next.sustained_participation_state
        || previous.sustained_participation_signal_source
            != next.sustained_participation_signal_source
        || previous.sustained_participation_reason != next.sustained_participation_reason
}
