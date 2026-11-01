use crate::data::tools_store::SqliteToolsStore;
use crate::domain::tools::{ToolAlert, ToolsRuntimeSnapshot};
use crate::engine::tools::{
    self, CreateActivityReminderRuleRequest, StartPomodoroRequest, StartTimerRequest,
};
use tauri::{App, AppHandle, Listener, Runtime};

pub(crate) fn register_alert_handler<R: Runtime>(app: &App<R>) {
    let app_handle = app.handle().clone();
    app.listen(crate::engine::tools::TOOLS_ALERT_EVENT, move |_| {
        let _ = crate::app::tray::show_main_window(
            &app_handle,
            crate::app::main_window::MainWindowShowReason::ToolAlert,
        );
    });
}

fn store<R: Runtime>(app: &AppHandle<R>) -> SqliteToolsStore<R> {
    SqliteToolsStore::new(app.clone())
}

pub(crate) fn get_alerts<R: Runtime>(app: &AppHandle<R>) -> Vec<ToolAlert> {
    tools::get_alerts(app)
}

pub(crate) fn dismiss_alert<R: Runtime>(app: &AppHandle<R>, alert_id: &str) {
    tools::dismiss_alert(app, alert_id);
}

pub(crate) async fn extend_activity_reminder<R: Runtime>(
    app: &AppHandle<R>,
    alert_id: &str,
    extension: crate::domain::tools::ActivityReminderExtension,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::extend_activity_reminder(app, &store(app), alert_id, extension).await
}

pub(crate) async fn run<R: Runtime + 'static>(app: AppHandle<R>) -> Result<(), String> {
    let store = store(&app);
    tools::run(app, store).await
}

pub(crate) async fn get_snapshot<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::get_snapshot(app, &store(app)).await
}

pub(crate) async fn create_reminder<R: Runtime>(
    app: &AppHandle<R>,
    label: String,
    scheduled_at: i64,
    recurrence: Option<crate::domain::reminder_schedule::ReminderRecurrence>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::timed_reminders::create_reminder(app, &store(app), label, scheduled_at, recurrence).await
}

pub(crate) async fn resolve_reminder_alert<R: Runtime>(
    app: &AppHandle<R>,
    alert_id: &str,
    delay_minutes: Option<u32>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::timed_reminders::resolve_reminder_alert(app, &store(app), alert_id, delay_minutes).await
}

pub(crate) async fn cancel_reminder<R: Runtime>(
    app: &AppHandle<R>,
    reminder_id: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::timed_reminders::cancel_reminder(app, &store(app), reminder_id).await
}

pub(crate) async fn update_reminder<R: Runtime>(
    app: &AppHandle<R>,
    reminder_id: i64,
    label: String,
    scheduled_at: i64,
    enabled: bool,
    recurrence: Option<crate::domain::reminder_schedule::ReminderRecurrence>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::timed_reminders::update_reminder(
        app,
        &store(app),
        reminder_id,
        label,
        scheduled_at,
        enabled,
        recurrence,
    )
    .await
}

pub(crate) async fn create_activity_reminder_rule<R: Runtime>(
    app: &AppHandle<R>,
    request: CreateActivityReminderRuleRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::create_activity_reminder_rule(app, &store(app), request).await
}

pub(crate) async fn disable_activity_reminder_rule<R: Runtime>(
    app: &AppHandle<R>,
    rule_id: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::disable_activity_reminder_rule(app, &store(app), rule_id).await
}

pub(crate) async fn set_activity_reminder_enabled<R: Runtime>(
    app: &AppHandle<R>,
    rule_id: i64,
    enabled: bool,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::set_activity_reminder_enabled(app, &store(app), rule_id, enabled).await
}

pub(crate) async fn update_activity_reminder_limit<R: Runtime>(
    app: &AppHandle<R>,
    rule_id: i64,
    limit_ms: i64,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::update_activity_reminder_limit(app, &store(app), rule_id, limit_ms).await
}

pub(crate) async fn start_timer<R: Runtime>(
    app: &AppHandle<R>,
    request: StartTimerRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::start_timer(app, &store(app), request).await
}

pub(crate) async fn pause_timer<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::pause_timer(app, &store(app)).await
}

pub(crate) async fn resume_timer<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::resume_timer(app, &store(app)).await
}

pub(crate) async fn reset_timer<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::reset_timer(app, &store(app)).await
}

pub(crate) async fn add_timer_lap<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::add_timer_lap(app, &store(app)).await
}

pub(crate) async fn start_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
    request: StartPomodoroRequest,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::start_pomodoro(app, &store(app), request).await
}

pub(crate) async fn pause_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::pause_pomodoro(app, &store(app)).await
}

pub(crate) async fn resume_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::resume_pomodoro(app, &store(app)).await
}

pub(crate) async fn skip_pomodoro_phase<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::skip_pomodoro_phase(app, &store(app)).await
}

pub(crate) async fn reset_pomodoro<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::reset_pomodoro(app, &store(app)).await
}
