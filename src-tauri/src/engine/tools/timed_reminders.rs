use super::{
    apply_mutation_and_refresh, dismiss_alert, get_alerts, now_ms, ToolsMutation, ToolsStore,
};
use crate::domain::tools::{
    ReminderStatus, ToolAlert, ToolAlertKind, ToolReminder, ToolsRuntimeSnapshot,
};
use tauri::{AppHandle, Runtime};

pub(super) fn include_pending_alerts(
    mut alerts: Vec<ToolAlert>,
    reminders: Vec<ToolReminder>,
) -> Vec<ToolAlert> {
    alerts.retain(|alert| alert.kind != ToolAlertKind::Reminder);
    // Pending confirmations are durable work, even after eviction from the transient alert cache.
    for reminder in reminders
        .into_iter()
        .filter(|row| row.status == ReminderStatus::PendingConfirmation)
    {
        let Some(occurred_at) = reminder.fired_at else {
            continue;
        };
        let id = format!("reminder:{}:{occurred_at}", reminder.id);
        if !alerts.iter().any(|alert| alert.id == id) {
            alerts.push(ToolAlert {
                id,
                kind: ToolAlertKind::Reminder,
                title: String::new(),
                body: reminder.label,
                occurred_at,
                free_focus: None,
                pomodoro: None,
                activity_reminder: None,
            });
        }
    }
    alerts.sort_by_key(|alert| alert.occurred_at);
    alerts
}

pub async fn resolve_reminder_alert<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    alert_id: &str,
    delay_minutes: Option<u32>,
) -> Result<ToolsRuntimeSnapshot, String> {
    let alert = get_alerts(app)
        .into_iter()
        .find(|alert| alert.id == alert_id && alert.kind == ToolAlertKind::Reminder)
        .ok_or("reminder alert is unavailable")?;
    let reminder_id = alert
        .id
        .strip_prefix("reminder:")
        .and_then(|id| id.split(':').next())
        .and_then(|id| id.parse::<i64>().ok())
        .ok_or("invalid reminder alert identity")?;
    let snapshot = apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::ResolveReminderAlert {
            reminder_id,
            fired_at: alert.occurred_at,
            delay_minutes,
        },
        now_ms(),
    )
    .await?;
    dismiss_alert(app, alert_id);
    Ok(snapshot)
}

pub async fn create_reminder<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    label: String,
    scheduled_at: i64,
    recurrence: Option<crate::domain::reminder_schedule::ReminderRecurrence>,
) -> Result<ToolsRuntimeSnapshot, String> {
    let now_ms = now_ms();
    if scheduled_at <= now_ms {
        return Err("reminder time must be in the future".to_string());
    }
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::CreateReminder {
            label,
            scheduled_at,
            recurrence,
        },
        now_ms,
    )
    .await
}

pub async fn cancel_reminder<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    reminder_id: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::CancelReminder { reminder_id },
        now_ms(),
    )
    .await
}

pub async fn update_reminder<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    reminder_id: i64,
    label: String,
    scheduled_at: i64,
    enabled: bool,
    recurrence: Option<crate::domain::reminder_schedule::ReminderRecurrence>,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::UpdateReminder {
            reminder_id,
            label,
            scheduled_at,
            enabled,
            recurrence,
        },
        now_ms(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timed_reminder_pending_work_survives_transient_cache_eviction() {
        let rows: Vec<_> = (0..40)
            .map(|id| ToolReminder {
                id,
                label: "Pending".into(),
                scheduled_at: id,
                created_at: 0,
                status: if id == 39 {
                    ReminderStatus::Fired
                } else {
                    ReminderStatus::PendingConfirmation
                },
                fired_at: Some(id + 100),
                cancelled_at: None,
                recurrence: None,
                recurrence_anchor_at: None,
            })
            .collect();
        let alerts = include_pending_alerts(Vec::new(), rows.clone());
        assert_eq!(alerts.len(), 39);
        assert_eq!(alerts[0].id, "reminder:0:100");
        assert_eq!(include_pending_alerts(alerts, rows).len(), 39);
    }
}
