use crate::domain::tools::{
    PomodoroPhase, PomodoroStatus, ReminderStatus, TimerMode, TimerStatus, ToolPomodoroRun,
    ToolReminder, ToolSoftwareReminderRule, ToolTimer, ToolTimerLap, ToolsRuntimeSnapshot,
};
use sqlx::{Pool, Row, Sqlite, Transaction};

const RECENT_REMINDER_LIMIT: i64 = 16;

pub async fn fetch_tools_snapshot(
    pool: &Pool<Sqlite>,
    now_ms: i64,
    date_key: &str,
) -> Result<ToolsRuntimeSnapshot, String> {
    let settings = super::load_tool_runtime_settings(pool)
        .await
        .map_err(|error| format!("failed to load tools settings: {error}"))?;
    let reminders = fetch_visible_reminders(pool).await?;
    let software_reminder_rules = fetch_active_software_reminder_rules(pool).await?;
    let current_timer = fetch_latest_timer(pool)
        .await?
        .filter(|timer| timer.status != TimerStatus::Idle);
    let timer_laps = match &current_timer {
        Some(timer) => fetch_timer_laps(pool, timer.id).await?,
        None => Vec::new(),
    };
    let current_pomodoro = fetch_latest_pomodoro(pool).await?;
    let today_completed_pomodoros = fetch_daily_pomodoro_count(pool, date_key).await?;
    let next_reminder_at = reminders
        .iter()
        .filter(|reminder| reminder.status == ReminderStatus::Scheduled)
        .map(|reminder| reminder.scheduled_at)
        .min();

    Ok(ToolsRuntimeSnapshot {
        settings,
        reminders,
        software_reminder_rules,
        current_timer,
        timer_laps,
        current_pomodoro,
        today_completed_pomodoros,
        next_reminder_at,
        sampled_at_ms: now_ms,
    })
}

pub(super) async fn fetch_reminder_by_id(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<ToolReminder, String> {
    sqlx::query(
        "SELECT id, label, scheduled_at, created_at, status, fired_at, cancelled_at
         FROM tool_reminders
         WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to read reminder: {error}"))
    .map(map_reminder_row)
}

pub(super) async fn fetch_software_reminder_rule_by_id(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<ToolSoftwareReminderRule, String> {
    sqlx::query(
        "SELECT id, app_name, exe_name, limit_ms, message, created_at, updated_at,
                disabled_at, last_fired_date_key
         FROM tool_software_reminder_rules
         WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to read software reminder rule: {error}"))
    .map(map_software_reminder_rule_row)
}

pub(super) async fn fetch_active_software_reminder_rules_tx(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<Vec<ToolSoftwareReminderRule>, String> {
    let rows = sqlx::query(
        "SELECT id, app_name, exe_name, limit_ms, message, created_at, updated_at,
                disabled_at, last_fired_date_key
         FROM tool_software_reminder_rules
         WHERE disabled_at IS NULL
         ORDER BY created_at ASC, id ASC",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| format!("failed to load active software reminder rules: {error}"))?;

    Ok(rows
        .into_iter()
        .map(map_software_reminder_rule_row)
        .collect())
}

async fn fetch_active_software_reminder_rules(
    pool: &Pool<Sqlite>,
) -> Result<Vec<ToolSoftwareReminderRule>, String> {
    let rows = sqlx::query(
        "SELECT id, app_name, exe_name, limit_ms, message, created_at, updated_at,
                disabled_at, last_fired_date_key
         FROM tool_software_reminder_rules
         WHERE disabled_at IS NULL
         ORDER BY created_at ASC, id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to load active software reminder rules: {error}"))?;

    Ok(rows
        .into_iter()
        .map(map_software_reminder_rule_row)
        .collect())
}

pub(super) async fn fetch_software_usage_ms_today_tx(
    tx: &mut Transaction<'_, Sqlite>,
    rule: &ToolSoftwareReminderRule,
    day_start_ms: i64,
    now_ms: i64,
) -> Result<i64, String> {
    let match_value = rule
        .exe_name
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(rule.app_name.as_str());
    let match_column_is_exe = rule
        .exe_name
        .as_deref()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);

    let row = if match_column_is_exe {
        sqlx::query(
            "SELECT COALESCE(SUM(
                MAX(0, MIN(COALESCE(end_time, ?), ?) - MAX(start_time, ?))
             ), 0) AS usage_ms
             FROM sessions
             WHERE exe_name = ? COLLATE NOCASE
               AND start_time < ?
               AND COALESCE(end_time, ?) > ?",
        )
        .bind(now_ms)
        .bind(now_ms)
        .bind(day_start_ms)
        .bind(match_value)
        .bind(now_ms)
        .bind(now_ms)
        .bind(day_start_ms)
        .fetch_one(&mut **tx)
        .await
    } else {
        sqlx::query(
            "SELECT COALESCE(SUM(
                MAX(0, MIN(COALESCE(end_time, ?), ?) - MAX(start_time, ?))
             ), 0) AS usage_ms
             FROM sessions
             WHERE app_name = ? COLLATE NOCASE
               AND start_time < ?
               AND COALESCE(end_time, ?) > ?",
        )
        .bind(now_ms)
        .bind(now_ms)
        .bind(day_start_ms)
        .bind(match_value)
        .bind(now_ms)
        .bind(now_ms)
        .bind(day_start_ms)
        .fetch_one(&mut **tx)
        .await
    }
    .map_err(|error| format!("failed to read software reminder usage: {error}"))?;

    Ok(row.get::<i64, _>("usage_ms"))
}

async fn fetch_visible_reminders(pool: &Pool<Sqlite>) -> Result<Vec<ToolReminder>, String> {
    let rows = sqlx::query(
        "SELECT id, label, scheduled_at, created_at, status, fired_at, cancelled_at
         FROM tool_reminders
         WHERE status = ?
            OR id IN (
                SELECT id
                FROM tool_reminders
                WHERE status <> ?
                ORDER BY COALESCE(fired_at, cancelled_at, created_at) DESC, id DESC
                LIMIT ?
            )
         ORDER BY
            CASE WHEN status = ? THEN 0 ELSE 1 END ASC,
            CASE WHEN status = ? THEN scheduled_at ELSE -COALESCE(fired_at, cancelled_at, created_at) END ASC,
            id ASC",
    )
    .bind(ReminderStatus::Scheduled.as_str())
    .bind(ReminderStatus::Scheduled.as_str())
    .bind(RECENT_REMINDER_LIMIT)
    .bind(ReminderStatus::Scheduled.as_str())
    .bind(ReminderStatus::Scheduled.as_str())
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to load reminders: {error}"))?;

    Ok(rows.into_iter().map(map_reminder_row).collect())
}

pub(super) async fn fetch_timer_by_id(pool: &Pool<Sqlite>, id: i64) -> Result<ToolTimer, String> {
    sqlx::query(
        "SELECT id, mode, label, duration_ms, accumulated_ms, started_at, paused_at,
                completed_at, status, created_at, updated_at
         FROM tool_timers
         WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to read timer: {error}"))
    .map(map_timer_row)
}

pub(super) async fn fetch_latest_timer(pool: &Pool<Sqlite>) -> Result<Option<ToolTimer>, String> {
    sqlx::query(
        "SELECT id, mode, label, duration_ms, accumulated_ms, started_at, paused_at,
                completed_at, status, created_at, updated_at
         FROM tool_timers
         ORDER BY updated_at DESC, id DESC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to read current timer: {error}"))
    .map(|row| row.map(map_timer_row))
}

pub(super) async fn fetch_timer_laps(
    pool: &Pool<Sqlite>,
    timer_id: i64,
) -> Result<Vec<ToolTimerLap>, String> {
    let rows = sqlx::query(
        "SELECT id, timer_id, lap_index, started_at, ended_at, duration_ms
         FROM tool_timer_laps
         WHERE timer_id = ?
         ORDER BY lap_index ASC, id ASC",
    )
    .bind(timer_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read timer laps: {error}"))?;

    Ok(rows.into_iter().map(map_timer_lap_row).collect())
}

pub(super) async fn fetch_pomodoro_by_id(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<ToolPomodoroRun, String> {
    sqlx::query(
        "SELECT id, phase, status, cycle_index, focus_ms, short_break_ms, long_break_ms,
                long_break_every, phase_started_at, phase_paused_at, phase_remaining_ms,
                completed_focus_count, created_at, updated_at
         FROM tool_pomodoro_runs
         WHERE id = ?",
    )
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to read pomodoro run: {error}"))
    .map(map_pomodoro_row)
}

pub(super) async fn fetch_latest_pomodoro(
    pool: &Pool<Sqlite>,
) -> Result<Option<ToolPomodoroRun>, String> {
    sqlx::query(
        "SELECT id, phase, status, cycle_index, focus_ms, short_break_ms, long_break_ms,
                long_break_every, phase_started_at, phase_paused_at, phase_remaining_ms,
                completed_focus_count, created_at, updated_at
         FROM tool_pomodoro_runs
         ORDER BY updated_at DESC, id DESC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to read current pomodoro: {error}"))
    .map(|row| row.map(map_pomodoro_row))
}

async fn fetch_daily_pomodoro_count(pool: &Pool<Sqlite>, date_key: &str) -> Result<i64, String> {
    sqlx::query_scalar(
        "SELECT completed_pomodoros
         FROM tool_daily_stats
         WHERE date_key = ?
         LIMIT 1",
    )
    .bind(date_key)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to read tool daily stats: {error}"))
    .map(|value| value.unwrap_or(0))
}

pub(super) fn map_reminder_row(row: sqlx::sqlite::SqliteRow) -> ToolReminder {
    let status: String = row.get("status");
    ToolReminder {
        id: row.get("id"),
        label: row.get("label"),
        scheduled_at: row.get("scheduled_at"),
        created_at: row.get("created_at"),
        status: ReminderStatus::from_storage(&status),
        fired_at: row.get("fired_at"),
        cancelled_at: row.get("cancelled_at"),
    }
}

fn map_software_reminder_rule_row(row: sqlx::sqlite::SqliteRow) -> ToolSoftwareReminderRule {
    ToolSoftwareReminderRule {
        id: row.get("id"),
        app_name: row.get("app_name"),
        exe_name: row.get("exe_name"),
        limit_ms: row.get("limit_ms"),
        message: row.get("message"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        disabled_at: row.get("disabled_at"),
        last_fired_date_key: row.get("last_fired_date_key"),
    }
}

fn map_timer_row(row: sqlx::sqlite::SqliteRow) -> ToolTimer {
    let mode: String = row.get("mode");
    let status: String = row.get("status");
    ToolTimer {
        id: row.get("id"),
        mode: TimerMode::from_storage(&mode),
        label: row.get("label"),
        duration_ms: row.get("duration_ms"),
        accumulated_ms: row.get("accumulated_ms"),
        started_at: row.get("started_at"),
        paused_at: row.get("paused_at"),
        completed_at: row.get("completed_at"),
        status: TimerStatus::from_storage(&status),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    }
}

pub(super) fn map_timer_lap_row(row: sqlx::sqlite::SqliteRow) -> ToolTimerLap {
    ToolTimerLap {
        id: row.get("id"),
        timer_id: row.get("timer_id"),
        lap_index: row.get("lap_index"),
        started_at: row.get("started_at"),
        ended_at: row.get("ended_at"),
        duration_ms: row.get("duration_ms"),
    }
}

fn map_pomodoro_row(row: sqlx::sqlite::SqliteRow) -> ToolPomodoroRun {
    let phase: String = row.get("phase");
    let status: String = row.get("status");
    ToolPomodoroRun {
        id: row.get("id"),
        phase: PomodoroPhase::from_storage(&phase),
        status: PomodoroStatus::from_storage(&status),
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
    }
}
