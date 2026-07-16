use crate::app::state::DesktopBehaviorState;
use crate::app::{desktop_behavior, tray};
use crate::commands::error::CommandErrorDto;
use crate::data::app_settings_service::commit_app_setting_mutations_with_recovery;
use crate::data::classification_service::commit_classification_setting_mutations_with_recovery;
use crate::data::repositories::app_settings::AppSettingMutation;
use crate::data::repositories::classification_settings::ClassificationSettingMutation;
use crate::domain::settings::parse_boolean_setting;
use crate::engine::tracking::title_state::TitleRecordingRuntimeState;
use serde_json::json;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettingMutationDto {
    key: String,
    value: String,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassificationSettingMutationDto {
    key: String,
    value: Option<String>,
}

impl From<AppSettingMutationDto> for AppSettingMutation {
    fn from(value: AppSettingMutationDto) -> Self {
        Self {
            key: value.key,
            value: value.value,
        }
    }
}

impl From<ClassificationSettingMutationDto> for ClassificationSettingMutation {
    fn from(value: ClassificationSettingMutationDto) -> Self {
        Self {
            key: value.key,
            value: value.value,
        }
    }
}

#[tauri::command]
pub fn cmd_set_desktop_behavior(
    close_behavior: String,
    minimize_behavior: String,
    app: AppHandle,
    desktop_behavior_state: State<DesktopBehaviorState>,
) -> Result<(), String> {
    desktop_behavior::set_desktop_behavior(
        &app,
        &desktop_behavior_state,
        &close_behavior,
        &minimize_behavior,
    );
    Ok(())
}

#[tauri::command]
pub fn cmd_set_launch_behavior(
    launch_at_login: bool,
    start_minimized: bool,
    app: AppHandle,
    desktop_behavior_state: State<DesktopBehaviorState>,
) -> Result<(), String> {
    desktop_behavior::set_launch_behavior(
        &app,
        &desktop_behavior_state,
        launch_at_login,
        start_minimized,
    )
}

#[tauri::command]
pub fn cmd_set_background_optimization(
    background_optimization: bool,
    desktop_behavior_state: State<DesktopBehaviorState>,
) -> Result<(), String> {
    desktop_behavior::set_background_optimization(&desktop_behavior_state, background_optimization);
    Ok(())
}

#[tauri::command]
pub async fn cmd_commit_app_settings(
    mutations: Vec<AppSettingMutationDto>,
    app: AppHandle,
) -> Result<(), CommandErrorDto> {
    let mutations = mutations
        .into_iter()
        .map(AppSettingMutation::from)
        .collect::<Vec<_>>();
    let tracking_pause_setting = mutations
        .iter()
        .rev()
        .find(|mutation| mutation.key == "tracking_paused")
        .map(|mutation| parse_boolean_setting(&mutation.value, false));
    let title_recording_setting = mutations
        .iter()
        .rev()
        .find(|mutation| mutation.key == "title_recording_enabled")
        .map(|mutation| parse_boolean_setting(&mutation.value, true));
    let title_state = app.state::<TitleRecordingRuntimeState>();
    let _title_update_guard = if title_recording_setting.is_some() {
        Some(title_state.lock_update().await)
    } else {
        None
    };

    commit_app_setting_mutations_with_recovery(&app, &mutations)
        .await
        .map_err(CommandErrorDto::from)?;
    if let Some(tracking_paused) = tracking_pause_setting {
        tray::apply_tracking_pause_setting_change(
            &app,
            tracking_paused,
            tray::tracking_pause_event_reason(tracking_paused),
        )
        .map_err(|error| CommandErrorDto::new("SETTINGS_APPLY_FAILED", error, false))?;
    }
    if let Some(enabled) = title_recording_setting {
        tray::apply_title_recording_setting_change(&app, enabled)
            .await
            .map_err(|error| CommandErrorDto::new("SETTINGS_APPLY_FAILED", error, false))?;
    }
    app.emit("app-settings-changed", json!({}))
        .map_err(|error| {
            CommandErrorDto::new(
                "SETTINGS_EVENT_FAILED",
                format!("failed to emit settings refresh event: {error}"),
                false,
            )
        })?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_commit_classification_settings(
    mutations: Vec<ClassificationSettingMutationDto>,
    app: AppHandle,
) -> Result<(), CommandErrorDto> {
    let mutations = mutations
        .into_iter()
        .map(ClassificationSettingMutation::from)
        .collect::<Vec<_>>();

    let outcome = commit_classification_setting_mutations_with_recovery(&app, &mutations)
        .await
        .map_err(CommandErrorDto::from)?;
    crate::app::classification::apply_recording_policy_changes(&app, &outcome)
        .await
        .map_err(|error| CommandErrorDto::new("CLASSIFICATION_APPLY_FAILED", error, false))
}
