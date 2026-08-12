use crate::domain::tools::{
    CompletedPomodoroNotification, CompletedTimerNotification, PomodoroPhase, PomodoroStatus,
    ReminderStatus, TimerMode, TimerStatus, ToolPomodoroRun, ToolReminder, ToolRuntimeSettings,
    ToolTimer, ToolTimerLap,
};
use sqlx::{Pool, Sqlite, Transaction};

mod activity_reminders;
mod backup_restore;
mod read;

pub use activity_reminders::{
    create_activity_reminder_rule, disable_activity_reminder_rule, fire_due_activity_reminders,
    merge_activity_reminder_rules,
};
pub(crate) use read::fetch_all_activity_reminder_rules;
pub use read::fetch_tools_snapshot;

pub use backup_restore::{
    clear_for_restore, fetch_all_daily_stats_for_backup, fetch_all_pomodoro_runs_for_backup,
    fetch_all_reminders_for_backup, fetch_all_software_reminder_rules_for_backup,
    fetch_all_timer_laps_for_backup, fetch_all_timers_for_backup, insert_for_restore,
    insert_missing_for_restore,
};

use read::{
    fetch_latest_pomodoro, fetch_latest_timer, fetch_pomodoro_by_id, fetch_reminder_by_id,
    fetch_timer_by_id, map_reminder_row, map_timer_lap_row,
};

pub async fn load_tool_runtime_settings(
    _pool: &Pool<Sqlite>,
) -> Result<ToolRuntimeSettings, sqlx::Error> {
    Ok(ToolRuntimeSettings::default())
}

pub async fn create_reminder(
    pool: &Pool<Sqlite>,
    label: &str,
    scheduled_at: i64,
    now_ms: i64,
) -> Result<ToolReminder, String> {
    let label = label.trim();
    let safe_label = if label.is_empty() {
        "时间到了"
    } else {
        label
    };

    let result = sqlx::query(
        "INSERT INTO tool_reminders (label, scheduled_at, created_at, status)
         VALUES (?, ?, ?, ?)",
    )
    .bind(safe_label)
    .bind(scheduled_at)
    .bind(now_ms)
    .bind(ReminderStatus::Scheduled.as_str())
    .execute(pool)
    .await
    .map_err(|error| format!("failed to create reminder: {error}"))?;

    fetch_reminder_by_id(pool, result.last_insert_rowid()).await
}

pub async fn cancel_reminder(
    pool: &Pool<Sqlite>,
    reminder_id: i64,
    now_ms: i64,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE tool_reminders
         SET status = ?, cancelled_at = ?
         WHERE id = ? AND status = ?",
    )
    .bind(ReminderStatus::Cancelled.as_str())
    .bind(now_ms)
    .bind(reminder_id)
    .bind(ReminderStatus::Scheduled.as_str())
    .execute(pool)
    .await
    .map_err(|error| format!("failed to cancel reminder: {error}"))?;
    Ok(())
}

pub async fn fire_due_reminders(
    pool: &Pool<Sqlite>,
    now_ms: i64,
) -> Result<Vec<ToolReminder>, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start reminder transaction: {error}"))?;
    let rows = sqlx::query(
        "SELECT id, label, scheduled_at, created_at, status, fired_at, cancelled_at
         FROM tool_reminders
         WHERE status = ? AND scheduled_at <= ?
         ORDER BY scheduled_at ASC, id ASC",
    )
    .bind(ReminderStatus::Scheduled.as_str())
    .bind(now_ms)
    .fetch_all(&mut *tx)
    .await
    .map_err(|error| format!("failed to load due reminders: {error}"))?;

    let reminders = rows.into_iter().map(map_reminder_row).collect::<Vec<_>>();
    for reminder in &reminders {
        sqlx::query(
            "UPDATE tool_reminders
             SET status = ?, fired_at = ?
             WHERE id = ? AND status = ?",
        )
        .bind(ReminderStatus::Fired.as_str())
        .bind(now_ms)
        .bind(reminder.id)
        .bind(ReminderStatus::Scheduled.as_str())
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to mark reminder fired: {error}"))?;
    }

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit reminder transaction: {error}"))?;

    Ok(reminders
        .into_iter()
        .map(|mut reminder| {
            reminder.status = ReminderStatus::Fired;
            reminder.fired_at = Some(now_ms);
            reminder
        })
        .collect())
}

pub async fn start_timer(
    pool: &Pool<Sqlite>,
    mode: TimerMode,
    duration_ms: Option<i64>,
    label: Option<&str>,
    now_ms: i64,
) -> Result<ToolTimer, String> {
    let duration_ms = match mode {
        TimerMode::Stopwatch => None,
        TimerMode::Countdown => Some(duration_ms.unwrap_or(0).max(1_000)),
    };
    let label = label.map(str::trim).filter(|value| !value.is_empty());

    let result = sqlx::query(
        "INSERT INTO tool_timers (
            mode, label, duration_ms, accumulated_ms, started_at, paused_at,
            completed_at, status, created_at, updated_at
         ) VALUES (?, ?, ?, 0, ?, NULL, NULL, ?, ?, ?)",
    )
    .bind(mode.as_str())
    .bind(label)
    .bind(duration_ms)
    .bind(now_ms)
    .bind(TimerStatus::Running.as_str())
    .bind(now_ms)
    .bind(now_ms)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to start timer: {error}"))?;

    fetch_timer_by_id(pool, result.last_insert_rowid()).await
}

pub async fn pause_timer(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let Some(timer) = fetch_latest_timer(pool).await? else {
        return Ok(());
    };
    if timer.status != TimerStatus::Running {
        return Ok(());
    }

    let elapsed = timer.elapsed_ms_at(now_ms);
    sqlx::query(
        "UPDATE tool_timers
         SET accumulated_ms = ?, status = ?, started_at = NULL, paused_at = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(elapsed)
    .bind(TimerStatus::Paused.as_str())
    .bind(now_ms)
    .bind(now_ms)
    .bind(timer.id)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to pause timer: {error}"))?;
    Ok(())
}

pub async fn resume_timer(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let Some(timer) = fetch_latest_timer(pool).await? else {
        return Ok(());
    };
    if timer.status != TimerStatus::Paused {
        return Ok(());
    }

    sqlx::query(
        "UPDATE tool_timers
         SET status = ?, started_at = ?, paused_at = NULL, updated_at = ?
         WHERE id = ?",
    )
    .bind(TimerStatus::Running.as_str())
    .bind(now_ms)
    .bind(now_ms)
    .bind(timer.id)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to resume timer: {error}"))?;
    Ok(())
}

pub async fn reset_timer(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let Some(timer) = fetch_latest_timer(pool).await? else {
        return Ok(());
    };

    sqlx::query(
        "UPDATE tool_timers
         SET accumulated_ms = 0,
             started_at = NULL,
             paused_at = NULL,
             completed_at = NULL,
             status = ?,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(TimerStatus::Idle.as_str())
    .bind(now_ms)
    .bind(timer.id)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to reset timer: {error}"))?;
    clear_laps_for_timer(pool, timer.id).await?;
    Ok(())
}

pub async fn add_timer_lap(
    pool: &Pool<Sqlite>,
    now_ms: i64,
) -> Result<Option<ToolTimerLap>, String> {
    let Some(timer) = fetch_latest_timer(pool).await? else {
        return Ok(None);
    };
    if timer.status != TimerStatus::Running {
        return Ok(None);
    }

    let last_lap = sqlx::query(
        "SELECT id, timer_id, lap_index, started_at, ended_at, duration_ms
         FROM tool_timer_laps
         WHERE timer_id = ?
         ORDER BY lap_index DESC, id DESC
         LIMIT 1",
    )
    .bind(timer.id)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to load previous timer lap: {error}"))?
    .map(map_timer_lap_row);

    let lap_index = last_lap
        .as_ref()
        .map(|lap| lap.lap_index.saturating_add(1))
        .unwrap_or(1);
    let started_at = last_lap
        .map(|lap| lap.ended_at)
        .or(timer.started_at)
        .unwrap_or(now_ms);
    let ended_at = now_ms.max(started_at);
    let duration_ms = ended_at.saturating_sub(started_at);

    let result = sqlx::query(
        "INSERT INTO tool_timer_laps (timer_id, lap_index, started_at, ended_at, duration_ms)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(timer.id)
    .bind(lap_index)
    .bind(started_at)
    .bind(ended_at)
    .bind(duration_ms)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to add timer lap: {error}"))?;

    let lap_id = result.last_insert_rowid();
    let lap = sqlx::query(
        "SELECT id, timer_id, lap_index, started_at, ended_at, duration_ms
         FROM tool_timer_laps
         WHERE id = ?",
    )
    .bind(lap_id)
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to read timer lap: {error}"))
    .map(map_timer_lap_row)?;

    Ok(Some(lap))
}

pub async fn complete_due_countdown(
    pool: &Pool<Sqlite>,
    now_ms: i64,
) -> Result<Option<CompletedTimerNotification>, String> {
    let Some(timer) = fetch_latest_timer(pool).await? else {
        return Ok(None);
    };
    if !timer.is_countdown_due(now_ms) {
        return Ok(None);
    }

    let duration_ms = timer
        .duration_ms
        .unwrap_or_else(|| timer.elapsed_ms_at(now_ms));
    sqlx::query(
        "UPDATE tool_timers
         SET accumulated_ms = ?,
             started_at = NULL,
             paused_at = NULL,
             completed_at = ?,
             status = ?,
             updated_at = ?
         WHERE id = ? AND status = ?",
    )
    .bind(duration_ms.max(0))
    .bind(now_ms)
    .bind(TimerStatus::Completed.as_str())
    .bind(now_ms)
    .bind(timer.id)
    .bind(TimerStatus::Running.as_str())
    .execute(pool)
    .await
    .map_err(|error| format!("failed to complete countdown: {error}"))?;

    Ok(Some(CompletedTimerNotification {
        timer_id: timer.id,
        label: timer.label,
    }))
}

pub async fn pause_running_stopwatch_after_restart(
    pool: &Pool<Sqlite>,
    now_ms: i64,
) -> Result<bool, String> {
    let Some(timer) = fetch_latest_timer(pool).await? else {
        return Ok(false);
    };
    if timer.mode != TimerMode::Stopwatch || timer.status != TimerStatus::Running {
        return Ok(false);
    }

    pause_timer(pool, now_ms).await?;
    Ok(true)
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
    .execute(pool)
    .await
    .map_err(|error| format!("failed to start pomodoro: {error}"))?;

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
    if run.status != PomodoroStatus::Paused {
        return Ok(());
    }

    sqlx::query(
        "UPDATE tool_pomodoro_runs
         SET status = ?,
             phase_started_at = ?,
             phase_paused_at = NULL,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(PomodoroStatus::Running.as_str())
    .bind(now_ms)
    .bind(now_ms)
    .bind(run.id)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to resume pomodoro: {error}"))?;
    Ok(())
}

pub async fn skip_pomodoro_phase(
    pool: &Pool<Sqlite>,
    date_key: &str,
    now_ms: i64,
) -> Result<Option<CompletedPomodoroNotification>, String> {
    advance_pomodoro_phase(pool, date_key, now_ms, false, false).await
}

pub async fn complete_due_pomodoro_phase(
    pool: &Pool<Sqlite>,
    date_key: &str,
    now_ms: i64,
) -> Result<Option<CompletedPomodoroNotification>, String> {
    let Some(run) = fetch_latest_pomodoro(pool).await? else {
        return Ok(None);
    };
    if !run.is_phase_due(now_ms) {
        return Ok(None);
    }

    advance_pomodoro_phase(pool, date_key, now_ms, true, true).await
}

async fn advance_pomodoro_phase(
    pool: &Pool<Sqlite>,
    date_key: &str,
    now_ms: i64,
    count_focus_completion: bool,
    start_next_phase: bool,
) -> Result<Option<CompletedPomodoroNotification>, String> {
    let Some(run) = fetch_latest_pomodoro(pool).await? else {
        return Ok(None);
    };
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
    let next_started_at = start_next_phase.then_some(now_ms);
    let next_paused_at = (!start_next_phase).then_some(now_ms);

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start pomodoro transaction: {error}"))?;
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
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to advance pomodoro phase: {error}"))?;

    let counted_focus = count_focus_completion && run.phase == PomodoroPhase::Focus;
    if counted_focus {
        increment_daily_pomodoro_stat_tx(&mut tx, date_key, now_ms).await?;
    }

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit pomodoro transaction: {error}"))?;

    Ok(Some(CompletedPomodoroNotification {
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

async fn clear_laps_for_timer(pool: &Pool<Sqlite>, timer_id: i64) -> Result<(), String> {
    sqlx::query("DELETE FROM tool_timer_laps WHERE timer_id = ?")
        .bind(timer_id)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to clear timer laps: {error}"))?;
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
    use super::*;
    use crate::data::schema as db_schema;
    use crate::domain::tools::{ActivityReminderSuspensionReason, ActivityReminderTarget};
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::TOOLS_TABLES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::ACTIVITY_REMINDER_RULES_SCHEMA_SQL)
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

            create_reminder(&pool, "'; DROP TABLE tool_reminders; --", 2_000, 1_000)
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
    fn due_reminder_fires_only_once() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            create_reminder(&pool, "Stand up", 1_000, 900)
                .await
                .unwrap();

            let first = fire_due_reminders(&pool, 1_100).await.unwrap();
            let second = fire_due_reminders(&pool, 1_200).await.unwrap();

            assert_eq!(first.len(), 1);
            assert_eq!(first[0].status, ReminderStatus::Fired);
            assert!(second.is_empty());
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
                let target = match index % 3 {
                    0 => ActivityReminderTarget::App {
                        app_name: "Editor".to_string(),
                        exe_name: Some("editor.exe".to_string()),
                    },
                    1 => ActivityReminderTarget::Category {
                        category_id: "development".to_string(),
                    },
                    _ => ActivityReminderTarget::Web {
                        normalized_domain: "example.com".to_string(),
                    },
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
    fn timer_laps_are_committed_in_order() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_timer(&pool, TimerMode::Stopwatch, None, None, 1_000)
                .await
                .unwrap();

            add_timer_lap(&pool, 1_500).await.unwrap();
            add_timer_lap(&pool, 2_000).await.unwrap();
            let snapshot = fetch_tools_snapshot(&pool, 2_000, "2026-06-07")
                .await
                .unwrap();

            assert_eq!(snapshot.timer_laps.len(), 2);
            assert_eq!(snapshot.timer_laps[0].duration_ms, 500);
            assert_eq!(
                snapshot.timer_laps[1].started_at,
                snapshot.timer_laps[0].ended_at
            );
        });
    }

    #[test]
    fn countdown_completion_updates_current_timer_once() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_timer(&pool, TimerMode::Countdown, Some(1_000), None, 1_000)
                .await
                .unwrap();

            let completed = complete_due_countdown(&pool, 2_100).await.unwrap();
            let second = complete_due_countdown(&pool, 2_200).await.unwrap();
            let snapshot = fetch_tools_snapshot(&pool, 2_200, "2026-06-07")
                .await
                .unwrap();

            assert!(completed.is_some());
            assert!(second.is_none());
            assert_eq!(
                snapshot.current_timer.unwrap().status,
                TimerStatus::Completed
            );
        });
    }

    #[test]
    fn pausing_running_timer_sets_paused_status() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_timer(&pool, TimerMode::Stopwatch, None, None, 1_000)
                .await
                .unwrap();

            pause_timer(&pool, 1_500).await.unwrap();
            let snapshot = fetch_tools_snapshot(&pool, 3_000, "2026-06-07")
                .await
                .unwrap();
            let timer = snapshot.current_timer.unwrap();

            assert_eq!(timer.status, TimerStatus::Paused);
            assert_eq!(timer.elapsed_ms_at(3_000), 500);
        });
    }

    #[test]
    fn reset_timer_clears_current_timer_from_snapshot() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_timer(&pool, TimerMode::Stopwatch, None, None, 1_000)
                .await
                .unwrap();
            add_timer_lap(&pool, 1_500).await.unwrap();

            reset_timer(&pool, 2_000).await.unwrap();
            let snapshot = fetch_tools_snapshot(&pool, 2_000, "2026-06-07")
                .await
                .unwrap();

            assert!(snapshot.current_timer.is_none());
            assert!(snapshot.timer_laps.is_empty());
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
            assert_eq!(run.status, PomodoroStatus::Running);
            assert_eq!(run.phase_started_at, Some(2_100));
            assert_eq!(run.phase_paused_at, None);
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
