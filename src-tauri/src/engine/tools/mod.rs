use crate::domain::localization::{self, LocalizationState};
use crate::domain::tools::{
    ActivityReminderNotification, ActivityReminderTarget, CompletedPomodoroNotification,
    CompletedTimerNotification, PomodoroPhase, PomodoroStatus, TimerMode, TimerStatus, ToolAlert,
    ToolAlertKind, ToolReminder, ToolsRuntimeSnapshot,
};
use chrono::{Local, Utc};
use serde::Serialize;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Mutex, PoisonError};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::Notify;
use tokio::time::{sleep, Duration};

mod activity_notifications;

pub const TOOLS_RUNTIME_CHANGED_EVENT: &str = "tools-runtime-changed";
pub const TOOLS_ALERT_EVENT: &str = "tools-alert";
const TOOLS_RUNTIME_MIN_WAKE_MS: i64 = 250;
const TOOLS_RUNTIME_IDLE_WAKE_MS: i64 = 60_000;
const TOOLS_RUNTIME_ACTIVITY_REMINDER_WAKE_MS: i64 = 10_000;
const TOOLS_RUNTIME_ERROR_WAKE_MS: u64 = 5_000;
const TOOLS_ALERT_LIMIT: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolAlertQueueStats {
    pub entries: usize,
    pub limit: usize,
}

#[derive(Debug, Default)]
pub struct ToolsRuntimeState {
    inner: Mutex<ToolsRuntimeSnapshot>,
    alerts: Mutex<Vec<ToolAlert>>,
    // Serialize store operations so a late read cannot acknowledge a newer write.
    refresh_pending: tokio::sync::Mutex<bool>,
}

impl ToolsRuntimeState {
    async fn fetch_snapshot(
        &self,
        store: &impl ToolsStore,
    ) -> Result<ToolsRuntimeSnapshot, String> {
        let snapshot = store.fetch_snapshot(now_ms(), date_key()).await?;
        self.replace(snapshot.clone());
        Ok(snapshot)
    }

    pub(crate) fn snapshot(&self) -> ToolsRuntimeSnapshot {
        self.inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn replace(&self, snapshot: ToolsRuntimeSnapshot) {
        *self.inner.lock().unwrap_or_else(PoisonError::into_inner) = snapshot;
    }

    fn push_alert(&self, alert: ToolAlert) {
        push_unique_alert(
            &mut self.alerts.lock().unwrap_or_else(PoisonError::into_inner),
            alert,
        );
    }

    fn alerts(&self) -> Vec<ToolAlert> {
        self.alerts
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn alert_stats(&self) -> ToolAlertQueueStats {
        let entries = self
            .alerts
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len();

        ToolAlertQueueStats {
            entries,
            limit: TOOLS_ALERT_LIMIT,
        }
    }

    fn dismiss_alert(&self, alert_id: &str) {
        self.alerts
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .retain(|alert| alert.id != alert_id);
    }
}

#[derive(Default)]
pub struct ToolsRuntimeWakeState {
    notify: Notify,
}

impl ToolsRuntimeWakeState {
    fn notify(&self) {
        self.notify.notify_one();
    }

    fn notified(&self) -> tokio::sync::futures::Notified<'_> {
        self.notify.notified()
    }
}

fn push_unique_alert(alerts: &mut Vec<ToolAlert>, alert: ToolAlert) {
    if alerts.iter().any(|existing| existing.id == alert.id) {
        return;
    }

    alerts.push(alert);
    if alerts.len() > TOOLS_ALERT_LIMIT {
        let overflow = alerts.len().saturating_sub(TOOLS_ALERT_LIMIT);
        alerts.drain(0..overflow);
    }
}

#[derive(Clone, Debug)]
pub struct StartTimerRequest {
    pub mode: TimerMode,
    pub duration_ms: Option<i64>,
    pub label: Option<String>,
}

#[derive(Clone, Debug)]
pub struct StartPomodoroRequest {
    pub focus_ms: i64,
    pub short_break_ms: i64,
    pub long_break_ms: i64,
    pub long_break_every: i64,
}

#[derive(Clone, Debug)]
pub struct CreateActivityReminderRuleRequest {
    pub target: ActivityReminderTarget,
    pub label_snapshot: String,
    pub limit_ms: i64,
    pub message: String,
}

#[derive(Clone, Debug)]
pub enum ToolsMutation {
    CreateReminder { label: String, scheduled_at: i64 },
    CancelReminder { reminder_id: i64 },
    CreateActivityReminderRule(CreateActivityReminderRuleRequest),
    DisableActivityReminderRule { rule_id: i64 },
    StartTimer(StartTimerRequest),
    PauseTimer,
    ResumeTimer,
    ResetTimer,
    AddTimerLap,
    StartPomodoro(StartPomodoroRequest),
    PausePomodoro,
    ResumePomodoro,
    SkipPomodoroPhase,
    ResetPomodoro,
}

#[derive(Clone, Debug, Default)]
pub struct ToolsTickEvents {
    pub reminders: Vec<ToolReminder>,
    pub activity_reminders: Vec<ActivityReminderNotification>,
    pub completed_timer: Option<CompletedTimerNotification>,
    pub completed_pomodoro: Option<CompletedPomodoroNotification>,
    pub state_changed: bool,
}

pub type ToolsStoreFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait ToolsStore: Send + Sync {
    fn apply_mutation(
        &self,
        mutation: ToolsMutation,
        now_ms: i64,
        date_key: String,
    ) -> ToolsStoreFuture<'_, ()>;
    fn recover_after_startup(
        &self,
        now_ms: i64,
        date_key: String,
        day_start_ms: i64,
    ) -> ToolsStoreFuture<'_, ToolsTickEvents>;
    fn tick(
        &self,
        now_ms: i64,
        date_key: String,
        day_start_ms: i64,
    ) -> ToolsStoreFuture<'_, ToolsTickEvents>;
    fn fetch_snapshot(
        &self,
        now_ms: i64,
        date_key: String,
    ) -> ToolsStoreFuture<'_, ToolsRuntimeSnapshot>;
}

pub async fn run<R: Runtime + 'static>(
    app: AppHandle<R>,
    store: impl ToolsStore,
) -> Result<(), String> {
    recover_after_startup(&app, &store).await?;

    loop {
        if let Err(error) = tick_and_refresh_if_changed(&app, &store).await {
            eprintln!("[tools] runtime tick failed: {error}");
            wait_for_next_tools_wake(&app, Duration::from_millis(TOOLS_RUNTIME_ERROR_WAKE_MS))
                .await;
            continue;
        }

        let snapshot = app
            .try_state::<ToolsRuntimeState>()
            .map(|state| state.snapshot())
            .unwrap_or_default();
        let next_wake =
            compute_next_tools_wake(&snapshot, now_ms(), next_day_start_ms(), &date_key());
        wait_for_next_tools_wake(&app, next_wake).await;
    }
}

pub async fn get_snapshot<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    let state = app.state::<ToolsRuntimeState>();
    let mut pending = state.refresh_pending.lock().await;
    let snapshot = state.fetch_snapshot(store).await?;
    if *pending {
        emit_tools_snapshot(app, &snapshot);
        *pending = false;
    }
    Ok(snapshot)
}

pub fn get_alerts<R: Runtime>(app: &AppHandle<R>) -> Vec<ToolAlert> {
    app.try_state::<ToolsRuntimeState>()
        .map(|state| state.alerts())
        .unwrap_or_default()
}

pub fn dismiss_alert<R: Runtime>(app: &AppHandle<R>, alert_id: &str) {
    if let Some(state) = app.try_state::<ToolsRuntimeState>() {
        state.dismiss_alert(alert_id);
    }
}

pub fn alert_queue_stats<R: Runtime>(app: &AppHandle<R>) -> ToolAlertQueueStats {
    app.try_state::<ToolsRuntimeState>()
        .map(|state| state.alert_stats())
        .unwrap_or(ToolAlertQueueStats {
            entries: 0,
            limit: TOOLS_ALERT_LIMIT,
        })
}

pub fn notify_tools_runtime<R: Runtime>(app: &AppHandle<R>) {
    if let Some(state) = app.try_state::<ToolsRuntimeWakeState>() {
        state.notify();
    }
}

pub async fn create_reminder<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    label: String,
    scheduled_at: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    let now_ms = now_ms();
    if scheduled_at <= now_ms {
        return Err("reminder time must be in the future".to_string());
    }
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::CreateReminder {
            label,
            scheduled_at,
        },
        now_ms,
    )
    .await
}

pub async fn cancel_reminder<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    reminder_id: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::CancelReminder { reminder_id },
        now_ms(),
    )
    .await
}

pub async fn create_activity_reminder_rule<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    request: CreateActivityReminderRuleRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::CreateActivityReminderRule(request),
        now_ms(),
    )
    .await
}

pub async fn disable_activity_reminder_rule<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    rule_id: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(
        app,
        store,
        ToolsMutation::DisableActivityReminderRule { rule_id },
        now_ms(),
    )
    .await
}

pub async fn start_timer<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    request: StartTimerRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::StartTimer(request), now_ms()).await
}

pub async fn pause_timer<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::PauseTimer, now_ms()).await
}

pub async fn resume_timer<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::ResumeTimer, now_ms()).await
}

pub async fn reset_timer<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::ResetTimer, now_ms()).await
}

pub async fn add_timer_lap<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::AddTimerLap, now_ms()).await
}

pub async fn start_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    request: StartPomodoroRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::StartPomodoro(request), now_ms()).await
}

pub async fn pause_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::PausePomodoro, now_ms()).await
}

pub async fn resume_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::ResumePomodoro, now_ms()).await
}

pub async fn skip_pomodoro_phase<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::SkipPomodoroPhase, now_ms()).await
}

pub async fn reset_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<ToolsRuntimeSnapshot, String> {
    apply_mutation_and_refresh(app, store, ToolsMutation::ResetPomodoro, now_ms()).await
}

async fn wait_for_next_tools_wake<R: Runtime>(app: &AppHandle<R>, delay: Duration) {
    if let Some(state) = app.try_state::<ToolsRuntimeWakeState>() {
        tokio::select! {
            _ = sleep(delay) => {}
            _ = state.notified() => {}
        }
    } else {
        sleep(delay).await;
    }
}

async fn recover_after_startup<R: Runtime + 'static>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<(), String> {
    let state = app.state::<ToolsRuntimeState>();
    let mut pending = state.refresh_pending.lock().await;
    *pending = true;
    let now = now_ms();
    let events = store
        .recover_after_startup(now, date_key(), day_start_ms())
        .await?;
    notify_tick_events(app, events, now);
    emit_tools_snapshot(app, &state.fetch_snapshot(store).await?);
    *pending = false;
    Ok(())
}

async fn tick_and_refresh_if_changed<R: Runtime + 'static>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
) -> Result<(), String> {
    let state = app.state::<ToolsRuntimeState>();
    tick_and_refresh_state(
        &state,
        store,
        |events, now| notify_tick_events(app, events, now),
        |snapshot| emit_tools_snapshot(app, snapshot),
    )
    .await
}

async fn tick_and_refresh_state(
    state: &ToolsRuntimeState,
    store: &impl ToolsStore,
    emit_events: impl FnOnce(ToolsTickEvents, i64),
    emit_snapshot: impl FnOnce(&ToolsRuntimeSnapshot),
) -> Result<(), String> {
    let mut pending = state.refresh_pending.lock().await;
    let retry_refresh = *pending;
    *pending = true;
    let now = now_ms();
    let events = store.tick(now, date_key(), day_start_ms()).await?;
    *pending = retry_refresh || events.state_changed;
    emit_events(events, now);
    if *pending {
        emit_snapshot(&state.fetch_snapshot(store).await?);
        *pending = false;
    }
    Ok(())
}

fn notify_tick_events<R: Runtime + 'static>(app: &AppHandle<R>, events: ToolsTickEvents, now: i64) {
    let localizer = app.state::<LocalizationState>();
    // One event batch must render from one locale snapshot so a concurrent setting change
    // cannot produce mixed-language title/body pairs.
    let locale = localizer.locale();
    let ToolsTickEvents {
        reminders: fired_reminders,
        activity_reminders: fired_activity_reminders,
        completed_timer,
        completed_pomodoro,
        ..
    } = events;

    for reminder in fired_reminders {
        send_tool_alert(
            app,
            ToolAlert {
                id: format!("reminder:{}", reminder.id),
                kind: ToolAlertKind::Reminder,
                title: localization::text(locale, "native.tools.reminderTitle"),
                body: if reminder.label.trim().is_empty() {
                    localization::text(locale, "native.tools.reminderDefaultBody")
                } else {
                    reminder.label
                },
                occurred_at: reminder.fired_at.unwrap_or(now),
            },
        );
    }

    let current_date_key = date_key();
    for alert in activity_notifications::build_activity_reminder_alerts(
        fired_activity_reminders,
        locale,
        &current_date_key,
        now,
    ) {
        send_tool_alert(app, alert);
    }

    if let Some(completed_timer) = completed_timer {
        send_tool_alert(
            app,
            ToolAlert {
                id: format!("countdown:{}", completed_timer.timer_id),
                kind: ToolAlertKind::Countdown,
                title: localization::text(locale, "native.tools.countdownTitle"),
                body: completed_timer.label.unwrap_or_else(|| {
                    localization::text(locale, "native.tools.countdownDefaultBody")
                }),
                occurred_at: now,
            },
        );
    }

    if let Some(completed_phase) = completed_pomodoro {
        let title_key = match completed_phase.completed_phase {
            PomodoroPhase::Focus => "native.tools.focusEnded",
            PomodoroPhase::ShortBreak | PomodoroPhase::LongBreak => "native.tools.breakEnded",
        };
        let body_key = match completed_phase.next_phase {
            PomodoroPhase::Focus => "native.tools.nextFocus",
            PomodoroPhase::ShortBreak => "native.tools.nextShortBreak",
            PomodoroPhase::LongBreak => "native.tools.nextLongBreak",
        };
        send_tool_alert(
            app,
            ToolAlert {
                id: format!(
                    "pomodoro:{}:{}:{}",
                    completed_phase.run_id,
                    completed_phase.completed_focus_count,
                    completed_phase.completed_phase.as_str()
                ),
                kind: ToolAlertKind::Pomodoro,
                title: localization::text(locale, title_key),
                body: localization::text(locale, body_key),
                occurred_at: now,
            },
        );
    }
}

fn emit_tools_snapshot<R: Runtime>(app: &AppHandle<R>, snapshot: &ToolsRuntimeSnapshot) {
    if let Err(error) = app.emit(TOOLS_RUNTIME_CHANGED_EVENT, snapshot) {
        eprintln!("[tools] failed to emit tools snapshot: {error}");
    }
}

async fn apply_mutation_and_refresh<R: Runtime>(
    app: &AppHandle<R>,
    store: &impl ToolsStore,
    mutation: ToolsMutation,
    now: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    let state = app.state::<ToolsRuntimeState>();
    apply_mutation_and_refresh_state(
        &state,
        store,
        mutation,
        now,
        |snapshot| emit_tools_snapshot(app, snapshot),
        || notify_tools_runtime(app),
    )
    .await
}

async fn apply_mutation_and_refresh_state(
    state: &ToolsRuntimeState,
    store: &impl ToolsStore,
    mutation: ToolsMutation,
    now: i64,
    emit_snapshot: impl FnOnce(&ToolsRuntimeSnapshot),
    wake: impl FnOnce(),
) -> Result<ToolsRuntimeSnapshot, String> {
    let mut pending = state
        .refresh_pending
        .try_lock()
        .map_err(|_| "a tools operation is already in progress".to_string())?;
    if *pending {
        wake();
        return Err(
            "TOOLS_STATE_REFRESH_PENDING: previous tools change is awaiting snapshot recovery"
                .into(),
        );
    }
    // Repository errors can occur after a write, so every outcome needs reconciliation.
    *pending = true;
    let mutation_result = store.apply_mutation(mutation, now, date_key()).await;
    wake();
    let snapshot = state.fetch_snapshot(store).await.map_err(|read_error| {
        let outcome = match &mutation_result {
            Ok(()) => "tools change committed".to_string(),
            Err(error) => format!("tools change outcome uncertain: {error}"),
        };
        let error = format!(
            "TOOLS_STATE_REFRESH_PENDING: {outcome}; snapshot refresh failed: {read_error}"
        );
        eprintln!("[tools] {error}");
        error
    })?;
    emit_snapshot(&snapshot);
    *pending = false;
    mutation_result?;
    Ok(snapshot)
}

fn send_tool_alert<R: Runtime + 'static>(app: &AppHandle<R>, alert: ToolAlert) {
    if let Some(state) = app.try_state::<ToolsRuntimeState>() {
        state.push_alert(alert.clone());
    }

    if let Err(error) = app.emit(TOOLS_ALERT_EVENT, &alert) {
        eprintln!("[tools] failed to emit tool alert: {error}");
    }
}

#[cfg(test)]
fn snapshot_has_active_work(snapshot: &ToolsRuntimeSnapshot) -> bool {
    snapshot
        .current_timer
        .as_ref()
        .map(|timer| timer.status == TimerStatus::Running)
        .unwrap_or(false)
        || snapshot
            .current_pomodoro
            .as_ref()
            .map(|pomodoro| pomodoro.status == PomodoroStatus::Running)
            .unwrap_or(false)
        || snapshot.next_reminder_at.is_some()
}

fn compute_next_tools_wake(
    snapshot: &ToolsRuntimeSnapshot,
    now_ms: i64,
    date_boundary_ms: i64,
    current_date_key: &str,
) -> Duration {
    let has_pending_activity_reminder = snapshot
        .activity_reminder_rules
        .iter()
        .any(|rule| rule.last_fired_date_key.as_deref() != Some(current_date_key));
    let max_delay_ms = if has_pending_activity_reminder {
        TOOLS_RUNTIME_ACTIVITY_REMINDER_WAKE_MS
    } else {
        TOOLS_RUNTIME_IDLE_WAKE_MS
    };
    let mut delay_ms = max_delay_ms;
    if let Some(next_reminder_at) = snapshot.next_reminder_at {
        delay_ms = delay_ms.min(next_reminder_at.saturating_sub(now_ms));
    }
    if let Some(timer) = snapshot.current_timer.as_ref() {
        if timer.mode == TimerMode::Countdown && timer.status == TimerStatus::Running {
            if let Some(remaining_ms) = timer.remaining_ms_at(now_ms) {
                delay_ms = delay_ms.min(remaining_ms);
            }
        }
    }
    if let Some(pomodoro) = snapshot.current_pomodoro.as_ref() {
        if pomodoro.status == PomodoroStatus::Running {
            delay_ms = delay_ms.min(pomodoro.remaining_ms_at(now_ms));
        }
    }
    if date_boundary_ms > now_ms {
        delay_ms = delay_ms.min(date_boundary_ms.saturating_sub(now_ms));
    }

    let clamped_ms = delay_ms.clamp(TOOLS_RUNTIME_MIN_WAKE_MS, max_delay_ms);
    Duration::from_millis(clamped_ms as u64)
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis().max(0)
}

fn date_key() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

fn day_start_ms() -> i64 {
    let now = Local::now();
    let Some(start) = now.date_naive().and_hms_opt(0, 0, 0) else {
        return now.timestamp_millis();
    };
    start
        .and_local_timezone(Local)
        .earliest()
        .map(|date_time| date_time.timestamp_millis())
        .unwrap_or_else(|| now.timestamp_millis())
}

fn next_day_start_ms() -> i64 {
    let now = Local::now();
    let Some(next_date) = now.date_naive().succ_opt() else {
        return now
            .timestamp_millis()
            .saturating_add(TOOLS_RUNTIME_IDLE_WAKE_MS);
    };
    let Some(start) = next_date.and_hms_opt(0, 0, 0) else {
        return now
            .timestamp_millis()
            .saturating_add(TOOLS_RUNTIME_IDLE_WAKE_MS);
    };
    start
        .and_local_timezone(Local)
        .earliest()
        .map(|date_time| date_time.timestamp_millis())
        .unwrap_or_else(|| {
            now.timestamp_millis()
                .saturating_add(TOOLS_RUNTIME_IDLE_WAKE_MS)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::tools::{
        ActivityReminderTarget, ToolActivityReminderRule, ToolPomodoroRun, ToolReminder, ToolTimer,
    };
    use std::cell::Cell;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct ControlledToolsStore {
        mutations: AtomicUsize,
        commits: AtomicUsize,
        failed_reads: AtomicUsize,
        mutation_error: bool,
        hold_first_mutation: bool,
        release_mutation: Notify,
    }

    impl ToolsStore for ControlledToolsStore {
        fn apply_mutation(&self, _: ToolsMutation, _: i64, _: String) -> ToolsStoreFuture<'_, ()> {
            Box::pin(async {
                let mutation_index = self.mutations.fetch_add(1, Ordering::SeqCst);
                self.commits.fetch_add(1, Ordering::SeqCst);
                if self.hold_first_mutation && mutation_index == 0 {
                    self.release_mutation.notified().await;
                }
                if self.mutation_error {
                    Err("controlled read-back failure after insert".into())
                } else {
                    Ok(())
                }
            })
        }

        fn recover_after_startup(
            &self,
            now: i64,
            day: String,
            start: i64,
        ) -> ToolsStoreFuture<'_, ToolsTickEvents> {
            self.tick(now, day, start)
        }

        fn tick(&self, _: i64, _: String, _: i64) -> ToolsStoreFuture<'_, ToolsTickEvents> {
            Box::pin(async { Ok(ToolsTickEvents::default()) })
        }

        fn fetch_snapshot(&self, _: i64, _: String) -> ToolsStoreFuture<'_, ToolsRuntimeSnapshot> {
            Box::pin(async {
                if self
                    .failed_reads
                    .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                        count.checked_sub(1)
                    })
                    .is_ok()
                {
                    return Err("controlled snapshot failure".into());
                }
                Ok(ToolsRuntimeSnapshot {
                    next_reminder_at: (self.commits.load(Ordering::SeqCst) > 0).then_some(10_000),
                    ..ToolsRuntimeSnapshot::default()
                })
            })
        }
    }

    fn reminder_mutation() -> ToolsMutation {
        ToolsMutation::CreateReminder {
            label: "fixture".into(),
            scheduled_at: 10_000,
        }
    }

    #[tokio::test]
    async fn tools_in_flight_mutation_does_not_queue_a_duplicate_write() {
        let state = ToolsRuntimeState::default();
        let store = ControlledToolsStore {
            hold_first_mutation: true,
            ..Default::default()
        };
        let first = apply_mutation_and_refresh_state(
            &state,
            &store,
            reminder_mutation(),
            1_000,
            |_| {},
            || {},
        );
        tokio::pin!(first);
        tokio::select! {
            result = &mut first => panic!("mutation completed before release: {result:?}"),
            _ = tokio::task::yield_now() => {}
        }
        assert_eq!(store.mutations.load(Ordering::SeqCst), 1);
        let repeated = apply_mutation_and_refresh_state(
            &state,
            &store,
            reminder_mutation(),
            1_001,
            |_| {},
            || {},
        )
        .await;
        assert!(repeated.is_err());
        assert_eq!(store.mutations.load(Ordering::SeqCst), 1);
        store.release_mutation.notify_one();
        first.await.unwrap();
    }

    #[tokio::test]
    async fn tools_committed_mutation_wakes_even_when_snapshot_fails() {
        let state = ToolsRuntimeState::default();
        let store = ControlledToolsStore {
            failed_reads: AtomicUsize::new(1),
            ..Default::default()
        };
        let wakes = Cell::new(0);
        let result = apply_mutation_and_refresh_state(
            &state,
            &store,
            reminder_mutation(),
            1_000,
            |_| panic!("failed read must not publish a snapshot"),
            || wakes.set(wakes.get() + 1),
        )
        .await;
        assert!(result.is_err());
        assert_eq!(store.commits.load(Ordering::SeqCst), 1);
        assert_eq!(
            wakes.get(),
            1,
            "a committed reminder must wake the old idle loop"
        );
        assert!(result.unwrap_err().contains("committed"));
    }

    #[tokio::test]
    async fn tools_failed_refresh_blocks_repeat_write_and_reconciles_unchanged_tick() {
        let state = ToolsRuntimeState::default();
        let store = ControlledToolsStore {
            failed_reads: AtomicUsize::new(2),
            ..Default::default()
        };
        assert!(apply_mutation_and_refresh_state(
            &state,
            &store,
            reminder_mutation(),
            1_000,
            |_| {},
            || {}
        )
        .await
        .is_err());
        assert!(apply_mutation_and_refresh_state(
            &state,
            &store,
            reminder_mutation(),
            1_001,
            |_| {},
            || {}
        )
        .await
        .is_err());
        assert_eq!(
            store.mutations.load(Ordering::SeqCst),
            1,
            "retry cannot insert the committed reminder again"
        );
        assert!(
            tick_and_refresh_state(&state, &store, |_, _| {}, |_| panic!("read still fails"))
                .await
                .is_err()
        );
        let published = Cell::new(0);
        tick_and_refresh_state(
            &state,
            &store,
            |events, _| assert!(!events.state_changed),
            |snapshot| {
                assert_eq!(snapshot.next_reminder_at, Some(10_000));
                published.set(published.get() + 1);
            },
        )
        .await
        .unwrap();
        assert_eq!(
            published.get(),
            1,
            "successful reconciliation must reach existing event subscribers"
        );
        assert_eq!(state.snapshot().next_reminder_at, Some(10_000));
        apply_mutation_and_refresh_state(&state, &store, reminder_mutation(), 1_002, |_| {}, || {})
            .await
            .unwrap();
        assert_eq!(store.mutations.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn tools_store_error_after_insert_is_reconciled_without_hiding_error() {
        let state = ToolsRuntimeState::default();
        let store = ControlledToolsStore {
            mutation_error: true,
            ..Default::default()
        };
        let published = Cell::new(0);
        let wakes = Cell::new(0);
        let result = apply_mutation_and_refresh_state(
            &state,
            &store,
            reminder_mutation(),
            1_000,
            |_| published.set(published.get() + 1),
            || wakes.set(wakes.get() + 1),
        )
        .await;
        assert_eq!(
            result.unwrap_err(),
            "controlled read-back failure after insert"
        );
        assert_eq!(store.commits.load(Ordering::SeqCst), 1);
        assert_eq!(published.get(), 1);
        assert_eq!(wakes.get(), 1);
        assert_eq!(state.snapshot().next_reminder_at, Some(10_000));
    }

    #[tokio::test]
    async fn tools_uncertain_write_and_failed_read_report_pending_with_both_errors() {
        let state = ToolsRuntimeState::default();
        let store = ControlledToolsStore {
            mutation_error: true,
            failed_reads: AtomicUsize::new(1),
            ..Default::default()
        };
        let result = apply_mutation_and_refresh_state(
            &state,
            &store,
            reminder_mutation(),
            1_000,
            |_| panic!("failed read must not publish"),
            || {},
        )
        .await;
        let error = result.unwrap_err();
        assert!(error.starts_with("TOOLS_STATE_REFRESH_PENDING:"));
        assert!(error.contains("controlled read-back failure after insert"));
        assert!(error.contains("controlled snapshot failure"));
        tick_and_refresh_state(&state, &store, |_, _| {}, |_| {})
            .await
            .unwrap();
        assert_eq!(state.snapshot().next_reminder_at, Some(10_000));
        assert_eq!(store.mutations.load(Ordering::SeqCst), 1);
    }

    fn duration_ms(duration: Duration) -> u64 {
        duration.as_millis() as u64
    }

    #[test]
    fn active_snapshot_detects_running_timer_and_pending_reminder() {
        let mut snapshot = ToolsRuntimeSnapshot::default();
        assert!(!snapshot_has_active_work(&snapshot));

        snapshot.next_reminder_at = Some(1_000);
        assert!(snapshot_has_active_work(&snapshot));

        snapshot.next_reminder_at = None;
        snapshot.current_timer = Some(ToolTimer {
            id: 1,
            mode: TimerMode::Stopwatch,
            label: None,
            duration_ms: None,
            accumulated_ms: 0,
            started_at: Some(1_000),
            paused_at: None,
            completed_at: None,
            status: TimerStatus::Running,
            created_at: 1_000,
            updated_at: 1_000,
        });
        assert!(snapshot_has_active_work(&snapshot));

        snapshot.current_timer = None;
        snapshot.current_pomodoro = Some(ToolPomodoroRun {
            id: 1,
            phase: PomodoroPhase::Focus,
            status: PomodoroStatus::Paused,
            cycle_index: 1,
            focus_ms: 1_000,
            short_break_ms: 1_000,
            long_break_ms: 1_000,
            long_break_every: 4,
            phase_started_at: None,
            phase_paused_at: None,
            phase_remaining_ms: Some(1_000),
            completed_focus_count: 0,
            created_at: 1_000,
            updated_at: 1_000,
        });
        assert!(!snapshot_has_active_work(&snapshot));

        let _ = ToolReminder {
            id: 1,
            label: "x".to_string(),
            scheduled_at: 1,
            created_at: 1,
            status: crate::domain::tools::ReminderStatus::Scheduled,
            fired_at: None,
            cancelled_at: None,
        };
    }

    #[test]
    fn tool_alerts_are_queued_once_and_dismissed_by_id() {
        let state = ToolsRuntimeState::default();
        let alert = ToolAlert {
            id: "reminder:1".to_string(),
            kind: ToolAlertKind::Reminder,
            title: "提醒".to_string(),
            body: "时间到了".to_string(),
            occurred_at: 1_000,
        };

        state.push_alert(alert.clone());
        state.push_alert(alert);
        assert_eq!(state.alerts().len(), 1);

        state.dismiss_alert("reminder:1");
        assert!(state.alerts().is_empty());
    }

    #[test]
    fn tool_alerts_keep_a_hard_queue_limit() {
        let state = ToolsRuntimeState::default();

        for index in 0..(TOOLS_ALERT_LIMIT + 1) {
            state.push_alert(ToolAlert {
                id: format!("reminder:{index}"),
                kind: ToolAlertKind::Reminder,
                title: "提醒".to_string(),
                body: "时间到了".to_string(),
                occurred_at: index as i64,
            });
        }

        let alerts = state.alerts();
        assert_eq!(alerts.len(), TOOLS_ALERT_LIMIT);
        assert_eq!(
            alerts.first().map(|alert| alert.id.as_str()),
            Some("reminder:1")
        );
        assert_eq!(
            state.alert_stats(),
            ToolAlertQueueStats {
                entries: TOOLS_ALERT_LIMIT,
                limit: TOOLS_ALERT_LIMIT,
            }
        );
    }

    #[test]
    fn tools_wake_uses_idle_delay_without_active_work() {
        let snapshot = ToolsRuntimeSnapshot::default();
        let delay = compute_next_tools_wake(&snapshot, 1_000, 120_000, "2026-06-29");

        assert_eq!(duration_ms(delay), TOOLS_RUNTIME_IDLE_WAKE_MS as u64);
    }

    #[test]
    fn tools_wake_uses_pending_reminder_time() {
        let snapshot = ToolsRuntimeSnapshot {
            next_reminder_at: Some(11_000),
            ..ToolsRuntimeSnapshot::default()
        };
        let delay = compute_next_tools_wake(&snapshot, 1_000, 120_000, "2026-06-29");

        assert_eq!(duration_ms(delay), 10_000);
    }

    #[test]
    fn tools_wake_clamps_due_reminder_to_min_delay() {
        let snapshot = ToolsRuntimeSnapshot {
            next_reminder_at: Some(1_000),
            ..ToolsRuntimeSnapshot::default()
        };
        let delay = compute_next_tools_wake(&snapshot, 1_000, 120_000, "2026-06-29");

        assert_eq!(duration_ms(delay), TOOLS_RUNTIME_MIN_WAKE_MS as u64);
    }

    #[test]
    fn tools_wake_uses_countdown_remaining_time() {
        let snapshot = ToolsRuntimeSnapshot {
            current_timer: Some(ToolTimer {
                id: 1,
                mode: TimerMode::Countdown,
                label: None,
                duration_ms: Some(10_000),
                accumulated_ms: 2_000,
                started_at: Some(1_000),
                paused_at: None,
                completed_at: None,
                status: TimerStatus::Running,
                created_at: 1_000,
                updated_at: 1_000,
            }),
            ..ToolsRuntimeSnapshot::default()
        };
        let delay = compute_next_tools_wake(&snapshot, 4_000, 120_000, "2026-06-29");

        assert_eq!(duration_ms(delay), 5_000);
    }

    #[test]
    fn tools_wake_uses_pomodoro_remaining_time() {
        let snapshot = ToolsRuntimeSnapshot {
            current_pomodoro: Some(ToolPomodoroRun {
                id: 1,
                phase: PomodoroPhase::Focus,
                status: PomodoroStatus::Running,
                cycle_index: 1,
                focus_ms: 10_000,
                short_break_ms: 1_000,
                long_break_ms: 1_000,
                long_break_every: 4,
                phase_started_at: Some(1_000),
                phase_paused_at: None,
                phase_remaining_ms: Some(10_000),
                completed_focus_count: 0,
                created_at: 1_000,
                updated_at: 1_000,
            }),
            ..ToolsRuntimeSnapshot::default()
        };
        let delay = compute_next_tools_wake(&snapshot, 6_000, 120_000, "2026-06-29");

        assert_eq!(duration_ms(delay), 5_000);
    }

    #[test]
    fn tools_wake_keeps_activity_reminder_on_slow_poll() {
        let snapshot = ToolsRuntimeSnapshot {
            activity_reminder_rules: vec![ToolActivityReminderRule {
                id: 1,
                target: ActivityReminderTarget::App {
                    app_name: "Editor".to_string(),
                    exe_name: Some("editor.exe".to_string()),
                },
                label_snapshot: "Editor".to_string(),
                limit_ms: 60_000,
                message: "Break".to_string(),
                created_at: 1_000,
                updated_at: 1_000,
                disabled_at: None,
                last_fired_date_key: None,
                suspension_reason: None,
            }],
            ..ToolsRuntimeSnapshot::default()
        };
        let delay = compute_next_tools_wake(&snapshot, 1_000, 120_000, "2026-06-29");

        assert_eq!(
            duration_ms(delay),
            TOOLS_RUNTIME_ACTIVITY_REMINDER_WAKE_MS as u64
        );
    }

    #[test]
    fn tools_wake_ignores_activity_reminders_already_fired_today() {
        let snapshot = ToolsRuntimeSnapshot {
            activity_reminder_rules: vec![ToolActivityReminderRule {
                id: 1,
                target: ActivityReminderTarget::App {
                    app_name: "Editor".to_string(),
                    exe_name: Some("editor.exe".to_string()),
                },
                label_snapshot: "Editor".to_string(),
                limit_ms: 60_000,
                message: "Break".to_string(),
                created_at: 1_000,
                updated_at: 1_000,
                disabled_at: None,
                last_fired_date_key: Some("2026-06-29".to_string()),
                suspension_reason: None,
            }],
            ..ToolsRuntimeSnapshot::default()
        };
        let delay = compute_next_tools_wake(&snapshot, 1_000, 120_000, "2026-06-29");

        assert_eq!(duration_ms(delay), TOOLS_RUNTIME_IDLE_WAKE_MS as u64);
    }

    #[test]
    fn tools_wake_respects_date_boundary() {
        let snapshot = ToolsRuntimeSnapshot::default();
        let delay = compute_next_tools_wake(&snapshot, 1_000, 21_000, "2026-06-29");

        assert_eq!(duration_ms(delay), 20_000);
    }

    #[test]
    fn tools_wake_state_notifies_waiter() {
        tauri::async_runtime::block_on(async {
            let state = ToolsRuntimeWakeState::default();
            let notified = state.notified();

            state.notify();

            assert!(tokio::time::timeout(Duration::from_millis(50), notified)
                .await
                .is_ok());
        });
    }
}
