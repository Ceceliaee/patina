use crate::domain::localization::{self, Locale};
use crate::domain::tools::{
    ActivityReminderNotification, ActivityReminderTarget, ToolAlert, ToolAlertKind,
};

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
                reminder.message
            };
            let title_key = match reminder.target {
                ActivityReminderTarget::App { .. } => "native.tools.activityReminderAppTitle",
                ActivityReminderTarget::Category { .. } => {
                    "native.tools.activityReminderCategoryTitle"
                }
                ActivityReminderTarget::Web { .. } => "native.tools.activityReminderWebTitle",
            };
            ToolAlert {
                id: format!("activity-reminder:{}:{date_key}", reminder.rule_id),
                kind: ToolAlertKind::ActivityReminder,
                title: localization::text(locale, title_key),
                body,
                occurred_at: now_ms,
            }
        })
        .collect()
}
