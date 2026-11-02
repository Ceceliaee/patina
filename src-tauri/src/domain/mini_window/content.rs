use crate::domain::tools::{PomodoroPhase, PomodoroStatus, ToolsRuntimeSnapshot};
use serde::Serialize;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MiniToolKind {
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
pub struct MiniToolProjection {
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
    pub sampled_at_ms: i64,
}

const COMPLETED_TOOL_VISIBLE_MS: i64 = 5_000;

pub fn build_mini_status_snapshot(
    tools: ToolsRuntimeSnapshot,
    sampled_at_ms: i64,
) -> MiniStatusSnapshot {
    let mut tool_slots = Vec::with_capacity(1);

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

    MiniStatusSnapshot {
        tools: tool_slots,
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
}
