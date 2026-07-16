use super::ports::{TrackingDataError, TrackingDataStore};
use super::transition;
use crate::domain::tracking::{
    SustainedParticipationState, TrackingStatusSnapshot, WindowSessionIdentity,
    TRACKING_REASON_CONTINUITY_WINDOW_SEALED, TRACKING_REASON_PASSIVE_PARTICIPATION_SEALED,
    TRACKING_REASON_TRACKING_PAUSED_SEALED,
};
use crate::platform::windows::foreground as tracker;

pub(super) async fn seal_active_sessions_for_tracking_pause(
    data: &dyn TrackingDataStore,
    timestamp_ms: i64,
) -> Result<Option<&'static str>, TrackingDataError> {
    if data.end_active_sessions(timestamp_ms).await? {
        return Ok(Some(TRACKING_REASON_TRACKING_PAUSED_SEALED));
    }

    Ok(None)
}

pub(super) async fn seal_active_sessions_for_continuity_timeout(
    data: &dyn TrackingDataStore,
    window: &tracker::WindowInfo,
    now_ms: i64,
    continuity_window_secs: u64,
) -> Result<Option<&'static str>, TrackingDataError> {
    if !has_exceeded_continuity_window(window, continuity_window_secs) {
        return Ok(None);
    }

    let resolved_end_time =
        resolve_continuity_window_end_time(now_ms, window.idle_time_ms, continuity_window_secs);

    if data.end_active_sessions(resolved_end_time).await? {
        return Ok(Some(TRACKING_REASON_CONTINUITY_WINDOW_SEALED));
    }

    Ok(None)
}

pub(super) async fn seal_active_sessions_for_passive_participation_timeout(
    data: &dyn TrackingDataStore,
    window: &tracker::WindowInfo,
    now_ms: i64,
    sustained_participation_secs: u64,
) -> Result<Option<&'static str>, TrackingDataError> {
    if !has_exceeded_sustained_participation_window(window, sustained_participation_secs) {
        return Ok(None);
    }

    let resolved_end_time = resolve_sustained_participation_end_time(
        now_ms,
        window.idle_time_ms,
        sustained_participation_secs,
    );

    if data.end_active_sessions(resolved_end_time).await? {
        return Ok(Some(TRACKING_REASON_PASSIVE_PARTICIPATION_SEALED));
    }

    Ok(None)
}

pub(super) fn should_suspend_active_tracking(
    previous_window: Option<&tracker::WindowInfo>,
    current_window: &tracker::WindowInfo,
    continuity_window_secs: u64,
    tracking_status: &TrackingStatusSnapshot,
) -> bool {
    if tracking_status.sustained_participation_active {
        return false;
    }

    if current_window.is_afk
        || !has_exceeded_continuity_window(current_window, continuity_window_secs)
    {
        return false;
    }

    let Some(previous_identity) = transition::resolve_window_session_identity(previous_window)
    else {
        return false;
    };
    let Some(current_identity) = transition::resolve_window_session_identity(Some(current_window))
    else {
        return false;
    };

    previous_identity.is_same_app(&current_identity)
}

pub(super) fn should_seal_sustained_participation(
    previous_window: Option<&tracker::WindowInfo>,
    previous_tracking_status: Option<&TrackingStatusSnapshot>,
    current_window: &tracker::WindowInfo,
    tracking_status: &TrackingStatusSnapshot,
) -> bool {
    if tracking_status.sustained_participation_state != SustainedParticipationState::Expired {
        return false;
    }

    if !previous_tracking_status
        .map(|status| status.sustained_participation_active)
        .unwrap_or(false)
    {
        return false;
    }

    let Some(previous_identity) = transition::resolve_window_session_identity(previous_window)
    else {
        return false;
    };
    let Some(current_identity) = WindowSessionIdentity::from_window_fields(
        &current_window.exe_name,
        current_window.process_id,
        &current_window.root_owner_hwnd,
        &current_window.hwnd,
        &current_window.window_class,
    ) else {
        return false;
    };

    previous_identity.is_same_app(&current_identity)
}

fn has_exceeded_continuity_window(
    window: &tracker::WindowInfo,
    continuity_window_secs: u64,
) -> bool {
    let continuity_window_ms = continuity_window_ms(continuity_window_secs);
    continuity_window_ms >= 0 && i64::from(window.idle_time_ms) > continuity_window_ms
}

fn has_exceeded_sustained_participation_window(
    window: &tracker::WindowInfo,
    sustained_participation_secs: u64,
) -> bool {
    let sustained_participation_window_ms =
        sustained_participation_window_ms(sustained_participation_secs);
    sustained_participation_window_ms >= 0
        && i64::from(window.idle_time_ms) > sustained_participation_window_ms
}

fn resolve_continuity_window_end_time(
    now_ms: i64,
    idle_time_ms: u32,
    continuity_window_secs: u64,
) -> i64 {
    now_ms - i64::from(idle_time_ms) + continuity_window_ms(continuity_window_secs)
}

fn resolve_sustained_participation_end_time(
    now_ms: i64,
    idle_time_ms: u32,
    sustained_participation_secs: u64,
) -> i64 {
    now_ms - i64::from(idle_time_ms)
        + sustained_participation_window_ms(sustained_participation_secs)
}

fn continuity_window_ms(continuity_window_secs: u64) -> i64 {
    continuity_window_secs
        .saturating_mul(1000)
        .min(i64::MAX as u64) as i64
}

fn sustained_participation_window_ms(sustained_participation_secs: u64) -> i64 {
    sustained_participation_secs
        .saturating_mul(1000)
        .min(i64::MAX as u64) as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema as db_schema;
    use crate::data::tracking_runtime::TrackingRuntimeDataStore;
    use crate::domain::tracking::SustainedParticipationStatusReason;
    use crate::engine::tracking::active_session;
    use sqlx::{Executor, SqlitePool};

    fn make_window(overrides: &[(&str, &str)]) -> tracker::WindowInfo {
        let mut window = tracker::WindowInfo {
            hwnd: "0x100".into(),
            root_owner_hwnd: "0x100".into(),
            process_id: 123,
            window_class: "Chrome_WidgetWin_1".into(),
            title: "Window".into(),
            exe_name: "QQ.exe".into(),
            process_path: r"C:\Program Files\QQ\QQ.exe".into(),
            is_afk: false,
            idle_time_ms: 0,
        };

        for (key, value) in overrides {
            match *key {
                "hwnd" => window.hwnd = (*value).into(),
                "root_owner_hwnd" => window.root_owner_hwnd = (*value).into(),
                "process_id" => window.process_id = value.parse().unwrap(),
                "window_class" => window.window_class = (*value).into(),
                "title" => window.title = (*value).into(),
                "exe_name" => window.exe_name = (*value).into(),
                "process_path" => window.process_path = (*value).into(),
                "is_afk" => window.is_afk = *value == "true",
                "idle_time_ms" => window.idle_time_ms = value.parse().unwrap(),
                _ => {}
            }
        }

        window
    }

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    fn data_store(pool: &SqlitePool) -> TrackingRuntimeDataStore {
        TrackingRuntimeDataStore::new(pool.clone())
    }

    #[test]
    fn continuity_timeout_seals_active_session_at_continuity_boundary() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[("idle_time_ms", "300000")]);

            assert!(
                active_session::start_session(&pool, &make_window(&[]), 10_000)
                    .await
                    .unwrap()
            );

            let data = data_store(&pool);
            let reason = seal_active_sessions_for_continuity_timeout(&data, &window, 400_000, 180)
                .await
                .unwrap();

            let ended: Option<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL LIMIT 1",
            )
            .fetch_optional(&pool)
            .await
            .unwrap();

            assert_eq!(reason, Some(TRACKING_REASON_CONTINUITY_WINDOW_SEALED));
            assert_eq!(ended, Some((280_000, 270_000)));
        });
    }

    #[test]
    fn continuity_timeout_allows_same_app_to_start_new_session_after_input_returns() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let previous = make_window(&[]);
            let timed_out = make_window(&[("idle_time_ms", "240000")]);
            let resumed = make_window(&[("idle_time_ms", "1")]);

            assert!(active_session::start_session(&pool, &previous, 1_000)
                .await
                .unwrap());

            let data = data_store(&pool);
            let seal_reason =
                seal_active_sessions_for_continuity_timeout(&data, &timed_out, 300_000, 180)
                    .await
                    .unwrap();
            let recover_reason = transition::apply_window_transition(
                &data,
                Some(&timed_out),
                &resumed,
                301_000,
                301_000,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let sessions: Vec<(i64, i64, Option<i64>)> = sqlx::query_as(
                "SELECT start_time, continuity_group_start_time, end_time
                 FROM sessions
                 ORDER BY start_time ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(seal_reason, Some(TRACKING_REASON_CONTINUITY_WINDOW_SEALED));
            assert_eq!(recover_reason, Some("session-recovered"));
            assert_eq!(
                sessions,
                vec![(1_000, 1_000, Some(240_000)), (301_000, 301_000, None)]
            );
        });
    }

    #[test]
    fn sustained_participation_signal_skips_continuity_suspend() {
        let previous = make_window(&[("exe_name", "Zoom.exe"), ("idle_time_ms", "0")]);
        let current = make_window(&[("exe_name", "Zoom.exe"), ("idle_time_ms", "240000")]);
        let tracking_status = TrackingStatusSnapshot {
            is_tracking_active: true,
            sustained_participation_eligible: true,
            sustained_participation_active: true,
            sustained_participation_kind: None,
            ..TrackingStatusSnapshot::default()
        };

        assert!(!should_suspend_active_tracking(
            Some(&previous),
            &current,
            180,
            &tracking_status,
        ));
    }

    #[test]
    fn sustained_participation_timeout_seals_session_at_sustained_boundary() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let previous = make_window(&[("exe_name", "Zoom.exe"), ("idle_time_ms", "0")]);
            let timed_out = make_window(&[
                ("exe_name", "Zoom.exe"),
                ("idle_time_ms", "660000"),
                ("is_afk", "true"),
            ]);
            let expired_status = TrackingStatusSnapshot {
                sustained_participation_state: SustainedParticipationState::Expired,
                sustained_participation_reason:
                    SustainedParticipationStatusReason::SustainedWindowExpired,
                ..TrackingStatusSnapshot::default()
            };
            let previous_status = TrackingStatusSnapshot {
                sustained_participation_active: true,
                sustained_participation_state: SustainedParticipationState::Active,
                ..TrackingStatusSnapshot::default()
            };

            assert!(active_session::start_session(&pool, &previous, 10_000)
                .await
                .unwrap());
            assert!(should_seal_sustained_participation(
                Some(&previous),
                Some(&previous_status),
                &timed_out,
                &expired_status,
            ));

            let data = data_store(&pool);
            let reason = seal_active_sessions_for_passive_participation_timeout(
                &data, &timed_out, 700_000, 600,
            )
            .await
            .unwrap();

            let ended: Option<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL LIMIT 1",
            )
            .fetch_optional(&pool)
            .await
            .unwrap();

            assert_eq!(reason, Some(TRACKING_REASON_PASSIVE_PARTICIPATION_SEALED));
            assert_eq!(ended, Some((640_000, 630_000)));
        });
    }

    #[test]
    fn sustained_participation_timeout_supports_unknown_audio_signal_matches() {
        let previous = make_window(&[
            ("exe_name", "PotPlayerMini64.exe"),
            (
                "process_path",
                r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
            ),
            ("idle_time_ms", "0"),
        ]);
        let timed_out = make_window(&[
            ("exe_name", "PotPlayerMini64.exe"),
            (
                "process_path",
                r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
            ),
            ("idle_time_ms", "660000"),
            ("is_afk", "true"),
        ]);
        let expired_status = TrackingStatusSnapshot {
            sustained_participation_state: SustainedParticipationState::Expired,
            sustained_participation_reason:
                SustainedParticipationStatusReason::SustainedWindowExpired,
            ..TrackingStatusSnapshot::default()
        };
        let previous_status = TrackingStatusSnapshot {
            sustained_participation_active: true,
            sustained_participation_state: SustainedParticipationState::Active,
            ..TrackingStatusSnapshot::default()
        };

        assert!(should_seal_sustained_participation(
            Some(&previous),
            Some(&previous_status),
            &timed_out,
            &expired_status,
        ));
    }
}
