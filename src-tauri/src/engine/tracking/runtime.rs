use super::session_timeout::{
    seal_active_sessions_for_continuity_timeout,
    seal_active_sessions_for_passive_participation_timeout,
    seal_active_sessions_for_tracking_pause, should_seal_sustained_participation,
    should_suspend_active_tracking,
};
use super::sustained_participation::{
    SustainedParticipationRuntimeState,
};
use super::{active_session, continuity, startup, transition, watchdog};
use crate::data::sqlite_pool::wait_for_sqlite_pool;
#[cfg(test)]
use crate::data::repositories::{sessions, tracker_settings};
#[cfg(test)]
use crate::domain::tracking::TRACKING_REASON_TRACKING_PAUSED_SEALED;
#[cfg(test)]
use crate::domain::tracking::TrackingDataChangedPayload;
use crate::domain::tracking::TrackingStatusSnapshot;
use crate::platform::windows::foreground as tracker;
use sqlx::{Pool, Sqlite};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Runtime};
use tokio::time::{sleep, Duration};

#[path = "runtime/loop_state.rs"]
mod loop_state;
#[path = "runtime/power_lifecycle.rs"]
mod power_lifecycle;
#[path = "runtime/support.rs"]
mod support;
#[path = "runtime/window_polling.rs"]
mod window_polling;

use loop_state::{
    load_tracking_loop_state, persist_tracker_runtime_timestamps, CurrentTrackingSnapshotData,
};
use power_lifecycle::apply_power_lifecycle_event;
pub use support::emit_tracking_data_changed;
use support::{log_tracker_error, now_ms};
use window_polling::poll_active_window_with_timeout;

pub async fn run<R: Runtime>(
    app: AppHandle<R>,
    health_state: Arc<watchdog::RuntimeHealthState>,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(&app).await?;
    startup::initialize_tracker(&app, &pool)
        .await
        .map_err(|error| format!("tracker initialization failed: {error}"))?;

    let mut last_window: Option<tracker::WindowInfo> = None;
    let mut last_tracking_status: Option<TrackingStatusSnapshot> = None;
    let mut last_emitted_window: Option<tracker::WindowInfo> = None;
    let mut pending_continuity: Option<continuity::PendingContinuity> = None;
    let mut sustained_participation_state = SustainedParticipationRuntimeState::default();

    loop {
        let window_info = poll_active_window_with_timeout().await?;
        let now_ms = now_ms();
        health_state.note_successful_sample(now_ms);
        persist_tracker_runtime_timestamps(&pool, now_ms).await;
        let (tracking_state, next_sustained_participation_state) =
            load_tracking_loop_state(&pool, &window_info, now_ms, &sustained_participation_state)
                .await;
        sustained_participation_state = next_sustained_participation_state;
        let tracked_window = tracking_state.tracked_window;
        let continuity_group_start_time =
            continuity::resolve_next_session_continuity_group_start_time(
                pending_continuity.as_ref(),
                &tracked_window,
                now_ms,
            );
        let new_pending_continuity = continuity::load_pending_continuity(
            &pool,
            last_window.as_ref(),
            last_tracking_status.as_ref(),
            &tracked_window,
            tracking_state.continuity_window_secs,
            now_ms,
        )
        .await;

        if tracking_state.tracking_paused {
            match seal_active_sessions_for_tracking_pause(&pool, now_ms).await {
                Ok(Some(reason)) => {
                    let _ = emit_tracking_data_changed(&app, reason, now_ms as u64);
                }
                Ok(None) => {}
                Err(error) => {
                    log_tracker_error(format!("failed to seal session while paused: {error}"));
                }
            }

            pending_continuity = None;
            last_window = Some(tracked_window);
            last_tracking_status = Some(tracking_state.tracking_status);
            sleep(Duration::from_secs(1)).await;
            continue;
        }

        if should_seal_sustained_participation(
            last_window.as_ref(),
            last_tracking_status.as_ref(),
            &tracked_window,
            &tracking_state.tracking_status,
        ) {
            match seal_active_sessions_for_passive_participation_timeout(
                &pool,
                &tracked_window,
                now_ms,
                tracking_state.sustained_participation_secs,
            )
            .await
            {
                Ok(Some(reason)) => {
                    let _ = emit_tracking_data_changed(&app, reason, now_ms as u64);
                }
                Ok(None) => {}
                Err(error) => {
                    log_tracker_error(format!(
                        "failed to seal session for passive participation timeout: {error}"
                    ));
                }
            }

            last_window = Some(tracked_window);
            last_tracking_status = Some(tracking_state.tracking_status);
            sleep(Duration::from_secs(1)).await;
            continue;
        }

        if should_suspend_active_tracking(
            last_window.as_ref(),
            &tracked_window,
            tracking_state.continuity_window_secs,
            &tracking_state.tracking_status,
        ) {
            match seal_active_sessions_for_continuity_timeout(
                &pool,
                &tracked_window,
                now_ms,
                tracking_state.continuity_window_secs,
            )
            .await
            {
                Ok(Some(reason)) => {
                    let _ = emit_tracking_data_changed(&app, reason, now_ms as u64);
                }
                Ok(None) => {}
                Err(error) => {
                    log_tracker_error(format!(
                        "failed to seal session for continuity timeout: {error}"
                    ));
                }
            }

            last_window = Some(tracked_window);
            last_tracking_status = Some(tracking_state.tracking_status);
            sleep(Duration::from_secs(1)).await;
            continue;
        }

        if tracker::has_meaningful_change(last_emitted_window.as_ref(), &window_info) {
            let _ = app.emit("active-window-changed", &window_info);
            last_emitted_window = Some(window_info.clone());
        }

        match transition::apply_window_transition(
            &pool,
            last_window.as_ref(),
            &tracked_window,
            now_ms,
            continuity_group_start_time,
            active_session::start_session_for_transition,
        )
        .await
        {
            Ok(Some(reason)) => {
                let _ = emit_tracking_data_changed(&app, reason, now_ms as u64);
            }
            Ok(None) => {}
            Err(error) => {
                log_tracker_error(format!("failed to apply window transition: {error}"));
            }
        }

        pending_continuity = continuity::resolve_next_pending_continuity(
            pending_continuity,
            new_pending_continuity,
            continuity_group_start_time,
            &tracked_window,
            now_ms,
        );
        last_window = Some(tracked_window);
        last_tracking_status = Some(tracking_state.tracking_status);
        sleep(Duration::from_secs(1)).await;
    }
}

pub async fn load_current_tracking_snapshot(
    pool: &Pool<Sqlite>,
) -> Result<CurrentTrackingSnapshotData, String> {
    let window_info = poll_active_window_with_timeout().await?;
    let (tracking_state, _) = load_tracking_loop_state(
        pool,
        &window_info,
        now_ms(),
        &SustainedParticipationRuntimeState::default(),
    )
    .await;

    Ok(CurrentTrackingSnapshotData {
        window: tracking_state.tracked_window,
        status: tracking_state.tracking_status,
    })
}

pub async fn handle_power_lifecycle_event<R: Runtime>(
    app: AppHandle<R>,
    state: &str,
    timestamp_ms: i64,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(&app).await?;
    let reason = apply_power_lifecycle_event(&pool, state, timestamp_ms)
        .await
        .map_err(|error| format!("power lifecycle transition failed: {error}"))?;

    if let Some(reason) = reason {
        let _ = emit_tracking_data_changed(&app, reason, timestamp_ms as u64);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::migrations as db_schema;
    use serde_json::json;
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
        pool.execute(db_schema::MIGRATION_1_SQL).await.unwrap();
        pool.execute(db_schema::MIGRATION_2_SQL).await.unwrap();
        pool.execute(db_schema::MIGRATION_3_SQL).await.unwrap();
        pool.execute(db_schema::MIGRATION_4_SQL).await.unwrap();
        pool.execute(db_schema::MIGRATION_5_SQL).await.unwrap();
        pool.execute(db_schema::MIGRATION_6_SQL).await.unwrap();
        pool.execute(db_schema::MIGRATION_7_SQL).await.unwrap();
        pool
    }

    #[test]
    fn afk_transition_backdates_end_without_starting_new_session() {
        let previous = make_window(&[]);
        let next = make_window(&[
            ("exe_name", "explorer.exe"),
            ("process_path", r"C:\Windows\explorer.exe"),
            ("is_afk", "true"),
            ("idle_time_ms", "300000"),
        ]);

        let decision = transition::plan_window_transition(Some(&previous), &next, 1_000_000);

        assert!(decision.should_end_previous);
        assert!(!decision.should_start_next);
        assert!(!decision.should_refresh_metadata);
        assert_eq!(decision.end_time_override, Some(700_000));
    }

    #[test]
    fn same_app_different_window_refreshes_metadata_without_splitting_session() {
        let previous = make_window(&[
            ("hwnd", "0x100"),
            ("root_owner_hwnd", "0x100"),
            ("title", "Window A"),
        ]);
        let next = make_window(&[
            ("hwnd", "0x200"),
            ("root_owner_hwnd", "0x200"),
            ("title", "Window B"),
        ]);

        let decision = transition::plan_window_transition(Some(&previous), &next, 1_000_000);

        assert_eq!(decision.reason, "session-metadata-refreshed");
        assert!(!decision.should_end_previous);
        assert!(!decision.should_start_next);
        assert!(decision.should_refresh_metadata);
    }

    #[test]
    fn lock_screen_processes_are_not_trackable() {
        assert!(!crate::domain::tracking::should_track("LockApp.exe"));
        assert!(!crate::domain::tracking::should_track("LogonUI.exe"));
        assert!(!crate::domain::tracking::should_track("time-tracker.exe"));
        assert!(!crate::domain::tracking::should_track("un.exe"));
        assert!(!crate::domain::tracking::should_track("SearchHost.exe"));
        assert!(!crate::domain::tracking::should_track("ShellHost.exe"));
        assert!(!crate::domain::tracking::should_track(
            "ShellExperienceHost.exe"
        ));
        assert!(!crate::domain::tracking::should_track("Consent.exe"));
        assert!(!crate::domain::tracking::should_track("PickerHost.exe"));
        assert!(!crate::domain::tracking::should_track("openwith.exe"));
        assert!(!crate::domain::tracking::should_track("SearchUXHost.exe"));
        assert!(!crate::domain::tracking::should_track(
            "FooExperienceHost.exe"
        ));
        assert!(!crate::domain::tracking::should_track("svchost.exe"));
    }

    #[test]
    fn lifecycle_utility_processes_are_not_trackable() {
        assert!(!crate::domain::tracking::should_track("uninstall.exe"));
        assert!(!crate::domain::tracking::should_track("unins000.exe"));
        assert!(!crate::domain::tracking::should_track("obsidian-setup.exe"));
        assert!(!crate::domain::tracking::should_track(
            "cursor-installer.exe"
        ));
        assert!(!crate::domain::tracking::should_track("cursor-updater.exe"));
        assert!(!crate::domain::tracking::should_track(
            "maintenancetool.exe"
        ));
        assert!(crate::domain::tracking::should_track("Antigravity.exe"));
    }

    #[test]
    fn lifecycle_utility_window_titles_are_not_trackable_for_versioned_installers() {
        let installer = make_window(&[
            ("exe_name", "alma-0.0.750-win-x64.exe"),
            ("title", "Alma 安装"),
        ]);
        let app = make_window(&[("exe_name", "Alma.exe"), ("title", "Alma")]);

        assert!(!transition::is_trackable_window(Some(&installer)));
        assert!(transition::is_trackable_window(Some(&app)));
    }

    #[test]
    fn watchdog_seal_only_triggers_once_per_stale_sample() {
        assert!(!watchdog::should_watchdog_seal(None, None, 20_000));
        assert!(!watchdog::should_watchdog_seal(Some(10_000), None, 18_000));
        assert!(watchdog::should_watchdog_seal(Some(10_000), None, 18_001));
        assert!(!watchdog::should_watchdog_seal(
            Some(10_000),
            Some(10_000),
            25_000
        ));
        assert!(watchdog::should_watchdog_seal(
            Some(12_000),
            Some(10_000),
            21_000
        ));
    }

    #[test]
    fn app_title_capture_override_defaults_to_enabled() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            let enabled =
                tracker_settings::load_capture_window_title_setting_for_app(&pool, "QQ.exe")
                    .await
                    .unwrap();

            assert!(enabled);
        });
    }

    #[test]
    fn app_title_capture_override_can_disable_title_recording() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let key = format!("{}qq.exe", tracker_settings::APP_OVERRIDE_KEY_PREFIX);
            let value = serde_json::to_string(&json!({
                "captureTitle": false,
                "enabled": true
            }))
            .unwrap();

            sqlx::query(
                "INSERT INTO settings (key, value) VALUES (?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(key)
            .bind(value)
            .execute(&pool)
            .await
            .unwrap();

            let enabled =
                tracker_settings::load_capture_window_title_setting_for_app(&pool, "QQ.exe")
                    .await
                    .unwrap();

            assert!(!enabled);
        });
    }

    #[test]
    fn tracking_payload_contracts_are_stable() {
        let payload =
            serde_json::to_value(TrackingDataChangedPayload::new("session-transition", 123))
                .unwrap();

        assert_eq!(
            payload,
            json!({
                "reason": "session-transition",
                "changed_at_ms": 123
            })
        );

        let window_payload = serde_json::to_value(make_window(&[])).unwrap();
        assert_eq!(window_payload["hwnd"], "0x100");
        assert_eq!(window_payload["root_owner_hwnd"], "0x100");
        assert_eq!(window_payload["process_id"], 123);
        assert_eq!(window_payload["window_class"], "Chrome_WidgetWin_1");
        assert_eq!(window_payload["title"], "Window");
        assert_eq!(window_payload["exe_name"], "QQ.exe");
        assert_eq!(
            window_payload["process_path"],
            r"C:\Program Files\QQ\QQ.exe"
        );
        assert_eq!(window_payload["is_afk"], false);
        assert_eq!(window_payload["idle_time_ms"], 0);
    }

    #[test]
    fn migration_dedupes_multiple_active_sessions() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(db_schema::MIGRATION_1_SQL).await.unwrap();
            pool.execute(
                "INSERT INTO sessions (app_name, exe_name, window_title, start_time)
                 VALUES ('QQ', 'QQ.exe', 'Chat A', 1000),
                        ('QQ', 'QQ.exe', 'Chat B', 2000)",
            )
            .await
            .unwrap();

            pool.execute(db_schema::MIGRATION_3_SQL).await.unwrap();

            let active_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            let sealed_duration: i64 =
                sqlx::query_scalar("SELECT duration FROM sessions WHERE start_time = 1000")
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            assert_eq!(active_count, 1);
            assert_eq!(sealed_duration, 0);
        });
    }

    #[test]
    fn start_session_preserves_single_active_session() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[]);

            assert!(active_session::start_session(&pool, &window, 1_000)
                .await
                .unwrap());
            assert!(!active_session::start_session(&pool, &window, 2_000)
                .await
                .unwrap());

            let active_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            assert_eq!(active_count, 1);
        });
    }

    #[test]
    fn missing_active_session_is_recovered_without_window_change() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[]);

            let reason = transition::apply_window_transition(
                &pool,
                Some(&window),
                &window,
                5_000,
                5_000,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let active_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            assert_eq!(reason, Some("session-recovered"));
            assert_eq!(active_count, 1);
        });
    }

    #[test]
    fn metadata_refresh_updates_active_session_title() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let original = make_window(&[("title", "Window A")]);
            let updated = make_window(&[
                ("hwnd", "0x200"),
                ("root_owner_hwnd", "0x200"),
                ("title", "Window B"),
            ]);

            assert!(active_session::start_session(&pool, &original, 1_000)
                .await
                .unwrap());

            let reason = transition::apply_window_transition(
                &pool,
                Some(&original),
                &updated,
                5_000,
                5_000,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let latest_title: String = sqlx::query_scalar(
                "SELECT window_title FROM sessions WHERE end_time IS NULL LIMIT 1",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(reason, Some("session-metadata-refreshed"));
            assert_eq!(latest_title, "Window B");
        });
    }

    #[test]
    fn lock_event_seals_active_session_immediately() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[]);

            assert!(active_session::start_session(&pool, &window, 1_000)
                .await
                .unwrap());

            let reason = apply_power_lifecycle_event(&pool, "lock", 5_000)
                .await
                .unwrap();

            let ended: Option<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL LIMIT 1",
            )
            .fetch_optional(&pool)
            .await
            .unwrap();

            assert_eq!(reason, Some("session-ended-lock"));
            assert_eq!(ended, Some((5_000, 4_000)));
        });
    }

    #[test]
    fn unlock_event_does_not_mutate_sessions() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let reason = apply_power_lifecycle_event(&pool, "unlock", 5_000)
                .await
                .unwrap();

            let active_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            assert_eq!(reason, None);
            assert_eq!(active_count, 0);
        });
    }

    #[test]
    fn suspend_event_seals_active_session_immediately() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[]);

            assert!(active_session::start_session(&pool, &window, 1_000)
                .await
                .unwrap());

            let reason = apply_power_lifecycle_event(&pool, "suspend", 5_000)
                .await
                .unwrap();

            let ended: Option<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL LIMIT 1",
            )
            .fetch_optional(&pool)
            .await
            .unwrap();

            assert_eq!(reason, Some("session-ended-suspend"));
            assert_eq!(ended, Some((5_000, 4_000)));
        });
    }

    #[test]
    fn resume_event_does_not_mutate_sessions() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let reason = apply_power_lifecycle_event(&pool, "resume", 5_000)
                .await
                .unwrap();

            let active_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            assert_eq!(reason, None);
            assert_eq!(active_count, 0);
        });
    }

    #[test]
    fn tracking_pause_seals_active_session_and_returns_pause_reason() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[]);

            assert!(active_session::start_session(&pool, &window, 1_000)
                .await
                .unwrap());

            let reason = seal_active_sessions_for_tracking_pause(&pool, 5_000)
                .await
                .unwrap();

            let ended: Option<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL LIMIT 1",
            )
            .fetch_optional(&pool)
            .await
            .unwrap();

            assert_eq!(reason, Some(TRACKING_REASON_TRACKING_PAUSED_SEALED));
            assert_eq!(ended, Some((5_000, 4_000)));
        });
    }

    #[test]
    fn tracking_pause_without_active_session_is_a_noop() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            let reason = seal_active_sessions_for_tracking_pause(&pool, 5_000)
                .await
                .unwrap();

            let active_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();

            assert_eq!(reason, None);
            assert_eq!(active_count, 0);
        });
    }

    #[test]
    fn lock_after_tracking_pause_does_not_double_seal_closed_session() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[]);

            assert!(active_session::start_session(&pool, &window, 1_000)
                .await
                .unwrap());
            let pause_reason = seal_active_sessions_for_tracking_pause(&pool, 5_000)
                .await
                .unwrap();
            let lock_reason = apply_power_lifecycle_event(&pool, "lock", 8_000)
                .await
                .unwrap();

            let ended_sessions: Vec<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(pause_reason, Some(TRACKING_REASON_TRACKING_PAUSED_SEALED));
            assert_eq!(lock_reason, None);
            assert_eq!(ended_sessions, vec![(5_000, 4_000)]);
        });
    }

    #[test]
    fn tracking_pause_after_lock_is_a_noop_for_already_closed_session() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[]);

            assert!(active_session::start_session(&pool, &window, 1_000)
                .await
                .unwrap());
            let lock_reason = apply_power_lifecycle_event(&pool, "lock", 5_000)
                .await
                .unwrap();
            let pause_reason = seal_active_sessions_for_tracking_pause(&pool, 8_000)
                .await
                .unwrap();

            let ended_sessions: Vec<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(lock_reason, Some("session-ended-lock"));
            assert_eq!(pause_reason, None);
            assert_eq!(ended_sessions, vec![(5_000, 4_000)]);
        });
    }

    #[test]
    fn lock_after_startup_seal_is_a_noop_for_already_closed_session() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[]);

            assert!(active_session::start_session(&pool, &window, 1_000)
                .await
                .unwrap());
            tracker_settings::save_tracker_timestamp(
                &pool,
                tracker_settings::TRACKER_LAST_HEARTBEAT_KEY,
                8_000,
            )
            .await
            .unwrap();

            let startup_reason = startup::seal_startup_active_session_in_pool(&pool, 20_000)
                .await
                .unwrap();
            let lock_reason = apply_power_lifecycle_event(&pool, "lock", 25_000)
                .await
                .unwrap();

            let ended_sessions: Vec<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(startup_reason, Some(8_000));
            assert_eq!(lock_reason, None);
            assert_eq!(ended_sessions, vec![(8_000, 7_000)]);
        });
    }

    #[test]
    fn suspend_after_startup_seal_is_a_noop_for_already_closed_session() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[]);

            assert!(active_session::start_session(&pool, &window, 1_000)
                .await
                .unwrap());
            tracker_settings::save_tracker_timestamp(
                &pool,
                tracker_settings::TRACKER_LAST_HEARTBEAT_KEY,
                8_000,
            )
            .await
            .unwrap();

            let startup_reason = startup::seal_startup_active_session_in_pool(&pool, 20_000)
                .await
                .unwrap();
            let suspend_reason = apply_power_lifecycle_event(&pool, "suspend", 25_000)
                .await
                .unwrap();

            let ended_sessions: Vec<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(startup_reason, Some(8_000));
            assert_eq!(suspend_reason, None);
            assert_eq!(ended_sessions, vec![(8_000, 7_000)]);
        });
    }

    #[test]
    fn tracking_pause_after_startup_seal_is_a_noop_for_already_closed_session() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let window = make_window(&[]);

            assert!(active_session::start_session(&pool, &window, 1_000)
                .await
                .unwrap());
            tracker_settings::save_tracker_timestamp(
                &pool,
                tracker_settings::TRACKER_LAST_HEARTBEAT_KEY,
                8_000,
            )
            .await
            .unwrap();

            let startup_reason = startup::seal_startup_active_session_in_pool(&pool, 20_000)
                .await
                .unwrap();
            let pause_reason = seal_active_sessions_for_tracking_pause(&pool, 25_000)
                .await
                .unwrap();

            let ended_sessions: Vec<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(startup_reason, Some(8_000));
            assert_eq!(pause_reason, None);
            assert_eq!(ended_sessions, vec![(8_000, 7_000)]);
        });
    }

    #[test]
    fn startup_self_heal_normalizes_closed_session_duration() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            pool.execute(
                "INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
                 VALUES ('QQ', 'QQ.exe', 'Chat', 1000, 5000, 99)",
            )
            .await
            .unwrap();

            let affected = sessions::normalize_closed_session_durations(&pool)
                .await
                .unwrap();
            let duration: i64 = sqlx::query_scalar("SELECT duration FROM sessions LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();

            assert_eq!(affected, 1);
            assert_eq!(duration, 4000);
        });
    }
}
