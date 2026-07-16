use crate::domain::settings::DesktopBehaviorSettings;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

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
pub(crate) struct MainWindowLifecycleState {
    inner: Mutex<MainWindowLifecycle>,
}

#[derive(Debug, Default)]
struct MainWindowLifecycle {
    desired_visible: bool,
    hide_generation: u64,
    destroy_in_progress: bool,
}

impl MainWindowLifecycleState {
    pub(crate) fn show(&self) -> bool {
        match self.inner.lock() {
            Ok(mut guard) => {
                guard.desired_visible = true;
                guard.hide_generation = guard.hide_generation.wrapping_add(1);
                guard.destroy_in_progress
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                guard.desired_visible = true;
                guard.hide_generation = guard.hide_generation.wrapping_add(1);
                guard.destroy_in_progress
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

    pub(crate) fn try_hide_for_startup(&self) -> Option<u64> {
        match self.inner.lock() {
            Ok(mut guard) => {
                if guard.desired_visible {
                    return None;
                }
                guard.hide_generation = guard.hide_generation.wrapping_add(1);
                Some(guard.hide_generation)
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                if guard.desired_visible {
                    return None;
                }
                guard.hide_generation = guard.hide_generation.wrapping_add(1);
                Some(guard.hide_generation)
            }
        }
    }

    pub(crate) fn begin_destroy_hidden_window(&self, hide_generation: u64) -> bool {
        match self.inner.lock() {
            Ok(mut guard) => {
                if guard.desired_visible
                    || guard.destroy_in_progress
                    || guard.hide_generation != hide_generation
                {
                    return false;
                }
                guard.destroy_in_progress = true;
                true
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                if guard.desired_visible
                    || guard.destroy_in_progress
                    || guard.hide_generation != hide_generation
                {
                    return false;
                }
                guard.destroy_in_progress = true;
                true
            }
        }
    }

    pub(crate) fn finish_destroy_hidden_window(&self) -> bool {
        match self.inner.lock() {
            Ok(mut guard) => {
                guard.destroy_in_progress = false;
                guard.desired_visible
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                guard.destroy_in_progress = false;
                guard.desired_visible
            }
        }
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
    use super::{MainWindowLifecycleState, WidgetWindowLifecycleState};

    #[test]
    fn main_window_lifecycle_cancels_stale_destroy_after_show() {
        let state = MainWindowLifecycleState::default();

        let _ = state.show();
        let hide_generation = state.hide();
        let _ = state.show();

        assert!(!state.begin_destroy_hidden_window(hide_generation));
    }

    #[test]
    fn main_window_lifecycle_rejects_late_startup_hide_after_show() {
        let state = MainWindowLifecycleState::default();

        let _ = state.show();

        assert_eq!(state.try_hide_for_startup(), None);
    }

    #[test]
    fn main_window_lifecycle_startup_hide_is_invalidated_by_later_show() {
        let state = MainWindowLifecycleState::default();

        let hide_generation = state
            .try_hide_for_startup()
            .expect("initial hidden startup should be accepted");
        let _ = state.show();

        assert!(!state.begin_destroy_hidden_window(hide_generation));
    }

    #[test]
    fn main_window_lifecycle_queues_show_while_destroy_is_in_progress() {
        let state = MainWindowLifecycleState::default();
        let hide_generation = state.hide();

        assert!(state.begin_destroy_hidden_window(hide_generation));
        assert!(state.show());
        assert!(state.finish_destroy_hidden_window());
        assert!(!state.begin_destroy_hidden_window(hide_generation));
    }

    #[test]
    fn main_window_lifecycle_rejects_stale_or_duplicate_destroy_claims() {
        let state = MainWindowLifecycleState::default();
        let stale_generation = state.hide();
        let current_generation = state.hide();

        assert!(!state.begin_destroy_hidden_window(stale_generation));
        assert!(state.begin_destroy_hidden_window(current_generation));
        assert!(!state.begin_destroy_hidden_window(current_generation));
        assert!(!state.finish_destroy_hidden_window());
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
