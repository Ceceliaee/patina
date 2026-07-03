use crate::data::repositories;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::tools::{
    PomodoroPhase, PomodoroStatus, TimerMode, TimerStatus, ToolAlert, ToolAlertKind,
    ToolsRuntimeSnapshot,
};
use chrono::Local;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::sync::Notify;
use tokio::time::{sleep, Duration};

mod notification;

pub const TOOLS_RUNTIME_CHANGED_EVENT: &str = "tools-runtime-changed";
pub const TOOLS_ALERT_EVENT: &str = "tools-alert";
const TOOLS_RUNTIME_MIN_WAKE_MS: i64 = 250;
const TOOLS_RUNTIME_IDLE_WAKE_MS: i64 = 60_000;
const TOOLS_RUNTIME_ACTIVE_MAX_WAKE_MS: i64 = 60_000;
const TOOLS_RUNTIME_SOFTWARE_REMINDER_WAKE_MS: i64 = 10_000;
const TOOLS_RUNTIME_ERROR_WAKE_MS: u64 = 5_000;
const TOOLS_ALERT_LIMIT: usize = 32;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct ToolsTickOutcome {
    state_changed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ToolAlertQueueStats {
    pub entries: usize,
    pub limit: usize,
}

impl ToolsTickOutcome {
    fn changed() -> Self {
        Self {
            state_changed: true,
        }
    }

    fn mark_changed(&mut self) {
        self.state_changed = true;
    }

    fn merge(&mut self, next: Self) {
        self.state_changed |= next.state_changed;
    }
}

#[derive(Debug, Default)]
pub struct ToolsRuntimeState {
    inner: Mutex<ToolsRuntimeSnapshot>,
    alerts: Mutex<Vec<ToolAlert>>,
}

impl ToolsRuntimeState {
    fn snapshot(&self) -> ToolsRuntimeSnapshot {
        match self.inner.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn replace(&self, snapshot: ToolsRuntimeSnapshot) {
        match self.inner.lock() {
            Ok(mut guard) => {
                *guard = snapshot;
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = snapshot;
            }
        }
    }

    fn push_alert(&self, alert: ToolAlert) {
        match self.alerts.lock() {
            Ok(mut guard) => push_unique_alert(&mut guard, alert),
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                push_unique_alert(&mut guard, alert);
            }
        }
    }

    fn alerts(&self) -> Vec<ToolAlert> {
        match self.alerts.lock() {
            Ok(guard) => guard.clone(),
            Err(poisoned) => poisoned.into_inner().clone(),
        }
    }

    fn alert_stats(&self) -> ToolAlertQueueStats {
        let entries = match self.alerts.lock() {
            Ok(guard) => guard.len(),
            Err(poisoned) => poisoned.into_inner().len(),
        };

        ToolAlertQueueStats {
            entries,
            limit: TOOLS_ALERT_LIMIT,
        }
    }

    fn dismiss_alert(&self, alert_id: &str) {
        match self.alerts.lock() {
            Ok(mut guard) => guard.retain(|alert| alert.id != alert_id),
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                guard.retain(|alert| alert.id != alert_id);
            }
        }
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
pub struct CreateSoftwareReminderRuleRequest {
    pub app_name: String,
    pub exe_name: Option<String>,
    pub limit_ms: i64,
    pub message: String,
}

pub async fn run<R: Runtime + 'static>(app: AppHandle<R>) -> Result<(), String> {
    wait_for_sqlite_pool(&app).await?;
    recover_after_startup(&app).await?;

    loop {
        if let Err(error) = tick_and_refresh_if_changed(&app).await {
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

pub async fn get_snapshot<R: Runtime>(app: &AppHandle<R>) -> Result<ToolsRuntimeSnapshot, String> {
    load_snapshot(app).await
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
    label: String,
    scheduled_at: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    let now_ms = now_ms();
    if scheduled_at <= now_ms {
        return Err("reminder time must be in the future".to_string());
    }
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::create_reminder(&pool, &label, scheduled_at, now_ms).await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn cancel_reminder<R: Runtime>(
    app: &AppHandle<R>,
    reminder_id: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::cancel_reminder(&pool, reminder_id, now_ms()).await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn create_software_reminder_rule<R: Runtime>(
    app: &AppHandle<R>,
    request: CreateSoftwareReminderRuleRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::create_software_reminder_rule(
        &pool,
        &request.app_name,
        request.exe_name.as_deref(),
        request.limit_ms,
        &request.message,
        now_ms(),
    )
    .await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn disable_software_reminder_rule<R: Runtime>(
    app: &AppHandle<R>,
    rule_id: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::disable_software_reminder_rule(&pool, rule_id, now_ms()).await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn start_timer<R: Runtime>(
    app: &AppHandle<R>,
    request: StartTimerRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::start_timer(
        &pool,
        request.mode,
        request.duration_ms,
        request.label.as_deref(),
        now_ms(),
    )
    .await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn pause_timer<R: Runtime>(app: &AppHandle<R>) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::pause_timer(&pool, now_ms()).await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn resume_timer<R: Runtime>(app: &AppHandle<R>) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::resume_timer(&pool, now_ms()).await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn reset_timer<R: Runtime>(app: &AppHandle<R>) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::reset_timer(&pool, now_ms()).await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn add_timer_lap<R: Runtime>(app: &AppHandle<R>) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::add_timer_lap(&pool, now_ms()).await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn start_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    request: StartPomodoroRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::start_pomodoro(
        &pool,
        request.focus_ms,
        request.short_break_ms,
        request.long_break_ms,
        request.long_break_every,
        now_ms(),
    )
    .await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn pause_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::pause_pomodoro(&pool, now_ms()).await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn resume_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::resume_pomodoro(&pool, now_ms()).await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn skip_pomodoro_phase<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::skip_pomodoro_phase(&pool, &date_key(), now_ms()).await?;
    refresh_snapshot_after_tool_change(app).await
}

pub async fn reset_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    repositories::tools::reset_pomodoro(&pool, now_ms()).await?;
    refresh_snapshot_after_tool_change(app).await
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

async fn recover_after_startup<R: Runtime + 'static>(app: &AppHandle<R>) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let now = now_ms();
    repositories::tools::pause_running_stopwatch_after_restart(&pool, now).await?;
    tick_and_notify(app, &pool, now).await?;
    refresh_snapshot(app).await?;
    Ok(())
}

async fn tick_and_refresh_if_changed<R: Runtime + 'static>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let outcome = tick_and_notify(app, &pool, now_ms()).await?;
    if outcome.state_changed {
        refresh_snapshot(app).await?;
    }
    Ok(())
}

async fn tick_and_notify<R: Runtime + 'static>(
    app: &AppHandle<R>,
    pool: &sqlx::Pool<sqlx::Sqlite>,
    now: i64,
) -> Result<ToolsTickOutcome, String> {
    let mut outcome = ToolsTickOutcome::default();

    let fired_reminders = repositories::tools::fire_due_reminders(pool, now).await?;
    if !fired_reminders.is_empty() {
        outcome.merge(ToolsTickOutcome::changed());
    }
    for reminder in fired_reminders {
        send_tool_alert(
            app,
            ToolAlert {
                id: format!("reminder:{}", reminder.id),
                kind: ToolAlertKind::Reminder,
                title: "提醒".to_string(),
                body: if reminder.label.trim().is_empty() {
                    "时间到了".to_string()
                } else {
                    reminder.label
                },
                occurred_at: reminder.fired_at.unwrap_or(now),
            },
        );
    }

    let current_date_key = date_key();
    let fired_software_reminders = repositories::tools::fire_due_software_reminders(
        pool,
        &current_date_key,
        day_start_ms(),
        now,
    )
    .await?;
    if !fired_software_reminders.is_empty() {
        outcome.mark_changed();
    }
    for reminder in fired_software_reminders {
        let limit_minutes = (reminder.limit_ms / 60_000).max(1);
        let usage_minutes = (reminder.usage_ms / 60_000).max(limit_minutes);
        let body = if reminder.message.trim().is_empty() {
            format!(
                "{} 今日已使用 {} 分钟，已达到 {} 分钟上限",
                reminder.app_name, usage_minutes, limit_minutes
            )
        } else {
            reminder.message
        };
        send_tool_alert(
            app,
            ToolAlert {
                id: format!(
                    "software-reminder:{}:{}",
                    reminder.rule_id, current_date_key
                ),
                kind: ToolAlertKind::SoftwareReminder,
                title: "软件提醒".to_string(),
                body,
                occurred_at: now,
            },
        );
    }

    if let Some(completed_timer) = repositories::tools::complete_due_countdown(pool, now).await? {
        outcome.mark_changed();
        send_tool_alert(
            app,
            ToolAlert {
                id: format!("countdown:{}", completed_timer.timer_id),
                kind: ToolAlertKind::Countdown,
                title: "倒计时结束".to_string(),
                body: completed_timer
                    .label
                    .unwrap_or_else(|| "倒计时已完成".to_string()),
                occurred_at: now,
            },
        );
    }

    if let Some(completed_phase) =
        repositories::tools::complete_due_pomodoro_phase(pool, &date_key(), now).await?
    {
        outcome.mark_changed();
        let title = match completed_phase.completed_phase {
            PomodoroPhase::Focus => "专注结束",
            PomodoroPhase::ShortBreak | PomodoroPhase::LongBreak => "休息结束",
        };
        let body = match completed_phase.next_phase {
            PomodoroPhase::Focus => "下一阶段：专注",
            PomodoroPhase::ShortBreak => "下一阶段：短休息",
            PomodoroPhase::LongBreak => "下一阶段：长休息",
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
                title: title.to_string(),
                body: body.to_string(),
                occurred_at: now,
            },
        );
    }

    Ok(outcome)
}

async fn load_snapshot<R: Runtime>(app: &AppHandle<R>) -> Result<ToolsRuntimeSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let snapshot = repositories::tools::fetch_tools_snapshot(&pool, now_ms(), &date_key()).await?;

    if let Some(state) = app.try_state::<ToolsRuntimeState>() {
        state.replace(snapshot.clone());
    }

    Ok(snapshot)
}

async fn refresh_snapshot<R: Runtime>(app: &AppHandle<R>) -> Result<ToolsRuntimeSnapshot, String> {
    let snapshot = load_snapshot(app).await?;

    if let Err(error) = app.emit(TOOLS_RUNTIME_CHANGED_EVENT, &snapshot) {
        eprintln!("[tools] failed to emit tools snapshot: {error}");
    }

    Ok(snapshot)
}

async fn refresh_snapshot_after_tool_change<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    let snapshot = refresh_snapshot(app).await?;
    notify_tools_runtime(app);
    Ok(snapshot)
}

fn send_tool_alert<R: Runtime + 'static>(app: &AppHandle<R>, alert: ToolAlert) {
    if let Some(state) = app.try_state::<ToolsRuntimeState>() {
        state.push_alert(alert.clone());
    }

    crate::app::main_window::show_main_window(app);

    if let Err(error) = app.emit(TOOLS_ALERT_EVENT, &alert) {
        eprintln!(
            "[tools] failed to emit tool alert, falling back to system notification: {error}"
        );
        if let Err(error) = notification::send(app, &alert.title, &alert.body) {
            eprintln!("[tools] failed to send fallback notification: {error}");
        }
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
    let has_pending_software_reminder = snapshot
        .software_reminder_rules
        .iter()
        .any(|rule| rule.last_fired_date_key.as_deref() != Some(current_date_key));
    let mut max_delay_ms = if has_pending_software_reminder {
        TOOLS_RUNTIME_SOFTWARE_REMINDER_WAKE_MS
    } else {
        TOOLS_RUNTIME_IDLE_WAKE_MS
    };
    if snapshot_has_runtime_boundary_work(snapshot) {
        max_delay_ms = max_delay_ms.min(TOOLS_RUNTIME_ACTIVE_MAX_WAKE_MS);
    }

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

fn snapshot_has_runtime_boundary_work(snapshot: &ToolsRuntimeSnapshot) -> bool {
    snapshot.next_reminder_at.is_some()
        || snapshot
            .current_timer
            .as_ref()
            .map(|timer| timer.mode == TimerMode::Countdown && timer.status == TimerStatus::Running)
            .unwrap_or(false)
        || snapshot
            .current_pomodoro
            .as_ref()
            .map(|pomodoro| pomodoro.status == PomodoroStatus::Running)
            .unwrap_or(false)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
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
        ToolPomodoroRun, ToolReminder, ToolSoftwareReminderRule, ToolTimer,
    };

    fn duration_ms(duration: Duration) -> u64 {
        duration.as_millis() as u64
    }

    #[test]
    fn tools_tick_outcome_merges_state_changes() {
        let mut outcome = ToolsTickOutcome::default();
        assert!(!outcome.state_changed);

        outcome.merge(ToolsTickOutcome::default());
        assert!(!outcome.state_changed);

        outcome.merge(ToolsTickOutcome::changed());
        assert!(outcome.state_changed);

        outcome.mark_changed();
        assert!(outcome.state_changed);
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
    fn tools_wake_keeps_software_reminder_on_slow_poll() {
        let snapshot = ToolsRuntimeSnapshot {
            software_reminder_rules: vec![ToolSoftwareReminderRule {
                id: 1,
                app_name: "Editor".to_string(),
                exe_name: Some("editor.exe".to_string()),
                limit_ms: 60_000,
                message: "Break".to_string(),
                created_at: 1_000,
                updated_at: 1_000,
                disabled_at: None,
                last_fired_date_key: None,
            }],
            ..ToolsRuntimeSnapshot::default()
        };
        let delay = compute_next_tools_wake(&snapshot, 1_000, 120_000, "2026-06-29");

        assert_eq!(
            duration_ms(delay),
            TOOLS_RUNTIME_SOFTWARE_REMINDER_WAKE_MS as u64
        );
    }

    #[test]
    fn tools_wake_ignores_software_reminders_already_fired_today() {
        let snapshot = ToolsRuntimeSnapshot {
            software_reminder_rules: vec![ToolSoftwareReminderRule {
                id: 1,
                app_name: "Editor".to_string(),
                exe_name: Some("editor.exe".to_string()),
                limit_ms: 60_000,
                message: "Break".to_string(),
                created_at: 1_000,
                updated_at: 1_000,
                disabled_at: None,
                last_fired_date_key: Some("2026-06-29".to_string()),
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
