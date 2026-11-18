use super::read::{fetch_reminder_by_id, map_reminder_row, REMINDER_RECURRENCE_COLUMNS};
use crate::domain::reminder_schedule::ReminderRecurrence;
use crate::domain::tools::{ReminderStatus, ToolReminder};
use chrono::Local;
use sqlx::{Pool, Sqlite, Transaction};

#[cfg(test)]
mod tests;

pub async fn create_reminder(
    pool: &Pool<Sqlite>,
    label: &str,
    scheduled_at: i64,
    recurrence: Option<ReminderRecurrence>,
    now_ms: i64,
) -> Result<ToolReminder, String> {
    let anchor = recurrence.as_ref().map(|_| scheduled_at);
    let scheduled_at = match &recurrence {
        Some(rule) => rule.next_after(scheduled_at, scheduled_at.saturating_sub(1), &Local)?,
        None => scheduled_at,
    };
    let label = label.trim();
    let safe_label = if label.is_empty() {
        "时间到了"
    } else {
        label
    };

    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let result = sqlx::query(
        "INSERT INTO tool_reminders (label, scheduled_at, created_at, status)
         VALUES (?, ?, ?, ?)",
    )
    .bind(safe_label)
    .bind(scheduled_at)
    .bind(now_ms)
    .bind(ReminderStatus::Scheduled.as_str())
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to create reminder: {error}"))?;

    let id = result.last_insert_rowid();
    save_recurrence(&mut tx, id, recurrence.as_ref(), anchor).await?;
    tx.commit().await.map_err(|error| error.to_string())?;
    fetch_reminder_by_id(pool, id).await
}

pub async fn cancel_reminder(
    pool: &Pool<Sqlite>,
    reminder_id: i64,
    now_ms: i64,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE tool_reminders
         SET status = ?, cancelled_at = ?
         WHERE id = ? AND status != ?",
    )
    .bind(ReminderStatus::Cancelled.as_str())
    .bind(now_ms)
    .bind(reminder_id)
    .bind(ReminderStatus::Cancelled.as_str())
    .execute(pool)
    .await
    .map_err(|error| format!("failed to cancel reminder: {error}"))?;
    Ok(())
}

pub async fn update_reminder(
    pool: &Pool<Sqlite>,
    reminder_id: i64,
    label: &str,
    scheduled_at: i64,
    enabled: bool,
    recurrence: Option<ReminderRecurrence>,
    now_ms: i64,
) -> Result<(), String> {
    let current = fetch_reminder_by_id(pool, reminder_id).await?;
    if enabled && current.status == ReminderStatus::PendingConfirmation {
        return Err("confirm or pause the pending reminder before editing".into());
    }
    let unchanged = current.scheduled_at == scheduled_at && current.recurrence == recurrence;
    let anchor = recurrence.as_ref().map(|_| {
        if unchanged {
            current.recurrence_anchor_at.unwrap_or(scheduled_at)
        } else {
            scheduled_at
        }
    });
    let scheduled_at = match (&recurrence, anchor) {
        (Some(rule), Some(anchor)) => {
            rule.validate()?;
            if enabled && scheduled_at <= now_ms {
                rule.next_after(anchor, now_ms, &Local)?
            } else if !unchanged {
                rule.next_after(anchor, scheduled_at.saturating_sub(1), &Local)?
            } else {
                scheduled_at
            }
        }
        _ => scheduled_at,
    };
    if enabled && scheduled_at <= now_ms {
        return Err("reminder time must be in the future".into());
    }
    let label = label.trim();
    if label.is_empty() {
        return Err("reminder label must not be empty".into());
    }
    let status = if enabled {
        ReminderStatus::Scheduled
    } else {
        ReminderStatus::Paused
    };
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    let result = sqlx::query(
        "UPDATE tool_reminders SET label = ?, scheduled_at = ?, status = ?, fired_at = NULL
         WHERE id = ? AND status IN ('scheduled', 'paused', 'fired', 'pending_confirmation')",
    )
    .bind(label)
    .bind(scheduled_at)
    .bind(status.as_str())
    .bind(reminder_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to update reminder: {error}"))?;
    if result.rows_affected() == 0 {
        return Err("reminder is unavailable".into());
    }
    save_recurrence(&mut tx, reminder_id, recurrence.as_ref(), anchor).await?;
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) async fn save_recurrence(
    tx: &mut Transaction<'_, Sqlite>,
    id: i64,
    rule: Option<&ReminderRecurrence>,
    anchor: Option<i64>,
) -> Result<(), String> {
    match (rule, anchor) {
        (Some(rule), Some(anchor)) => {
            rule.validate()?;
            let json = serde_json::to_string(rule).map_err(|error| error.to_string())?;
            sqlx::query("INSERT INTO tool_reminder_recurrences(reminder_id, recurrence, recurrence_anchor_at)
                VALUES(?, ?, ?) ON CONFLICT(reminder_id) DO UPDATE SET recurrence=excluded.recurrence, recurrence_anchor_at=excluded.recurrence_anchor_at")
                .bind(id).bind(json).bind(anchor).execute(&mut **tx).await.map_err(|error| error.to_string())?;
        }
        (None, None) => {
            sqlx::query("DELETE FROM tool_reminder_recurrences WHERE reminder_id=?")
                .bind(id)
                .execute(&mut **tx)
                .await
                .map_err(|error| error.to_string())?;
        }
        _ => return Err("reminder recurrence anchor is missing".into()),
    }
    Ok(())
}

pub async fn resolve_reminder_alert(
    pool: &Pool<Sqlite>,
    reminder_id: i64,
    fired_at: i64,
    delay_minutes: Option<u32>,
    now_ms: i64,
) -> Result<(), String> {
    if delay_minutes.is_some_and(|minutes| ![5, 15, 30].contains(&minutes)) {
        return Err("reminder delay must be 5, 15 or 30 minutes".into());
    }
    let reminder = fetch_reminder_by_id(pool, reminder_id).await?;
    let scheduled_at = match delay_minutes {
        Some(minutes) => Some(now_ms.saturating_add(i64::from(minutes) * 60_000)),
        None => reminder
            .recurrence
            .as_ref()
            .map(|rule| {
                rule.next_after(
                    reminder
                        .recurrence_anchor_at
                        .unwrap_or(reminder.scheduled_at),
                    now_ms,
                    &Local,
                )
            })
            .transpose()?,
    };
    let status = if scheduled_at.is_some() {
        ReminderStatus::Scheduled
    } else {
        ReminderStatus::Fired
    };
    let result = sqlx::query(
        "UPDATE tool_reminders SET status = ?, scheduled_at = COALESCE(?, scheduled_at)
         WHERE id = ? AND status = 'pending_confirmation' AND fired_at = ?",
    )
    .bind(status.as_str())
    .bind(scheduled_at)
    .bind(reminder_id)
    .bind(fired_at)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to resolve reminder: {error}"))?;
    if result.rows_affected() == 0 {
        let reminder = fetch_reminder_by_id(pool, reminder_id).await?;
        // A committed write may need retrying after snapshot refresh failed; do not add time twice.
        if reminder.status != status || reminder.fired_at != Some(fired_at) {
            return Err("reminder alert is unavailable".into());
        }
    }
    Ok(())
}

pub async fn pending_reminder_alerts(pool: &Pool<Sqlite>) -> Result<Vec<ToolReminder>, String> {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT id, label, scheduled_at, created_at, status, fired_at, cancelled_at, {REMINDER_RECURRENCE_COLUMNS}
         FROM tool_reminders WHERE status = 'pending_confirmation' ORDER BY fired_at, id"
    )))
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to recover pending reminders: {error}"))
    .and_then(|rows| rows.into_iter().map(map_reminder_row).collect())
}

pub async fn fire_due_reminders(
    tx: &mut Transaction<'_, Sqlite>,
    now_ms: i64,
) -> Result<Vec<ToolReminder>, String> {
    let rows = sqlx::query(sqlx::AssertSqlSafe(format!(
        "SELECT id, label, scheduled_at, created_at, status, fired_at, cancelled_at, {REMINDER_RECURRENCE_COLUMNS}
         FROM tool_reminders
         WHERE status = ? AND scheduled_at <= ?
         ORDER BY scheduled_at ASC, id ASC"
    )))
    .bind(ReminderStatus::Scheduled.as_str())
    .bind(now_ms)
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| format!("failed to load due reminders: {error}"))?;

    let reminders = rows
        .into_iter()
        .map(map_reminder_row)
        .collect::<Result<Vec<_>, _>>()?;
    for reminder in &reminders {
        sqlx::query(
            "UPDATE tool_reminders
             SET status = ?, fired_at = ?
             WHERE id = ? AND status = ?",
        )
        .bind(ReminderStatus::PendingConfirmation.as_str())
        .bind(now_ms)
        .bind(reminder.id)
        .bind(ReminderStatus::Scheduled.as_str())
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to mark reminder fired: {error}"))?;
    }

    Ok(reminders
        .into_iter()
        .map(|mut reminder| {
            reminder.status = ReminderStatus::PendingConfirmation;
            reminder.fired_at = Some(now_ms);
            reminder
        })
        .collect())
}
