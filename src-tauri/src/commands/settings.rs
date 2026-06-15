use crate::app::desktop_behavior;
use crate::app::state::DesktopBehaviorState;
use crate::data::app_settings_service::commit_app_setting_mutations_with_recovery;
use crate::data::classification_service::commit_classification_setting_mutations_with_recovery;
use crate::data::repositories::app_settings::AppSettingMutation;
use crate::data::repositories::classification_settings::ClassificationSettingMutation;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

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
) -> Result<(), String> {
    let mutations = mutations
        .into_iter()
        .map(AppSettingMutation::from)
        .collect::<Vec<_>>();

    commit_app_setting_mutations_with_recovery(&app, &mutations).await?;
    app.emit("app-settings-changed", json!({}))
        .map_err(|error| format!("failed to emit settings refresh event: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn cmd_commit_classification_settings(
    mutations: Vec<ClassificationSettingMutationDto>,
    app: AppHandle,
) -> Result<(), String> {
    let mutations = mutations
        .into_iter()
        .map(ClassificationSettingMutation::from)
        .collect::<Vec<_>>();

    commit_classification_setting_mutations_with_recovery(&app, &mutations).await
}
