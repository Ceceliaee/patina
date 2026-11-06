use crate::domain::tools::{
    CompletedPomodoroNotification, PomodoroPhase, PomodoroStatus, ToolPomodoroRun,
    ToolRuntimeSettings,
};
use sqlx::{Pool, Sqlite, Transaction};

#[cfg(test)]
mod activity_extensions_tests;
mod activity_reminders;
#[cfg(test)]
mod activity_unique_target_tests;
mod backup_restore;
pub(crate) mod focus_history;
pub(crate) mod free_focus;
pub(crate) mod notification_preferences;
pub(crate) mod pomodoro_tasks;
mod read;
pub(crate) mod timed_reminders;

pub use activity_reminders::{
    create_activity_reminder_rule, disable_activity_reminder_rule, extend_activity_reminder,
    fire_due_activity_reminders, merge_activity_reminder_rules, set_activity_reminder_enabled,
    update_activity_reminder_limit,
};
pub(crate) use read::fetch_all_activity_reminder_rules;
pub use read::fetch_tools_snapshot;

pub use backup_restore::{
    fetch_all_daily_stats_for_backup, fetch_all_pomodoro_runs_for_backup,
    fetch_all_reminders_for_backup, insert_missing_for_restore,
};

use read::{fetch_latest_pomodoro, fetch_pomodoro_by_id};

pub async fn load_tool_runtime_settings(
    _pool: &Pool<Sqlite>,
) -> Result<ToolRuntimeSettings, sqlx::Error> {
    Ok(ToolRuntimeSettings::default())
}

pub async fn start_pomodoro(
    pool: &Pool<Sqlite>,
    focus_ms: i64,
    short_break_ms: i64,
    long_break_ms: i64,
    long_break_every: i64,
    now_ms: i64,
) -> Result<ToolPomodoroRun, String> {
    let focus_ms = focus_ms.max(1_000);
    let short_break_ms = short_break_ms.max(1_000);
    let long_break_ms = long_break_ms.max(1_000);
    let long_break_every = long_break_every.clamp(2, 12);
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    free_focus::pause_active(&mut tx, now_ms).await?;
    sqlx::query("UPDATE tool_pomodoro_runs SET status='paused', phase_remaining_ms=MAX(0,
        COALESCE(phase_remaining_ms, CASE phase WHEN 'focus' THEN focus_ms WHEN 'short_break' THEN short_break_ms ELSE long_break_ms END)
        - MAX(0, ? - COALESCE(phase_started_at, ?))), phase_started_at=NULL, phase_paused_at=?, updated_at=? WHERE status='running'")
        .bind(now_ms).bind(now_ms).bind(now_ms).bind(now_ms).execute(&mut *tx).await.map_err(|error|error.to_string())?;
    let result = sqlx::query(
        "INSERT INTO tool_pomodoro_runs (
            phase, status, cycle_index, focus_ms, short_break_ms, long_break_ms,
            long_break_every, phase_started_at, phase_paused_at, phase_remaining_ms,
            completed_focus_count, created_at, updated_at
         ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)",
    )
    .bind(PomodoroPhase::Focus.as_str())
    .bind(PomodoroStatus::Running.as_str())
    .bind(focus_ms)
    .bind(short_break_ms)
    .bind(long_break_ms)
    .bind(long_break_every)
    .bind(now_ms)
    .bind(focus_ms)
    .bind(now_ms)
    .bind(now_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to start pomodoro: {error}"))?;
    sqlx::query("INSERT INTO tool_pomodoro_tasks(run_id,label) VALUES(?,'')")
        .bind(result.last_insert_rowid())
        .execute(&mut *tx)
        .await
        .map_err(|error| error.to_string())?;
    tx.commit().await.map_err(|error| error.to_string())?;
    fetch_pomodoro_by_id(pool, result.last_insert_rowid()).await
}

pub async fn pause_pomodoro(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let Some(run) = fetch_latest_pomodoro(pool).await? else {
        return Ok(());
    };
    if run.status != PomodoroStatus::Running {
        return Ok(());
    }

    let remaining_ms = run.remaining_ms_at(now_ms);
    sqlx::query(
        "UPDATE tool_pomodoro_runs
         SET status = ?,
             phase_started_at = NULL,
             phase_paused_at = ?,
             phase_remaining_ms = ?,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(PomodoroStatus::Paused.as_str())
    .bind(now_ms)
    .bind(remaining_ms)
    .bind(now_ms)
    .bind(run.id)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to pause pomodoro: {error}"))?;
    Ok(())
}

pub async fn resume_pomodoro(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let Some(run) = fetch_latest_pomodoro(pool).await? else {
        return Ok(());
    };
    if !matches!(
        run.status,
        PomodoroStatus::Paused | PomodoroStatus::Completed
    ) {
        return Ok(());
    }
    pomodoro_tasks::apply(
        pool,
        crate::domain::tools::PomodoroTaskAction::Resume { id: run.id },
        now_ms,
        "",
    )
    .await
}

pub async fn skip_pomodoro_phase(
    pool: &Pool<Sqlite>,
    date_key: &str,
    now_ms: i64,
) -> Result<Option<CompletedPomodoroNotification>, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start pomodoro transaction: {error}"))?;
    let Some(run) = fetch_latest_pomodoro(&mut *tx).await? else {
        return Ok(None);
    };
    let outcome = advance_pomodoro_phase(&mut tx, run, date_key, now_ms, false, false).await?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit pomodoro transaction: {error}"))?;
    Ok(outcome)
}

pub async fn complete_due_pomodoro_phase(
    tx: &mut Transaction<'_, Sqlite>,
    date_key: &str,
    now_ms: i64,
) -> Result<Option<CompletedPomodoroNotification>, String> {
    let Some(run) = fetch_latest_pomodoro(&mut **tx).await? else {
        return Ok(None);
    };
    if !run.is_phase_due(now_ms) {
        return Ok(None);
    }

    if run.phase == PomodoroPhase::LongBreak {
        return pomodoro_tasks::complete_group(tx, &run, now_ms)
            .await
            .map(Some);
    }
    advance_pomodoro_phase(tx, run, date_key, now_ms, true, false).await
}

async fn advance_pomodoro_phase(
    tx: &mut Transaction<'_, Sqlite>,
    run: ToolPomodoroRun,
    date_key: &str,
    now_ms: i64,
    count_focus_completion: bool,
    start_next_phase: bool,
) -> Result<Option<CompletedPomodoroNotification>, String> {
    if run.status == PomodoroStatus::Idle || run.status == PomodoroStatus::Completed {
        return Ok(None);
    }

    let (next_phase, next_cycle_index, next_completed_focus_count) =
        if run.phase == PomodoroPhase::Focus && !count_focus_completion {
            let phase = if (run.completed_focus_count + 1) % run.long_break_every.max(1) == 0 {
                PomodoroPhase::LongBreak
            } else {
                PomodoroPhase::ShortBreak
            };
            let cycle_index = if phase == PomodoroPhase::LongBreak {
                run.long_break_every
            } else {
                (run.completed_focus_count + 1) % run.long_break_every.max(1)
            };
            (phase, cycle_index.max(1), run.completed_focus_count)
        } else {
            run.next_phase_after_completion()
        };
    let next_remaining_ms = match next_phase {
        PomodoroPhase::Focus => run.focus_ms,
        PomodoroPhase::ShortBreak => run.short_break_ms,
        PomodoroPhase::LongBreak => run.long_break_ms,
    };
    let next_status = if start_next_phase {
        PomodoroStatus::Running
    } else {
        PomodoroStatus::Paused
    };
    let next_started_at = (next_status == PomodoroStatus::Running).then_some(now_ms);
    let next_paused_at = (next_status == PomodoroStatus::Paused).then_some(now_ms);

    sqlx::query(
        "UPDATE tool_pomodoro_runs
         SET phase = ?,
             status = ?,
             cycle_index = ?,
             phase_started_at = ?,
             phase_paused_at = ?,
             phase_remaining_ms = ?,
             completed_focus_count = ?,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(next_phase.as_str())
    .bind(next_status.as_str())
    .bind(next_cycle_index)
    .bind(next_started_at)
    .bind(next_paused_at)
    .bind(next_remaining_ms)
    .bind(next_completed_focus_count)
    .bind(now_ms)
    .bind(run.id)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to advance pomodoro phase: {error}"))?;

    let counted_focus = count_focus_completion && run.phase == PomodoroPhase::Focus;
    if counted_focus {
        increment_daily_pomodoro_stat_tx(tx, date_key, now_ms).await?;
    }

    Ok(Some(CompletedPomodoroNotification {
        task: pomodoro_tasks::notification_task(tx, run.id).await?,
        run_id: run.id,
        completed_phase: run.phase,
        next_phase,
        completed_focus_count: next_completed_focus_count,
    }))
}

pub async fn reset_pomodoro(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let Some(run) = fetch_latest_pomodoro(pool).await? else {
        return Ok(());
    };

    sqlx::query(
        "UPDATE tool_pomodoro_runs
         SET phase = ?,
             status = ?,
             cycle_index = 1,
             phase_started_at = NULL,
             phase_paused_at = NULL,
             phase_remaining_ms = focus_ms,
             completed_focus_count = 0,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(PomodoroPhase::Focus.as_str())
    .bind(PomodoroStatus::Idle.as_str())
    .bind(now_ms)
    .bind(run.id)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to reset pomodoro: {error}"))?;
    Ok(())
}

async fn increment_daily_pomodoro_stat_tx(
    tx: &mut Transaction<'_, Sqlite>,
    date_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO tool_daily_stats (date_key, completed_pomodoros, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(date_key) DO UPDATE SET
             completed_pomodoros = completed_pomodoros + 1,
             updated_at = excluded.updated_at",
    )
    .bind(date_key)
    .bind(now_ms)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to update pomodoro daily stats: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::timed_reminders::*;
    use super::*;
    use crate::data::schema as db_schema;
    use crate::domain::tools::{
        ActivityReminderSuspensionReason, ActivityReminderTarget, ReminderStatus, ToolReminder,
    };
    use sqlx::{Executor, SqlitePool};

    async fn fire_due_reminders(
        pool: &Pool<Sqlite>,
        now_ms: i64,
    ) -> Result<Vec<ToolReminder>, String> {
        let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
        let result = super::timed_reminders::fire_due_reminders(&mut tx, now_ms).await?;
        tx.commit().await.map_err(|error| error.to_string())?;
        Ok(result)
    }

    async fn fire_due_activity_reminders(
        pool: &Pool<Sqlite>,
        date_key: &str,
        day_start_ms: i64,
        now_ms: i64,
    ) -> Result<Vec<crate::domain::tools::ActivityReminderNotification>, String> {
        let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
        let result = super::fire_due_activity_reminders(
            &mut tx,
            date_key,
            day_start_ms,
            now_ms,
            &[],
            &crate::domain::tools::ActivityReminderCheck::All,
        )
        .await?;
        tx.commit().await.map_err(|error| error.to_string())?;
        Ok(result.notifications)
    }

    async fn complete_due_pomodoro_phase(
        pool: &Pool<Sqlite>,
        date_key: &str,
        now_ms: i64,
    ) -> Result<Option<CompletedPomodoroNotification>, String> {
        let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
        let result = super::complete_due_pomodoro_phase(&mut tx, date_key, now_ms).await?;
        tx.commit().await.map_err(|error| error.to_string())?;
        Ok(result)
    }

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::TOOLS_TABLES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::POMODORO_TASKS_SQL).await.unwrap();
        pool.execute(db_schema::FREE_FOCUS_SQL).await.unwrap();
        pool.execute(db_schema::POMODORO_COMPLETIONS_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::ACTIVITY_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::ACTIVITY_REMINDER_EXTENSION_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::ACTIVITY_REMINDER_ENABLED_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::REMINDER_RECURRENCE_SQL)
            .await
            .unwrap();
        pool.execute(crate::data::schema::REMINDER_IDENTITY_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::ACTIVITY_REMINDER_UNIQUE_TARGET_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn created_reminder_can_be_read_in_snapshot() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            create_reminder(
                &pool,
                "'; DROP TABLE tool_reminders; --",
                2_000,
                None,
                1_000,
            )
            .await
            .unwrap();
            let snapshot = fetch_tools_snapshot(&pool, 1_000, "2026-06-07")
                .await
                .unwrap();

            assert_eq!(snapshot.reminders.len(), 1);
            assert_eq!(
                snapshot.reminders[0].label,
                "'; DROP TABLE tool_reminders; --"
            );
            assert_eq!(snapshot.next_reminder_at, Some(2_000));
        });
    }

    #[test]
    fn reminder_controls_preserve_identity_and_never_fire_paused_or_deleted_rows() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let reminder = create_reminder(&pool, "Break", 2_000, None, 1_000)
                .await
                .unwrap();
            update_reminder(&pool, reminder.id, "Break", 2_000, false, None, 1_500)
                .await
                .unwrap();
            let snapshot = fetch_tools_snapshot(&pool, 3_000, "2026-10-31")
                .await
                .unwrap();
            assert_eq!(snapshot.reminders[0].status, ReminderStatus::Paused);
            assert_eq!(snapshot.next_reminder_at, None);
            assert!(fire_due_reminders(&pool, 3_000).await.unwrap().is_empty());
            assert!(
                update_reminder(&pool, reminder.id, "Break", 2_000, true, None, 3_000)
                    .await
                    .is_err()
            );
            assert!(
                update_reminder(&pool, reminder.id, " ", 4_000, true, None, 3_000)
                    .await
                    .is_err()
            );
            update_reminder(&pool, reminder.id, "Revised", 4_000, false, None, 3_000)
                .await
                .unwrap();
            let backup = fetch_all_reminders_for_backup(&pool).await.unwrap();
            assert_eq!(backup[0].status, "paused");
            let restored = setup_test_db().await;
            let mut tx = restored.begin().await.unwrap();
            insert_missing_for_restore(&mut tx, &backup, &[], &[])
                .await
                .unwrap();
            tx.commit().await.unwrap();
            assert!(fire_due_reminders(&restored, 5_000)
                .await
                .unwrap()
                .is_empty());
            assert_eq!(
                fetch_tools_snapshot(&restored, 5_000, "2026-10-31")
                    .await
                    .unwrap()
                    .reminders[0]
                    .status,
                ReminderStatus::Paused
            );
            update_reminder(&pool, reminder.id, "Revised", 4_000, true, None, 3_000)
                .await
                .unwrap();
            let fired = fire_due_reminders(&pool, 4_001).await.unwrap();
            assert_eq!(fired[0].id, reminder.id);
            assert_eq!(fired[0].label, "Revised");
            assert!(
                update_reminder(&pool, reminder.id, "Again", 6_000, true, None, 5_000)
                    .await
                    .is_err()
            );
            let deleted = create_reminder(&pool, "Delete", 8_000, None, 5_000)
                .await
                .unwrap();
            update_reminder(&pool, deleted.id, "Delete", 8_000, false, None, 5_000)
                .await
                .unwrap();
            cancel_reminder(&pool, deleted.id, 5_000).await.unwrap();
            assert!(
                update_reminder(&pool, deleted.id, "Delete", 8_000, true, None, 5_000)
                    .await
                    .is_err()
            );
            assert!(fire_due_reminders(&pool, 9_000).await.unwrap().is_empty());
        });
    }

    #[test]
    fn paused_reminders_are_not_truncated_to_recent_history() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            for index in 0..30 {
                let reminder =
                    create_reminder(&pool, &format!("Reminder {index}"), 2_000, None, 1_000)
                        .await
                        .unwrap();
                update_reminder(
                    &pool,
                    reminder.id,
                    &reminder.label,
                    2_000,
                    false,
                    None,
                    1_000,
                )
                .await
                .unwrap();
            }
            assert_eq!(
                fetch_tools_snapshot(&pool, 3_000, "2026-10-31")
                    .await
                    .unwrap()
                    .reminders
                    .len(),
                30
            );
        });
    }

    #[test]
    fn due_reminder_fires_only_once() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            create_reminder(&pool, "Stand up", 1_000, None, 900)
                .await
                .unwrap();

            let first = fire_due_reminders(&pool, 1_100).await.unwrap();
            let second = fire_due_reminders(&pool, 1_200).await.unwrap();

            assert_eq!(first.len(), 1);
            assert_eq!(first[0].status, ReminderStatus::PendingConfirmation);
            assert!(second.is_empty());
        });
    }

    #[test]
    fn timed_reminder_completion_retains_history_and_backup_states() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            for index in 0..20 {
                create_reminder(&pool, &format!("History {index}"), 1_000, None, 900)
                    .await
                    .unwrap();
            }
            let due = fire_due_reminders(&pool, 1_100).await.unwrap();
            for row in due.iter().take(19) {
                resolve_reminder_alert(&pool, row.id, 1_100, None, 1_200)
                    .await
                    .unwrap();
                resolve_reminder_alert(&pool, row.id, 1_100, None, 1_300)
                    .await
                    .unwrap();
            }
            assert!(fire_due_reminders(&pool, 10_000).await.unwrap().is_empty());
            assert_eq!(pending_reminder_alerts(&pool).await.unwrap().len(), 1);
            let backup = fetch_all_reminders_for_backup(&pool).await.unwrap();
            let restored = setup_test_db().await;
            let mut tx = restored.begin().await.unwrap();
            insert_missing_for_restore(&mut tx, &backup, &[], &[])
                .await
                .unwrap();
            tx.commit().await.unwrap();
            let snapshot = fetch_tools_snapshot(&restored, 10_000, "2026-11-01")
                .await
                .unwrap();
            assert_eq!(
                snapshot.reminders.len(),
                20,
                "completed items must not fall out of a recent-history cap"
            );
            assert_eq!(
                snapshot
                    .reminders
                    .iter()
                    .filter(|row| row.status == ReminderStatus::Fired)
                    .count(),
                19
            );
            assert!(snapshot.next_reminder_at.is_none());
            assert_eq!(pending_reminder_alerts(&restored).await.unwrap().len(), 1);
            assert!(fire_due_reminders(&restored, 20_000)
                .await
                .unwrap()
                .is_empty());
            cancel_reminder(&pool, due[0].id, 2_000).await.unwrap();
            assert_eq!(
                fetch_tools_snapshot(&pool, 2_000, "2026-11-01")
                    .await
                    .unwrap()
                    .reminders
                    .len(),
                19
            );
            update_reminder(&pool, due[1].id, "Again", 30_000, true, None, 2_000)
                .await
                .unwrap();
            let again = fire_due_reminders(&pool, 30_000).await.unwrap();
            assert_eq!(again.len(), 1);
            assert_eq!(again[0].id, due[1].id);
        });
    }

    #[test]
    fn timed_reminder_snooze_preserves_identity_and_rejects_stale_confirmations() {
        tauri::async_runtime::block_on(async {
            for minutes in [5, 15, 30] {
                let pool = setup_test_db().await;
                let row = create_reminder(&pool, "Break", 1_000, None, 900)
                    .await
                    .unwrap();
                assert!(resolve_reminder_alert(&pool, row.id, 1_100, None, 1_000)
                    .await
                    .is_err());
                fire_due_reminders(&pool, 1_100).await.unwrap();
                for invalid in [0, 1, 60, u32::MAX] {
                    assert!(
                        resolve_reminder_alert(&pool, row.id, 1_100, Some(invalid), 2_000)
                            .await
                            .is_err()
                    );
                }
                assert!(resolve_reminder_alert(&pool, row.id, 1_099, None, 2_000)
                    .await
                    .is_err());
                resolve_reminder_alert(&pool, row.id, 1_100, Some(minutes), 2_000)
                    .await
                    .unwrap();
                // Retrying after a committed write must keep the original deadline.
                resolve_reminder_alert(&pool, row.id, 1_100, Some(minutes), 5_000)
                    .await
                    .unwrap();
                let deadline = 2_000 + i64::from(minutes) * 60_000;
                let snapshot = fetch_tools_snapshot(&pool, 5_000, "2026-11-01")
                    .await
                    .unwrap();
                assert_eq!(snapshot.reminders.len(), 1);
                assert_eq!(snapshot.reminders[0].id, row.id);
                assert_eq!(snapshot.next_reminder_at, Some(deadline));
                assert!(pending_reminder_alerts(&pool).await.unwrap().is_empty());
                assert!(fire_due_reminders(&pool, deadline - 1)
                    .await
                    .unwrap()
                    .is_empty());
                let again = fire_due_reminders(&pool, deadline).await.unwrap();
                assert_eq!(again.len(), 1);
                assert_eq!(again[0].id, row.id);
                assert!(resolve_reminder_alert(&pool, row.id, 1_100, None, deadline)
                    .await
                    .is_err());
                assert!(fire_due_reminders(&pool, deadline + 1)
                    .await
                    .unwrap()
                    .is_empty());
                cancel_reminder(&pool, row.id, deadline).await.unwrap();
                assert!(
                    resolve_reminder_alert(&pool, row.id, deadline, None, deadline)
                        .await
                        .is_err()
                );
            }
        });
    }

    #[test]
    fn app_activity_reminder_counts_today_usage_and_active_session_once() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO sessions (
                    app_name, exe_name, window_title, start_time, end_time, duration,
                    continuity_group_start_time
                 ) VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, NULL, NULL, ?)",
            )
            .bind("Editor")
            .bind("editor.exe")
            .bind("Doc")
            .bind(0_i64)
            .bind(40_000_i64)
            .bind(40_000_i64)
            .bind(0_i64)
            .bind("Editor")
            .bind("editor.exe")
            .bind("Doc")
            .bind(40_000_i64)
            .bind(40_000_i64)
            .execute(&pool)
            .await
            .unwrap();
            create_activity_reminder_rule(
                &pool,
                &ActivityReminderTarget::App {
                    app_name: "Editor".to_string(),
                    exe_name: Some("editor.exe".to_string()),
                },
                "Editor",
                60_000,
                "Take a break",
                900,
            )
            .await
            .unwrap();

            let first = fire_due_activity_reminders(&pool, "2026-06-07", 0, 70_000)
                .await
                .unwrap();
            let second = fire_due_activity_reminders(&pool, "2026-06-07", 0, 71_000)
                .await
                .unwrap();

            assert_eq!(first.len(), 1);
            assert_eq!(first[0].usage_ms, 70_000);
            assert_eq!(first[0].message, "Take a break");
            assert!(second.is_empty());
        });
    }

    #[test]
    fn activity_usage_clips_cross_midnight_active_and_future_segments() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES ('web_activity_enabled', 'true')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO sessions (
                    app_name, exe_name, window_title, start_time, end_time, duration,
                    continuity_group_start_time
                 ) VALUES
                    ('Editor', 'editor.exe', 'Before midnight', -30_000, 30_000, 60_000, -30_000),
                    ('Editor', 'editor.exe', 'Active', 60_000, NULL, NULL, 60_000),
                    ('Editor', 'editor.exe', 'Future', 100_000, 120_000, 20_000, 100_000)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO web_activity_segments (
                    browser_client_id, browser_kind, browser_exe_name, domain,
                    normalized_domain, start_time, end_time, duration, source, created_at, updated_at
                 ) VALUES
                    ('client', 'chromium', 'chrome.exe', 'Example.com', 'example.com',
                     -20_000, 40_000, 60_000, 'browser-extension', 0, 40_000),
                    ('client', 'chromium', 'chrome.exe', 'Example.com', 'example.com',
                     70_000, NULL, NULL, 'browser-extension', 70_000, 70_000),
                    ('client', 'chromium', 'chrome.exe', 'Example.com', 'example.com',
                     110_000, 130_000, 20_000, 'browser-extension', 110_000, 130_000)",
            )
            .execute(&pool)
            .await
            .unwrap();
            create_activity_reminder_rule(
                &pool,
                &ActivityReminderTarget::App {
                    app_name: "Editor".to_string(),
                    exe_name: Some("editor.exe".to_string()),
                },
                "Editor",
                60_000,
                "",
                1,
            )
            .await
            .unwrap();
            create_activity_reminder_rule(
                &pool,
                &ActivityReminderTarget::Web {
                    normalized_domain: "example.com".to_string(),
                },
                "Example",
                60_000,
                "",
                2,
            )
            .await
            .unwrap();

            let fired = fire_due_activity_reminders(&pool, "2026-06-07", 0, 100_000)
                .await
                .unwrap();

            assert_eq!(fired.len(), 2);
            assert_eq!(fired[0].usage_ms, 70_000);
            assert_eq!(fired[1].usage_ms, 70_000);
        });
    }

    #[test]
    fn category_rules_reclassify_existing_sessions_at_evaluation_time() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO sessions (
                    app_name, exe_name, window_title, start_time, end_time, duration,
                    continuity_group_start_time
                 ) VALUES ('Editor', 'editor.exe', 'Doc', 0, 70_000, 70_000, 0)",
            )
            .execute(&pool)
            .await
            .unwrap();
            create_activity_reminder_rule(
                &pool,
                &ActivityReminderTarget::Category {
                    category_id: "development".to_string(),
                },
                "Development",
                60_000,
                "",
                1,
            )
            .await
            .unwrap();

            assert!(fire_due_activity_reminders(&pool, "2026-06-07", 0, 80_000)
                .await
                .unwrap()
                .is_empty());
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES (
                    '__app_override::editor.exe',
                    '{\"category\":\"development\",\"enabled\":true}'
                 )",
            )
            .execute(&pool)
            .await
            .unwrap();

            let fired = fire_due_activity_reminders(&pool, "2026-06-07", 0, 80_000)
                .await
                .unwrap();
            assert_eq!(fired.len(), 1);
            assert_eq!(fired[0].usage_ms, 70_000);
        });
    }

    #[test]
    fn web_activity_rules_reject_unobserved_or_excluded_domains() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let target = ActivityReminderTarget::Web {
                normalized_domain: "example.com".to_string(),
            };
            let unobserved =
                create_activity_reminder_rule(&pool, &target, "Example", 60_000, "", 1)
                    .await
                    .unwrap_err();
            assert!(unobserved.contains("has not been observed"));

            sqlx::query(
                "INSERT INTO web_activity_segments (
                    browser_client_id, browser_kind, browser_exe_name, domain,
                    normalized_domain, start_time, end_time, duration, source, created_at, updated_at
                 ) VALUES ('client', 'chromium', 'chrome.exe', 'Example.com',
                           'example.com', 0, 10, 10, 'browser-extension', 0, 10)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES (
                    '__web_domain_override::example.com', '{\"enabled\":false}'
                 )",
            )
            .execute(&pool)
            .await
            .unwrap();
            let excluded = create_activity_reminder_rule(&pool, &target, "Example", 60_000, "", 2)
                .await
                .unwrap_err();
            assert!(excluded.contains("unavailable"));
        });
    }

    #[test]
    fn activity_rule_suspensions_follow_current_source_and_target_settings() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO web_activity_segments (
                    browser_client_id, browser_kind, browser_exe_name, domain,
                    normalized_domain, start_time, end_time, duration, source, created_at, updated_at
                 ) VALUES ('client', 'chromium', 'chrome.exe', 'Example.com',
                           'example.com', 0, 10, 10, 'browser-extension', 0, 10)",
            )
            .execute(&pool)
            .await
            .unwrap();
            let category = create_activity_reminder_rule(
                &pool,
                &ActivityReminderTarget::Category {
                    category_id: "development".to_string(),
                },
                "Development",
                60_000,
                "",
                1,
            )
            .await
            .unwrap();
            let web = create_activity_reminder_rule(
                &pool,
                &ActivityReminderTarget::Web {
                    normalized_domain: "example.com".to_string(),
                },
                "Example",
                60_000,
                "",
                2,
            )
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES
                    ('__deleted_category::development', '1'),
                    ('web_activity_enabled', 'false'),
                    ('__web_domain_override::example.com', '{\"enabled\":false}')",
            )
            .execute(&pool)
            .await
            .unwrap();

            let snapshot = fetch_tools_snapshot(&pool, 10, "2026-06-07").await.unwrap();
            let category_rule = snapshot
                .activity_reminder_rules
                .iter()
                .find(|rule| rule.id == category.id)
                .unwrap();
            let web_rule = snapshot
                .activity_reminder_rules
                .iter()
                .find(|rule| rule.id == web.id)
                .unwrap();
            assert_eq!(
                category_rule.suspension_reason,
                Some(ActivityReminderSuspensionReason::TargetDeleted)
            );
            assert_eq!(
                web_rule.suspension_reason,
                Some(ActivityReminderSuspensionReason::SourceDisabled)
            );

            sqlx::query("UPDATE settings SET value = 'true' WHERE key = 'web_activity_enabled'")
                .execute(&pool)
                .await
                .unwrap();
            let resumed_source = fetch_tools_snapshot(&pool, 11, "2026-06-07").await.unwrap();
            let web_rule = resumed_source
                .activity_reminder_rules
                .iter()
                .find(|rule| rule.id == web.id)
                .unwrap();
            assert_eq!(
                web_rule.suspension_reason,
                Some(ActivityReminderSuspensionReason::TargetExcluded)
            );
        });
    }

    #[test]
    fn category_and_web_activity_reminders_share_usage_facts_and_respect_exclusions() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES
                    ('__app_override::editor.exe', '{\"category\":\"development\",\"enabled\":true}'),
                    ('__app_override::excluded.exe', '{\"category\":\"development\",\"track\":false}'),
                    ('web_activity_enabled', 'true')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO sessions (
                    app_name, exe_name, window_title, start_time, end_time, duration,
                    continuity_group_start_time
                 ) VALUES
                    ('Editor', 'editor.exe', 'Doc', 0, 70_000, 70_000, 0),
                    ('Excluded', 'excluded.exe', 'Hidden', 0, 90_000, 90_000, 0)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO web_activity_segments (
                    browser_client_id, browser_kind, browser_exe_name, domain,
                    normalized_domain, start_time, end_time, duration, source, created_at, updated_at
                 ) VALUES ('client', 'chromium', 'chrome.exe', 'Example.com',
                           'example.com', 0, 80_000, 80_000, 'browser-extension', 0, 80_000)",
            )
            .execute(&pool)
            .await
            .unwrap();

            create_activity_reminder_rule(
                &pool,
                &ActivityReminderTarget::Category {
                    category_id: "development".to_string(),
                },
                "Development",
                60_000,
                "",
                900,
            )
            .await
            .unwrap();
            create_activity_reminder_rule(
                &pool,
                &ActivityReminderTarget::Web {
                    normalized_domain: "example.com".to_string(),
                },
                "Example",
                60_000,
                "Web break",
                901,
            )
            .await
            .unwrap();

            let first = fire_due_activity_reminders(&pool, "2026-06-07", 0, 100_000)
                .await
                .unwrap();
            let second = fire_due_activity_reminders(&pool, "2026-06-07", 0, 101_000)
                .await
                .unwrap();

            assert_eq!(first.len(), 2);
            assert_eq!(first[0].usage_ms, 70_000);
            assert_eq!(first[1].usage_ms, 80_000);
            assert!(second.is_empty());
        });
    }

    #[test]
    fn one_tick_evaluates_one_hundred_mixed_activity_rules() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES
                    ('__app_override::editor.exe', '{\"category\":\"development\",\"enabled\":true}'),
                    ('web_activity_enabled', 'true')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO sessions (
                    app_name, exe_name, window_title, start_time, end_time, duration,
                    continuity_group_start_time
                 ) VALUES ('Editor', 'editor.exe', 'Doc', 0, 70_000, 70_000, 0)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO web_activity_segments (
                    browser_client_id, browser_kind, browser_exe_name, domain,
                    normalized_domain, start_time, end_time, duration, source, created_at, updated_at
                 ) VALUES ('client', 'chromium', 'chrome.exe', 'Example.com',
                           'example.com', 0, 80_000, 80_000, 'browser-extension', 0, 80_000)",
            )
            .execute(&pool)
            .await
            .unwrap();

            for index in 0..100 {
                let target = match index {
                    98 => ActivityReminderTarget::Category {
                        category_id: "development".to_string(),
                    },
                    99 => ActivityReminderTarget::Web {
                        normalized_domain: "example.com".to_string(),
                    },
                    _ => {
                        let exe = format!("editor-{index}.exe");
                        sqlx::query("INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration) VALUES('Editor',?,0,70000,70000)")
                            .bind(&exe).execute(&pool).await.unwrap();
                        ActivityReminderTarget::App {
                            app_name: "Editor".to_string(),
                            exe_name: Some(exe),
                        }
                    }
                };
                create_activity_reminder_rule(&pool, &target, "Target", 60_000, "", index)
                    .await
                    .unwrap();
            }

            let fired = fire_due_activity_reminders(&pool, "2026-06-07", 0, 100_000)
                .await
                .unwrap();
            assert_eq!(fired.len(), 100);
        });
    }

    #[test]
    fn snapshot_merge_preserves_all_activity_targets_and_is_idempotent() {
        tauri::async_runtime::block_on(async {
            let source = setup_test_db().await;
            sqlx::query(
                "INSERT INTO web_activity_segments (
                    browser_client_id, browser_kind, browser_exe_name, domain,
                    normalized_domain, start_time, end_time, duration, source, created_at, updated_at
                 ) VALUES ('client', 'chromium', 'chrome.exe', 'Example.com',
                           'example.com', 0, 10, 10, 'browser-extension', 0, 10)",
            )
            .execute(&source)
            .await
            .unwrap();
            create_activity_reminder_rule(
                &source,
                &ActivityReminderTarget::App {
                    app_name: "Editor".to_string(),
                    exe_name: Some("editor.exe".to_string()),
                },
                "My editor",
                60_000,
                "App break",
                1_000,
            )
            .await
            .unwrap();
            let category = create_activity_reminder_rule(
                &source,
                &ActivityReminderTarget::Category {
                    category_id: "development".to_string(),
                },
                "Development",
                120_000,
                "Category break",
                1_001,
            )
            .await
            .unwrap();
            disable_activity_reminder_rule(&source, category.id, 1_100)
                .await
                .unwrap();
            create_activity_reminder_rule(
                &source,
                &ActivityReminderTarget::Web {
                    normalized_domain: "example.com".to_string(),
                },
                "Example",
                180_000,
                "Web break",
                1_002,
            )
            .await
            .unwrap();
            let rules = read::fetch_all_activity_reminder_rules(&source)
                .await
                .unwrap();

            let target = setup_test_db().await;
            sqlx::query(
                "INSERT INTO tool_activity_reminder_rules (
                    id, target_kind, app_name, exe_name, category_id, normalized_domain,
                    label_snapshot, limit_ms, message, created_at, updated_at
                 ) VALUES (1, 'web', NULL, NULL, NULL, 'existing.test',
                           'Existing', 60000, '', 9, 9)",
            )
            .execute(&target)
            .await
            .unwrap();
            for _ in 0..2 {
                let mut tx = target.begin().await.unwrap();
                merge_activity_reminder_rules(&mut tx, &rules)
                    .await
                    .unwrap();
                tx.commit().await.unwrap();
            }

            let rows: Vec<(String, String, Option<i64>)> = sqlx::query_as(
                "SELECT target_kind, label_snapshot, disabled_at
                 FROM tool_activity_reminder_rules ORDER BY created_at, id",
            )
            .fetch_all(&target)
            .await
            .unwrap();
            assert_eq!(rows.len(), 4);
            assert!(rows
                .iter()
                .any(|row| row.0 == "app" && row.1 == "My editor"));
            assert!(rows
                .iter()
                .any(|row| row.0 == "category" && row.2 == Some(1_100)));
            assert!(rows.iter().any(|row| row.0 == "web" && row.1 == "Example"));
        });
    }

    #[test]
    fn pomodoro_focus_completion_updates_daily_stats() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_pomodoro(&pool, 1_000, 500, 700, 4, 1_000)
                .await
                .unwrap();

            let completed = complete_due_pomodoro_phase(&pool, "2026-06-07", 2_100)
                .await
                .unwrap();
            let snapshot = fetch_tools_snapshot(&pool, 2_100, "2026-06-07")
                .await
                .unwrap();

            assert!(completed.is_some());
            assert_eq!(snapshot.today_completed_pomodoros, 1);
            let run = snapshot.current_pomodoro.unwrap();
            assert_eq!(run.phase, PomodoroPhase::ShortBreak);
            assert_eq!(run.status, PomodoroStatus::Paused);
            assert_eq!(run.phase_started_at, None);
            assert_eq!(run.phase_paused_at, Some(2_100));
            assert_eq!(run.remaining_ms_at(99_999), run.short_break_ms);
        });
    }

    #[test]
    fn pause_then_resume_pomodoro_restarts_current_phase() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_pomodoro(&pool, 1_000, 500, 700, 4, 1_000)
                .await
                .unwrap();

            pause_pomodoro(&pool, 1_400).await.unwrap();
            resume_pomodoro(&pool, 2_000).await.unwrap();

            let snapshot = fetch_tools_snapshot(&pool, 2_000, "2026-06-07")
                .await
                .unwrap();
            let run = snapshot.current_pomodoro.unwrap();
            assert_eq!(run.phase, PomodoroPhase::Focus);
            assert_eq!(run.status, PomodoroStatus::Running);
            assert_eq!(run.phase_started_at, Some(2_000));
            assert_eq!(run.phase_paused_at, None);
            assert_eq!(run.phase_remaining_ms, Some(600));
        });
    }

    #[test]
    fn skip_pomodoro_phase_pauses_next_phase() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_pomodoro(&pool, 1_000, 500, 700, 4, 1_000)
                .await
                .unwrap();

            skip_pomodoro_phase(&pool, "2026-06-07", 1_500)
                .await
                .unwrap();
            let snapshot = fetch_tools_snapshot(&pool, 1_500, "2026-06-07")
                .await
                .unwrap();

            assert_eq!(snapshot.today_completed_pomodoros, 0);
            let run = snapshot.current_pomodoro.unwrap();
            assert_eq!(run.phase, PomodoroPhase::ShortBreak);
            assert_eq!(run.status, PomodoroStatus::Paused);
            assert_eq!(run.phase_started_at, None);
            assert_eq!(run.phase_paused_at, Some(1_500));
        });
    }
}
