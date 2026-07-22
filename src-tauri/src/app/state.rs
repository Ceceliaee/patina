use crate::domain::settings::DesktopBehaviorSettings;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Instant;

#[derive(Debug, Default)]
pub(crate) struct DesktopBehaviorState {
    inner: Mutex<DesktopBehaviorSettings>,
}

impl DesktopBehaviorState {
    pub(crate) fn snapshot(&self) -> DesktopBehaviorSettings {
        match self.inner.lock() {
            Ok(guard) => *guard,
            Err(poisoned) => *poisoned.into_inner(),
        }
    }

    pub(crate) fn update_desktop_from_raw(
        &self,
        close_behavior: &str,
        minimize_behavior: &str,
    ) -> DesktopBehaviorSettings {
        match self.inner.lock() {
            Ok(mut guard) => {
                *guard = guard.with_raw_desktop_behavior(close_behavior, minimize_behavior);
                *guard
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = guard.with_raw_desktop_behavior(close_behavior, minimize_behavior);
                *guard
            }
        }
    }

    pub(crate) fn update_launch(
        &self,
        launch_at_login: bool,
        start_minimized: bool,
    ) -> DesktopBehaviorSettings {
        match self.inner.lock() {
            Ok(mut guard) => {
                *guard = guard.with_launch_behavior(launch_at_login, start_minimized);
                *guard
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = guard.with_launch_behavior(launch_at_login, start_minimized);
                *guard
            }
        }
    }

    pub(crate) fn update_background_optimization(
        &self,
        background_optimization: bool,
    ) -> DesktopBehaviorSettings {
        match self.inner.lock() {
            Ok(mut guard) => {
                *guard = guard.with_background_optimization(background_optimization);
                *guard
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = guard.with_background_optimization(background_optimization);
                *guard
            }
        }
    }

    pub(crate) fn replace(&self, next: DesktopBehaviorSettings) -> DesktopBehaviorSettings {
        match self.inner.lock() {
            Ok(mut guard) => {
                *guard = next;
                *guard
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = next;
                *guard
            }
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct AppExitState {
    requested: AtomicBool,
}

impl AppExitState {
    pub(crate) fn request_exit(&self) {
        self.requested.store(true, Ordering::Relaxed);
    }

    pub(crate) fn is_exit_requested(&self) -> bool {
        self.requested.load(Ordering::Relaxed)
    }
}

#[derive(Debug, Default)]
pub(crate) struct TraySafetyState {
    forced_visible: AtomicBool,
}

impl TraySafetyState {
    pub(crate) fn force_visible(&self) {
        self.forced_visible.store(true, Ordering::Relaxed);
    }

    pub(crate) fn clear_forced_visibility(&self) {
        self.forced_visible.store(false, Ordering::Relaxed);
    }

    pub(crate) fn is_forced_visible(&self) -> bool {
        self.forced_visible.load(Ordering::Relaxed)
    }
}

#[derive(Debug, Default)]
pub(crate) struct MainWindowLifecycleState {
    inner: Mutex<MainWindowLifecycle>,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub(crate) enum MainWindowRenderState {
    #[default]
    Absent,
    Waiting,
    Ready,
    TimedOut,
}

impl MainWindowRenderState {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Absent => "absent",
            Self::Waiting => "waiting",
            Self::Ready => "ready",
            Self::TimedOut => "timed-out",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MainWindowShowDecision {
    Wait,
    Reveal { generation: u64 },
    Destroying,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MainWindowReadyDecision {
    Stale,
    Duplicate,
    Hidden,
    Reveal { generation: u64 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MainWindowTimeoutDecision {
    Stale,
    Hidden,
    Reveal { generation: u64 },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct MainWindowLifecycleSnapshot {
    pub(crate) desired_visible: bool,
    pub(crate) generation: u64,
    pub(crate) render_state: MainWindowRenderState,
    pub(crate) create_in_progress: bool,
    pub(crate) destroy_in_progress: bool,
    pub(crate) reveal_in_progress: bool,
    pub(crate) elapsed_ms: Option<u128>,
}

#[derive(Debug, Default)]
struct MainWindowLifecycle {
    desired_visible: bool,
    hide_generation: u64,
    destroy_in_progress: bool,
    window_generation: u64,
    render_state: MainWindowRenderState,
    create_in_progress: bool,
    reveal_in_progress: bool,
    reveal_satisfied: bool,
    created_at: Option<Instant>,
}

impl MainWindowLifecycleState {
    fn with_inner<T>(&self, update: impl FnOnce(&mut MainWindowLifecycle) -> T) -> T {
        let mut guard = match self.inner.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        update(&mut guard)
    }

    pub(crate) fn begin_window_creation(&self) -> Option<u64> {
        self.with_inner(|inner| {
            if inner.create_in_progress || inner.destroy_in_progress {
                return None;
            }

            inner.create_in_progress = true;
            inner.window_generation = inner.window_generation.wrapping_add(1);
            inner.render_state = MainWindowRenderState::Waiting;
            inner.reveal_in_progress = false;
            inner.reveal_satisfied = false;
            inner.created_at = Some(Instant::now());
            Some(inner.window_generation)
        })
    }

    pub(crate) fn finish_window_creation(&self, generation: u64, created: bool) -> bool {
        self.with_inner(|inner| {
            if inner.window_generation != generation || !inner.create_in_progress {
                return false;
            }

            inner.create_in_progress = false;
            if !created {
                inner.render_state = MainWindowRenderState::Absent;
                inner.reveal_in_progress = false;
                inner.reveal_satisfied = false;
                inner.created_at = None;
                return false;
            }

            if inner.desired_visible
                && matches!(
                    inner.render_state,
                    MainWindowRenderState::Ready | MainWindowRenderState::TimedOut
                )
                && !inner.destroy_in_progress
                && !inner.reveal_in_progress
                && !inner.reveal_satisfied
            {
                inner.reveal_in_progress = true;
                return true;
            }

            false
        })
    }

    pub(crate) fn request_show(&self) -> MainWindowShowDecision {
        self.with_inner(|inner| {
            inner.desired_visible = true;
            inner.hide_generation = inner.hide_generation.wrapping_add(1);
            inner.reveal_satisfied = false;

            if inner.destroy_in_progress {
                return MainWindowShowDecision::Destroying;
            }

            if matches!(
                inner.render_state,
                MainWindowRenderState::Ready | MainWindowRenderState::TimedOut
            ) && !inner.create_in_progress
                && !inner.reveal_in_progress
            {
                inner.reveal_in_progress = true;
                return MainWindowShowDecision::Reveal {
                    generation: inner.window_generation,
                };
            }

            MainWindowShowDecision::Wait
        })
    }

    pub(crate) fn mark_ready(&self, generation: u64) -> MainWindowReadyDecision {
        self.with_inner(|inner| {
            if inner.window_generation != generation
                || inner.render_state == MainWindowRenderState::Absent
            {
                return MainWindowReadyDecision::Stale;
            }

            let first_ready = inner.render_state == MainWindowRenderState::Waiting;
            if first_ready || inner.render_state == MainWindowRenderState::TimedOut {
                inner.render_state = MainWindowRenderState::Ready;
            }

            if inner.desired_visible
                && !inner.create_in_progress
                && !inner.destroy_in_progress
                && !inner.reveal_in_progress
                && !inner.reveal_satisfied
            {
                inner.reveal_in_progress = true;
                return MainWindowReadyDecision::Reveal { generation };
            }

            if first_ready && (!inner.desired_visible || inner.create_in_progress) {
                MainWindowReadyDecision::Hidden
            } else {
                MainWindowReadyDecision::Duplicate
            }
        })
    }

    pub(crate) fn handle_ready_timeout(&self, generation: u64) -> MainWindowTimeoutDecision {
        self.with_inner(|inner| {
            if inner.window_generation != generation
                || inner.render_state != MainWindowRenderState::Waiting
            {
                return MainWindowTimeoutDecision::Stale;
            }

            inner.render_state = MainWindowRenderState::TimedOut;
            if inner.desired_visible
                && !inner.create_in_progress
                && !inner.destroy_in_progress
                && !inner.reveal_in_progress
            {
                inner.reveal_in_progress = true;
                MainWindowTimeoutDecision::Reveal { generation }
            } else {
                MainWindowTimeoutDecision::Hidden
            }
        })
    }

    pub(crate) fn finish_reveal(&self, generation: u64, succeeded: bool) -> bool {
        self.with_inner(|inner| {
            if inner.window_generation != generation {
                return succeeded;
            }

            inner.reveal_in_progress = false;
            inner.reveal_satisfied = succeeded && inner.desired_visible;
            succeeded && !inner.desired_visible
        })
    }

    pub(crate) fn can_reveal(&self, generation: u64) -> bool {
        self.with_inner(|inner| {
            inner.window_generation == generation
                && inner.desired_visible
                && matches!(
                    inner.render_state,
                    MainWindowRenderState::Ready | MainWindowRenderState::TimedOut
                )
                && !inner.create_in_progress
                && !inner.destroy_in_progress
                && inner.reveal_in_progress
        })
    }

    pub(crate) fn snapshot(&self) -> MainWindowLifecycleSnapshot {
        self.with_inner(|inner| MainWindowLifecycleSnapshot {
            desired_visible: inner.desired_visible,
            generation: inner.window_generation,
            render_state: inner.render_state,
            create_in_progress: inner.create_in_progress,
            destroy_in_progress: inner.destroy_in_progress,
            reveal_in_progress: inner.reveal_in_progress,
            elapsed_ms: inner
                .created_at
                .map(|created_at| created_at.elapsed().as_millis()),
        })
    }

    pub(crate) fn hide(&self) -> u64 {
        self.with_inner(|inner| {
            inner.desired_visible = false;
            inner.reveal_satisfied = false;
            inner.hide_generation = inner.hide_generation.wrapping_add(1);
            inner.hide_generation
        })
    }

    pub(crate) fn try_hide_for_startup(&self) -> Option<u64> {
        self.with_inner(|inner| {
            if inner.desired_visible {
                return None;
            }
            inner.reveal_satisfied = false;
            inner.hide_generation = inner.hide_generation.wrapping_add(1);
            Some(inner.hide_generation)
        })
    }

    pub(crate) fn begin_destroy_hidden_window(&self, hide_generation: u64) -> bool {
        self.with_inner(|inner| {
            if inner.desired_visible
                || inner.create_in_progress
                || inner.destroy_in_progress
                || inner.reveal_in_progress
                || inner.hide_generation != hide_generation
            {
                return false;
            }
            inner.destroy_in_progress = true;
            true
        })
    }

    pub(crate) fn finish_destroy_hidden_window(&self, destroyed: bool) -> bool {
        self.with_inner(|inner| {
            inner.destroy_in_progress = false;
            if destroyed {
                inner.render_state = MainWindowRenderState::Absent;
                inner.reveal_in_progress = false;
                inner.reveal_satisfied = false;
                inner.created_at = None;
            }
            inner.desired_visible
        })
    }
}

#[derive(Debug, Default)]
pub(crate) struct WidgetWindowLifecycleState {
    inner: Mutex<WidgetWindowLifecycle>,
}

#[derive(Debug, Default)]
struct WidgetWindowLifecycle {
    create_in_progress: bool,
    desired_visible: bool,
    hide_generation: u64,
}

impl WidgetWindowLifecycleState {
    pub(crate) fn show_existing(&self) {
        match self.inner.lock() {
            Ok(mut guard) => {
                guard.desired_visible = true;
                guard.hide_generation = guard.hide_generation.wrapping_add(1);
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                guard.desired_visible = true;
                guard.hide_generation = guard.hide_generation.wrapping_add(1);
            }
        }
    }

    pub(crate) fn begin_show(&self) -> bool {
        match self.inner.lock() {
            Ok(mut guard) => {
                guard.desired_visible = true;
                guard.hide_generation = guard.hide_generation.wrapping_add(1);
                if guard.create_in_progress {
                    return false;
                }

                guard.create_in_progress = true;
                true
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                guard.desired_visible = true;
                guard.hide_generation = guard.hide_generation.wrapping_add(1);
                if guard.create_in_progress {
                    return false;
                }

                guard.create_in_progress = true;
                true
            }
        }
    }

    pub(crate) fn finish_show(&self) -> bool {
        match self.inner.lock() {
            Ok(mut guard) => {
                guard.create_in_progress = false;
                guard.desired_visible
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                guard.create_in_progress = false;
                guard.desired_visible
            }
        }
    }

    pub(crate) fn hide(&self) -> u64 {
        match self.inner.lock() {
            Ok(mut guard) => {
                guard.desired_visible = false;
                guard.hide_generation = guard.hide_generation.wrapping_add(1);
                guard.hide_generation
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                guard.desired_visible = false;
                guard.hide_generation = guard.hide_generation.wrapping_add(1);
                guard.hide_generation
            }
        }
    }

    pub(crate) fn should_destroy_hidden_window(&self, hide_generation: u64) -> bool {
        match self.inner.lock() {
            Ok(guard) => {
                !guard.desired_visible
                    && !guard.create_in_progress
                    && guard.hide_generation == hide_generation
            }
            Err(poisoned) => {
                let guard = poisoned.into_inner();
                !guard.desired_visible
                    && !guard.create_in_progress
                    && guard.hide_generation == hide_generation
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        MainWindowLifecycleState, MainWindowReadyDecision, MainWindowRenderState,
        MainWindowShowDecision, MainWindowTimeoutDecision, TraySafetyState,
        WidgetWindowLifecycleState,
    };

    fn begin_window_creation(state: &MainWindowLifecycleState) -> u64 {
        state
            .begin_window_creation()
            .expect("window creation should be claimable")
    }

    #[test]
    fn tray_safety_visibility_is_explicit_and_reversible() {
        let state = TraySafetyState::default();
        assert!(!state.is_forced_visible());

        state.force_visible();
        assert!(state.is_forced_visible());

        state.clear_forced_visibility();
        assert!(!state.is_forced_visible());
    }

    #[test]
    fn main_window_lifecycle_cancels_stale_destroy_after_show() {
        let state = MainWindowLifecycleState::default();

        let _ = state.request_show();
        let hide_generation = state.hide();
        let _ = state.request_show();

        assert!(!state.begin_destroy_hidden_window(hide_generation));
    }

    #[test]
    fn main_window_lifecycle_rejects_late_startup_hide_after_show() {
        let state = MainWindowLifecycleState::default();

        let _ = state.request_show();

        assert_eq!(state.try_hide_for_startup(), None);
    }

    #[test]
    fn main_window_lifecycle_startup_hide_is_invalidated_by_later_show() {
        let state = MainWindowLifecycleState::default();

        let hide_generation = state
            .try_hide_for_startup()
            .expect("initial hidden startup should be accepted");
        let _ = state.request_show();

        assert!(!state.begin_destroy_hidden_window(hide_generation));
    }

    #[test]
    fn main_window_lifecycle_starts_each_window_hidden_and_waiting() {
        let state = MainWindowLifecycleState::default();

        let generation = begin_window_creation(&state);
        let snapshot = state.snapshot();

        assert_eq!(generation, 1);
        assert!(!snapshot.desired_visible);
        assert_eq!(snapshot.generation, generation);
        assert_eq!(snapshot.render_state, MainWindowRenderState::Waiting);
        assert!(snapshot.create_in_progress);
        assert!(!snapshot.destroy_in_progress);
        assert!(!snapshot.reveal_in_progress);
        assert!(snapshot.elapsed_ms.is_some());
    }

    #[test]
    fn main_window_lifecycle_waits_for_ready_after_early_show_request() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);
        state.finish_window_creation(generation, true);

        assert_eq!(state.request_show(), MainWindowShowDecision::Wait);
        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Reveal { generation }
        );
        assert!(state.can_reveal(generation));
    }

    #[test]
    fn main_window_lifecycle_ready_window_reveals_on_later_show_request() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);
        state.finish_window_creation(generation, true);

        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Hidden
        );
        assert_eq!(
            state.request_show(),
            MainWindowShowDecision::Reveal { generation }
        );
    }

    #[test]
    fn main_window_lifecycle_ready_does_not_override_hidden_startup() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);
        state.finish_window_creation(generation, true);

        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Hidden
        );
        assert!(!state.snapshot().desired_visible);
    }

    #[test]
    fn main_window_lifecycle_duplicate_ready_is_idempotent_after_reveal() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);
        state.finish_window_creation(generation, true);
        assert_eq!(state.request_show(), MainWindowShowDecision::Wait);
        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Reveal { generation }
        );
        assert!(!state.finish_reveal(generation, true));

        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Duplicate
        );
    }

    #[test]
    fn main_window_lifecycle_rejects_stale_ready_and_timeout() {
        let state = MainWindowLifecycleState::default();
        let stale_generation = begin_window_creation(&state);
        state.finish_window_creation(stale_generation, true);
        let current_generation = begin_window_creation(&state);

        assert_eq!(
            state.mark_ready(stale_generation),
            MainWindowReadyDecision::Stale
        );
        assert_eq!(
            state.handle_ready_timeout(stale_generation),
            MainWindowTimeoutDecision::Stale
        );
        assert_eq!(state.snapshot().generation, current_generation);
        assert_eq!(
            state.snapshot().render_state,
            MainWindowRenderState::Waiting
        );
    }

    #[test]
    fn main_window_lifecycle_timeout_only_reveals_when_requested() {
        let hidden_state = MainWindowLifecycleState::default();
        let hidden_generation = begin_window_creation(&hidden_state);
        hidden_state.finish_window_creation(hidden_generation, true);
        assert_eq!(
            hidden_state.handle_ready_timeout(hidden_generation),
            MainWindowTimeoutDecision::Hidden
        );

        let visible_state = MainWindowLifecycleState::default();
        let visible_generation = begin_window_creation(&visible_state);
        visible_state.finish_window_creation(visible_generation, true);
        assert_eq!(visible_state.request_show(), MainWindowShowDecision::Wait);
        assert_eq!(
            visible_state.handle_ready_timeout(visible_generation),
            MainWindowTimeoutDecision::Reveal {
                generation: visible_generation,
            }
        );
    }

    #[test]
    fn main_window_lifecycle_retries_reveal_after_show_failure() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);
        state.finish_window_creation(generation, true);
        assert_eq!(state.request_show(), MainWindowShowDecision::Wait);
        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Reveal { generation }
        );
        assert!(!state.finish_reveal(generation, false));

        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Reveal { generation }
        );
    }

    #[test]
    fn main_window_lifecycle_hides_a_reveal_that_loses_to_hide() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);
        state.finish_window_creation(generation, true);
        assert_eq!(state.request_show(), MainWindowShowDecision::Wait);
        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Reveal { generation }
        );
        let _ = state.hide();

        assert!(!state.can_reveal(generation));
        assert!(state.finish_reveal(generation, true));
    }

    #[test]
    fn main_window_lifecycle_invalidates_old_reveal_before_new_generation() {
        let state = MainWindowLifecycleState::default();
        let old_generation = begin_window_creation(&state);
        state.finish_window_creation(old_generation, true);
        assert_eq!(
            state.mark_ready(old_generation),
            MainWindowReadyDecision::Hidden
        );
        assert_eq!(
            state.request_show(),
            MainWindowShowDecision::Reveal {
                generation: old_generation,
            }
        );

        let new_generation = begin_window_creation(&state);

        assert_ne!(new_generation, old_generation);
        assert!(!state.can_reveal(old_generation));
        assert!(!state.finish_window_creation(new_generation, true));
        assert_eq!(
            state.mark_ready(new_generation),
            MainWindowReadyDecision::Reveal {
                generation: new_generation,
            }
        );
    }

    #[test]
    fn main_window_lifecycle_queues_show_while_destroy_is_in_progress() {
        let state = MainWindowLifecycleState::default();
        let first_generation = begin_window_creation(&state);
        state.finish_window_creation(first_generation, true);
        assert_eq!(
            state.mark_ready(first_generation),
            MainWindowReadyDecision::Hidden
        );
        let hide_generation = state.hide();

        assert!(state.begin_destroy_hidden_window(hide_generation));
        assert_eq!(state.request_show(), MainWindowShowDecision::Destroying);
        assert!(state.finish_destroy_hidden_window(true));
        assert!(!state.begin_destroy_hidden_window(hide_generation));

        let next_generation = begin_window_creation(&state);
        state.finish_window_creation(next_generation, true);
        assert_ne!(next_generation, first_generation);
        assert_eq!(
            state.mark_ready(next_generation),
            MainWindowReadyDecision::Reveal {
                generation: next_generation,
            }
        );
    }

    #[test]
    fn main_window_lifecycle_rejects_stale_or_duplicate_destroy_claims() {
        let state = MainWindowLifecycleState::default();
        let stale_generation = state.hide();
        let current_generation = state.hide();

        assert!(!state.begin_destroy_hidden_window(stale_generation));
        assert!(state.begin_destroy_hidden_window(current_generation));
        assert!(!state.begin_destroy_hidden_window(current_generation));
        assert!(!state.finish_destroy_hidden_window(true));
    }

    #[test]
    fn main_window_lifecycle_failed_destroy_keeps_current_ready_generation() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);
        state.finish_window_creation(generation, true);
        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Hidden
        );
        let hide_generation = state.hide();
        assert!(state.begin_destroy_hidden_window(hide_generation));
        assert!(!state.finish_destroy_hidden_window(false));

        assert_eq!(state.snapshot().generation, generation);
        assert_eq!(state.snapshot().render_state, MainWindowRenderState::Ready);
        assert_eq!(
            state.request_show(),
            MainWindowShowDecision::Reveal { generation }
        );
    }

    #[test]
    fn main_window_lifecycle_cancelled_creation_returns_to_absent() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);

        state.finish_window_creation(generation, false);

        assert_eq!(state.snapshot().render_state, MainWindowRenderState::Absent);
        assert_eq!(state.mark_ready(generation), MainWindowReadyDecision::Stale);
    }

    #[test]
    fn main_window_lifecycle_coalesces_concurrent_creation_claims() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);

        assert_eq!(state.begin_window_creation(), None);
        state.finish_window_creation(generation, true);
        assert!(!state.snapshot().create_in_progress);

        let next_generation = begin_window_creation(&state);
        assert_ne!(next_generation, generation);
    }

    #[test]
    fn main_window_lifecycle_reveals_ready_that_arrives_during_creation() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);
        assert_eq!(state.request_show(), MainWindowShowDecision::Wait);

        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Hidden
        );
        assert!(!state.can_reveal(generation));
        assert!(state.finish_window_creation(generation, true));
        assert!(state.can_reveal(generation));
    }

    #[test]
    fn main_window_lifecycle_failed_creation_discards_early_ready() {
        let state = MainWindowLifecycleState::default();
        let generation = begin_window_creation(&state);
        assert_eq!(state.request_show(), MainWindowShowDecision::Wait);
        assert_eq!(
            state.mark_ready(generation),
            MainWindowReadyDecision::Hidden
        );

        assert!(!state.finish_window_creation(generation, false));
        assert_eq!(state.snapshot().render_state, MainWindowRenderState::Absent);
        assert_eq!(state.mark_ready(generation), MainWindowReadyDecision::Stale);
    }

    #[test]
    fn widget_lifecycle_coalesces_concurrent_show_requests() {
        let state = WidgetWindowLifecycleState::default();

        assert!(state.begin_show());
        assert!(!state.begin_show());
        assert!(state.finish_show());
        assert!(state.begin_show());
    }

    #[test]
    fn widget_lifecycle_cancels_pending_show_after_hide() {
        let state = WidgetWindowLifecycleState::default();

        assert!(state.begin_show());
        let hide_generation = state.hide();
        assert!(!state.finish_show());
        assert!(state.should_destroy_hidden_window(hide_generation));
        assert!(state.begin_show());
        assert!(state.finish_show());
    }

    #[test]
    fn widget_lifecycle_cancels_stale_destroy_after_show() {
        let state = WidgetWindowLifecycleState::default();

        assert!(state.begin_show());
        assert!(state.finish_show());
        let hide_generation = state.hide();
        state.show_existing();

        assert!(!state.should_destroy_hidden_window(hide_generation));
    }
}
