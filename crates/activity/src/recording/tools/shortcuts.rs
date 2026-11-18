use crate::domain::tools::{PomodoroStatus, ReminderStatus, ToolsRuntimeSnapshot};
use patina_activity_model::{Shortcut, ToolTarget};
use patina_i18n::{text, Locale};

pub(super) fn from_snapshot(
    tools: ToolsRuntimeSnapshot,
    focus: bool,
    reminders: bool,
    locale: Locale,
    now: i64,
) -> Vec<Shortcut> {
    let mut entries = Vec::new();
    if focus {
        if let Some(entry) = focus_shortcut(&tools, locale, now) {
            entries.push(entry);
        }
    }
    if reminders {
        if let Some(reminder) = tools
            .reminders
            .into_iter()
            .filter(|r| r.status == ReminderStatus::Scheduled)
            .min_by_key(|r| (r.scheduled_at, r.id))
        {
            entries.push(Shortcut {
                target: ToolTarget::Reminders,
                label: reminder.label,
                at: reminder.scheduled_at,
                counting_up: false,
            });
        }
    }
    entries
}

fn focus_shortcut(tools: &ToolsRuntimeSnapshot, locale: Locale, now: i64) -> Option<Shortcut> {
    let pomodoro = tools
        .current_pomodoro
        .as_ref()
        .filter(|run| run.status == PomodoroStatus::Running);
    let mut selected_update = pomodoro.map(|run| run.updated_at);
    let mut free_focus = None;
    for task in &tools.free_focus_tasks {
        if task.status == "running" && selected_update.is_none_or(|last| task.updated_at > last) {
            selected_update = Some(task.updated_at);
            free_focus = Some(task);
        }
    }
    let (label, at, counting_up) = if let Some(task) = free_focus {
        let counting_up = task.phase == "focus";
        let at = if counting_up {
            now - task.elapsed_at(now)
        } else {
            now + task.remaining_at(now)
        };
        (task.label.clone(), at, counting_up)
    } else {
        let run = pomodoro?;
        let label = tools
            .pomodoro_tasks
            .iter()
            .find(|task| task.run.id == run.id)
            .map(|task| task.label.clone())
            .unwrap_or_default();
        (label, now + run.remaining_ms_at(now), false)
    };
    Some(Shortcut {
        target: ToolTarget::Focus,
        label: if label.is_empty() {
            text(locale, "tools.pomodoroTitle")
        } else {
            label
        },
        at,
        counting_up,
    })
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
    fn only_running_pomodoro_has_a_shortcut() {
        for status in [
            PomodoroStatus::Paused,
            PomodoroStatus::Completed,
            PomodoroStatus::Idle,
        ] {
            let tools = ToolsRuntimeSnapshot {
                current_pomodoro: Some(pomodoro(status, 100_000)),
                ..Default::default()
            };
            assert!(from_snapshot(tools, true, true, Locale::EnUs, 100_000).is_empty());
        }
    }

    #[test]
    fn running_pomodoro_uses_remaining_time_and_localized_default_label() {
        let run = pomodoro(PomodoroStatus::Running, 100_000);
        let expected = 100_000 + run.remaining_ms_at(100_000);
        let tools = ToolsRuntimeSnapshot {
            current_pomodoro: Some(run),
            ..Default::default()
        };
        assert!(from_snapshot(tools.clone(), false, true, Locale::EnUs, 100_000).is_empty());
        let entries = from_snapshot(tools, true, true, Locale::EnUs, 100_000);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, ToolTarget::Focus);
        assert_eq!(entries[0].label, text(Locale::EnUs, "tools.pomodoroTitle"));
        assert!(!entries[0].counting_up);
        assert_eq!(entries[0].at, expected);
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
        assert!(from_snapshot(tools.clone(), true, false, Locale::EnUs, 0).is_empty());
        let entries = from_snapshot(tools.clone(), true, true, Locale::EnUs, 0);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].target, ToolTarget::Reminders);
        assert_eq!(entries[0].label, "Reminder 2");
        tools.reminders.retain(|reminder| reminder.id != 2);
        assert_eq!(
            from_snapshot(tools.clone(), false, true, Locale::EnUs, 0)[0].label,
            "Reminder 3"
        );
        tools.reminders.clear();
        assert!(from_snapshot(tools, true, true, Locale::EnUs, 0).is_empty());
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
        let entries = from_snapshot(tools, true, true, Locale::EnUs, 100_000);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].label, "Reading");
        assert!(entries[0].counting_up);
        assert_eq!(entries[0].at, 70_000);
    }
}
