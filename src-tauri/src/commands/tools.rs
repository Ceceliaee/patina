use crate::domain::tools::{TimerMode, ToolAlert, ToolsRuntimeSnapshot};
use crate::engine::tools::{
    self, CreateSoftwareReminderRuleRequest, StartPomodoroRequest, StartTimerRequest,
};
use serde::Deserialize;
use tauri::AppHandle;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReminderDto {
    label: String,
    scheduled_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSoftwareReminderRuleDto {
    app_name: String,
    exe_name: Option<String>,
    limit_ms: i64,
    message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTimerDto {
    mode: TimerMode,
    duration_ms: Option<i64>,
    label: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartPomodoroDto {
    focus_ms: i64,
    short_break_ms: i64,
    long_break_ms: i64,
    long_break_every: i64,
}

#[tauri::command]
pub async fn cmd_get_tools_snapshot(app: AppHandle) -> Result<ToolsRuntimeSnapshot, String> {
    tools::get_snapshot(&app).await
}

#[tauri::command]
pub fn cmd_get_tool_alerts(app: AppHandle) -> Vec<ToolAlert> {
    tools::get_alerts(&app)
}

#[tauri::command]
pub fn cmd_dismiss_tool_alert(alert_id: String, app: AppHandle) {
    tools::dismiss_alert(&app, &alert_id);
}

#[tauri::command]
pub async fn cmd_create_reminder(
    input: CreateReminderDto,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::create_reminder(&app, input.label, input.scheduled_at).await
}

#[tauri::command]
pub async fn cmd_cancel_reminder(
    reminder_id: i64,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::cancel_reminder(&app, reminder_id).await
}

#[tauri::command]
pub async fn cmd_create_software_reminder_rule(
    input: CreateSoftwareReminderRuleDto,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::create_software_reminder_rule(
        &app,
        CreateSoftwareReminderRuleRequest {
            app_name: input.app_name,
            exe_name: input.exe_name,
            limit_ms: input.limit_ms,
            message: input.message,
        },
    )
    .await
}

#[tauri::command]
pub async fn cmd_disable_software_reminder_rule(
    rule_id: i64,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::disable_software_reminder_rule(&app, rule_id).await
}

#[tauri::command]
pub async fn cmd_start_timer(
    input: StartTimerDto,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::start_timer(
        &app,
        StartTimerRequest {
            mode: input.mode,
            duration_ms: input.duration_ms,
            label: input.label,
        },
    )
    .await
}

#[tauri::command]
pub async fn cmd_pause_timer(app: AppHandle) -> Result<ToolsRuntimeSnapshot, String> {
    tools::pause_timer(&app).await
}

#[tauri::command]
pub async fn cmd_resume_timer(app: AppHandle) -> Result<ToolsRuntimeSnapshot, String> {
    tools::resume_timer(&app).await
}

#[tauri::command]
pub async fn cmd_reset_timer(app: AppHandle) -> Result<ToolsRuntimeSnapshot, String> {
    tools::reset_timer(&app).await
}

#[tauri::command]
pub async fn cmd_add_timer_lap(app: AppHandle) -> Result<ToolsRuntimeSnapshot, String> {
    tools::add_timer_lap(&app).await
}

#[tauri::command]
pub async fn cmd_start_pomodoro(
    input: StartPomodoroDto,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::start_pomodoro(
        &app,
        StartPomodoroRequest {
            focus_ms: input.focus_ms,
            short_break_ms: input.short_break_ms,
            long_break_ms: input.long_break_ms,
            long_break_every: input.long_break_every,
        },
    )
    .await
}

#[tauri::command]
pub async fn cmd_pause_pomodoro(app: AppHandle) -> Result<ToolsRuntimeSnapshot, String> {
    tools::pause_pomodoro(&app).await
}

#[tauri::command]
pub async fn cmd_resume_pomodoro(app: AppHandle) -> Result<ToolsRuntimeSnapshot, String> {
    tools::resume_pomodoro(&app).await
}

#[tauri::command]
pub async fn cmd_skip_pomodoro_phase(app: AppHandle) -> Result<ToolsRuntimeSnapshot, String> {
    tools::skip_pomodoro_phase(&app).await
}

#[tauri::command]
pub async fn cmd_reset_pomodoro(app: AppHandle) -> Result<ToolsRuntimeSnapshot, String> {
    tools::reset_pomodoro(&app).await
}

#[tauri::command]
pub async fn cmd_set_reminder_snooze_minutes(
    minutes: i64,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::set_reminder_snooze_minutes(&app, minutes).await
}

#[tauri::command]
pub async fn cmd_set_pomodoro_snooze_minutes(
    minutes: i64,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::set_pomodoro_snooze_minutes(&app, minutes).await
}

#[tauri::command]
pub async fn cmd_set_countdown_snooze_minutes(
    minutes: i64,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::set_countdown_snooze_minutes(&app, minutes).await
}
