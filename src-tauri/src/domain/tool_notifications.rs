use crate::domain::tools::{ToolAlert, ToolAlertKind, ToolsRuntimeSnapshot};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Delivery {
    #[default]
    Notification,
    Dialog,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Sound {
    #[default]
    Default,
    Bell,
    Clear,
    None,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, deny_unknown_fields)]
pub struct Preferences {
    pub delivery: Delivery,
    pub sound: Sound,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreferencesPatch {
    pub delivery: Option<Delivery>,
    pub sound: Option<Sound>,
}

impl Preferences {
    pub fn apply(&mut self, patch: PreferencesPatch) {
        if let Some(value) = patch.delivery {
            self.delivery = value;
        }
        if let Some(value) = patch.sound {
            self.sound = value;
        }
    }
}

pub fn is_current(alert: &ToolAlert, snapshot: &ToolsRuntimeSnapshot) -> bool {
    match alert.kind {
        ToolAlertKind::Reminder => snapshot.reminders.iter().any(|r| {
            r.status == crate::domain::tools::ReminderStatus::PendingConfirmation
                && r.fired_at == Some(alert.occurred_at)
                && alert.id == format!("reminder:{}:{}", r.id, alert.occurred_at)
        }),
        ToolAlertKind::Pomodoro => alert.pomodoro.as_ref().is_some_and(|a| {
            snapshot
                .pomodoro_tasks
                .iter()
                .any(|t| t.run.id == a.run.id && t.run.updated_at == a.run.updated_at)
        }),
        ToolAlertKind::FreeFocus => alert.free_focus.as_ref().is_some_and(|a| {
            snapshot
                .free_focus_tasks
                .iter()
                .any(|t| t.id == a.id && t.updated_at == a.updated_at)
        }),
        ToolAlertKind::ActivityReminder => alert.activity_reminder.as_ref().is_some_and(|a| {
            snapshot.activity_reminder_rules.iter().any(|r| {
                r.id == a.rule_id
                    && r.enabled
                    && r.disabled_at.is_none()
                    && r.limit_for_date(&a.date_key) == Some(a.limit_ms)
                    && r.target == a.target
                    && r.last_fired_at == Some(alert.occurred_at)
                    && r.last_extended_alert_at != Some(alert.occurred_at)
                    && r.suspension_reason.is_none()
            })
        }),
    }
}

pub fn same_source(a: &ToolAlert, b: &ToolAlert) -> bool {
    if a.kind != b.kind {
        return false;
    }
    match a.kind {
        ToolAlertKind::Reminder => {
            a.id.rsplit_once(':').map(|v| v.0) == b.id.rsplit_once(':').map(|v| v.0)
        }
        ToolAlertKind::Pomodoro => a
            .pomodoro
            .as_ref()
            .zip(b.pomodoro.as_ref())
            .is_some_and(|(a, b)| a.run.id == b.run.id),
        ToolAlertKind::FreeFocus => a
            .free_focus
            .as_ref()
            .zip(b.free_focus.as_ref())
            .is_some_and(|(a, b)| a.id == b.id),
        ToolAlertKind::ActivityReminder => a
            .activity_reminder
            .as_ref()
            .zip(b.activity_reminder.as_ref())
            .is_some_and(|(a, b)| a.rule_id == b.rule_id),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notification_preferences_reject_unknown_values_and_preserve_missing_fields() {
        let mut p: Preferences = serde_json::from_str("{}").unwrap();
        assert_eq!(p, Preferences::default());
        p.apply(serde_json::from_str(r#"{"sound":"none"}"#).unwrap());
        assert_eq!(p.delivery, Delivery::Notification);
        assert_eq!(p.sound, Sound::None);
        for value in [
            r#"{"delivery":"windows"}"#,
            r#"{"sound":"C:/audio.wav"}"#,
            r#"{"volume":1}"#,
        ] {
            assert!(serde_json::from_str::<PreferencesPatch>(value).is_err());
        }
    }
}
