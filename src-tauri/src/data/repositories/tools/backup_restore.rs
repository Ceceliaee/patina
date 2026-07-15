use crate::domain::backup::{
    BackupToolDailyStats, BackupToolPomodoroRun, BackupToolReminder,
    BackupToolSoftwareReminderRule, BackupToolTimer, BackupToolTimerLap,
};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::HashMap;

pub async fn fetch_all_reminders_for_backup(
    pool: &Pool<Sqlite>,
) -> Result<Vec<BackupToolReminder>, String> {
    let rows = sqlx::query(
        "SELECT id, label, scheduled_at, created_at, status, fired_at, cancelled_at
         FROM tool_reminders
         ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read tool reminders for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupToolReminder {
            id: row.get("id"),
            label: row.get("label"),
            scheduled_at: row.get("scheduled_at"),
            created_at: row.get("created_at"),
            status: row.get("status"),
            fired_at: row.get("fired_at"),
            cancelled_at: row.get("cancelled_at"),
        })
        .collect())
}

pub async fn fetch_all_timers_for_backup(
    pool: &Pool<Sqlite>,
) -> Result<Vec<BackupToolTimer>, String> {
    let rows = sqlx::query(
        "SELECT id, mode, label, duration_ms, accumulated_ms, started_at, paused_at,
                completed_at, status, created_at, updated_at
         FROM tool_timers
         ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read tool timers for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupToolTimer {
            id: row.get("id"),
            mode: row.get("mode"),
            label: row.get("label"),
            duration_ms: row.get("duration_ms"),
            accumulated_ms: row.get("accumulated_ms"),
            started_at: row.get("started_at"),
            paused_at: row.get("paused_at"),
            completed_at: row.get("completed_at"),
            status: row.get("status"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect())
}

pub async fn fetch_all_timer_laps_for_backup(
    pool: &Pool<Sqlite>,
) -> Result<Vec<BackupToolTimerLap>, String> {
    let rows = sqlx::query(
        "SELECT id, timer_id, lap_index, started_at, ended_at, duration_ms
         FROM tool_timer_laps
         ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read tool timer laps for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupToolTimerLap {
            id: row.get("id"),
            timer_id: row.get("timer_id"),
            lap_index: row.get("lap_index"),
            started_at: row.get("started_at"),
            ended_at: row.get("ended_at"),
            duration_ms: row.get("duration_ms"),
        })
        .collect())
}

pub async fn fetch_all_pomodoro_runs_for_backup(
    pool: &Pool<Sqlite>,
) -> Result<Vec<BackupToolPomodoroRun>, String> {
    let rows = sqlx::query(
        "SELECT id, phase, status, cycle_index, focus_ms, short_break_ms, long_break_ms,
                long_break_every, phase_started_at, phase_paused_at, phase_remaining_ms,
                completed_focus_count, created_at, updated_at
         FROM tool_pomodoro_runs
         ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read tool pomodoro runs for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupToolPomodoroRun {
            id: row.get("id"),
            phase: row.get("phase"),
            status: row.get("status"),
            cycle_index: row.get("cycle_index"),
            focus_ms: row.get("focus_ms"),
            short_break_ms: row.get("short_break_ms"),
            long_break_ms: row.get("long_break_ms"),
            long_break_every: row.get("long_break_every"),
            phase_started_at: row.get("phase_started_at"),
            phase_paused_at: row.get("phase_paused_at"),
            phase_remaining_ms: row.get("phase_remaining_ms"),
            completed_focus_count: row.get("completed_focus_count"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect())
}

pub async fn fetch_all_daily_stats_for_backup(
    pool: &Pool<Sqlite>,
) -> Result<Vec<BackupToolDailyStats>, String> {
    let rows = sqlx::query(
        "SELECT date_key, completed_pomodoros, updated_at
         FROM tool_daily_stats
         ORDER BY date_key ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read tool daily stats for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupToolDailyStats {
            date_key: row.get("date_key"),
            completed_pomodoros: row.get("completed_pomodoros"),
            updated_at: row.get("updated_at"),
        })
        .collect())
}

pub async fn fetch_all_software_reminder_rules_for_backup(
    pool: &Pool<Sqlite>,
) -> Result<Vec<BackupToolSoftwareReminderRule>, String> {
    let rows = sqlx::query(
        "SELECT id, app_name, exe_name, limit_ms, message, created_at, updated_at,
                disabled_at, last_fired_date_key
         FROM tool_software_reminder_rules
         ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read software reminder rules for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupToolSoftwareReminderRule {
            id: row.get("id"),
            app_name: row.get("app_name"),
            exe_name: row.get("exe_name"),
            limit_ms: row.get("limit_ms"),
            message: row.get("message"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
            disabled_at: row.get("disabled_at"),
            last_fired_date_key: row.get("last_fired_date_key"),
        })
        .collect())
}

pub async fn clear_for_restore(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("DELETE FROM tool_software_reminder_rules")
        .execute(&mut **tx)
        .await
        .map_err(|error| {
            format!("failed to clear software reminder rules before restore: {error}")
        })?;
    sqlx::query("DELETE FROM tool_timer_laps")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear tool timer laps before restore: {error}"))?;
    sqlx::query("DELETE FROM tool_timers")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear tool timers before restore: {error}"))?;
    sqlx::query("DELETE FROM tool_reminders")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear tool reminders before restore: {error}"))?;
    sqlx::query("DELETE FROM tool_pomodoro_runs")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear tool pomodoro runs before restore: {error}"))?;
    sqlx::query("DELETE FROM tool_daily_stats")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear tool daily stats before restore: {error}"))?;
    Ok(())
}

pub async fn insert_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    reminders: &[BackupToolReminder],
    timers: &[BackupToolTimer],
    laps: &[BackupToolTimerLap],
    pomodoro_runs: &[BackupToolPomodoroRun],
    daily_stats: &[BackupToolDailyStats],
    software_reminder_rules: &[BackupToolSoftwareReminderRule],
) -> Result<(), String> {
    for rule in software_reminder_rules {
        sqlx::query(
            "INSERT INTO tool_software_reminder_rules (
                id, app_name, exe_name, limit_ms, message, created_at, updated_at,
                disabled_at, last_fired_date_key
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(rule.id)
        .bind(&rule.app_name)
        .bind(&rule.exe_name)
        .bind(rule.limit_ms)
        .bind(&rule.message)
        .bind(rule.created_at)
        .bind(rule.updated_at)
        .bind(rule.disabled_at)
        .bind(&rule.last_fired_date_key)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore software reminder rules: {error}"))?;
    }
    for reminder in reminders {
        sqlx::query(
            "INSERT INTO tool_reminders (id, label, scheduled_at, created_at, status, fired_at, cancelled_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(reminder.id)
        .bind(&reminder.label)
        .bind(reminder.scheduled_at)
        .bind(reminder.created_at)
        .bind(&reminder.status)
        .bind(reminder.fired_at)
        .bind(reminder.cancelled_at)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore tool reminders: {error}"))?;
    }

    for timer in timers {
        sqlx::query(
            "INSERT INTO tool_timers (
                id, mode, label, duration_ms, accumulated_ms, started_at, paused_at,
                completed_at, status, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(timer.id)
        .bind(&timer.mode)
        .bind(&timer.label)
        .bind(timer.duration_ms)
        .bind(timer.accumulated_ms)
        .bind(timer.started_at)
        .bind(timer.paused_at)
        .bind(timer.completed_at)
        .bind(&timer.status)
        .bind(timer.created_at)
        .bind(timer.updated_at)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore tool timers: {error}"))?;
    }

    for lap in laps {
        sqlx::query(
            "INSERT INTO tool_timer_laps (id, timer_id, lap_index, started_at, ended_at, duration_ms)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(lap.id)
        .bind(lap.timer_id)
        .bind(lap.lap_index)
        .bind(lap.started_at)
        .bind(lap.ended_at)
        .bind(lap.duration_ms)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore tool timer laps: {error}"))?;
    }

    for run in pomodoro_runs {
        sqlx::query(
            "INSERT INTO tool_pomodoro_runs (
                id, phase, status, cycle_index, focus_ms, short_break_ms, long_break_ms,
                long_break_every, phase_started_at, phase_paused_at, phase_remaining_ms,
                completed_focus_count, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(run.id)
        .bind(&run.phase)
        .bind(&run.status)
        .bind(run.cycle_index)
        .bind(run.focus_ms)
        .bind(run.short_break_ms)
        .bind(run.long_break_ms)
        .bind(run.long_break_every)
        .bind(run.phase_started_at)
        .bind(run.phase_paused_at)
        .bind(run.phase_remaining_ms)
        .bind(run.completed_focus_count)
        .bind(run.created_at)
        .bind(run.updated_at)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore tool pomodoro runs: {error}"))?;
    }

    for stat in daily_stats {
        sqlx::query(
            "INSERT INTO tool_daily_stats (date_key, completed_pomodoros, updated_at)
             VALUES (?, ?, ?)",
        )
        .bind(&stat.date_key)
        .bind(stat.completed_pomodoros)
        .bind(stat.updated_at)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore tool daily stats: {error}"))?;
    }

    Ok(())
}

pub async fn insert_missing_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    reminders: &[BackupToolReminder],
    timers: &[BackupToolTimer],
    laps: &[BackupToolTimerLap],
    pomodoro_runs: &[BackupToolPomodoroRun],
    daily_stats: &[BackupToolDailyStats],
    software_reminder_rules: &[BackupToolSoftwareReminderRule],
) -> Result<(), String> {
    for rule in software_reminder_rules {
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM tool_software_reminder_rules
             WHERE app_name = ? AND exe_name IS ? AND created_at = ?
             LIMIT 1",
        )
        .bind(&rule.app_name)
        .bind(&rule.exe_name)
        .bind(rule.created_at)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("failed to inspect software reminder rule merge: {error}"))?;
        if exists.is_none() {
            sqlx::query(
                "INSERT INTO tool_software_reminder_rules (
                    app_name, exe_name, limit_ms, message, created_at, updated_at,
                    disabled_at, last_fired_date_key
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&rule.app_name)
            .bind(&rule.exe_name)
            .bind(rule.limit_ms)
            .bind(&rule.message)
            .bind(rule.created_at)
            .bind(rule.updated_at)
            .bind(rule.disabled_at)
            .bind(&rule.last_fired_date_key)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to merge software reminder rules: {error}"))?;
        }
    }
    for reminder in reminders {
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM tool_reminders
             WHERE label = ? AND scheduled_at = ? AND created_at = ?
             LIMIT 1",
        )
        .bind(&reminder.label)
        .bind(reminder.scheduled_at)
        .bind(reminder.created_at)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("failed to inspect tool reminder merge: {error}"))?;
        if exists.is_none() {
            sqlx::query(
                "INSERT INTO tool_reminders (label, scheduled_at, created_at, status, fired_at, cancelled_at)
                 VALUES (?, ?, ?, ?, ?, ?)",
            )
            .bind(&reminder.label)
            .bind(reminder.scheduled_at)
            .bind(reminder.created_at)
            .bind(&reminder.status)
            .bind(reminder.fired_at)
            .bind(reminder.cancelled_at)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to merge restore tool reminders: {error}"))?;
        }
    }

    let mut timer_id_map = HashMap::new();
    for timer in timers {
        let existing_id: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM tool_timers
             WHERE mode = ? AND label IS ? AND duration_ms IS ? AND created_at = ?
             LIMIT 1",
        )
        .bind(&timer.mode)
        .bind(&timer.label)
        .bind(timer.duration_ms)
        .bind(timer.created_at)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("failed to inspect tool timer merge: {error}"))?;
        let target_id = match existing_id {
            Some(id) => id,
            None => sqlx::query(
                "INSERT INTO tool_timers (
                    mode, label, duration_ms, accumulated_ms, started_at, paused_at,
                    completed_at, status, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&timer.mode)
            .bind(&timer.label)
            .bind(timer.duration_ms)
            .bind(timer.accumulated_ms)
            .bind(timer.started_at)
            .bind(timer.paused_at)
            .bind(timer.completed_at)
            .bind(&timer.status)
            .bind(timer.created_at)
            .bind(timer.updated_at)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to merge restore tool timers: {error}"))?
            .last_insert_rowid(),
        };
        timer_id_map.insert(timer.id, target_id);
    }

    for lap in laps {
        let target_timer_id = timer_id_map.get(&lap.timer_id).copied().ok_or_else(|| {
            format!(
                "backup tool timer lap {} references missing timer {}",
                lap.id, lap.timer_id
            )
        })?;
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM tool_timer_laps
             WHERE timer_id = ? AND lap_index = ? AND started_at = ?
             LIMIT 1",
        )
        .bind(target_timer_id)
        .bind(lap.lap_index)
        .bind(lap.started_at)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("failed to inspect tool timer lap merge: {error}"))?;
        if exists.is_none() {
            sqlx::query(
                "INSERT INTO tool_timer_laps (timer_id, lap_index, started_at, ended_at, duration_ms)
                 VALUES (?, ?, ?, ?, ?)",
            )
            .bind(target_timer_id)
            .bind(lap.lap_index)
            .bind(lap.started_at)
            .bind(lap.ended_at)
            .bind(lap.duration_ms)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to merge restore tool timer laps: {error}"))?;
        }
    }

    for run in pomodoro_runs {
        let exists: Option<i64> = sqlx::query_scalar(
            "SELECT id FROM tool_pomodoro_runs
             WHERE created_at = ?
             LIMIT 1",
        )
        .bind(run.created_at)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("failed to inspect tool pomodoro merge: {error}"))?;
        if exists.is_none() {
            sqlx::query(
                "INSERT INTO tool_pomodoro_runs (
                    phase, status, cycle_index, focus_ms, short_break_ms, long_break_ms,
                    long_break_every, phase_started_at, phase_paused_at, phase_remaining_ms,
                    completed_focus_count, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&run.phase)
            .bind(&run.status)
            .bind(run.cycle_index)
            .bind(run.focus_ms)
            .bind(run.short_break_ms)
            .bind(run.long_break_ms)
            .bind(run.long_break_every)
            .bind(run.phase_started_at)
            .bind(run.phase_paused_at)
            .bind(run.phase_remaining_ms)
            .bind(run.completed_focus_count)
            .bind(run.created_at)
            .bind(run.updated_at)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to merge restore tool pomodoro runs: {error}"))?;
        }
    }

    for stat in daily_stats {
        sqlx::query(
            "INSERT OR IGNORE INTO tool_daily_stats (date_key, completed_pomodoros, updated_at)
             VALUES (?, ?, ?)",
        )
        .bind(&stat.date_key)
        .bind(stat.completed_pomodoros)
        .bind(stat.updated_at)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to merge restore tool daily stats: {error}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::repositories::tools::{
        add_timer_lap, complete_due_pomodoro_phase, create_reminder, create_software_reminder_rule,
        start_pomodoro, start_timer,
    };
    use crate::data::schema;
    use crate::domain::backup::{BackupToolTimer, BackupToolTimerLap};
    use crate::domain::tools::TimerMode;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn backup_restore_round_trips_tool_tables() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            create_reminder(&pool, "Check", 2_000, 1_000).await.unwrap();
            start_timer(&pool, TimerMode::Stopwatch, None, None, 1_000)
                .await
                .unwrap();
            add_timer_lap(&pool, 1_500).await.unwrap();
            start_pomodoro(&pool, 1_000, 500, 700, 4, 1_000)
                .await
                .unwrap();
            complete_due_pomodoro_phase(&pool, "2026-06-07", 2_100)
                .await
                .unwrap();
            create_software_reminder_rule(
                &pool,
                "Editor",
                Some("editor.exe"),
                60_000,
                "Take a break",
                1_000,
            )
            .await
            .unwrap();

            let reminders = fetch_all_reminders_for_backup(&pool).await.unwrap();
            let timers = fetch_all_timers_for_backup(&pool).await.unwrap();
            let laps = fetch_all_timer_laps_for_backup(&pool).await.unwrap();
            let pomodoros = fetch_all_pomodoro_runs_for_backup(&pool).await.unwrap();
            let stats = fetch_all_daily_stats_for_backup(&pool).await.unwrap();
            let software_rules = fetch_all_software_reminder_rules_for_backup(&pool)
                .await
                .unwrap();

            let mut tx = pool.begin().await.unwrap();
            clear_for_restore(&mut tx).await.unwrap();
            insert_for_restore(
                &mut tx,
                &reminders,
                &timers,
                &laps,
                &pomodoros,
                &stats,
                &software_rules,
            )
            .await
            .unwrap();
            tx.commit().await.unwrap();

            assert_eq!(
                fetch_all_reminders_for_backup(&pool).await.unwrap().len(),
                1
            );
            assert_eq!(fetch_all_timers_for_backup(&pool).await.unwrap().len(), 1);
            assert_eq!(
                fetch_all_timer_laps_for_backup(&pool).await.unwrap().len(),
                1
            );
            assert_eq!(
                fetch_all_pomodoro_runs_for_backup(&pool)
                    .await
                    .unwrap()
                    .len(),
                1
            );
            assert_eq!(
                fetch_all_daily_stats_for_backup(&pool).await.unwrap().len(),
                1
            );
            assert_eq!(
                fetch_all_software_reminder_rules_for_backup(&pool)
                    .await
                    .unwrap()
                    .len(),
                1
            );
        });
    }

    #[test]
    fn merge_restore_remaps_colliding_timer_ids_and_is_idempotent() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_timer(&pool, TimerMode::Stopwatch, None, Some("Current"), 1_000)
                .await
                .unwrap();
            let timers = vec![BackupToolTimer {
                id: 1,
                mode: "stopwatch".to_string(),
                label: Some("Backup".to_string()),
                duration_ms: None,
                accumulated_ms: 500,
                started_at: Some(2_000),
                paused_at: None,
                completed_at: None,
                status: "running".to_string(),
                created_at: 2_000,
                updated_at: 2_500,
            }];
            let laps = vec![BackupToolTimerLap {
                id: 1,
                timer_id: 1,
                lap_index: 1,
                started_at: 2_000,
                ended_at: 2_500,
                duration_ms: 500,
            }];

            for _ in 0..2 {
                let mut tx = pool.begin().await.unwrap();
                insert_missing_for_restore(&mut tx, &[], &timers, &laps, &[], &[], &[])
                    .await
                    .unwrap();
                tx.commit().await.unwrap();
            }

            let timer_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tool_timers")
                .fetch_one(&pool)
                .await
                .unwrap();
            let lap_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM tool_timer_laps")
                .fetch_one(&pool)
                .await
                .unwrap();
            let lap_owner: String = sqlx::query_scalar(
                "SELECT timers.label
                 FROM tool_timer_laps laps
                 JOIN tool_timers timers ON timers.id = laps.timer_id",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(timer_count, 2);
            assert_eq!(lap_count, 1);
            assert_eq!(lap_owner, "Backup");
        });
    }

    #[test]
    fn merge_restore_keeps_current_timer_state_for_stable_identity() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO tool_timers (
                    mode, label, accumulated_ms, status, created_at, updated_at
                 ) VALUES ('stopwatch', 'Same', 900, 'paused', 1000, 2000)",
            )
            .execute(&pool)
            .await
            .unwrap();
            let timers = vec![BackupToolTimer {
                id: 42,
                mode: "stopwatch".into(),
                label: Some("Same".into()),
                duration_ms: None,
                accumulated_ms: 100,
                started_at: Some(1_000),
                paused_at: None,
                completed_at: None,
                status: "running".into(),
                created_at: 1_000,
                updated_at: 1_100,
            }];
            let mut tx = pool.begin().await.unwrap();
            insert_missing_for_restore(&mut tx, &[], &timers, &[], &[], &[], &[])
                .await
                .unwrap();
            tx.commit().await.unwrap();
            let row: (i64, String) =
                sqlx::query_as("SELECT accumulated_ms, status FROM tool_timers")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(row, (900, "paused".to_string()));
        });
    }
}
