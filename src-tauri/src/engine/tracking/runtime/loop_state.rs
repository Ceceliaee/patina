use super::support::log_tracker_error;
use super::super::sustained_participation::{
    apply_tracking_mode_window_state, load_sustained_participation_signals,
    resolve_tracking_status_with_runtime, SustainedParticipationRuntimeState,
};
use crate::data::repositories::tracker_settings;
use crate::domain::tracking::TrackingStatusSnapshot;
use crate::platform::windows::foreground as tracker;
use sqlx::{Pool, Sqlite};

pub(super) struct TrackingLoopState {
    pub continuity_window_secs: u64,
    pub sustained_participation_secs: u64,
    pub tracking_paused: bool,
    pub tracked_window: tracker::WindowInfo,
    pub tracking_status: TrackingStatusSnapshot,
}

pub struct CurrentTrackingSnapshotData {
    pub window: tracker::WindowInfo,
    pub status: TrackingStatusSnapshot,
}

pub(super) async fn persist_tracker_runtime_timestamps(pool: &Pool<Sqlite>, now_ms: i64) {
    for (setting_key, error_context) in [
        (
            tracker_settings::TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY,
            "sample timestamp",
        ),
        (tracker_settings::TRACKER_LAST_HEARTBEAT_KEY, "heartbeat"),
    ] {
        if let Err(error) =
            tracker_settings::save_tracker_timestamp(pool, setting_key, now_ms).await
        {
            log_tracker_error(format!("failed to save tracker {error_context}: {error}"));
        }
    }
}

pub(super) async fn load_tracking_loop_state(
    pool: &Pool<Sqlite>,
    window_info: &tracker::WindowInfo,
    now_ms: i64,
    previous_state: &SustainedParticipationRuntimeState,
) -> (TrackingLoopState, SustainedParticipationRuntimeState) {
    let continuity_window_secs =
        match tracker_settings::load_timeline_merge_gap_secs(pool, 180).await {
            Ok(value) => value,
            Err(error) => {
                log_tracker_error(format!("failed to load continuity window setting: {error}"));
                180
            }
        };

    let tracking_paused = match tracker_settings::load_tracking_paused_setting(pool).await {
        Ok(value) => value,
        Err(error) => {
            log_tracker_error(format!("failed to load tracking pause setting: {error}"));
            false
        }
    };

    let sustained_participation_secs =
        match tracker_settings::load_idle_timeout_secs(pool, 300).await {
            Ok(value) => value,
            Err(error) => {
                log_tracker_error(format!(
                    "failed to load sustained participation setting: {error}"
                ));
                300
            }
        };

    let capture_window_title = match tracker_settings::load_capture_window_title_setting_for_app(
        pool,
        &window_info.exe_name,
    )
    .await
    {
        Ok(value) => value,
        Err(error) => {
            log_tracker_error(format!(
                "failed to load app capture title setting for {}: {error}",
                window_info.exe_name
            ));
            true
        }
    };

    let mut tracked_window = window_info.clone();
    if !capture_window_title {
        tracked_window.title.clear();
    }

    let (system_media_signal, audio_signal) =
        load_sustained_participation_signals(&tracked_window, tracking_paused).await;
    let (tracking_status, next_sustained_participation_state) =
        resolve_tracking_status_with_runtime(
            &tracked_window.exe_name,
            &tracked_window.process_path,
            tracked_window.idle_time_ms,
            tracked_window.is_afk,
            continuity_window_secs,
            sustained_participation_secs,
            tracking_paused,
            now_ms,
            previous_state,
            &system_media_signal,
            &audio_signal,
        );
    let tracked_window = apply_tracking_mode_window_state(tracked_window, &tracking_status);

    (
        TrackingLoopState {
            continuity_window_secs,
            sustained_participation_secs,
            tracking_paused,
            tracked_window,
            tracking_status,
        },
        next_sustained_participation_state,
    )
}
