use super::ports::TrackingDataStore;
use super::transition;
use crate::domain::tracking::TrackingStatusSnapshot;
use crate::platform::windows::foreground as tracker;

#[derive(Clone, Debug)]
pub(crate) struct PendingContinuity {
    pub(crate) app_key: String,
    pub(crate) continuity_group_start_time: i64,
    pub(crate) expires_at_ms: i64,
}

pub(crate) async fn load_pending_continuity(
    data: &dyn TrackingDataStore,
    previous_window: Option<&tracker::WindowInfo>,
    previous_tracking_status: Option<&TrackingStatusSnapshot>,
    current_window: &tracker::WindowInfo,
    continuity_window_secs: u64,
    now_ms: i64,
) -> Option<PendingContinuity> {
    if !should_open_pending_continuity(previous_window, previous_tracking_status, current_window) {
        return None;
    }

    let previous_identity = transition::resolve_window_session_identity(previous_window)?;
    let active_session = data.load_active_session().await.ok().flatten()?;

    Some(PendingContinuity {
        app_key: previous_identity.app_key,
        continuity_group_start_time: active_session.continuity_group_start_time,
        expires_at_ms: now_ms + continuity_window_ms(continuity_window_secs),
    })
}

pub(crate) fn resolve_next_session_continuity_group_start_time(
    pending_continuity: Option<&PendingContinuity>,
    window: &tracker::WindowInfo,
    now_ms: i64,
) -> i64 {
    let Some(pending_continuity) = pending_continuity else {
        return now_ms;
    };

    if pending_continuity.expires_at_ms < now_ms {
        return now_ms;
    }

    let Some(current_identity) = transition::resolve_window_session_identity(Some(window)) else {
        return now_ms;
    };

    if current_identity.app_key != pending_continuity.app_key {
        return now_ms;
    }

    pending_continuity.continuity_group_start_time
}

pub(crate) fn resolve_next_pending_continuity(
    existing_pending_continuity: Option<PendingContinuity>,
    new_pending_continuity: Option<PendingContinuity>,
    continuity_group_start_time: i64,
    current_window: &tracker::WindowInfo,
    now_ms: i64,
) -> Option<PendingContinuity> {
    if let Some(new_pending_continuity) = new_pending_continuity {
        return Some(new_pending_continuity);
    }

    let existing_pending_continuity = existing_pending_continuity?;
    if existing_pending_continuity.expires_at_ms < now_ms {
        return None;
    }

    let Some(current_identity) = transition::resolve_window_session_identity(Some(current_window))
    else {
        return Some(existing_pending_continuity);
    };

    if current_identity.app_key == existing_pending_continuity.app_key
        && continuity_group_start_time == existing_pending_continuity.continuity_group_start_time
    {
        return None;
    }

    Some(existing_pending_continuity)
}

fn should_open_pending_continuity(
    previous_window: Option<&tracker::WindowInfo>,
    previous_tracking_status: Option<&TrackingStatusSnapshot>,
    current_window: &tracker::WindowInfo,
) -> bool {
    if !previous_tracking_status
        .map(|status| status.is_tracking_active)
        .unwrap_or(false)
        || current_window.is_afk
    {
        return false;
    }

    let Some(previous_identity) = transition::resolve_window_session_identity(previous_window)
    else {
        return false;
    };

    match transition::resolve_window_session_identity(Some(current_window)) {
        Some(current_identity) => !previous_identity.is_same_app(&current_identity),
        None => true,
    }
}

fn continuity_window_ms(continuity_window_secs: u64) -> i64 {
    continuity_window_secs
        .saturating_mul(1000)
        .min(i64::MAX as u64) as i64
}

#[cfg(test)]
mod tests {
    use super::{
        load_pending_continuity, resolve_next_pending_continuity,
        resolve_next_session_continuity_group_start_time,
    };
    use crate::data::schema as db_schema;
    use crate::data::tracking_runtime::TrackingRuntimeDataStore;
    use crate::domain::tracking::{SustainedParticipationKind, TrackingStatusSnapshot};
    use crate::engine::tracking::{active_session, transition};
    use crate::platform::windows::foreground as tracker;
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
    fn sustained_participation_short_app_switch_reuses_original_continuity_group() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = data_store(&pool);
            let video = make_window(&[
                ("exe_name", "Zoom.exe"),
                ("process_path", r"C:\Program Files\Zoom\Zoom.exe"),
            ]);
            let chat = make_window(&[
                ("exe_name", "QQ.exe"),
                ("process_path", r"C:\Program Files\QQ\QQ.exe"),
            ]);
            let resumed_video = make_window(&[
                ("exe_name", "Zoom.exe"),
                ("process_path", r"C:\Program Files\Zoom\Zoom.exe"),
                ("idle_time_ms", "1"),
            ]);
            let previous_status = TrackingStatusSnapshot {
                is_tracking_active: true,
                sustained_participation_eligible: true,
                sustained_participation_active: true,
                sustained_participation_kind: Some(SustainedParticipationKind::Audio),
                ..TrackingStatusSnapshot::default()
            };

            assert!(active_session::start_session(&pool, &video, 1_000)
                .await
                .unwrap());

            let pending = load_pending_continuity(
                &data,
                Some(&video),
                Some(&previous_status),
                &chat,
                180,
                10_000,
            )
            .await
            .unwrap();

            let switch_reason = transition::apply_window_transition(
                &data,
                Some(&video),
                &chat,
                10_000,
                10_000,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let return_continuity_group_start_time =
                resolve_next_session_continuity_group_start_time(
                    Some(&pending),
                    &resumed_video,
                    70_000,
                );
            let return_reason = transition::apply_window_transition(
                &data,
                Some(&chat),
                &resumed_video,
                70_000,
                return_continuity_group_start_time,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
                "SELECT exe_name, start_time, continuity_group_start_time, end_time
                 FROM sessions
                 ORDER BY start_time ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(switch_reason, Some("session-transition"));
            assert_eq!(return_reason, Some("session-transition"));
            assert_eq!(
                sessions,
                vec![
                    ("Zoom.exe".into(), 1_000, 1_000, Some(10_000)),
                    ("QQ.exe".into(), 10_000, 10_000, Some(70_000)),
                    ("Zoom.exe".into(), 70_000, 1_000, None),
                ]
            );
        });
    }

    #[test]
    fn sustained_participation_return_after_continuity_window_starts_new_group() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = data_store(&pool);
            let video = make_window(&[
                ("exe_name", "Zoom.exe"),
                ("process_path", r"C:\Program Files\Zoom\Zoom.exe"),
            ]);
            let chat = make_window(&[
                ("exe_name", "QQ.exe"),
                ("process_path", r"C:\Program Files\QQ\QQ.exe"),
            ]);
            let resumed_video = make_window(&[
                ("exe_name", "Zoom.exe"),
                ("process_path", r"C:\Program Files\Zoom\Zoom.exe"),
                ("idle_time_ms", "1"),
            ]);
            let previous_status = TrackingStatusSnapshot {
                is_tracking_active: true,
                sustained_participation_eligible: true,
                sustained_participation_active: true,
                sustained_participation_kind: Some(SustainedParticipationKind::Audio),
                ..TrackingStatusSnapshot::default()
            };

            assert!(active_session::start_session(&pool, &video, 1_000)
                .await
                .unwrap());

            let pending = load_pending_continuity(
                &data,
                Some(&video),
                Some(&previous_status),
                &chat,
                180,
                10_000,
            )
            .await
            .unwrap();

            let switch_reason = transition::apply_window_transition(
                &data,
                Some(&video),
                &chat,
                10_000,
                10_000,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let return_continuity_group_start_time =
                resolve_next_session_continuity_group_start_time(
                    Some(&pending),
                    &resumed_video,
                    250_000,
                );
            let return_reason = transition::apply_window_transition(
                &data,
                Some(&chat),
                &resumed_video,
                250_000,
                return_continuity_group_start_time,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
                "SELECT exe_name, start_time, continuity_group_start_time, end_time
                 FROM sessions
                 ORDER BY start_time ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(switch_reason, Some("session-transition"));
            assert_eq!(return_reason, Some("session-transition"));
            assert_eq!(
                sessions,
                vec![
                    ("Zoom.exe".into(), 1_000, 1_000, Some(10_000)),
                    ("QQ.exe".into(), 10_000, 10_000, Some(250_000)),
                    ("Zoom.exe".into(), 250_000, 250_000, None),
                ]
            );
        });
    }

    #[test]
    fn ordinary_short_app_switch_reuses_original_continuity_group() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = data_store(&pool);
            let coding = make_window(&[
                ("exe_name", "Code.exe"),
                (
                    "process_path",
                    r"C:\Program Files\Microsoft VS Code\Code.exe",
                ),
            ]);
            let chat = make_window(&[
                ("exe_name", "QQ.exe"),
                ("process_path", r"C:\Program Files\QQ\QQ.exe"),
            ]);
            let resumed_coding = make_window(&[
                ("exe_name", "Code.exe"),
                (
                    "process_path",
                    r"C:\Program Files\Microsoft VS Code\Code.exe",
                ),
                ("idle_time_ms", "1"),
            ]);
            let previous_status = TrackingStatusSnapshot {
                is_tracking_active: true,
                sustained_participation_eligible: false,
                sustained_participation_active: false,
                sustained_participation_kind: None,
                ..TrackingStatusSnapshot::default()
            };

            assert!(active_session::start_session(&pool, &coding, 1_000)
                .await
                .unwrap());

            let pending = load_pending_continuity(
                &data,
                Some(&coding),
                Some(&previous_status),
                &chat,
                180,
                10_000,
            )
            .await
            .unwrap();

            transition::apply_window_transition(
                &data,
                Some(&coding),
                &chat,
                10_000,
                10_000,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let return_continuity_group_start_time =
                resolve_next_session_continuity_group_start_time(
                    Some(&pending),
                    &resumed_coding,
                    70_000,
                );
            transition::apply_window_transition(
                &data,
                Some(&chat),
                &resumed_coding,
                70_000,
                return_continuity_group_start_time,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
                "SELECT exe_name, start_time, continuity_group_start_time, end_time
                 FROM sessions
                 ORDER BY start_time ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(
                sessions,
                vec![
                    ("Code.exe".into(), 1_000, 1_000, Some(10_000)),
                    ("QQ.exe".into(), 10_000, 10_000, Some(70_000)),
                    ("Code.exe".into(), 70_000, 1_000, None),
                ]
            );
        });
    }

    #[test]
    fn ordinary_return_after_continuity_window_starts_new_group() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = data_store(&pool);
            let coding = make_window(&[
                ("exe_name", "Code.exe"),
                (
                    "process_path",
                    r"C:\Program Files\Microsoft VS Code\Code.exe",
                ),
            ]);
            let chat = make_window(&[
                ("exe_name", "QQ.exe"),
                ("process_path", r"C:\Program Files\QQ\QQ.exe"),
            ]);
            let resumed_coding = make_window(&[
                ("exe_name", "Code.exe"),
                (
                    "process_path",
                    r"C:\Program Files\Microsoft VS Code\Code.exe",
                ),
                ("idle_time_ms", "1"),
            ]);
            let previous_status = TrackingStatusSnapshot {
                is_tracking_active: true,
                sustained_participation_eligible: false,
                sustained_participation_active: false,
                sustained_participation_kind: None,
                ..TrackingStatusSnapshot::default()
            };

            assert!(active_session::start_session(&pool, &coding, 1_000)
                .await
                .unwrap());

            let pending = load_pending_continuity(
                &data,
                Some(&coding),
                Some(&previous_status),
                &chat,
                180,
                10_000,
            )
            .await
            .unwrap();

            transition::apply_window_transition(
                &data,
                Some(&coding),
                &chat,
                10_000,
                10_000,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let return_continuity_group_start_time =
                resolve_next_session_continuity_group_start_time(
                    Some(&pending),
                    &resumed_coding,
                    250_000,
                );
            transition::apply_window_transition(
                &data,
                Some(&chat),
                &resumed_coding,
                250_000,
                return_continuity_group_start_time,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
                "SELECT exe_name, start_time, continuity_group_start_time, end_time
                 FROM sessions
                 ORDER BY start_time ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(
                sessions,
                vec![
                    ("Code.exe".into(), 1_000, 1_000, Some(10_000)),
                    ("QQ.exe".into(), 10_000, 10_000, Some(250_000)),
                    ("Code.exe".into(), 250_000, 250_000, None),
                ]
            );
        });
    }

    #[test]
    fn mixed_trackable_and_non_trackable_short_switch_reuses_original_continuity_group() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = data_store(&pool);
            let coding = make_window(&[
                ("exe_name", "Code.exe"),
                (
                    "process_path",
                    r"C:\Program Files\Microsoft VS Code\Code.exe",
                ),
            ]);
            let widget = make_window(&[
                ("exe_name", "SearchHost.exe"),
                ("process_path", r"C:\Windows\SystemApps\SearchHost.exe"),
            ]);
            let chat = make_window(&[
                ("exe_name", "QQ.exe"),
                ("process_path", r"C:\Program Files\QQ\QQ.exe"),
            ]);
            let resumed_coding = make_window(&[
                ("exe_name", "Code.exe"),
                (
                    "process_path",
                    r"C:\Program Files\Microsoft VS Code\Code.exe",
                ),
                ("idle_time_ms", "1"),
            ]);
            let previous_status = TrackingStatusSnapshot {
                is_tracking_active: true,
                sustained_participation_eligible: false,
                sustained_participation_active: false,
                sustained_participation_kind: None,
                ..TrackingStatusSnapshot::default()
            };

            assert!(active_session::start_session(&pool, &coding, 1_000)
                .await
                .unwrap());

            let pending = load_pending_continuity(
                &data,
                Some(&coding),
                Some(&previous_status),
                &widget,
                180,
                10_000,
            )
            .await
            .unwrap();

            transition::apply_window_transition(
                &data,
                Some(&coding),
                &widget,
                10_000,
                10_000,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let chat_continuity_group_start_time =
                resolve_next_session_continuity_group_start_time(Some(&pending), &chat, 40_000);
            transition::apply_window_transition(
                &data,
                Some(&widget),
                &chat,
                40_000,
                chat_continuity_group_start_time,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let pending_after_chat = resolve_next_pending_continuity(
                Some(pending),
                None,
                chat_continuity_group_start_time,
                &chat,
                40_000,
            )
            .unwrap();

            let continuity_group_start_time = resolve_next_session_continuity_group_start_time(
                Some(&pending_after_chat),
                &resumed_coding,
                70_000,
            );
            transition::apply_window_transition(
                &data,
                Some(&chat),
                &resumed_coding,
                70_000,
                continuity_group_start_time,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
                "SELECT exe_name, start_time, continuity_group_start_time, end_time
                 FROM sessions
                 ORDER BY start_time ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(
                sessions,
                vec![
                    ("Code.exe".into(), 1_000, 1_000, Some(10_000)),
                    ("QQ.exe".into(), 40_000, 40_000, Some(70_000)),
                    ("Code.exe".into(), 70_000, 1_000, None),
                ]
            );
        });
    }

    #[test]
    fn mixed_trackable_and_non_trackable_return_after_total_window_starts_new_group() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = data_store(&pool);
            let coding = make_window(&[
                ("exe_name", "Code.exe"),
                (
                    "process_path",
                    r"C:\Program Files\Microsoft VS Code\Code.exe",
                ),
            ]);
            let widget = make_window(&[
                ("exe_name", "SearchHost.exe"),
                ("process_path", r"C:\Windows\SystemApps\SearchHost.exe"),
            ]);
            let chat = make_window(&[
                ("exe_name", "QQ.exe"),
                ("process_path", r"C:\Program Files\QQ\QQ.exe"),
            ]);
            let resumed_coding = make_window(&[
                ("exe_name", "Code.exe"),
                (
                    "process_path",
                    r"C:\Program Files\Microsoft VS Code\Code.exe",
                ),
                ("idle_time_ms", "1"),
            ]);
            let previous_status = TrackingStatusSnapshot {
                is_tracking_active: true,
                sustained_participation_eligible: false,
                sustained_participation_active: false,
                sustained_participation_kind: None,
                ..TrackingStatusSnapshot::default()
            };

            assert!(active_session::start_session(&pool, &coding, 1_000)
                .await
                .unwrap());

            let pending = load_pending_continuity(
                &data,
                Some(&coding),
                Some(&previous_status),
                &widget,
                180,
                10_000,
            )
            .await
            .unwrap();

            transition::apply_window_transition(
                &data,
                Some(&coding),
                &widget,
                10_000,
                10_000,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let chat_continuity_group_start_time =
                resolve_next_session_continuity_group_start_time(Some(&pending), &chat, 100_000);
            transition::apply_window_transition(
                &data,
                Some(&widget),
                &chat,
                100_000,
                chat_continuity_group_start_time,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let pending_after_chat = resolve_next_pending_continuity(
                Some(pending),
                None,
                chat_continuity_group_start_time,
                &chat,
                100_000,
            )
            .unwrap();

            let continuity_group_start_time = resolve_next_session_continuity_group_start_time(
                Some(&pending_after_chat),
                &resumed_coding,
                220_000,
            );
            transition::apply_window_transition(
                &data,
                Some(&chat),
                &resumed_coding,
                220_000,
                continuity_group_start_time,
                active_session::start_session_for_transition,
            )
            .await
            .unwrap();

            let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
                "SELECT exe_name, start_time, continuity_group_start_time, end_time
                 FROM sessions
                 ORDER BY start_time ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(
                sessions,
                vec![
                    ("Code.exe".into(), 1_000, 1_000, Some(10_000)),
                    ("QQ.exe".into(), 100_000, 100_000, Some(220_000)),
                    ("Code.exe".into(), 220_000, 220_000, None),
                ]
            );
        });
    }
}
