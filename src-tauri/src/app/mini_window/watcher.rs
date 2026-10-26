use super::{layout, native, MiniWindowState};
use crate::domain::mini_window::{bounds, near_handle, release_placement, Point};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};
use tauri::{App, AppHandle, Listener, Manager, Runtime};

pub(crate) fn register_power_handler<R: Runtime>(app: &App<R>) {
    let handle = app.handle().clone();
    app.listen("power-lifecycle-changed", move |event| {
        let Ok(event) = serde_json::from_str::<crate::platform::windows::power::PowerLifecycleEvent>(event.payload()) else { return; };
        let owner = handle.state::<MiniWindowState>();
        match event.state.as_str() {
            "lock" => { owner.power.fetch_or(1, Ordering::AcqRel); }
            "unlock" => { owner.power.fetch_and(!1, Ordering::AcqRel); }
            "suspend" => { owner.power.fetch_or(2, Ordering::AcqRel); }
            "resume" => { owner.power.fetch_and(!2, Ordering::AcqRel); }
            _ => return,
        }
        owner.power_revision.fetch_add(1, Ordering::Release);
        owner.changed.notify_one();
    });
}

pub(super) async fn run<R: Runtime + 'static>(app: AppHandle<R>, epoch: u64) {
    let owner = app.state::<MiniWindowState>();
    struct Worker<'a>(&'a AtomicU64);
    impl Drop for Worker<'_> {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::Relaxed);
        }
    }
    owner.workers.fetch_add(1, Ordering::Relaxed);
    let _worker = Worker(&owner.workers);
    let mut last_environment = Instant::now() - Duration::from_secs(1);
    let mut power_revision = owner.power_revision.load(Ordering::Acquire);
    loop {
        let interval = {
            let mut state = owner.inner.lock().await;
            if !state.desired
                || state.epoch != epoch
                || app
                    .state::<super::super::state::AppExitState>()
                    .is_exit_requested()
            {
                return;
            }
            let Some(window) = app.get_webview_window("mini") else {
                state.desired = false;
                return;
            };
            let mut changed = false;
            if state.transition.expire(Instant::now()) {
                let _ = layout(&app, &mut state, false);
                changed = true;
            }
            let current_power = owner.power_revision.load(Ordering::Acquire);
            if current_power != power_revision {
                power_revision = current_power;
                state.reset_protection();
                state.interaction.dragging = false;
                state.interaction.expanded =
                    state.preferences.held || state.preferences.placement.edge.is_none();
                let expanded = state.interaction.expanded;
                state.transition.target(expanded, false, Instant::now());
                last_environment = Instant::now() - Duration::from_secs(1);
                changed = true;
            }
            if last_environment.elapsed() >= Duration::from_millis(400)
                && !state.interaction.dragging
            {
                let before = (
                    state.suppressed,
                    state.preferences.placement.monitor.clone(),
                    native::rect(&window).ok(),
                );
                if let Err(error) = layout(&app, &mut state, false) {
                    changed |= !state.failed;
                    state.failed = true;
                    eprintln!("[mini] layout failed: {error}");
                }
                changed |= before
                    != (
                        state.suppressed,
                        state.preferences.placement.monitor.clone(),
                        native::rect(&window).ok(),
                    );
                last_environment = Instant::now();
            }
            if state.suppressed {
                state.reset_protection();
            } else if state.interaction.dragging {
                if !crate::platform::windows::input::is_primary_mouse_button_down() {
                    state.interaction.dragging = false;
                    if let Ok((rect, monitor)) = native::rect(&window).and_then(|rect| {
                        native::release_monitor(&app, rect).map(|monitor| (rect, monitor))
                    }) {
                        let affinity = native::affinity(&monitor);
                        let mut placement = release_placement(
                            &state.preferences.placement,
                            rect,
                            affinity.work_area,
                            monitor.scale_factor(),
                        );
                        placement.monitor = Some(affinity);
                        let mut preferences = state.preferences.clone();
                        preferences.placement = placement;
                        match crate::data::mini_window_store::save(&app, &preferences).await {
                            Ok(()) => {
                                state.preferences = preferences;
                                state.failed = false;
                            }
                            Err(error) => {
                                state.failed = true;
                                eprintln!("[mini] placement save failed: {error}");
                            }
                        }
                    }
                    state.reset_protection();
                    let _ = layout(&app, &mut state, false);
                    changed = true;
                }
            } else if state.preferences.placement.edge.is_some() && !state.preferences.held {
                owner.detector_ticks.fetch_add(1, Ordering::Relaxed);
                if window.is_focused().ok() != Some(true)
                    && (state.keyboard || state.menu || state.touch)
                {
                    state.reset_protection();
                }
                state.interaction.protected = state.keyboard
                    || state.menu
                    || state.touch
                    || crate::platform::windows::input::is_primary_mouse_button_down();
                if let (Ok(monitor), Ok(cursor)) = (
                    native::monitor(&app, &state.preferences.placement),
                    app.cursor_position(),
                ) {
                    let work = native::affinity(&monitor).work_area;
                    let point = Point::new(cursor.x.round() as i32, cursor.y.round() as i32);
                    let near = if state.transition.surface_expanded() {
                        native::rect(&window).is_ok_and(|rect| rect.contains_point(point))
                    } else {
                        near_handle(
                            bounds(
                                &state.preferences.placement,
                                false,
                                work,
                                monitor.scale_factor(),
                            ),
                            state.preferences.placement.edge.unwrap_or_default(),
                            work,
                            monitor.scale_factor(),
                            point,
                        )
                    };
                    if state.interaction.tick(near, true, Instant::now()) {
                        let _ = layout(&app, &mut state, false);
                        changed = true;
                    }
                }
            }
            if changed {
                state.publish(&app);
            }
            if state.suppressed
                || (!state.interaction.dragging
                    && (state.preferences.held || state.preferences.placement.edge.is_none()))
            {
                Duration::from_millis(400)
            } else {
                Duration::from_millis(75)
            }
        };
        tokio::select! { _ = tokio::time::sleep(interval) => {}, _ = owner.changed.notified() => {} }
    }
}
