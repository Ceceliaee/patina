use crate::domain::backup::{BackupToolDailyStats, BackupToolPomodoroRun, BackupToolReminder};
use sqlx::{Pool, Row, Sqlite, Transaction};

pub async fn fetch_all_reminders_for_backup(
    pool: &Pool<Sqlite>,
) -> Result<Vec<BackupToolReminder>, String> {
    let recurrence_columns =
        if crate::data::schema_contracts::has_reminder_recurrence_schema(pool).await? {
            super::read::REMINDER_RECURRENCE_COLUMNS
        } else {
            "NULL AS recurrence, NULL AS recurrence_anchor_at"
        };
    let rows = sqlx::query(&format!(
        "SELECT id, label, scheduled_at, created_at, status, fired_at, cancelled_at, {recurrence_columns}
         FROM tool_reminders
         ORDER BY id ASC"
    ))
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read tool reminders for backup: {error}"))?;

    rows.into_iter()
        .map(|row| {
            let reminder = super::read::map_reminder_row(row)?;
            Ok(BackupToolReminder {
                label: reminder.label,
                scheduled_at: reminder.scheduled_at,
                created_at: reminder.created_at,
                status: reminder.status.as_str().into(),
                fired_at: reminder.fired_at,
                cancelled_at: reminder.cancelled_at,
                recurrence: reminder.recurrence,
                recurrence_anchor_at: reminder.recurrence_anchor_at,
            })
        })
        .collect()
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

pub async fn insert_missing_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    reminders: &[BackupToolReminder],
    pomodoro_runs: &[BackupToolPomodoroRun],
    daily_stats: &[BackupToolDailyStats],
) -> Result<(), String> {
    for reminder in reminders {
        if let Some(rule) = &reminder.recurrence {
            rule.validate()?;
        }
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
            let inserted = sqlx::query(
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
            super::timed_reminders::save_recurrence(
                tx,
                inserted.last_insert_rowid(),
                reminder.recurrence.as_ref(),
                reminder.recurrence_anchor_at,
            )
            .await?;
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
