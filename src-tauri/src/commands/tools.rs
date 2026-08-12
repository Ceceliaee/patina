use crate::app::tools;
use crate::domain::classification::{canonical_exe, normalize_domain_key};
use crate::domain::tools::{ActivityReminderTarget, TimerMode, ToolAlert, ToolsRuntimeSnapshot};
use crate::engine::tools::{
    CreateActivityReminderRuleRequest, StartPomodoroRequest, StartTimerRequest,
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
#[serde(deny_unknown_fields)]
pub struct CreateActivityReminderRuleDto {
    target: ActivityReminderTargetDto,
    label_snapshot: String,
    limit_ms: i64,
    message: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[serde(deny_unknown_fields)]
enum ActivityReminderTargetDto {
    App {
        #[serde(rename = "appName")]
        app_name: String,
        #[serde(rename = "exeName")]
        exe_name: Option<String>,
    },
    Category {
        #[serde(rename = "categoryId")]
        category_id: String,
    },
    Web {
        #[serde(rename = "normalizedDomain")]
        normalized_domain: String,
    },
}

impl TryFrom<CreateActivityReminderRuleDto> for CreateActivityReminderRuleRequest {
    type Error = String;

    fn try_from(input: CreateActivityReminderRuleDto) -> Result<Self, Self::Error> {
        if !(60_000..=86_400_000).contains(&input.limit_ms) {
            return Err("activity reminder limit must be between 1 and 1440 minutes".to_string());
        }
        let message = bounded_text(input.message, 500, "activity reminder message")?;
        let label_snapshot = bounded_required_text(
            input.label_snapshot,
            160,
            "activity reminder label snapshot",
        )?;
        let target = match input.target {
            ActivityReminderTargetDto::App { app_name, exe_name } => {
                let app_name = bounded_required_text(app_name, 160, "activity reminder app")?;
                let exe_name = exe_name
                    .as_deref()
                    .map(canonical_exe)
                    .filter(|value| !value.is_empty())
                    .map(|value| bounded_required_text(value, 260, "activity reminder executable"))
                    .transpose()?;
                ActivityReminderTarget::App { app_name, exe_name }
            }
            ActivityReminderTargetDto::Category { category_id } => {
                let category_id =
                    bounded_required_text(category_id, 128, "activity reminder category")?;
                ActivityReminderTarget::Category { category_id }
            }
            ActivityReminderTargetDto::Web { normalized_domain } => {
                let normalized_domain = normalize_domain_key(&normalized_domain);
                let normalized_domain =
                    bounded_required_text(normalized_domain, 253, "activity reminder web domain")?;
                ActivityReminderTarget::Web { normalized_domain }
            }
        };
        Ok(Self {
            target,
            label_snapshot,
            limit_ms: input.limit_ms,
            message,
        })
    }
}

fn bounded_text(value: String, max_len: usize, field: &str) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.chars().count() > max_len {
        return Err(format!("{field} is too long"));
    }
    Ok(value)
}

fn bounded_required_text(value: String, max_len: usize, field: &str) -> Result<String, String> {
    let value = bounded_text(value, max_len, field)?;
    if value.is_empty() {
        return Err(format!("{field} is required"));
    }
    Ok(value)
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
pub async fn cmd_create_activity_reminder_rule(
    input: CreateActivityReminderRuleDto,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::create_activity_reminder_rule(&app, input.try_into()?).await
}

#[tauri::command]
pub async fn cmd_disable_activity_reminder_rule(
    rule_id: i64,
    app: AppHandle,
) -> Result<ToolsRuntimeSnapshot, String> {
    tools::disable_activity_reminder_rule(&app, rule_id).await
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn valid_input(target: serde_json::Value) -> serde_json::Value {
        json!({
            "target": target,
            "labelSnapshot": "Target",
            "limitMs": 60_000,
            "message": ""
        })
    }

    #[test]
    fn activity_target_dto_rejects_mixed_and_unknown_fields() {
        assert!(
            serde_json::from_value::<CreateActivityReminderRuleDto>(valid_input(json!({
                "kind": "category",
                "categoryId": "development",
                "appName": "Editor"
            })))
            .is_err()
        );
        assert!(
            serde_json::from_value::<CreateActivityReminderRuleDto>(valid_input(json!({
                "kind": "unknown",
                "value": "x"
            })))
            .is_err()
        );
    }

    #[test]
    fn activity_target_dto_normalizes_and_bounds_input() {
        let input = serde_json::from_value::<CreateActivityReminderRuleDto>(valid_input(json!({
            "kind": "web",
            "normalizedDomain": " Example.COM. "
        })))
        .unwrap();
        let request = CreateActivityReminderRuleRequest::try_from(input).unwrap();
        assert_eq!(
            request.target,
            ActivityReminderTarget::Web {
                normalized_domain: "example.com".to_string()
            }
        );

        let oversized = "x".repeat(501);
        let input = serde_json::from_value::<CreateActivityReminderRuleDto>(json!({
            "target": { "kind": "app", "appName": "Editor", "exeName": "EDITOR.EXE" },
            "labelSnapshot": "Editor",
            "limitMs": 86_400_001_i64,
            "message": oversized
        }))
        .unwrap();
        assert!(CreateActivityReminderRuleRequest::try_from(input).is_err());
    }
}
