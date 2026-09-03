use super::ports::{TrackingDataError, TrackingDataStore};
use crate::domain::tracking::{
    self, WindowSessionIdentity, WindowTrackingCandidate, WindowTransitionDecision,
};
use crate::platform::windows::foreground as tracker;
use std::future::Future;
use std::pin::Pin;

pub(crate) type StartSessionFn =
    for<'a> fn(
        data: &'a dyn TrackingDataStore,
        window: &'a tracker::WindowInfo,
        start_time: i64,
        continuity_group_start_time: i64,
    ) -> Pin<Box<dyn Future<Output = Result<bool, TrackingDataError>> + Send + 'a>>;

#[cfg(test)]
pub(crate) async fn apply_window_transition(
    data: &dyn TrackingDataStore,
    previous_window: Option<&tracker::WindowInfo>,
    next_window: &tracker::WindowInfo,
    now_ms: i64,
    next_continuity_group_start_time: i64,
    start_session: StartSessionFn,
) -> Result<Option<&'static str>, TrackingDataError> {
    apply_window_transition_with_title_policy(
        data,
        previous_window,
        next_window,
        now_ms,
        next_continuity_group_start_time,
        true,
        start_session,
    )
    .await
}

pub(crate) async fn apply_window_transition_with_title_policy(
    data: &dyn TrackingDataStore,
    previous_window: Option<&tracker::WindowInfo>,
    next_window: &tracker::WindowInfo,
    now_ms: i64,
    next_continuity_group_start_time: i64,
    capture_window_title: bool,
    start_session: StartSessionFn,
) -> Result<Option<&'static str>, TrackingDataError> {
    let mut persisted_window = next_window.clone();
    if !capture_window_title {
        persisted_window.title.clear();
    }
    let decision = plan_window_transition(previous_window, next_window, now_ms);
    if !decision.has_mutation_plan() {
        if !is_trackable_window(Some(next_window)) {
            return Ok(None);
        }
        return recover_missing_active_session(
            data,
            &persisted_window,
            now_ms,
            next_continuity_group_start_time,
            start_session,
        )
        .await;
    }

    let mut did_mutate = false;

    if decision.should_end_previous {
        did_mutate |= data
            .end_active_sessions(decision.resolved_end_time(now_ms))
            .await?;
    }

    if decision.should_start_next {
        did_mutate |= start_session(
            data,
            &persisted_window,
            now_ms,
            next_continuity_group_start_time,
        )
        .await?;
    }

    if decision.should_refresh_metadata {
        did_mutate |= data
            .refresh_active_session_metadata(
                &persisted_window.exe_name,
                &persisted_window.title,
                now_ms,
            )
            .await?;
    }

    Ok(decision.mutation_reason(did_mutate))
}

pub(crate) async fn recover_missing_active_session(
    data: &dyn TrackingDataStore,
    window: &tracker::WindowInfo,
    now_ms: i64,
    continuity_group_start_time: i64,
    start_session: StartSessionFn,
) -> Result<Option<&'static str>, TrackingDataError> {
    if let Some(active) = data.load_active_session().await? {
        if active.exe_name.eq_ignore_ascii_case(&window.exe_name) {
            return Ok(data
                .refresh_active_session_metadata(&window.exe_name, &window.title, now_ms)
                .await?
                .then_some("session-metadata-refreshed"));
        }
    }

    if start_session(data, window, now_ms, continuity_group_start_time).await? {
        return Ok(Some("session-recovered"));
    }

    Ok(None)
}

pub(crate) fn plan_window_transition(
    previous_window: Option<&tracker::WindowInfo>,
    next_window: &tracker::WindowInfo,
    now_ms: i64,
) -> WindowTransitionDecision {
    let last_trackable = is_trackable_window(previous_window);
    let next_trackable = is_trackable_window(Some(next_window));
    let previous_identity = resolve_window_session_identity(previous_window);
    let next_identity = resolve_window_session_identity(Some(next_window));
    let app_changed = match (previous_identity.as_ref(), next_identity.as_ref()) {
        (Some(previous), Some(next)) => !previous.is_same_app(next),
        _ => last_trackable != next_trackable,
    };
    let instance_changed = match (previous_identity.as_ref(), next_identity.as_ref()) {
        (Some(previous), Some(next)) => !previous.is_same_instance(next),
        _ => false,
    };
    let tracking_state_changed = last_trackable != next_trackable;
    let did_change = app_changed || tracking_state_changed;
    let should_end_previous = last_trackable && did_change;
    let should_start_next = next_trackable && did_change;
    let title_changed = previous_window
        .map(|window| window.title != next_window.title)
        .unwrap_or(false);
    let should_refresh_metadata =
        !did_change && next_trackable && (title_changed || instance_changed);
    let reason = if app_changed {
        "session-transition-app-change"
    } else if tracking_state_changed {
        "session-transition-state-change"
    } else if should_refresh_metadata {
        "session-metadata-refreshed"
    } else if instance_changed {
        "session-instance-unchanged-app"
    } else {
        "session-no-change"
    };

    WindowTransitionDecision {
        reason,
        should_end_previous,
        should_start_next,
        should_refresh_metadata,
        end_time_override: if should_end_previous && !next_trackable && next_window.is_afk {
            Some(now_ms - i64::from(next_window.idle_time_ms))
        } else {
            None
        },
    }
}

pub(crate) fn resolve_window_session_identity(
    window: Option<&tracker::WindowInfo>,
) -> Option<WindowSessionIdentity> {
    let window = window?;
    if !is_trackable_window(Some(window)) {
        return None;
    }

    WindowSessionIdentity::from_window_fields(
        &window.exe_name,
        window.process_id,
        &window.root_owner_hwnd,
        &window.hwnd,
        &window.window_class,
    )
}

pub(crate) fn is_trackable_window(window: Option<&tracker::WindowInfo>) -> bool {
    tracking::is_trackable_window(window.map(to_tracking_candidate))
}

fn to_tracking_candidate(window: &tracker::WindowInfo) -> WindowTrackingCandidate<'_> {
    WindowTrackingCandidate::from_window_fields(
        &window.exe_name,
        &window.title,
        &window.window_class,
        window.is_afk,
    )
}

#[cfg(test)]
mod failure_recovery_tests {
    use super::*;
    use crate::data::{repositories::sessions, schema, tracking_runtime::TrackingRuntimeDataStore};
    use crate::engine::tracking::active_session::start_session_for_transition;
    use sqlx::{Executor, SqlitePool};

    fn window(exe: &str, title: &str) -> tracker::WindowInfo {
        tracker::WindowInfo {
            hwnd: "1".into(),
            root_owner_hwnd: "1".into(),
            process_id: 1,
            window_class: "Window".into(),
            title: title.into(),
            exe_name: exe.into(),
            process_path: String::new(),
            app_user_model_id: String::new(),
            is_afk: false,
            idle_time_ms: 0,
        }
    }

    #[test]
    fn failed_end_is_retried_and_failed_start_recovers_using_the_latest_window() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let a = window("a.exe", "A");
            let b = window("b.exe", "B");
            let c = window("c.exe", "C");
            sessions::start_session(&pool, "A", "a.exe", "A", 1_000, 1_000)
                .await
                .unwrap();
            pool.execute("CREATE TRIGGER reject_end BEFORE UPDATE OF end_time ON sessions BEGIN SELECT RAISE(FAIL, 'injected end failure'); END").await.unwrap();
            assert!(apply_window_transition(
                &data,
                Some(&a),
                &b,
                5_000,
                5_000,
                start_session_for_transition
            )
            .await
            .is_err());
            assert_eq!(
                data.load_active_session().await.unwrap().unwrap().exe_name,
                "a.exe"
            );
            pool.execute("DROP TRIGGER reject_end").await.unwrap();
            pool.execute("CREATE TRIGGER reject_start BEFORE INSERT ON sessions BEGIN SELECT RAISE(FAIL, 'injected start failure'); END").await.unwrap();
            assert!(apply_window_transition(
                &data,
                Some(&a),
                &b,
                6_000,
                6_000,
                start_session_for_transition
            )
            .await
            .is_err());
            assert!(data.load_active_session().await.unwrap().is_none());
            pool.execute("DROP TRIGGER reject_start").await.unwrap();
            apply_window_transition(
                &data,
                Some(&a),
                &c,
                7_000,
                7_000,
                start_session_for_transition,
            )
            .await
            .unwrap();
            let rows: Vec<(String, i64, Option<i64>)> =
                sqlx::query_as("SELECT exe_name, start_time, end_time FROM sessions ORDER BY id")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                rows,
                vec![
                    ("a.exe".into(), 1_000, Some(6_000)),
                    ("c.exe".into(), 7_000, None)
                ]
            );
        });
    }

    #[test]
    fn recovery_reconciles_wrong_app_and_retries_title_with_privacy_policy() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let b = window("b.exe", "private title");
            sessions::start_session(&pool, "A", "a.exe", "A", 1_000, 1_000)
                .await
                .unwrap();
            apply_window_transition_with_title_policy(
                &data,
                Some(&b),
                &b,
                5_000,
                5_000,
                false,
                start_session_for_transition,
            )
            .await
            .unwrap();
            let title: String =
                sqlx::query_scalar("SELECT window_title FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title, "");
            assert_eq!(
                data.load_active_session().await.unwrap().unwrap().exe_name,
                "b.exe"
            );
            pool.execute("CREATE TRIGGER reject_title BEFORE UPDATE OF window_title ON sessions BEGIN SELECT RAISE(FAIL, 'injected title failure'); END").await.unwrap();
            assert!(apply_window_transition(
                &data,
                Some(&b),
                &b,
                6_000,
                5_000,
                start_session_for_transition
            )
            .await
            .is_err());
            pool.execute("DROP TRIGGER reject_title").await.unwrap();
            apply_window_transition(
                &data,
                Some(&b),
                &b,
                7_000,
                5_000,
                start_session_for_transition,
            )
            .await
            .unwrap();
            let title: String =
                sqlx::query_scalar("SELECT window_title FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title, "private title");
            let count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE exe_name = 'b.exe'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(count, 1);
        });
    }
}

#[cfg(test)]
mod title_policy_tests {
    use super::*;
    use crate::data::schema as db_schema;
    use crate::data::tracking_runtime::TrackingRuntimeDataStore;
    use sqlx::{Executor, Row, SqlitePool};

    #[test]
    fn title_policy_masks_persistence_without_changing_trackability() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let window = tracker::WindowInfo {
                hwnd: "0x1".into(),
                root_owner_hwnd: "0x1".into(),
                process_id: 1,
                window_class: "Chrome_WidgetWin_1".into(),
                title: "Wallpaper Engine".into(),
                exe_name: "wallpaper32.exe".into(),
                process_path: "C:/wallpaper32.exe".into(),
                app_user_model_id: String::new(),
                is_afk: false,
                idle_time_ms: 0,
            };

            assert!(apply_window_transition_with_title_policy(
                &data,
                None,
                &window,
                1_000,
                1_000,
                false,
                crate::engine::tracking::active_session::start_session_for_transition,
            )
            .await
            .unwrap()
            .is_some());

            let row = sqlx::query("SELECT window_title, end_time FROM sessions LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(row.get::<String, _>("window_title"), "");
            assert_eq!(row.get::<Option<i64>, _>("end_time"), None);
        });
    }
}

#[cfg(test)]
mod packaged_app_transition_tests {
    use super::*;

    fn window(exe_name: &str, process_id: u32, root: &str, aumid: &str) -> tracker::WindowInfo {
        tracker::WindowInfo {
            hwnd: root.into(),
            root_owner_hwnd: root.into(),
            process_id,
            window_class: "ApplicationFrameWindow".into(),
            title: "Window".into(),
            exe_name: exe_name.into(),
            process_path: format!(r"C:\Program Files\WindowsApps\{exe_name}"),
            app_user_model_id: aumid.into(),
            is_afk: false,
            idle_time_ms: 0,
        }
    }

    #[test]
    fn unresolved_host_stays_out_of_tracking() {
        let host = window("ApplicationFrameHost.exe", 10, "0x100", "");

        assert!(!is_trackable_window(Some(&host)));
    }

    #[test]
    fn resolved_hosted_app_uses_existing_tracking_entry() {
        let store = window(
            "WinStore.App.exe",
            20,
            "0x100",
            "Microsoft.WindowsStore_8wekyb3d8bbwe!App",
        );

        assert!(is_trackable_window(Some(&store)));
        let decision = plan_window_transition(None, &store, 1_000);
        assert!(decision.should_start_next);
        assert!(!decision.should_end_previous);
    }

    #[test]
    fn same_packaged_executable_instance_change_does_not_split_session() {
        let previous = window(
            "WinStore.App.exe",
            20,
            "0x100",
            "Microsoft.WindowsStore_8wekyb3d8bbwe!App",
        );
        let next = window(
            "WinStore.App.exe",
            21,
            "0x200",
            "Microsoft.WindowsStore_8wekyb3d8bbwe!App",
        );

        let decision = plan_window_transition(Some(&previous), &next, 2_000);
        assert!(!decision.should_end_previous);
        assert!(!decision.should_start_next);
        assert!(decision.should_refresh_metadata);
    }

    #[test]
    fn different_packaged_apps_create_a_session_boundary() {
        let store = window(
            "WinStore.App.exe",
            20,
            "0x100",
            "Microsoft.WindowsStore_8wekyb3d8bbwe!App",
        );
        let calculator = window(
            "CalculatorApp.exe",
            30,
            "0x200",
            "Microsoft.WindowsCalculator_8wekyb3d8bbwe!App",
        );

        let decision = plan_window_transition(Some(&store), &calculator, 2_000);
        assert!(decision.should_end_previous);
        assert!(decision.should_start_next);
    }

    #[test]
    fn packaged_and_win32_apps_use_the_same_session_boundary() {
        let store = window(
            "WinStore.App.exe",
            20,
            "0x100",
            "Microsoft.WindowsStore_8wekyb3d8bbwe!App",
        );
        let chrome = window("chrome.exe", 40, "0x300", "");

        let decision = plan_window_transition(Some(&store), &chrome, 2_000);
        assert!(decision.should_end_previous);
        assert!(decision.should_start_next);
    }

    #[test]
    fn packaged_app_entering_afk_uses_existing_idle_boundary() {
        let previous = window(
            "WinStore.App.exe",
            20,
            "0x100",
            "Microsoft.WindowsStore_8wekyb3d8bbwe!App",
        );
        let mut afk = previous.clone();
        afk.is_afk = true;
        afk.idle_time_ms = 5_000;

        let decision = plan_window_transition(Some(&previous), &afk, 10_000);
        assert!(decision.should_end_previous);
        assert!(!decision.should_start_next);
        assert_eq!(decision.end_time_override, Some(5_000));
    }
}
