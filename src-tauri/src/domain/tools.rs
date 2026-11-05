use serde::{Deserialize, Serialize};

pub const DEFAULT_POMODORO_FOCUS_MINUTES: i64 = 25;
pub const DEFAULT_POMODORO_SHORT_BREAK_MINUTES: i64 = 5;
pub const DEFAULT_POMODORO_LONG_BREAK_MINUTES: i64 = 15;
pub const DEFAULT_POMODORO_LONG_BREAK_EVERY: i64 = 4;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderStatus {
    Scheduled,
    Paused,
    PendingConfirmation,
    // The legacy fired status is a finished reminder; new alerts wait for confirmation first.
    Fired,
    Cancelled,
}

impl ReminderStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ReminderStatus::Scheduled => "scheduled",
            ReminderStatus::Paused => "paused",
            ReminderStatus::PendingConfirmation => "pending_confirmation",
            ReminderStatus::Fired => "fired",
            ReminderStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_storage(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "paused" => ReminderStatus::Paused,
            "pending_confirmation" => ReminderStatus::PendingConfirmation,
            "fired" => ReminderStatus::Fired,
            "cancelled" => ReminderStatus::Cancelled,
            _ => ReminderStatus::Scheduled,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PomodoroPhase {
    Focus,
    ShortBreak,
    LongBreak,
}

impl PomodoroPhase {
    pub fn as_str(self) -> &'static str {
        match self {
            PomodoroPhase::Focus => "focus",
            PomodoroPhase::ShortBreak => "short_break",
            PomodoroPhase::LongBreak => "long_break",
        }
    }

    pub fn from_storage(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "short_break" => PomodoroPhase::ShortBreak,
            "long_break" => PomodoroPhase::LongBreak,
            _ => PomodoroPhase::Focus,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PomodoroStatus {
    Idle,
    Running,
    Paused,
    Completed,
}

impl PomodoroStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            PomodoroStatus::Idle => "idle",
            PomodoroStatus::Running => "running",
            PomodoroStatus::Paused => "paused",
            PomodoroStatus::Completed => "completed",
        }
    }

    pub fn from_storage(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "running" => PomodoroStatus::Running,
            "paused" => PomodoroStatus::Paused,
            "completed" => PomodoroStatus::Completed,
            _ => PomodoroStatus::Idle,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolAlertKind {
    FreeFocus,
    Reminder,
    Pomodoro,
    ActivityReminder,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolRuntimeSettings {
    pub pomodoro_focus_minutes: i64,
    pub pomodoro_short_break_minutes: i64,
    pub pomodoro_long_break_minutes: i64,
    pub pomodoro_long_break_every: i64,
}

impl Default for ToolRuntimeSettings {
    fn default() -> Self {
        Self {
            pomodoro_focus_minutes: DEFAULT_POMODORO_FOCUS_MINUTES,
            pomodoro_short_break_minutes: DEFAULT_POMODORO_SHORT_BREAK_MINUTES,
            pomodoro_long_break_minutes: DEFAULT_POMODORO_LONG_BREAK_MINUTES,
            pomodoro_long_break_every: DEFAULT_POMODORO_LONG_BREAK_EVERY,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolReminder {
    pub id: i64,
    pub label: String,
    pub scheduled_at: i64,
    pub created_at: i64,
    pub status: ReminderStatus,
    pub fired_at: Option<i64>,
    pub cancelled_at: Option<i64>,
    pub recurrence: Option<crate::domain::reminder_schedule::ReminderRecurrence>,
    pub recurrence_anchor_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActivityReminderTarget {
    App {
        app_name: String,
        exe_name: Option<String>,
    },
    Category {
        category_id: String,
    },
    Web {
        normalized_domain: String,
    },
}

#[derive(Clone, Debug, Default)]
pub struct ActivityReminderWatch {
    pub rules: Vec<ActivityReminderWatchedRule>,
    pub classification: crate::domain::classification::ClassificationSnapshot,
}

impl ActivityReminderWatch {
    pub fn next_check_at(&self) -> Option<i64> {
        self.rules
            .iter()
            .filter_map(|rule| rule.next_check_at)
            .min()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActivityReminderWatchedRule {
    pub id: i64,
    pub target: ActivityReminderTarget,
    pub active: bool,
    pub next_check_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ActivityReminderCheck {
    All,
    Rules(Vec<i64>),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityReminderSuspensionReason {
    SourceDisabled,
    TargetExcluded,
    TargetDeleted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolActivityReminderRule {
    pub id: i64,
    pub enabled: bool,
    pub target: ActivityReminderTarget,
    pub label_snapshot: String,
    pub limit_ms: i64,
    pub message: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub disabled_at: Option<i64>,
    pub last_fired_date_key: Option<String>,
    pub last_fired_at: Option<i64>,
    pub extension_date_key: Option<String>,
    pub extension_limit_ms: Option<i64>,
    pub last_extended_alert_at: Option<i64>,
    pub suspension_reason: Option<ActivityReminderSuspensionReason>,
}

impl ToolActivityReminderRule {
    pub fn limit_for_date(&self, date_key: &str) -> Option<i64> {
        if self.extension_date_key.as_deref() == Some(date_key) {
            self.extension_limit_ms
                .map(|limit| limit.max(self.limit_ms))
        } else {
            Some(self.limit_ms)
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityReminderExtension {
    FifteenMinutes,
    OneHour,
    Today,
}

impl ActivityReminderExtension {
    pub fn additional_ms(self) -> Option<i64> {
        match self {
            Self::FifteenMinutes => Some(15 * 60_000),
            Self::OneHour => Some(60 * 60_000),
            Self::Today => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolPomodoroRun {
    pub id: i64,
    pub phase: PomodoroPhase,
    pub status: PomodoroStatus,
    pub cycle_index: i64,
    pub focus_ms: i64,
    pub short_break_ms: i64,
    pub long_break_ms: i64,
    pub long_break_every: i64,
    pub phase_started_at: Option<i64>,
    pub phase_paused_at: Option<i64>,
    pub phase_remaining_ms: Option<i64>,
    pub completed_focus_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolPomodoroTask {
    pub label: String,
    pub completed_groups: i64,
    pub run: ToolPomodoroRun,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PomodoroTaskAction {
    Save {
        id: Option<i64>,
        label: String,
        focus_ms: i64,
        short_break_ms: i64,
        long_break_ms: i64,
        long_break_every: i64,
    },
    Resume {
        id: i64,
    },
    StartNext {
        id: i64,
        expected_updated_at: i64,
    },
    Pause {
        id: i64,
    },
    Skip {
        id: i64,
    },
    Reset {
        id: i64,
    },
    Delete {
        id: i64,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompletedPomodoroNotification {
    pub task: ToolPomodoroTask,
    pub run_id: i64,
    pub completed_phase: PomodoroPhase,
    pub next_phase: PomodoroPhase,
    pub completed_focus_count: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ActivityReminderNotification {
    pub rule_id: i64,
    pub target: ActivityReminderTarget,
    pub target_label: String,
    pub limit_ms: i64,
    pub usage_ms: i64,
    pub message: String,
}

impl ToolPomodoroRun {
    pub fn phase_duration_ms(&self) -> i64 {
        match self.phase {
            PomodoroPhase::Focus => self.focus_ms,
            PomodoroPhase::ShortBreak => self.short_break_ms,
            PomodoroPhase::LongBreak => self.long_break_ms,
        }
    }

    pub fn remaining_ms_at(&self, now_ms: i64) -> i64 {
        let base_remaining = self
            .phase_remaining_ms
            .unwrap_or_else(|| self.phase_duration_ms());
        match (self.status, self.phase_started_at) {
            (PomodoroStatus::Running, Some(started_at)) => {
                base_remaining.saturating_sub(now_ms.saturating_sub(started_at).max(0))
            }
            _ => base_remaining,
        }
        .max(0)
    }

    pub fn is_phase_due(&self, now_ms: i64) -> bool {
        self.status == PomodoroStatus::Running && self.remaining_ms_at(now_ms) <= 0
    }

    pub fn next_phase_after_completion(&self) -> (PomodoroPhase, i64, i64) {
        match self.phase {
            PomodoroPhase::Focus => {
                let completed_focus_count = self.completed_focus_count.saturating_add(1);
                let phase = if completed_focus_count % self.long_break_every.max(1) == 0 {
                    PomodoroPhase::LongBreak
                } else {
                    PomodoroPhase::ShortBreak
                };
                let cycle_index = if phase == PomodoroPhase::LongBreak {
                    self.long_break_every
                } else {
                    completed_focus_count % self.long_break_every.max(1)
                };
                (phase, cycle_index.max(1), completed_focus_count)
            }
            PomodoroPhase::ShortBreak | PomodoroPhase::LongBreak => (
                PomodoroPhase::Focus,
                (self.completed_focus_count % self.long_break_every.max(1)).saturating_add(1),
                self.completed_focus_count,
            ),
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct ToolsRuntimeSnapshot {
    pub free_focus_tasks: Vec<crate::domain::free_focus::FreeFocusTask>,
    pub settings: ToolRuntimeSettings,
    pub reminders: Vec<ToolReminder>,
    pub activity_reminder_rules: Vec<ToolActivityReminderRule>,
    pub current_pomodoro: Option<ToolPomodoroRun>,
    pub pomodoro_tasks: Vec<ToolPomodoroTask>,
    pub today_completed_pomodoros: i64,
    pub next_reminder_at: Option<i64>,
    pub sampled_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolAlert {
    pub free_focus: Option<crate::domain::free_focus::FreeFocusTask>,
    pub pomodoro: Option<ToolPomodoroTask>,
    pub id: String,
    pub kind: ToolAlertKind,
    pub title: String,
    pub body: String,
    pub occurred_at: i64,
    pub activity_reminder: Option<ActivityReminderAlert>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ActivityReminderAlert {
    pub rule_id: i64,
    pub date_key: String,
    pub target: ActivityReminderTarget,
    pub target_label: String,
    pub usage_ms: i64,
    pub limit_ms: i64,
    pub message: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pomodoro_fourth_focus_moves_to_long_break() {
        let run = ToolPomodoroRun {
            id: 1,
            phase: PomodoroPhase::Focus,
            status: PomodoroStatus::Running,
            cycle_index: 4,
            focus_ms: 25,
            short_break_ms: 5,
            long_break_ms: 15,
            long_break_every: 4,
            phase_started_at: Some(1),
            phase_paused_at: None,
            phase_remaining_ms: Some(0),
            completed_focus_count: 3,
            created_at: 1,
            updated_at: 1,
        };

        assert_eq!(
            run.next_phase_after_completion(),
            (PomodoroPhase::LongBreak, 4, 4)
        );
    }
}
