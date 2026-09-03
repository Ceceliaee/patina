use crate::domain::tools::{PomodoroStatus, TimerMode, TimerStatus, ToolsRuntimeSnapshot};
use crate::domain::tracking::ActiveSessionSnapshot;
use crate::domain::widget::{
    WidgetExpansionPreference, WidgetPlacement, WidgetStatusSnapshot, WidgetToolKind,
    WidgetToolProjection, WidgetToolState, WidgetTrackingProjection,
};
use std::future::Future;
use std::pin::Pin;

pub type WidgetStoreFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait WidgetPlacementStore: Send + Sync {
    fn load_placement(&self) -> WidgetStoreFuture<'_, WidgetPlacement>;
    fn save_placement(&self, placement: WidgetPlacement) -> WidgetStoreFuture<'_, ()>;
}

pub trait WidgetExpansionPreferenceStore: Send + Sync {
    fn load_expansion_preference(&self) -> WidgetStoreFuture<'_, WidgetExpansionPreference>;
    fn save_expansion_preference(
        &self,
        preference: WidgetExpansionPreference,
    ) -> WidgetStoreFuture<'_, ()>;
}

pub async fn load_widget_placement(
    store: &impl WidgetPlacementStore,
) -> Result<WidgetPlacement, String> {
    store
        .load_placement()
        .await
        .map_err(|error| format!("failed to load widget placement: {error}"))
}

pub async fn save_widget_placement(
    store: &impl WidgetPlacementStore,
    placement: WidgetPlacement,
) -> Result<(), String> {
    store
        .save_placement(placement)
        .await
        .map_err(|error| format!("failed to save widget placement: {error}"))
}

pub async fn load_widget_expansion_preference(
    store: &impl WidgetExpansionPreferenceStore,
) -> Result<WidgetExpansionPreference, String> {
    store
        .load_expansion_preference()
        .await
        .map_err(|error| format!("failed to load widget expansion preference: {error}"))
}

pub async fn save_widget_expansion_preference(
    store: &impl WidgetExpansionPreferenceStore,
    preference: WidgetExpansionPreference,
) -> Result<(), String> {
    store
        .save_expansion_preference(preference)
        .await
        .map_err(|error| format!("failed to save widget expansion preference: {error}"))
}

const COMPLETED_TOOL_VISIBLE_MS: i64 = 5_000;

pub fn build_widget_status_snapshot(
    active_session: Option<ActiveSessionSnapshot>,
    tools: ToolsRuntimeSnapshot,
    sampled_at_ms: i64,
) -> WidgetStatusSnapshot {
    let tracking = active_session.map(|session| WidgetTrackingProjection {
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
            TimerStatus::Running => Some(WidgetToolState::Running),
            TimerStatus::Paused => Some(WidgetToolState::Paused),
            TimerStatus::Completed
                if sampled_at_ms.saturating_sub(timer.completed_at.unwrap_or(timer.updated_at))
                    <= COMPLETED_TOOL_VISIBLE_MS =>
            {
                Some(WidgetToolState::Completed)
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
            tool_slots.push(WidgetToolProjection {
                kind: if counts_down {
                    WidgetToolKind::Countdown
                } else {
                    WidgetToolKind::Stopwatch
                },
                state,
                value_ms,
                counts_down,
                visible_until_ms: (state == WidgetToolState::Completed).then(|| {
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
            PomodoroStatus::Running => Some(WidgetToolState::Running),
            PomodoroStatus::Paused => Some(WidgetToolState::Paused),
            PomodoroStatus::Completed
                if sampled_at_ms.saturating_sub(pomodoro.updated_at)
                    <= COMPLETED_TOOL_VISIBLE_MS =>
            {
                Some(WidgetToolState::Completed)
            }
            PomodoroStatus::Idle | PomodoroStatus::Completed => None,
        };
        if let Some(state) = state {
            tool_slots.push(WidgetToolProjection {
                kind: WidgetToolKind::Pomodoro,
                state,
                value_ms: pomodoro.remaining_ms_at(sampled_at_ms),
                counts_down: true,
                visible_until_ms: (state == WidgetToolState::Completed).then(|| {
                    pomodoro
                        .updated_at
                        .saturating_add(COMPLETED_TOOL_VISIBLE_MS)
                }),
            });
        }
    }

    WidgetStatusSnapshot {
        tracking,
        tools: tool_slots,
        sampled_at_ms,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::tools::{
        PomodoroPhase, PomodoroStatus, TimerMode, TimerStatus, ToolPomodoroRun, ToolTimer,
        ToolsRuntimeSnapshot,
    };
    use crate::domain::tracking::ActiveSessionSnapshot;
    use crate::domain::widget::WidgetSide;
    use crate::domain::widget::{WidgetToolKind, WidgetToolState};
    use std::sync::Mutex;

    struct MemoryWidgetStore {
        placement: Mutex<WidgetPlacement>,
    }

    impl WidgetPlacementStore for MemoryWidgetStore {
        fn load_placement(&self) -> WidgetStoreFuture<'_, WidgetPlacement> {
            Box::pin(async move { Ok(self.placement.lock().unwrap().clone()) })
        }

        fn save_placement(&self, placement: WidgetPlacement) -> WidgetStoreFuture<'_, ()> {
            Box::pin(async move {
                *self.placement.lock().unwrap() = placement;
                Ok(())
            })
        }
    }

    #[test]
    fn widget_engine_uses_store_contract_without_storage_details() {
        tauri::async_runtime::block_on(async {
            let initial = WidgetPlacement::new(WidgetSide::Left, 0.2);
            let next = WidgetPlacement::new(WidgetSide::Right, 0.8);
            let store = MemoryWidgetStore {
                placement: Mutex::new(initial.clone()),
            };

            assert_eq!(load_widget_placement(&store).await.unwrap(), initial);
            save_widget_placement(&store, next.clone()).await.unwrap();
            assert_eq!(load_widget_placement(&store).await.unwrap(), next);
        });
    }

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
    fn widget_projection_keeps_tracking_and_fixed_tool_slots_together() {
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

        let snapshot = build_widget_status_snapshot(Some(active_session), tools, now_ms);

        assert_eq!(snapshot.tracking.unwrap().elapsed_ms, 60_000);
        assert_eq!(snapshot.tools.len(), 2);
        assert_eq!(snapshot.tools[0].kind, WidgetToolKind::Stopwatch);
        assert_eq!(snapshot.tools[0].state, WidgetToolState::Running);
        assert_eq!(snapshot.tools[0].value_ms, 15_000);
        assert_eq!(snapshot.tools[1].kind, WidgetToolKind::Pomodoro);
        assert_eq!(snapshot.tools[1].state, WidgetToolState::Paused);
        assert_eq!(snapshot.tools[1].value_ms, 20 * 60_000);
    }

    #[test]
    fn widget_projection_has_one_timer_domain_slot_and_excludes_reminders() {
        let now_ms = 100_000;
        let tools = ToolsRuntimeSnapshot {
            current_timer: Some(timer(TimerMode::Countdown, TimerStatus::Paused, now_ms)),
            ..ToolsRuntimeSnapshot::default()
        };

        let snapshot = build_widget_status_snapshot(None, tools, now_ms);

        assert!(snapshot.tracking.is_none());
        assert_eq!(snapshot.tools.len(), 1);
        assert_eq!(snapshot.tools[0].kind, WidgetToolKind::Countdown);
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
        let visible = build_widget_status_snapshot(None, visible_tools, completed_at + 2_000);
        assert_eq!(visible.tools.len(), 1);
        assert_eq!(visible.tools[0].state, WidgetToolState::Completed);
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
        let expired = build_widget_status_snapshot(None, expired_tools, completed_at + 6_001);
        assert!(expired.tools.is_empty());
    }
}
