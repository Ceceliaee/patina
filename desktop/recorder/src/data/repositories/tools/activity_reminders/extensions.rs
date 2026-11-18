use super::super::read::{map_activity_reminder_rule_row, ACTIVITY_RULE_COLUMNS};
use super::load_activity_reminder_usage;
use crate::domain::tools::ActivityReminderExtension;
use sqlx::{Pool, Sqlite};

pub async fn extend_activity_reminder(
    pool: &Pool<Sqlite>,
    rule_id: i64,
    alert_at: i64,
    extension: ActivityReminderExtension,
    date_key: &str,
    day_start_ms: i64,
    now_ms: i64,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let query = format!("SELECT {ACTIVITY_RULE_COLUMNS} FROM tool_activity_reminder_rules WHERE id = ? AND disabled_at IS NULL AND NOT EXISTS (SELECT 1 FROM tool_activity_reminder_states WHERE rule_id = tool_activity_reminder_rules.id AND enabled = 0)");
    let row = sqlx::query(sqlx::AssertSqlSafe(query))
        .bind(rule_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .ok_or("activity reminder is unavailable")?;
    let rule = map_activity_reminder_rule_row(row)?;
    if rule.extension_date_key.as_deref() == Some(date_key)
        && rule.last_extended_alert_at == Some(alert_at)
    {
        return Ok(());
    }
    if rule.last_fired_date_key.as_deref() != Some(date_key) || rule.last_fired_at != Some(alert_at)
    {
        return Err("activity reminder alert has expired".into());
    }
    let usage = load_activity_reminder_usage(&mut tx, vec![rule], day_start_ms, now_ms).await?;
    let (rule, usage_ms, _, _) = usage
        .entries
        .first()
        .ok_or("activity reminder target is unavailable")?;
    // Corrected usage must not turn an extension into a shorter allowance.
    let limit = extension.additional_ms().and_then(|extra| {
        rule.limit_for_date(date_key)
            .map(|current| current.max(usage_ms.saturating_add(extra)))
    });
    sqlx::query(
        "UPDATE tool_activity_reminder_extensions
        SET extension_date_key = ?, extension_limit_ms = ?, last_extended_alert_at = ? WHERE rule_id = ?",
    )
    .bind(date_key)
    .bind(limit)
    .bind(alert_at)
    .bind(rule_id)
    .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE tool_activity_reminder_rules SET last_fired_date_key = ?, updated_at = ? WHERE id = ?")
    .bind(if limit.is_none() {
        Some(date_key)
    } else {
        None
    })
    .bind(now_ms)
    .bind(rule_id)
    .execute(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}
