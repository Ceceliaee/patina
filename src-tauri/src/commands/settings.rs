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

impl ClassificationSettingMutationDto {
    pub(crate) fn into_parts(self) -> (String, Option<String>) {
        (self.key, self.value)
    }
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

fn last_app_setting_value<'a>(mutations: &'a [AppSettingMutation], key: &str) -> Option<&'a str> {
    mutations
        .iter()
        .rev()
        .find(|mutation| mutation.key == key)
        .map(|mutation| mutation.value.as_str())
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
    let tracking_pause_setting = last_app_setting_value(&mutations, "tracking_paused")
        .map(|value| parse_boolean_setting(value, false));
    let title_recording_setting = last_app_setting_value(&mutations, "title_recording_enabled")
        .map(|value| parse_boolean_setting(value, true));
    let language_setting = last_app_setting_value(&mutations, "language").map(str::to_owned);
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
    if let Some(language) = language_setting {
        tray::apply_language_setting_change(&app, &language)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_app_setting_value_uses_the_last_matching_mutation() {
        let single = vec![AppSettingMutation {
            key: "language".to_string(),
            value: "zh-CN".to_string(),
        }];
        assert_eq!(last_app_setting_value(&single, "language"), Some("zh-CN"));

        let mutations = vec![
            AppSettingMutation {
                key: "language".to_string(),
                value: "zh-CN".to_string(),
            },
            AppSettingMutation {
                key: "theme_mode".to_string(),
                value: "dark".to_string(),
            },
            AppSettingMutation {
                key: "language".to_string(),
                value: "en-US".to_string(),
            },
        ];

        assert_eq!(
            last_app_setting_value(&mutations, "language"),
            Some("en-US")
        );
        assert_eq!(last_app_setting_value(&mutations, "missing"), None);
    }
}
