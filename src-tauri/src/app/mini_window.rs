pub(crate) mod content;
mod native;
mod watcher;

use crate::data::mini_window_store;
use crate::domain::mini_window::transition::{visual_geometry, Transition, VisualGeometry};
use crate::domain::mini_window::{bounds, Edge, Interaction, Page, Preferences};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::{Mutex, Notify};

#[derive(Default)]
pub struct MiniWindowState {
    inner: Mutex<Session>,
    changed: Notify,
    pub(super) detector_ticks: AtomicU64,
    pub(super) workers: AtomicU64,
    power: AtomicU8,
    power_revision: AtomicU64,
}

pub(crate) use watcher::register_power_handler;

#[derive(Clone, Debug, Serialize)]
pub struct Diagnostics {
    pub detector_ticks: u64,
    pub workers: u64,
}
impl MiniWindowState {
    pub fn diagnostics(&self) -> Diagnostics {
        Diagnostics {
            detector_ticks: self.detector_ticks.load(Ordering::Relaxed),
            workers: self.workers.load(Ordering::Relaxed),
        }
    }
}

#[derive(Default)]
struct Session {
    epoch: u64,
    revision: u64,
    desired: bool,
    suppressed: bool,
    preferences: Preferences,
    interaction: Interaction,
    transition: Transition,
    visual: VisualGeometry,
    focus_request: u64,
    keyboard: bool,
    menu: bool,
    touch: bool,
    failed: bool,
}

#[derive(Clone, Serialize)]
pub struct Snapshot {
    epoch: u64,
    revision: u64,
    expanded: bool,
    suppressed: bool,
    edge: Option<Edge>,
    held: bool,
    page: Page,
    focus_request: u64,
    failed: bool,
    transition_id: u64,
    transitioning: bool,
    visual: VisualGeometry,
}

impl Session {
    fn snapshot(&self) -> Snapshot {
        Snapshot {
            epoch: self.epoch,
            revision: self.revision,
            expanded: self.interaction.expanded,
            suppressed: self.suppressed,
            edge: self.preferences.placement.edge,
            held: self.preferences.held,
            page: self.preferences.page,
            focus_request: self.focus_request,
            failed: self.failed,
            transition_id: self.transition.id,
            transitioning: self.transition.pending(),
            visual: self.visual,
        }
    }
    fn publish<R: Runtime>(&mut self, app: &AppHandle<R>) {
        self.revision = self.revision.wrapping_add(1);
        let _ = app.emit_to("mini", "mini-window-state", self.snapshot());
    }
    fn reset_protection(&mut self) {
        self.keyboard = false;
        self.menu = false;
        self.touch = false;
        self.interaction.protected = false;
        self.interaction.leave_since = None;
    }
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    CyclePage {
        forward: bool,
    },
    Reveal,
    Collapse,
    Hold {
        held: bool,
    },
    Place {
        edge: Option<Edge>,
    },
    Dock,
    Protect {
        keyboard: bool,
        menu: bool,
        touch: bool,
    },
    BeginDrag,
    TransitionComplete {
        transition_id: u64,
    },
    Close,
}

pub async fn snapshot<R: Runtime>(app: &AppHandle<R>) -> Snapshot {
    app.state::<MiniWindowState>().inner.lock().await.snapshot()
}

pub async fn open<R: Runtime + 'static>(app: &AppHandle<R>) -> Result<(), String> {
    if app
        .state::<super::state::AppExitState>()
        .is_exit_requested()
    {
        return Err("Application is exiting".into());
    }
    let owner = app.state::<MiniWindowState>();
    let mut state = owner.inner.lock().await;
    if app
        .state::<super::state::AppExitState>()
        .is_exit_requested()
    {
        return Err("Application is exiting".into());
    }
    let new = app.get_webview_window("mini").is_none();
    if new {
        state.preferences = mini_window_store::load(app).await?;
        let epoch = state.epoch.wrapping_add(1);
        if let Err(error) = native::create(app, &state.preferences.placement, epoch) {
            close_session(app, &mut state).await?;
            return Err(error);
        }
        state.epoch = epoch;
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            watcher::run(handle, epoch).await;
        });
    }
    state.desired = true;
    state.failed = false;
    state.reset_protection();
    state.interaction.reveal();
    if new {
        state.transition.target(true, false, Instant::now());
    }
    state.keyboard = true;
    state.interaction.protected = true;
    state.focus_request = state.focus_request.wrapping_add(1);
    let result = layout(app, &mut state, true);
    if result.is_err() {
        close_session(app, &mut state).await?;
    }
    state.publish(app);
    owner.changed.notify_one();
    result
}

fn layout<R: Runtime>(app: &AppHandle<R>, state: &mut Session, focus: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("mini")
        .ok_or("Mini window is closed")?;
    let monitor = native::monitor(app, &state.preferences.placement)?;
    let affinity = native::affinity(&monitor);
    let suppressed = app.state::<MiniWindowState>().power.load(Ordering::Acquire) != 0
        || native::fullscreen(&window, &monitor);
    if suppressed != state.suppressed {
        state.reset_protection();
        state.interaction.dragging = false;
        state.interaction.expanded =
            state.preferences.held || state.preferences.placement.edge.is_none();
    }
    state.suppressed = suppressed;
    let visual = visual_geometry(
        &state.preferences.placement,
        affinity.work_area,
        monitor.scale_factor(),
    );
    let animate = !state.suppressed
        && !state.interaction.dragging
        && state.preferences.placement.edge.is_some()
        && state.visual == visual
        && state.preferences.placement.monitor.as_ref() == Some(&affinity);
    state
        .transition
        .target(state.interaction.expanded, animate, Instant::now());
    state.visual = visual;
    if state.suppressed {
        return window.hide().map_err(|e| e.to_string());
    }
    let rect = bounds(
        &state.preferences.placement,
        true,
        affinity.work_area,
        monitor.scale_factor(),
    );
    native::apply_bounds(&window, rect)?;
    let surface = bounds(
        &state.preferences.placement,
        state.transition.surface_expanded(),
        affinity.work_area,
        monitor.scale_factor(),
    );
    // Keep the WebView viewport and handle coordinates stable across hover.
    // The native region releases desktop input without resizing the renderer.
    crate::platform::windows::window_activation::clip_without_activation(
        &window,
        crate::domain::mini_window::Rect::new(
            surface.x - rect.x,
            surface.y - rect.y,
            surface.width,
            surface.height,
        ),
    )?;
    if state.preferences.placement.edge.is_none() {
        state.preferences.placement.floating = Some(rect);
    }
    state.preferences.placement.monitor = Some(affinity);
    if !window.is_visible().map_err(|e| e.to_string())? {
        // The builder's focused(false) keeps passive shows non-activating;
        // use the framework so its visibility flags stay consistent with HWND.
        window.show().map_err(|e| e.to_string())?;
    }
    if focus {
        window.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub async fn action<R: Runtime + 'static>(
    app: &AppHandle<R>,
    epoch: u64,
    action: Action,
) -> Result<Snapshot, String> {
    let owner = app.state::<MiniWindowState>();
    let mut state = owner.inner.lock().await;
    if state.epoch != epoch
        || !state.desired
        || (app
            .state::<super::state::AppExitState>()
            .is_exit_requested()
            && !matches!(&action, Action::Close))
    {
        return Err("Mini window session expired".into());
    }
    let previous = state.preferences.clone();
    let previous_interaction = state.interaction.clone();
    let previous_transition = state.transition.clone();
    let mut persist = false;
    let mut focus = false;
    match action {
        Action::CyclePage { forward } => {
            state.preferences.page = state.preferences.page.cycle(forward);
            persist = true;
        }
        Action::TransitionComplete { transition_id } => {
            if !state.transition.complete(transition_id) {
                return Ok(state.snapshot());
            }
        }
        Action::Close => {
            close_session(app, &mut state).await?;
            owner.changed.notify_one();
            return Ok(state.snapshot());
        }
        Action::Reveal => {
            state.interaction.reveal();
            state.focus_request = state.focus_request.wrapping_add(1);
            focus = true;
        }
        Action::Collapse => {
            if state.preferences.placement.edge.is_some() && !state.preferences.held {
                state.reset_protection();
                state.interaction.expanded = false;
                state.interaction.require_leave = true;
            }
        }
        Action::Hold { held } => {
            state.preferences.held = held;
            state.interaction.reveal();
            persist = true;
        }
        Action::Place { edge } => {
            state.preferences.placement.edge = edge;
            if let Some(edge) = edge {
                state.preferences.placement.last_edge = edge;
            }
            state.interaction.reveal();
            state.transition.target(true, false, Instant::now());
            persist = true;
        }
        Action::Dock => {
            state.preferences.placement.edge = Some(state.preferences.placement.last_edge);
            state.preferences.held = false;
            state.reset_protection();
            state.interaction.expanded = false;
            state.interaction.require_leave = true;
            persist = true;
        }
        Action::Protect {
            keyboard,
            menu,
            touch,
        } => {
            state.keyboard = keyboard;
            state.menu = menu;
            state.touch = touch;
            state.interaction.protected = keyboard || menu || touch;
            state.interaction.leave_since = None;
        }
        Action::BeginDrag => {
            let window = app
                .get_webview_window("mini")
                .ok_or("Mini window is closed")?;
            let before = native::rect(&window)?;
            state.interaction.reveal();
            state.interaction.dragging = true;
            layout(app, &mut state, false)?;
            let expanded = native::rect(&window)?;
            native::apply_bounds(
                &window,
                crate::domain::mini_window::Rect::new(
                    before.x,
                    before.y,
                    expanded.width,
                    expanded.height,
                ),
            )?;
            state.publish(app);
            owner.changed.notify_one();
            if let Err(error) = window.start_dragging() {
                state.interaction.dragging = false;
                return Err(error.to_string());
            }
            return Ok(state.snapshot());
        }
    }
    let result = match layout(app, &mut state, focus) {
        Ok(()) if persist => mini_window_store::save(app, &state.preferences).await,
        result => result,
    };
    if let Err(error) = result {
        state.preferences = previous;
        state.interaction = previous_interaction;
        state.transition = previous_transition;
        let _ = layout(app, &mut state, false);
        state.failed = true;
        state.publish(app);
        owner.changed.notify_one();
        return Err(error);
    }
    state.failed = false;
    state.publish(app);
    owner.changed.notify_one();
    Ok(state.snapshot())
}

pub(crate) async fn stop_failed_webview<R: Runtime + 'static>(
    app: &AppHandle<R>,
    registration: u64,
) -> Result<(), String> {
    let owner = app.state::<MiniWindowState>();
    let mut state = owner.inner.lock().await;
    if !app
        .state::<super::webview_recovery::WebviewRecoveryState>()
        .accepts_recovery(super::webview_recovery::WindowKind::Mini, registration)
    {
        return Ok(());
    }
    close_session(app, &mut state).await?;
    owner.changed.notify_one();
    Ok(())
}

pub(crate) async fn recover_failed_webview<R: Runtime + 'static>(
    app: &AppHandle<R>,
    registration: u64,
) -> Result<(), String> {
    let owner = app.state::<MiniWindowState>();
    let mut state = owner.inner.lock().await;
    if app
        .state::<super::state::AppExitState>()
        .is_exit_requested()
        || !state.desired
        || !app
            .state::<super::webview_recovery::WebviewRecoveryState>()
            .accepts_recovery(super::webview_recovery::WindowKind::Mini, registration)
    {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window("mini") {
        if let Err(error) = super::webview_recovery::destroy_and_wait(&window).await {
            state.desired = app.get_webview_window("mini").is_some();
            return Err(error);
        }
    }
    let epoch = state.epoch.wrapping_add(1);
    native::create(app, &state.preferences.placement, epoch)?;
    state.epoch = epoch;
    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        watcher::run(handle, epoch).await;
    });
    owner.changed.notify_one();
    state.reset_protection();
    state.interaction.dragging = false;
    let expanded = state.interaction.expanded;
    state.transition.target(expanded, false, Instant::now());
    layout(app, &mut state, false)?;
    state.publish(app);
    Ok(())
}

async fn close_session<R: Runtime>(app: &AppHandle<R>, state: &mut Session) -> Result<(), String> {
    state.desired = false;
    state.reset_protection();
    state.interaction = Interaction::default();
    state.transition.target(false, false, Instant::now());
    if let Some(window) = app.get_webview_window("mini") {
        if let Err(error) = super::webview_recovery::destroy_and_wait(&window).await {
            state.desired = app.get_webview_window("mini").is_some();
            return Err(error);
        }
    }
    Ok(())
}
