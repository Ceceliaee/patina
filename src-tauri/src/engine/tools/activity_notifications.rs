use super::CreateActivityReminderRuleRequest;
use super::{
    apply_mutation_and_refresh, date_key, day_start_ms, dismiss_alert, get_alerts, now_ms,
    ToolsMutation, ToolsStore,
};
use crate::domain::localization::{self, Locale};
use crate::domain::tools::ToolsRuntimeSnapshot;
use crate::domain::tools::{
    ActivityReminderAlert, ActivityReminderNotification, ActivityReminderTarget, ToolAlert,
    ToolAlertKind,
};
use tauri::{AppHandle, Runtime};

pub(super) fn build_activity_reminder_alerts(
    reminders: Vec<ActivityReminderNotification>,
    locale: Locale,
    date_key: &str,
    now_ms: i64,
) -> Vec<ToolAlert> {
    reminders
        .into_iter()
        .map(|reminder| {
            let limit_minutes = (reminder.limit_ms / 60_000).max(1);
            let usage_minutes = (reminder.usage_ms / 60_000).max(limit_minutes);
            let body = if reminder.message.trim().is_empty() {
                localization::format_text(
                    locale,
                    "native.tools.activityReminderDefaultBody",
                    &[
                        ("targetName", reminder.target_label.clone()),
                        ("usageMinutes", usage_minutes.to_string()),
                        ("limitMinutes", limit_minutes.to_string()),
                    ],
                )
            } else {
                reminder.message.clone()
            };
            let title_key = match reminder.target {
                ActivityReminderTarget::App { .. } => "native.tools.activityReminderAppTitle",
                ActivityReminderTarget::Category { .. } => {
                    "native.tools.activityReminderCategoryTitle"
                }
                ActivityReminderTarget::Web { .. } => "native.tools.activityReminderWebTitle",
            };
            ToolAlert {
                id: format!("activity-reminder:{}:{date_key}:{now_ms}", reminder.rule_id),
                kind: ToolAlertKind::ActivityReminder,
                title: localization::text(locale, title_key),
                body,
                occurred_at: now_ms,
                activity_reminder: Some(ActivityReminderAlert {
                    rule_id: reminder.rule_id,
                    date_key: date_key.to_string(),
                    target: reminder.target,
                    target_label: reminder.target_label,
                    usage_ms: reminder.usage_ms,
                    limit_ms: reminder.limit_ms,
                    message: reminder.message,
                }),
            }
        })
        .collect()
}

pub async fn extend_activity_reminder<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    alert_id: &str,
    extension: crate::domain::tools::ActivityReminderExtension,
) -> Result<ToolsRuntimeSnapshot, String> {
    let alert = get_alerts(app)
        .into_iter()
        .find(|alert| alert.id == alert_id)
        .ok_or("activity reminder alert is unavailable")?;
    let details = alert
        .activity_reminder
        .ok_or("alert is not an activity reminder")?;
    if details.date_key != date_key() {
        return Err("activity reminder alert has expired".into());
    }
    let snapshot = apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::ExtendActivityReminder {
            rule_id: details.rule_id,
            alert_at: alert.occurred_at,
            extension,
            day_start_ms: day_start_ms(),
        },
        now_ms(),
    )
    .await?;
    dismiss_alert(app, alert_id);
    Ok(snapshot)
}

pub async fn create_activity_reminder_rule<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    request: CreateActivityReminderRuleRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::CreateActivityReminderRule(request),
        now_ms(),
    )
    .await
}

pub async fn disable_activity_reminder_rule<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    rule_id: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::DisableActivityReminderRule { rule_id },
        now_ms(),
    )
    .await
}

pub async fn set_activity_reminder_enabled<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    rule_id: i64,
    enabled: bool,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::SetActivityReminderEnabled { rule_id, enabled },
        now_ms(),
    )
    .await
}

pub async fn update_activity_reminder_limit<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    rule_id: i64,
    limit_ms: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::UpdateActivityReminderLimit { rule_id, limit_ms },
        now_ms(),
    )
    .await
}
