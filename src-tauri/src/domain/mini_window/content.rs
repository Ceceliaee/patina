use crate::domain::tools::{PomodoroStatus, TimerMode, TimerStatus, ToolsRuntimeSnapshot};
use crate::domain::tracking::ActiveSessionSnapshot;
use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MiniToolKind {
    Stopwatch,
    Countdown,
    Pomodoro,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MiniToolState {
    Running,
    Paused,
    Completed,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MiniTrackingProjection {
    pub app_name: String,
    pub exe_name: String,
    pub elapsed_ms: i64,
    pub running: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MiniToolProjection {
    pub kind: MiniToolKind,
    pub state: MiniToolState,
    pub value_ms: i64,
    pub counts_down: bool,
    pub visible_until_ms: Option<i64>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct MiniStatusSnapshot {
    pub tracking: Option<MiniTrackingProjection>,
    pub tools: Vec<MiniToolProjection>,
    pub sampled_at_ms: i64,
}

const COMPLETED_TOOL_VISIBLE_MS: i64 = 5_000;

pub fn build_mini_status_snapshot(
    active_session: Option<ActiveSessionSnapshot>,
    tools: ToolsRuntimeSnapshot,
    sampled_at_ms: i64,
) -> MiniStatusSnapshot {
    let tracking = active_session.map(|session| MiniTrackingProjection {
        app_name: session.app_name,
        exe_name: session.exe_name,
        elapsed_ms: session
            .closed_duration_ms
            .saturating_add(sampled_at_ms.saturating_sub(session.start_time))
            .max(0),
        running: true,
    });
    let mut tool_slots = Vec::with_capacity(2);

    if let Some(timer) = tools.current_timer {
        let state = match timer.status {
            TimerStatus::Running => Some(MiniToolState::Running),
            TimerStatus::Paused => Some(MiniToolState::Paused),
            TimerStatus::Completed
                if sampled_at_ms.saturating_sub(timer.completed_at.unwrap_or(timer.updated_at))
                    <= COMPLETED_TOOL_VISIBLE_MS =>
            {
                Some(MiniToolState::Completed)
            }
            TimerStatus::Idle | TimerStatus::Completed => None,
        };
        if let Some(state) = state {
            let counts_down = timer.mode == TimerMode::Countdown;
            let value_ms = if counts_down {
                timer.remaining_ms_at(sampled_at_ms).unwrap_or(0)
            } else {
                timer.elapsed_ms_at(sampled_at_ms)
            };
            tool_slots.push(MiniToolProjection {
                kind: if counts_down {
                    MiniToolKind::Countdown
                } else {
                    MiniToolKind::Stopwatch
                },
                state,
                value_ms,
                counts_down,
                visible_until_ms: (state == MiniToolState::Completed).then(|| {
                    timer
                        .completed_at
                        .unwrap_or(timer.updated_at)
                        .saturating_add(COMPLETED_TOOL_VISIBLE_MS)
                }),
            });
        }
    }

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
            tool_slots.push(MiniToolProjection {
                kind: MiniToolKind::Pomodoro,
                state,
                value_ms: pomodoro.remaining_ms_at(sampled_at_ms),
                counts_down: true,
                visible_until_ms: (state == MiniToolState::Completed).then(|| {
                    pomodoro
                        .updated_at
                        .saturating_add(COMPLETED_TOOL_VISIBLE_MS)
                }),
            });
        }
    }

    MiniStatusSnapshot {
        tracking,
        tools: tool_slots,
        sampled_at_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::tools::{PomodoroPhase, ToolPomodoroRun, ToolTimer};
    fn timer(mode: TimerMode, status: TimerStatus, now_ms: i64) -> ToolTimer {
        ToolTimer {
            id: 1,
            mode,
            label: None,
            duration_ms: (mode == TimerMode::Countdown).then_some(60_000),
            accumulated_ms: 12_000,
            started_at: (status == TimerStatus::Running).then_some(now_ms - 3_000),
            paused_at: (status == TimerStatus::Paused).then_some(now_ms),
            completed_at: (status == TimerStatus::Completed).then_some(now_ms - 2_000),
            status,
            created_at: now_ms - 20_000,
            updated_at: now_ms - 2_000,
        }
    }

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
    fn mini_projection_keeps_tracking_and_fixed_tool_slots_together() {
        let now_ms = 100_000;
        let active_session = ActiveSessionSnapshot {
            id: 1,
            app_name: "Visual Studio Code".to_string(),
            exe_name: "Code.exe".to_string(),
            start_time: 90_000,
            continuity_group_start_time: 40_000,
            closed_duration_ms: 50_000,
        };
        let tools = ToolsRuntimeSnapshot {
            current_timer: Some(timer(TimerMode::Stopwatch, TimerStatus::Running, now_ms)),
            current_pomodoro: Some(pomodoro(PomodoroStatus::Paused, now_ms)),
            ..ToolsRuntimeSnapshot::default()
        };

        let snapshot = build_mini_status_snapshot(Some(active_session), tools, now_ms);

        assert_eq!(snapshot.tracking.unwrap().elapsed_ms, 60_000);
        assert_eq!(snapshot.tools.len(), 2);
        assert_eq!(snapshot.tools[0].kind, MiniToolKind::Stopwatch);
        assert_eq!(snapshot.tools[0].state, MiniToolState::Running);
        assert_eq!(snapshot.tools[0].value_ms, 15_000);
        assert_eq!(snapshot.tools[1].kind, MiniToolKind::Pomodoro);
        assert_eq!(snapshot.tools[1].state, MiniToolState::Paused);
        assert_eq!(snapshot.tools[1].value_ms, 20 * 60_000);
    }

    #[test]
    fn mini_projection_has_one_timer_domain_slot_and_excludes_reminders() {
        let now_ms = 100_000;
        let tools = ToolsRuntimeSnapshot {
            current_timer: Some(timer(TimerMode::Countdown, TimerStatus::Paused, now_ms)),
            ..ToolsRuntimeSnapshot::default()
        };

        let snapshot = build_mini_status_snapshot(None, tools, now_ms);

        assert!(snapshot.tracking.is_none());
        assert_eq!(snapshot.tools.len(), 1);
        assert_eq!(snapshot.tools[0].kind, MiniToolKind::Countdown);
        assert!(snapshot.tools[0].counts_down);
        assert_eq!(snapshot.tools[0].value_ms, 48_000);
    }

    #[test]
    fn completed_tool_slot_expires_after_five_seconds() {
        let completed_at = 100_000;
        let visible_tools = ToolsRuntimeSnapshot {
            current_timer: Some(timer(
                TimerMode::Countdown,
                TimerStatus::Completed,
                completed_at + 2_000,
            )),
            ..ToolsRuntimeSnapshot::default()
        };
        let visible = build_mini_status_snapshot(None, visible_tools, completed_at + 2_000);
        assert_eq!(visible.tools.len(), 1);
        assert_eq!(visible.tools[0].state, MiniToolState::Completed);
        assert_eq!(
            visible.tools[0].visible_until_ms,
            Some(completed_at + 5_000)
        );

        let expired_tools = ToolsRuntimeSnapshot {
            current_timer: Some(timer(
                TimerMode::Countdown,
                TimerStatus::Completed,
                completed_at + 2_000,
            )),
            ..ToolsRuntimeSnapshot::default()
        };
        let expired = build_mini_status_snapshot(None, expired_tools, completed_at + 6_001);
        assert!(expired.tools.is_empty());
    }
}
