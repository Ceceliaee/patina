use serde::{Deserialize, Serialize};

pub const DEFAULT_COUNTDOWN_MINUTES: i64 = 25;
pub const DEFAULT_POMODORO_FOCUS_MINUTES: i64 = 25;
pub const DEFAULT_POMODORO_SHORT_BREAK_MINUTES: i64 = 5;
pub const DEFAULT_POMODORO_LONG_BREAK_MINUTES: i64 = 15;
pub const DEFAULT_POMODORO_LONG_BREAK_EVERY: i64 = 4;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderStatus {
    Scheduled,
    Fired,
    Cancelled,
}

impl ReminderStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            ReminderStatus::Scheduled => "scheduled",
            ReminderStatus::Fired => "fired",
            ReminderStatus::Cancelled => "cancelled",
        }
    }

    pub fn from_storage(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "fired" => ReminderStatus::Fired,
            "cancelled" => ReminderStatus::Cancelled,
            _ => ReminderStatus::Scheduled,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerMode {
    Stopwatch,
    Countdown,
}

impl TimerMode {
    pub fn as_str(self) -> &'static str {
        match self {
            TimerMode::Stopwatch => "stopwatch",
            TimerMode::Countdown => "countdown",
        }
    }

    pub fn from_storage(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "countdown" => TimerMode::Countdown,
            _ => TimerMode::Stopwatch,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TimerStatus {
    Idle,
    Running,
    Paused,
    Completed,
}

impl TimerStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TimerStatus::Idle => "idle",
            TimerStatus::Running => "running",
            TimerStatus::Paused => "paused",
            TimerStatus::Completed => "completed",
        }
    }

    pub fn from_storage(value: &str) -> Self {
        match value.trim().to_ascii_lowercase().as_str() {
            "running" => TimerStatus::Running,
            "paused" => TimerStatus::Paused,
            "completed" => TimerStatus::Completed,
            _ => TimerStatus::Idle,
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
    Reminder,
    Countdown,
    Pomodoro,
    SoftwareReminder,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolRuntimeSettings {
    pub default_countdown_minutes: i64,
    pub pomodoro_focus_minutes: i64,
    pub pomodoro_short_break_minutes: i64,
    pub pomodoro_long_break_minutes: i64,
    pub pomodoro_long_break_every: i64,
}

impl Default for ToolRuntimeSettings {
    fn default() -> Self {
        Self {
            default_countdown_minutes: DEFAULT_COUNTDOWN_MINUTES,
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
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolSoftwareReminderRule {
    pub id: i64,
    pub app_name: String,
    pub exe_name: Option<String>,
    pub limit_ms: i64,
    pub message: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub disabled_at: Option<i64>,
    pub last_fired_date_key: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolTimer {
    pub id: i64,
    pub mode: TimerMode,
    pub label: Option<String>,
    pub duration_ms: Option<i64>,
    pub accumulated_ms: i64,
    pub started_at: Option<i64>,
    pub paused_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub status: TimerStatus,
    pub created_at: i64,
    pub updated_at: i64,
}

impl ToolTimer {
    pub fn elapsed_ms_at(&self, now_ms: i64) -> i64 {
        let running_delta = match (self.status, self.started_at) {
            (TimerStatus::Running, Some(started_at)) => now_ms.saturating_sub(started_at),
            _ => 0,
        };
        self.accumulated_ms.saturating_add(running_delta).max(0)
    }

    pub fn remaining_ms_at(&self, now_ms: i64) -> Option<i64> {
        let duration_ms = self.duration_ms?;
        Some(
            duration_ms
                .saturating_sub(self.elapsed_ms_at(now_ms))
                .max(0),
        )
    }

    pub fn is_countdown_due(&self, now_ms: i64) -> bool {
        self.mode == TimerMode::Countdown
            && self.status == TimerStatus::Running
            && self
                .remaining_ms_at(now_ms)
                .map(|remaining| remaining <= 0)
                .unwrap_or(false)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolTimerLap {
    pub id: i64,
    pub timer_id: i64,
    pub lap_index: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompletedTimerNotification {
    pub timer_id: i64,
    pub label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CompletedPomodoroNotification {
    pub run_id: i64,
    pub completed_phase: PomodoroPhase,
    pub next_phase: PomodoroPhase,
    pub completed_focus_count: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SoftwareReminderNotification {
    pub rule_id: i64,
    pub app_name: String,
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
                base_remaining.saturating_sub(now_ms.saturating_sub(started_at))
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
    pub settings: ToolRuntimeSettings,
    pub reminders: Vec<ToolReminder>,
    pub software_reminder_rules: Vec<ToolSoftwareReminderRule>,
    pub current_timer: Option<ToolTimer>,
    pub timer_laps: Vec<ToolTimerLap>,
    pub current_pomodoro: Option<ToolPomodoroRun>,
    pub today_completed_pomodoros: i64,
    pub next_reminder_at: Option<i64>,
    pub sampled_at_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolAlert {
    pub id: String,
    pub kind: ToolAlertKind,
    pub title: String,
    pub body: String,
    pub occurred_at: i64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn countdown_timer_detects_due_time() {
        let timer = ToolTimer {
            id: 1,
            mode: TimerMode::Countdown,
            label: None,
            duration_ms: Some(1_000),
            accumulated_ms: 300,
            started_at: Some(10_000),
            paused_at: None,
            completed_at: None,
            status: TimerStatus::Running,
            created_at: 9_000,
            updated_at: 10_000,
        };

        assert_eq!(timer.remaining_ms_at(10_200), Some(500));
        assert!(timer.is_countdown_due(10_800));
    }

    #[test]
    fn paused_stopwatch_elapsed_does_not_grow() {
        let timer = ToolTimer {
            id: 1,
            mode: TimerMode::Stopwatch,
            label: None,
            duration_ms: None,
            accumulated_ms: 2_000,
            started_at: None,
            paused_at: Some(12_000),
            completed_at: None,
            status: TimerStatus::Paused,
            created_at: 9_000,
            updated_at: 12_000,
        };

        assert_eq!(timer.elapsed_ms_at(20_000), 2_000);
    }

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
