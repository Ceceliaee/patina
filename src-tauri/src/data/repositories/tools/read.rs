use crate::domain::tools::{
    ActivityReminderSuspensionReason, ActivityReminderTarget, PomodoroPhase, PomodoroStatus,
    ReminderStatus, ToolActivityReminderRule, ToolPomodoroRun, ToolReminder, ToolsRuntimeSnapshot,
};
use futures_util::TryStreamExt;
use sqlx::{Pool, Row, Sqlite, Transaction};

pub(super) const REMINDER_RECURRENCE_COLUMNS: &str =
    "(SELECT recurrence FROM tool_reminder_recurrences WHERE reminder_id = tool_reminders.id) AS recurrence,
     (SELECT recurrence_anchor_at FROM tool_reminder_recurrences WHERE reminder_id = tool_reminders.id) AS recurrence_anchor_at";

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
    let current_pomodoro = fetch_latest_pomodoro(pool).await?;
    let pomodoro_tasks = super::pomodoro_tasks::fetch_tasks(pool).await?;
    let today_completed_pomodoros = fetch_daily_pomodoro_count(pool, date_key).await?;
    let next_reminder_at = reminders
        .iter()
        .filter(|reminder| reminder.status == ReminderStatus::Scheduled)
        .map(|reminder| reminder.scheduled_at)
        .min();

    Ok(ToolsRuntimeSnapshot {
        free_focus_tasks: super::free_focus::fetch(pool)
            .await?
            .into_iter()
            .filter(|task| task.deleted_at.is_none())
            .collect(),
        settings,
        reminders,
        activity_reminder_rules,
        current_pomodoro,
        pomodoro_tasks,
        today_completed_pomodoros,
        next_reminder_at,
        sampled_at_ms: now_ms,
    })
}

pub(super) async fn fetch_reminder_by_id(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<ToolReminder, String> {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT id, label, scheduled_at, created_at, status, fired_at, cancelled_at, {REMINDER_RECURRENCE_COLUMNS}
         FROM tool_reminders
         WHERE id = ?"
    )))
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to read reminder: {error}"))
    .and_then(map_reminder_row)
}

pub(super) const ACTIVITY_RULE_COLUMNS: &str = "id, target_kind, app_name, exe_name, category_id,
    normalized_domain, label_snapshot, limit_ms, message, created_at, updated_at,
    disabled_at, last_fired_date_key,
    COALESCE((SELECT enabled FROM tool_activity_reminder_states WHERE rule_id = tool_activity_reminder_rules.id), 1) AS enabled,
    (SELECT last_fired_at FROM tool_activity_reminder_extensions WHERE rule_id = tool_activity_reminder_rules.id) AS last_fired_at,
    (SELECT extension_date_key FROM tool_activity_reminder_extensions WHERE rule_id = tool_activity_reminder_rules.id) AS extension_date_key,
    (SELECT extension_limit_ms FROM tool_activity_reminder_extensions WHERE rule_id = tool_activity_reminder_rules.id) AS extension_limit_ms,
    (SELECT last_extended_alert_at FROM tool_activity_reminder_extensions WHERE rule_id = tool_activity_reminder_rules.id) AS last_extended_alert_at";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct SessionUsageFact {
    pub exe_name: String,
    pub app_name: String,
    pub usage_ms: i64,
    pub active_since: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct WebUsageFact {
    pub normalized_domain: String,
    pub usage_ms: i64,
    pub active_since: Option<i64>,
}

pub(super) async fn fetch_activity_reminder_rule_by_id(
    pool: &Pool<Sqlite>,
    id: i64,
) -> Result<ToolActivityReminderRule, String> {
    let query =
        format!("SELECT {ACTIVITY_RULE_COLUMNS} FROM tool_activity_reminder_rules WHERE id = ?");
    let mut rule = map_activity_reminder_rule_row(
        sqlx::query(sqlx::AssertSqlSafe(query))
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
    check: &crate::domain::tools::ActivityReminderCheck,
) -> Result<Vec<ToolActivityReminderRule>, String> {
    let mut query = sqlx::QueryBuilder::<Sqlite>::new(format!(
        "SELECT {ACTIVITY_RULE_COLUMNS} FROM tool_activity_reminder_rules
         WHERE disabled_at IS NULL AND NOT EXISTS (SELECT 1 FROM tool_activity_reminder_states WHERE rule_id = tool_activity_reminder_rules.id AND enabled = 0)"
    ));
    if let crate::domain::tools::ActivityReminderCheck::Rules(ids) = check {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        query.push(" AND id IN (");
        let mut separated = query.separated(",");
        for &id in ids {
            separated.push_bind(id);
        }
        query.push(")");
    }
    query.push(" ORDER BY created_at ASC, id ASC");
    let rows = query
        .build()
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
    let rows = sqlx::query(sqlx::AssertSqlSafe(query))
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
    sqlx::query(sqlx::AssertSqlSafe(query))
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
    rules: &[ToolActivityReminderRule],
    classification: &crate::domain::classification::ClassificationSnapshot,
) -> Result<Vec<SessionUsageFact>, String> {
    let has_category = rules
        .iter()
        .any(|rule| matches!(rule.target, ActivityReminderTarget::Category { .. }));
    let mut query = sqlx::QueryBuilder::<Sqlite>::new(
        "SELECT LOWER(TRIM(exe_name)) AS exe_name, LOWER(TRIM(app_name)) AS app_name,
         COALESCE(SUM(MAX(0, MIN(COALESCE(end_time, ",
    );
    query.push_bind(now_ms).push("), ").push_bind(now_ms)
        .push(") - MAX(start_time, ").push_bind(day_start_ms)
        .push("))), 0) AS usage_ms, MAX(CASE WHEN end_time IS NULL THEN start_time END) AS active_since
               FROM sessions WHERE start_time <= ").push_bind(now_ms)
        .push(" AND COALESCE(end_time, ").push_bind(now_ms).push(") >= ").push_bind(day_start_ms);
    if !has_category {
        query.push(" AND (0");
        for rule in rules {
            if let ActivityReminderTarget::App { app_name, exe_name } = &rule.target {
                if let Some(exe) = exe_name {
                    query.push(" OR LOWER(TRIM(exe_name)) = ").push_bind(exe);
                } else {
                    query
                        .push(" OR LOWER(TRIM(app_name)) = ")
                        .push_bind(app_name);
                }
                query.push(" COLLATE NOCASE");
            }
        }
        query.push(")");
    }
    query.push(" GROUP BY LOWER(TRIM(exe_name)), LOWER(TRIM(app_name))");
    let mut rows = query.build().fetch(&mut **tx);
    let mut facts = Vec::new();
    while let Some(row) = rows
        .try_next()
        .await
        .map_err(|error| format!("failed to read activity reminder app usage: {error}"))?
    {
        let fact = SessionUsageFact {
            exe_name: row.get("exe_name"),
            app_name: row.get("app_name"),
            usage_ms: row.get("usage_ms"),
            active_since: row.get("active_since"),
        };
        // Category membership includes linked executables; retain only requested targets.
        let category = has_category
            .then(|| classification.resolve_tracked_session_category(&fact.exe_name))
            .flatten();
        if rules.iter().any(|rule| match &rule.target {
            ActivityReminderTarget::App { app_name, exe_name } => exe_name.as_deref().map_or_else(
                || fact.app_name.eq_ignore_ascii_case(app_name),
                |exe| fact.exe_name.eq_ignore_ascii_case(exe),
            ),
            ActivityReminderTarget::Category { category_id } => category
                .as_ref()
                .is_some_and(|category| category.id == *category_id),
            ActivityReminderTarget::Web { .. } => false,
        }) {
            facts.push(fact);
        }
    }
    Ok(facts)
}

pub(super) async fn fetch_web_usage_facts_tx(
    tx: &mut Transaction<'_, Sqlite>,
    day_start_ms: i64,
    now_ms: i64,
    rules: &[ToolActivityReminderRule],
) -> Result<Vec<WebUsageFact>, String> {
    let mut query = sqlx::QueryBuilder::<Sqlite>::new(
        "WITH ordered AS (
            SELECT start_time, end_time, id, LOWER(TRIM(normalized_domain, '.')) AS domain,
                   LAG(end_time) OVER (ORDER BY start_time, id) AS previous_end,
                   LAG(LOWER(TRIM(normalized_domain, '.'))) OVER (ORDER BY start_time, id) AS previous_domain
            FROM web_activity_segments
            WHERE start_time <= ");
    query
        .push_bind(now_ms)
        .push(" AND COALESCE(end_time, ")
        .push_bind(now_ms)
        .push(") >= ")
        .push_bind(day_start_ms)
        .push(
            "), visits AS (
            SELECT *, MAX(CASE WHEN previous_end = start_time AND previous_domain = domain
                               THEN NULL ELSE start_time END)
                      OVER (ORDER BY start_time, id ROWS UNBOUNDED PRECEDING) AS visit_start
            FROM ordered
         )
         SELECT domain AS normalized_domain,
                COALESCE(SUM(MAX(0, MIN(COALESCE(end_time, ",
        )
        .push_bind(now_ms)
        .push("), ")
        .push_bind(now_ms)
        .push(") - MAX(start_time, ")
        .push_bind(day_start_ms)
        .push(
            "))), 0) AS usage_ms,
                MAX(CASE WHEN end_time IS NULL THEN visit_start END) AS active_since
         FROM visits WHERE domain IN (",
        );
    let mut domains = query.separated(",");
    for rule in rules {
        if let ActivityReminderTarget::Web { normalized_domain } = &rule.target {
            domains.push_bind(normalized_domain);
        }
    }
    query.push(") GROUP BY domain");
    let rows = query
        .build()
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to read activity reminder web usage: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| WebUsageFact {
            normalized_domain: row.get("normalized_domain"),
            usage_ms: row.get("usage_ms"),
            active_since: row.get("active_since"),
        })
        .collect())
}

async fn fetch_visible_reminders(pool: &Pool<Sqlite>) -> Result<Vec<ToolReminder>, String> {
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT id, label, scheduled_at, created_at, status, fired_at, cancelled_at, {REMINDER_RECURRENCE_COLUMNS}
         FROM tool_reminders
         WHERE status != 'cancelled'
         ORDER BY
            CASE WHEN status IN (?, 'paused') THEN 0 ELSE 1 END ASC,
            CASE WHEN status IN (?, 'paused') THEN scheduled_at ELSE -COALESCE(fired_at, cancelled_at, created_at) END ASC,
            id ASC"
    )))
    .bind(ReminderStatus::Scheduled.as_str())
    .bind(ReminderStatus::Scheduled.as_str())
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to load reminders: {error}"))?;

    rows.into_iter().map(map_reminder_row).collect()
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

pub(super) async fn fetch_latest_pomodoro<'e>(
    executor: impl sqlx::Executor<'e, Database = Sqlite>,
) -> Result<Option<ToolPomodoroRun>, String> {
    sqlx::query(
        "SELECT id, phase, status, cycle_index, focus_ms, short_break_ms, long_break_ms,
                long_break_every, phase_started_at, phase_paused_at, phase_remaining_ms,
                completed_focus_count, created_at, updated_at
         FROM tool_pomodoro_runs
         WHERE NOT EXISTS (SELECT 1 FROM tool_pomodoro_tasks WHERE run_id = tool_pomodoro_runs.id AND deleted_at IS NOT NULL)
         ORDER BY (status = 'running') DESC, (status = 'paused') DESC, updated_at DESC, id DESC
         LIMIT 1",
    )
    .fetch_optional(executor)
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

pub(super) fn map_reminder_row(row: sqlx::sqlite::SqliteRow) -> Result<ToolReminder, String> {
    let status: String = row.get("status");
    let recurrence = row
        .get::<Option<String>, _>("recurrence")
        .map(|value| {
            serde_json::from_str::<crate::domain::reminder_schedule::ReminderRecurrence>(&value)
        })
        .transpose()
        .map_err(|error| format!("invalid stored reminder recurrence: {error}"))?;
    if let Some(rule) = &recurrence {
        rule.validate()?;
    }
    let recurrence_anchor_at: Option<i64> = row.get("recurrence_anchor_at");
    if recurrence.is_some() != recurrence_anchor_at.is_some()
        || recurrence_anchor_at
            .is_some_and(|value| chrono::DateTime::from_timestamp_millis(value).is_none())
    {
        return Err("invalid stored reminder recurrence anchor".into());
    }
    Ok(ToolReminder {
        id: row.get("id"),
        label: row.get("label"),
        scheduled_at: row.get("scheduled_at"),
        created_at: row.get("created_at"),
        status: ReminderStatus::from_storage(&status),
        fired_at: row.get("fired_at"),
        cancelled_at: row.get("cancelled_at"),
        recurrence,
        recurrence_anchor_at,
    })
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
        enabled: row.get("enabled"),
        id: row.get("id"),
        target,
        label_snapshot: row.get("label_snapshot"),
        limit_ms: row.get("limit_ms"),
        message: row.get("message"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        disabled_at: row.get("disabled_at"),
        last_fired_date_key: row.get("last_fired_date_key"),
        last_fired_at: row.get("last_fired_at"),
        extension_date_key: row.get("extension_date_key"),
        extension_limit_ms: row.get("extension_limit_ms"),
        last_extended_alert_at: row.get("last_extended_alert_at"),
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

pub(super) fn map_pomodoro_row(row: sqlx::sqlite::SqliteRow) -> ToolPomodoroRun {
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
