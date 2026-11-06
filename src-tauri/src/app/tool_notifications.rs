use crate::domain::tool_notifications::{Delivery, Preferences, PreferencesPatch, Sound};
use crate::domain::tools::{ToolAlert, ToolAlertKind};
use crate::{data::tool_notification_store as store, engine::tools};
use serde::Serialize;
use std::sync::{Mutex, PoisonError};
use tauri::{AppHandle, Emitter, Manager, Runtime};

mod native;
pub const WINDOW_LABEL: &str = "tool-notification";
pub const CHANGED: &str = "tool-presentation-changed";

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub alert: Option<ToolAlert>,
    pub preferences: Preferences,
    pub appearance: std::collections::BTreeMap<String, String>,
    pub error: Option<String>,
    pub target_icon: Option<String>,
}

#[derive(Default)]
struct Inner {
    snapshot: Snapshot,
    delivery: Delivery,
    sound: Sound,
    announced: bool,
    attempts: u8,
    ready_attempt: u8,
    watchdog: Option<tauri::async_runtime::JoinHandle<()>>,
}

impl Inner {
    fn assign(
        &mut self,
        next: Option<ToolAlert>,
        preferences: Preferences,
        appearance: std::collections::BTreeMap<String, String>,
    ) -> (bool, bool) {
        let new_alert = self.snapshot.alert.as_ref().map(|a| &a.id) != next.as_ref().map(|a| &a.id);
        let changed = self.snapshot.alert != next
            || self.snapshot.preferences != preferences
            || self.snapshot.appearance != appearance;
        if new_alert {
            if let Some(watchdog) = self.watchdog.take() {
                watchdog.abort();
            }
            self.delivery = preferences.delivery;
            self.sound = preferences.sound;
            self.announced = false;
            self.attempts = 0;
            self.ready_attempt = 0;
            self.snapshot.error = None;
        }
        self.snapshot.alert = next;
        self.snapshot.preferences = preferences;
        self.snapshot.appearance = appearance;
        if changed {
            self.snapshot.revision += 1;
        }
        (changed, new_alert)
    }
}

#[derive(Default)]
pub struct State {
    gate: tokio::sync::Mutex<()>,
    inner: Mutex<Inner>,
}

fn target(delivery: Delivery) -> &'static str {
    match delivery {
        Delivery::Notification => WINDOW_LABEL,
        Delivery::Dialog => "main",
    }
}

pub fn snapshot<R: Runtime>(app: &AppHandle<R>, label: &str) -> Result<Snapshot, String> {
    if label != "main" && label != WINDOW_LABEL {
        return Err("Tool presentation access denied".into());
    }
    let state = app.state::<State>();
    let inner = state.inner.lock().unwrap_or_else(PoisonError::into_inner);
    let mut snapshot = inner.snapshot.clone();
    if label != target(inner.delivery) {
        snapshot.alert = None;
    }
    Ok(snapshot)
}

pub async fn refresh<R: Runtime + 'static>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<State>();
    let _gate = state.gate.lock().await;
    refresh_locked(app).await
}

pub async fn recover<R: Runtime + 'static>(
    app: &AppHandle<R>,
    registration: u64,
    exhausted: bool,
) -> Result<(), String> {
    if !exhausted
        && !app
            .state::<super::webview_recovery::WebviewRecoveryState>()
            .accepts_recovery(
                super::webview_recovery::WindowKind::ToolNotification,
                registration,
            )
    {
        return Ok(());
    }
    let state = app.state::<State>();
    let _gate = state.gate.lock().await;
    if exhausted {
        let mut inner = state.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.attempts = 3;
        inner.snapshot.error = Some("Notification window recovery exhausted".into());
        inner.snapshot.revision += 1;
    }
    if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
        window.destroy().map_err(|e| e.to_string())?;
    }
    let _ = app.emit(CHANGED, ());
    if !exhausted {
        refresh_locked(app).await?;
    }
    Ok(())
}

async fn refresh_locked<R: Runtime + 'static>(app: &AppHandle<R>) -> Result<(), String> {
    if app
        .state::<super::state::AppExitState>()
        .is_exit_requested()
    {
        return Ok(());
    }
    let preferences = store::load(app).await?;
    let appearance = store::appearance(app).await?;
    let runtime = app.state::<tools::ToolsRuntimeState>().snapshot();
    let mut alerts = tools::get_alerts(app);
    alerts.retain(|a| crate::domain::tool_notifications::is_current(a, &runtime));
    let date_key = chrono::Local::now().format("%Y-%m-%d").to_string();
    alerts.retain(|a| {
        a.activity_reminder
            .as_ref()
            .is_none_or(|details| details.date_key == date_key)
    });
    alerts.sort_by(|a, b| a.occurred_at.cmp(&b.occurred_at).then(a.id.cmp(&b.id)));
    let state = app.state::<State>();
    let (delivery, present, changed, new_alert) = {
        let mut inner = state.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let current = inner
            .snapshot
            .alert
            .as_ref()
            .and_then(|old| alerts.iter().find(|a| a.id == old.id))
            .cloned();
        let next = current.or_else(|| alerts.first().cloned());
        let (changed, new_alert) = inner.assign(next, preferences, appearance);
        (
            inner.delivery,
            inner.snapshot.alert.is_some(),
            changed,
            new_alert,
        )
    };
    if new_alert {
        let alert = state
            .inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .snapshot
            .alert
            .clone();
        let icon = store::target_icon(app, alert.as_ref())
            .await
            .unwrap_or(None);
        state
            .inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .snapshot
            .target_icon = icon;
    }
    if changed {
        let _ = app.emit(CHANGED, ());
    }
    if !present || delivery == Delivery::Dialog {
        if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
            window.destroy().map_err(|e| e.to_string())?;
        }
    }
    if present && new_alert {
        match delivery {
            Delivery::Dialog => {
                super::tray::show_main_window(
                    app,
                    super::main_window::MainWindowShowReason::ToolAlert,
                );
            }
            Delivery::Notification => {
                ensure_notification(app);
            }
        }
    } else if present
        && delivery == Delivery::Notification
        && app.get_webview_window(WINDOW_LABEL).is_none()
    {
        ensure_notification(app);
    }
    Ok(())
}

fn ensure_notification<R: Runtime + 'static>(app: &AppHandle<R>) {
    let exists = app.get_webview_window(WINDOW_LABEL).is_some();
    let state = app.state::<State>();
    let (id, attempt) = {
        let mut inner = state.inner.lock().unwrap_or_else(PoisonError::into_inner);
        if inner.attempts >= 3 {
            if inner.snapshot.error.is_none() {
                inner.snapshot.error = Some("Notification window retry limit reached".into());
                inner.snapshot.revision += 1;
                let _ = app.emit(CHANGED, ());
            }
            return;
        }
        if inner.watchdog.is_some()
            || (exists && inner.announced && inner.ready_attempt == inner.attempts)
        {
            return;
        }
        inner.attempts += 1;
        (
            inner.snapshot.alert.as_ref().map(|a| a.id.clone()),
            inner.attempts,
        )
    };
    if let Err(error) = if exists { Ok(()) } else { native::create(app) } {
        let mut inner = state.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.snapshot.error = Some(error.clone());
        inner.snapshot.revision += 1;
        drop(inner);
        let _ = app.emit(CHANGED, ());
    }
    let owner = app.clone();
    let watchdog = tauri::async_runtime::spawn(async move {
        let app = owner;
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        let state = app.state::<State>();
        let _gate = state.gate.lock().await;
        if app
            .state::<super::state::AppExitState>()
            .is_exit_requested()
        {
            return;
        }
        {
            let mut inner = state.inner.lock().unwrap_or_else(PoisonError::into_inner);
            if inner.snapshot.alert.as_ref().map(|a| &a.id) != id.as_ref()
                || inner.delivery != Delivery::Notification
                || inner.attempts != attempt
                || inner.ready_attempt == attempt
            {
                return;
            }
            inner.snapshot.error = Some("Notification did not become ready".into());
            inner.snapshot.revision += 1;
            inner.watchdog.take();
        }
        if let Some(window) = app.get_webview_window(WINDOW_LABEL) {
            let _ = window.destroy();
        }
        let _ = app.emit(CHANGED, ());
        ensure_notification(&app);
    });
    state
        .inner
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .watchdog = Some(watchdog);
}

pub async fn retry<R: Runtime + 'static>(app: &AppHandle<R>) -> Result<(), String> {
    let state = app.state::<State>();
    let _gate = state.gate.lock().await;
    {
        let mut inner = state.inner.lock().unwrap_or_else(PoisonError::into_inner);
        if inner.snapshot.error.is_some() {
            if let Some(watchdog) = inner.watchdog.take() {
                watchdog.abort();
            }
            inner.attempts = 0;
            inner.ready_attempt = 0;
        }
    }
    refresh_locked(app).await
}

pub async fn save<R: Runtime + 'static>(
    app: &AppHandle<R>,
    patch: PreferencesPatch,
) -> Result<Preferences, String> {
    let state = app.state::<State>();
    let _gate = state.gate.lock().await;
    let preview_sound = patch.sound;
    let preferences = store::save(app, patch).await?;
    if let Some(sound) = preview_sound {
        crate::platform::windows::notification_sound::play(sound);
    }
    // Apply the committed preferences even when a separate window operation fails.
    if let Err(error) = refresh_locked(app).await {
        eprintln!("[tool-notification] refresh after saving preferences: {error}");
        let mut inner = state.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.snapshot.preferences = preferences.clone();
        inner.snapshot.error = Some(error);
        inner.snapshot.revision += 1;
        let _ = app.emit(CHANGED, ());
    }
    Ok(preferences)
}

pub async fn ready<R: Runtime + 'static>(
    app: &AppHandle<R>,
    label: &str,
    id: &str,
    width: f64,
    height: f64,
    canvas_height: Option<f64>,
) -> Result<(), String> {
    let state = app.state::<State>();
    let _gate = state.gate.lock().await;
    let sound = {
        let inner = state.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let alert = require_current(&inner, label, id)?;
        if !crate::domain::tool_notifications::is_current(
            &alert,
            &app.state::<tools::ToolsRuntimeState>().snapshot(),
        ) {
            return Err("Tool alert is no longer current".into());
        }
        (!inner.announced).then_some(inner.sound)
    };
    if label == WINDOW_LABEL {
        native::show(app, width, height, canvas_height)?;
    } else if !app
        .get_webview_window("main")
        .is_some_and(|w| w.is_visible().unwrap_or(false))
    {
        return Err("Main window is not visible yet".into());
    }
    {
        let mut inner = state.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.ready_attempt = inner.attempts;
        if let Some(watchdog) = inner.watchdog.take() {
            watchdog.abort();
        }
        if inner.snapshot.error.take().is_some() {
            inner.snapshot.revision += 1;
            let _ = app.emit(CHANGED, ());
        }
    }
    if let Some(sound) = sound {
        state
            .inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .announced = true;
        crate::platform::windows::notification_sound::play(sound);
    }
    Ok(())
}

fn require_current(inner: &Inner, label: &str, id: &str) -> Result<ToolAlert, String> {
    if label != target(inner.delivery) {
        return Err("Tool presentation access denied".into());
    }
    inner
        .snapshot
        .alert
        .as_ref()
        .filter(|a| a.id == id)
        .cloned()
        .ok_or_else(|| "Tool alert is no longer current".into())
}

#[derive(serde::Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Action {
    Dismiss,
    Resolve {
        delay: Option<u32>,
    },
    Extend {
        extension: crate::domain::tools::ActivityReminderExtension,
    },
    StartNext,
    Desktop,
}

pub async fn action<R: Runtime + 'static>(
    app: &AppHandle<R>,
    label: &str,
    id: &str,
    action: Action,
) -> Result<(), String> {
    let state = app.state::<State>();
    let _gate = state.gate.lock().await;
    let alert = require_current(
        &state.inner.lock().unwrap_or_else(PoisonError::into_inner),
        label,
        id,
    )?;
    if !crate::domain::tool_notifications::is_current(
        &alert,
        &app.state::<tools::ToolsRuntimeState>().snapshot(),
    ) {
        refresh_locked(app).await?;
        return Err("Tool alert is no longer current".into());
    }
    match action {
        Action::Resolve { delay } if alert.kind == ToolAlertKind::Reminder => {
            if delay.is_some_and(|d| ![5, 15, 30].contains(&d)) {
                return Err("Invalid reminder delay".into());
            }
            super::tools::resolve_reminder_alert(app, id, delay).await?;
        }
        Action::Extend { extension } if alert.kind == ToolAlertKind::ActivityReminder => {
            super::tools::extend_activity_reminder(app, id, extension).await?;
        }
        Action::Desktop if alert.kind == ToolAlertKind::ActivityReminder => {
            super::main_window::show_desktop().await?;
        }
        Action::StartNext if alert.kind == ToolAlertKind::FreeFocus => {
            let task = alert.free_focus.ok_or("Missing free focus task")?;
            super::tools::free_focus(
                app,
                crate::domain::free_focus::FreeFocusAction::StartNext {
                    id: task.id,
                    expected_updated_at: task.updated_at,
                },
            )
            .await?;
        }
        Action::StartNext if alert.kind == ToolAlertKind::Pomodoro => {
            let task = alert.pomodoro.ok_or("Missing pomodoro task")?;
            super::tools::pomodoro_task(
                app,
                crate::domain::tools::PomodoroTaskAction::StartNext {
                    id: task.run.id,
                    expected_updated_at: task.run.updated_at,
                },
            )
            .await?;
        }
        Action::Dismiss if alert.kind != ToolAlertKind::Reminder => {}
        _ => return Err("Action is not available for this alert".into()),
    }
    tools::dismiss_alert(app, id);
    refresh_locked(app).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notification_assignment_freezes_delivery_and_sound_until_the_next_identity() {
        let mut inner = Inner::default();
        let alert = ToolAlert {
            id: "reminder:1:10".into(),
            kind: ToolAlertKind::Reminder,
            title: String::new(),
            body: String::new(),
            occurred_at: 10,
            pomodoro: None,
            free_focus: None,
            activity_reminder: None,
        };
        assert_eq!(
            inner.assign(
                Some(alert.clone()),
                Preferences::default(),
                Default::default()
            ),
            (true, true)
        );
        inner.announced = true;
        let preferences = Preferences {
            delivery: Delivery::Dialog,
            sound: Sound::None,
        };
        assert_eq!(
            inner.assign(Some(alert.clone()), preferences.clone(), Default::default()),
            (true, false)
        );
        assert_eq!(inner.delivery, Delivery::Notification);
        assert_eq!(inner.sound, Sound::Default);
        assert!(inner.announced);
        let revision = inner.snapshot.revision;
        assert_eq!(
            inner.assign(Some(alert.clone()), preferences.clone(), Default::default()),
            (false, false)
        );
        assert_eq!(inner.snapshot.revision, revision);
        assert_eq!(
            inner.assign(
                Some(ToolAlert {
                    id: "reminder:2:20".into(),
                    ..alert
                }),
                preferences,
                Default::default()
            ),
            (true, true)
        );
        assert_eq!(inner.delivery, Delivery::Dialog);
        assert_eq!(inner.sound, Sound::None);
        assert!(!inner.announced);
        inner.assign(None, Preferences::default(), Default::default());
        assert!(inner.snapshot.alert.is_none());
    }
    #[test]
    fn notification_actions_require_the_assigned_window_and_current_identity() {
        let mut inner = Inner::default();
        inner.snapshot.alert = Some(ToolAlert {
            id: "reminder:1:10".into(),
            kind: ToolAlertKind::Reminder,
            title: String::new(),
            body: String::new(),
            occurred_at: 10,
            pomodoro: None,
            free_focus: None,
            activity_reminder: None,
        });
        assert!(require_current(&inner, WINDOW_LABEL, "reminder:1:10").is_ok());
        for label in ["main", "mini", "unknown"] {
            assert!(require_current(&inner, label, "reminder:1:10").is_err());
        }
        assert!(require_current(&inner, WINDOW_LABEL, "reminder:2:10").is_err());
        inner.delivery = Delivery::Dialog;
        assert!(require_current(&inner, WINDOW_LABEL, "reminder:1:10").is_err());
        assert!(require_current(&inner, "main", "reminder:1:10").is_ok());
        inner.snapshot.alert = None;
        assert!(require_current(&inner, "main", "reminder:1:10").is_err());
        assert!(serde_json::from_str::<Action>(r#"{"kind":"delete","id":1}"#).is_err());
    }
}
