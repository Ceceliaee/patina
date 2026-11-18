use crate::domain::tools::{PomodoroPhase, PomodoroStatus, ReminderStatus, ToolsRuntimeSnapshot};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MiniToolKind {
    Pomodoro,
    FreeFocus,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MiniToolState {
    Running,
    Paused,
    Completed,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MiniToolProjection {
    pub id: i64,
    pub label: String,
    pub counting_up: bool,
    pub kind: MiniToolKind,
    pub state: MiniToolState,
    pub value_ms: i64,
    pub visible_until_ms: Option<i64>,
    pub total_ms: Option<i64>,
    pub phase: Option<PomodoroPhase>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MiniStatusSnapshot {
    pub tools: Vec<MiniToolProjection>,
    pub reminder: Option<MiniReminderProjection>,
    pub sampled_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MiniReminderProjection {
    pub id: i64,
    pub label: String,
    pub scheduled_at: i64,
}

const COMPLETED_TOOL_VISIBLE_MS: i64 = 5_000;

pub fn build_mini_status_snapshot(
    tools: ToolsRuntimeSnapshot,
    sampled_at_ms: i64,
) -> MiniStatusSnapshot {
    let mut tool_slots = Vec::with_capacity(1);
    let mut selected_priority = (false, i64::MIN);

    if let Some(pomodoro) = tools.current_pomodoro {
        let state = match pomodoro.status {
            PomodoroStatus::Running => Some(MiniToolState::Running),
            PomodoroStatus::Paused => Some(MiniToolState::Paused),
            PomodoroStatus::Completed
                if sampled_at_ms.saturating_sub(pomodoro.updated_at)
                    <= COMPLETED_TOOL_VISIBLE_MS =>
            {
                Some(MiniToolState::Completed)
            }
            PomodoroStatus::Idle | PomodoroStatus::Completed => None,
        };
        if let Some(state) = state {
            selected_priority = (state == MiniToolState::Running, pomodoro.updated_at);
            tool_slots.push(MiniToolProjection {
                id: pomodoro.id,
                label: tools
                    .pomodoro_tasks
                    .iter()
                    .find(|task| task.run.id == pomodoro.id)
                    .map(|task| task.label.clone())
                    .unwrap_or_default(),
                counting_up: false,
                kind: MiniToolKind::Pomodoro,
                state,
                value_ms: pomodoro.remaining_ms_at(sampled_at_ms),
                total_ms: Some(pomodoro.phase_duration_ms()),
                phase: Some(pomodoro.phase),
                visible_until_ms: (state == MiniToolState::Completed).then(|| {
                    pomodoro
                        .updated_at
                        .saturating_add(COMPLETED_TOOL_VISIBLE_MS)
                }),
            });
        }
    }

    for task in &tools.free_focus_tasks {
        let state = match task.status.as_str() {
            "running" => MiniToolState::Running,
            "paused" => MiniToolState::Paused,
            _ => continue,
        };
        let priority = (state == MiniToolState::Running, task.updated_at);
        if priority <= selected_priority {
            continue;
        }
        selected_priority = priority;
        tool_slots.clear();
        tool_slots.push(MiniToolProjection {
            id: task.id,
            label: task.label.clone(),
            kind: MiniToolKind::FreeFocus,
            state,
            counting_up: task.phase == "focus",
            value_ms: if task.phase == "focus" {
                task.elapsed_at(sampled_at_ms)
            } else {
                task.remaining_at(sampled_at_ms)
            },
            total_ms: None,
            visible_until_ms: None,
            phase: Some(if task.phase == "focus" {
                PomodoroPhase::Focus
            } else {
                PomodoroPhase::ShortBreak
            }),
        });
    }

    let reminder = tools
        .reminders
        .iter()
        .filter(|reminder| reminder.status == ReminderStatus::Scheduled)
        .min_by_key(|reminder| (reminder.scheduled_at, reminder.id))
        .map(|reminder| MiniReminderProjection {
            id: reminder.id,
            label: reminder.label.clone(),
            scheduled_at: reminder.scheduled_at,
        });

    MiniStatusSnapshot {
        tools: tool_slots,
        reminder,
        sampled_at_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::tools::{PomodoroPhase, ToolPomodoroRun};

    fn pomodoro(status: PomodoroStatus, now_ms: i64) -> ToolPomodoroRun {
        ToolPomodoroRun {
            id: 2,
            phase: PomodoroPhase::Focus,
            status,
            cycle_index: 1,
            focus_ms: 25 * 60_000,
            short_break_ms: 5 * 60_000,
            long_break_ms: 15 * 60_000,
            long_break_every: 4,
            phase_started_at: (status == PomodoroStatus::Running).then_some(now_ms - 4_000),
            phase_paused_at: (status == PomodoroStatus::Paused).then_some(now_ms),
            phase_remaining_ms: Some(20 * 60_000),
            completed_focus_count: 0,
            created_at: now_ms - 30_000,
            updated_at: now_ms - 2_000,
        }
    }

    #[test]
    fn mini_projection_preserves_paused_pomodoro() {
        let now_ms = 100_000;
        let tools = ToolsRuntimeSnapshot {
            current_pomodoro: Some(pomodoro(PomodoroStatus::Paused, now_ms)),
            ..ToolsRuntimeSnapshot::default()
        };

        let snapshot = build_mini_status_snapshot(tools, now_ms);
        assert_eq!(snapshot.tools.len(), 1);
        assert_eq!(snapshot.tools[0].kind, MiniToolKind::Pomodoro);
        assert_eq!(snapshot.tools[0].state, MiniToolState::Paused);
        assert_eq!(snapshot.tools[0].value_ms, 20 * 60_000);
    }

    #[test]
    fn completed_tool_slot_expires_after_five_seconds() {
        let completed_at = 100_000;
        let visible_tools = ToolsRuntimeSnapshot {
            current_pomodoro: Some(pomodoro(PomodoroStatus::Completed, completed_at + 2_000)),
            ..ToolsRuntimeSnapshot::default()
        };
        let visible = build_mini_status_snapshot(visible_tools, completed_at + 2_000);
        assert_eq!(visible.tools.len(), 1);
        assert_eq!(visible.tools[0].state, MiniToolState::Completed);
        assert_eq!(
            visible.tools[0].visible_until_ms,
            Some(completed_at + 5_000)
        );

        let expired_tools = ToolsRuntimeSnapshot {
            current_pomodoro: Some(pomodoro(PomodoroStatus::Completed, completed_at + 2_000)),
            ..ToolsRuntimeSnapshot::default()
        };
        let expired = build_mini_status_snapshot(expired_tools, completed_at + 6_001);
        assert!(expired.tools.is_empty());
    }

    #[test]
    fn earliest_scheduled_reminder_wins_with_stable_ties_and_no_other_entry() {
        use crate::domain::tools::ToolReminder;
        let reminder = |id, scheduled_at, status| ToolReminder {
            id,
            scheduled_at,
            status,
            label: format!("Reminder {id}"),
            created_at: 0,
            fired_at: None,
            cancelled_at: None,
            recurrence: None,
            recurrence_anchor_at: None,
        };
        let mut tools = ToolsRuntimeSnapshot {
            reminders: vec![
                reminder(5, 300, ReminderStatus::Scheduled),
                reminder(3, 200, ReminderStatus::Scheduled),
                reminder(2, 200, ReminderStatus::Scheduled),
                reminder(1, 100, ReminderStatus::Paused),
                reminder(4, 50, ReminderStatus::PendingConfirmation),
            ],
            ..ToolsRuntimeSnapshot::default()
        };
        let status = build_mini_status_snapshot(tools.clone(), 0);
        assert!(status.tools.is_empty());
        assert_eq!(status.reminder.unwrap().id, 2);
        tools.reminders.retain(|reminder| reminder.id != 2);
        assert_eq!(
            build_mini_status_snapshot(tools.clone(), 0)
                .reminder
                .unwrap()
                .id,
            3
        );
        tools.reminders.clear();
        assert!(build_mini_status_snapshot(tools, 0).reminder.is_none());
    }

    #[test]
    fn running_free_focus_counts_up_and_takes_priority_over_paused_pomodoro() {
        use crate::domain::free_focus::{FreeFocusTask, RestMode};
        let tools = ToolsRuntimeSnapshot {
            current_pomodoro: Some(pomodoro(PomodoroStatus::Paused, 100_000)),
            free_focus_tasks: vec![FreeFocusTask {
                id: 7,
                label: "Reading".into(),
                rest_mode: RestMode::Fixed,
                rest_minutes: 5,
                rest_ratio: 5,
                phase: "focus".into(),
                status: "running".into(),
                elapsed_ms: 20_000,
                rest_remaining_ms: 0,
                started_at: Some(90_000),
                created_at: 0,
                updated_at: 90_000,
                deleted_at: None,
            }],
            ..ToolsRuntimeSnapshot::default()
        };
        let status = build_mini_status_snapshot(tools, 100_000);
        assert_eq!(status.tools.len(), 1);
        assert_eq!(status.tools[0].id, 7);
        assert!(status.tools[0].counting_up);
        assert_eq!(status.tools[0].value_ms, 30_000);
    }
}
