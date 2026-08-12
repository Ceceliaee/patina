use crate::domain::tools::{
    ActivityReminderSuspensionReason, ActivityReminderTarget, PomodoroPhase, PomodoroStatus,
    ReminderStatus, TimerMode, TimerStatus, ToolActivityReminderRule, ToolPomodoroRun,
    ToolReminder, ToolTimer, ToolTimerLap, ToolsRuntimeSnapshot,
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
    let activity_reminder_rules = fetch_active_activity_reminder_rules(pool).await?;
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
        activity_reminder_rules,
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

pub(super) const ACTIVITY_RULE_COLUMNS: &str = "id, target_kind, app_name, exe_name, category_id,
    normalized_domain, label_snapshot, limit_ms, message, created_at, updated_at,
    disabled_at, last_fired_date_key";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SessionUsageFact {
    pub exe_name: String,
    pub app_name: String,
    pub usage_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct WebUsageFact {
    pub normalized_domain: String,
    pub usage_ms: i64,
}

pub(super) async fn fetch_activity_reminder_rule_by_id(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<ToolActivityReminderRule, String> {
    let query =
        format!("SELECT {ACTIVITY_RULE_COLUMNS} FROM tool_activity_reminder_rules WHERE id = ?");
    let mut rule = map_activity_reminder_rule_row(
        sqlx::query(&query)
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(|error| format!("failed to read activity reminder rule: {error}"))?,
    )?;
    let classification =
        crate::data::repositories::classification_settings::load_classification_snapshot(pool)
            .await?;
    let web_activity_enabled = load_web_activity_enabled(pool).await?;
    rule.suspension_reason =
        resolve_activity_rule_suspension(&rule, &classification, web_activity_enabled);
    Ok(rule)
}

pub(super) async fn fetch_active_activity_reminder_rules_tx(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<Vec<ToolActivityReminderRule>, String> {
    let query = format!(
        "SELECT {ACTIVITY_RULE_COLUMNS} FROM tool_activity_reminder_rules
         WHERE disabled_at IS NULL ORDER BY created_at ASC, id ASC"
    );
    let rows = sqlx::query(&query)
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to load active activity reminder rules: {error}"))?;
    rows.into_iter()
        .map(map_activity_reminder_rule_row)
        .collect()
}

async fn fetch_active_activity_reminder_rules(
    pool: &Pool<Sqlite>,
) -> Result<Vec<ToolActivityReminderRule>, String> {
    let query = format!(
        "SELECT {ACTIVITY_RULE_COLUMNS} FROM tool_activity_reminder_rules
         WHERE disabled_at IS NULL ORDER BY created_at ASC, id ASC"
    );
    let rows = sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to load active activity reminder rules: {error}"))?;
    let mut rules = rows
        .into_iter()
        .map(map_activity_reminder_rule_row)
        .collect::<Result<Vec<_>, _>>()?;
    let classification =
        crate::data::repositories::classification_settings::load_classification_snapshot(pool)
            .await?;
    let web_activity_enabled = load_web_activity_enabled(pool).await?;
    for rule in &mut rules {
        rule.suspension_reason =
            resolve_activity_rule_suspension(rule, &classification, web_activity_enabled);
    }
    Ok(rules)
}

pub(crate) async fn fetch_all_activity_reminder_rules(
    pool: &Pool<Sqlite>,
) -> Result<Vec<ToolActivityReminderRule>, String> {
    let query =
        format!("SELECT {ACTIVITY_RULE_COLUMNS} FROM tool_activity_reminder_rules ORDER BY id ASC");
    sqlx::query(&query)
        .fetch_all(pool)
        .await
        .map_err(|error| {
            format!("failed to load activity reminder rules for snapshot merge: {error}")
        })?
        .into_iter()
        .map(map_activity_reminder_rule_row)
        .collect()
}

pub(super) async fn fetch_session_usage_facts_tx(
    tx: &mut Transaction<'_, Sqlite>,
    day_start_ms: i64,
    now_ms: i64,
) -> Result<Vec<SessionUsageFact>, String> {
    let rows = sqlx::query(
        "SELECT LOWER(TRIM(exe_name)) AS exe_name,
                LOWER(TRIM(app_name)) AS app_name,
                COALESCE(SUM(MAX(0, MIN(COALESCE(end_time, ?), ?) - MAX(start_time, ?))), 0)
                    AS usage_ms
         FROM sessions
         WHERE start_time < ? AND COALESCE(end_time, ?) > ?
         GROUP BY LOWER(TRIM(exe_name)), LOWER(TRIM(app_name))",
    )
    .bind(now_ms)
    .bind(now_ms)
    .bind(day_start_ms)
    .bind(now_ms)
    .bind(now_ms)
    .bind(day_start_ms)
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| format!("failed to read activity reminder app usage: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| SessionUsageFact {
            exe_name: row.get("exe_name"),
            app_name: row.get("app_name"),
            usage_ms: row.get("usage_ms"),
        })
        .collect())
}

pub(super) async fn fetch_web_usage_facts_tx(
    tx: &mut Transaction<'_, Sqlite>,
    day_start_ms: i64,
    now_ms: i64,
) -> Result<Vec<WebUsageFact>, String> {
    let rows = sqlx::query(
        "SELECT LOWER(TRIM(normalized_domain, '.')) AS normalized_domain,
                COALESCE(SUM(MAX(0, MIN(COALESCE(end_time, ?), ?) - MAX(start_time, ?))), 0)
                    AS usage_ms
         FROM web_activity_segments
         WHERE start_time < ? AND COALESCE(end_time, ?) > ?
         GROUP BY LOWER(TRIM(normalized_domain, '.'))",
    )
    .bind(now_ms)
    .bind(now_ms)
    .bind(day_start_ms)
    .bind(now_ms)
    .bind(now_ms)
    .bind(day_start_ms)
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| format!("failed to read activity reminder web usage: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| WebUsageFact {
            normalized_domain: row.get("normalized_domain"),
            usage_ms: row.get("usage_ms"),
        })
        .collect())
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

pub(super) fn map_activity_reminder_rule_row(
    row: sqlx::sqlite::SqliteRow,
) -> Result<ToolActivityReminderRule, String> {
    let target_kind: String = row.get("target_kind");
    let target = match target_kind.as_str() {
        "app" => ActivityReminderTarget::App {
            app_name: row
                .get::<Option<String>, _>("app_name")
                .ok_or_else(|| "activity reminder app target is missing app_name".to_string())?,
            exe_name: row.get("exe_name"),
        },
        "category" => ActivityReminderTarget::Category {
            category_id: row.get::<Option<String>, _>("category_id").ok_or_else(|| {
                "activity reminder category target is missing category_id".to_string()
            })?,
        },
        "web" => ActivityReminderTarget::Web {
            normalized_domain: row
                .get::<Option<String>, _>("normalized_domain")
                .ok_or_else(|| {
                    "activity reminder web target is missing normalized_domain".to_string()
                })?,
        },
        _ => {
            return Err(format!(
                "unknown activity reminder target kind `{target_kind}`"
            ))
        }
    };
    Ok(ToolActivityReminderRule {
        id: row.get("id"),
        target,
        label_snapshot: row.get("label_snapshot"),
        limit_ms: row.get("limit_ms"),
        message: row.get("message"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        disabled_at: row.get("disabled_at"),
        last_fired_date_key: row.get("last_fired_date_key"),
        suspension_reason: None,
    })
}

fn resolve_activity_rule_suspension(
    rule: &ToolActivityReminderRule,
    classification: &crate::domain::classification::ClassificationSnapshot,
    web_activity_enabled: bool,
) -> Option<ActivityReminderSuspensionReason> {
    match &rule.target {
        ActivityReminderTarget::App { exe_name, .. } => exe_name
            .as_deref()
            .filter(|exe| !classification.is_app_enabled(exe))
            .map(|_| ActivityReminderSuspensionReason::TargetExcluded),
        ActivityReminderTarget::Category { category_id } => (!classification
            .category_is_available(category_id))
        .then_some(ActivityReminderSuspensionReason::TargetDeleted),
        ActivityReminderTarget::Web { normalized_domain } => {
            if !web_activity_enabled {
                Some(ActivityReminderSuspensionReason::SourceDisabled)
            } else if !classification.is_web_domain_enabled(normalized_domain) {
                Some(ActivityReminderSuspensionReason::TargetExcluded)
            } else {
                None
            }
        }
    }
}

async fn load_web_activity_enabled(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let value = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = 'web_activity_enabled' LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to read web activity setting: {error}"))?;
    Ok(value.is_some_and(|value| value == "1" || value.eq_ignore_ascii_case("true")))
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
