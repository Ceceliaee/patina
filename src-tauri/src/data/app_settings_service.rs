use crate::data::repositories::app_settings::{
    self, commit_app_setting_mutations, AppSettingMutation,
};
use crate::data::repositories::update_state;
use crate::data::sqlite_pool::{
    is_recoverable_sqlite_error, reopen_sqlite_pool, wait_for_sqlite_pool,
};
use crate::domain::settings::{
    DesktopBehaviorSettings, PrivacySettings, WebActivityBridgeSettings, WebActivitySettings,
};
use tauri::{AppHandle, Runtime};

pub struct DesktopBehaviorStartupState {
    pub settings: DesktopBehaviorSettings,
    pub should_reopen_main_window: bool,
}

pub async fn commit_app_setting_mutations_with_recovery<R: Runtime>(
    app: &AppHandle<R>,
    mutations: &[AppSettingMutation],
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    match commit_app_setting_mutations(&pool, mutations).await {
        Ok(()) => Ok(()),
        Err(error) if is_recoverable_sqlite_error(&error) => {
            let reopened_pool = reopen_sqlite_pool(app).await?;
            commit_app_setting_mutations(&reopened_pool, mutations).await
        }
        Err(error) => Err(error),
    }
}

pub async fn load_desktop_behavior_startup_state<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<DesktopBehaviorStartupState, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let settings = app_settings::load_desktop_behavior_settings(&pool)
        .await
        .map_err(|error| format!("failed to load desktop behavior settings: {error}"))?;
    let should_reopen_main_window = update_state::take_post_install_reopen_main_window(&pool)
        .await
        .map_err(|error| format!("failed to load post-install reopen intent: {error}"))?;

    Ok(DesktopBehaviorStartupState {
        settings,
        should_reopen_main_window,
    })
}

pub async fn load_web_activity_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebActivitySettings, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    app_settings::load_web_activity_settings(&pool)
        .await
        .map_err(|error| format!("failed to load web activity settings: {error}"))
}

pub async fn load_web_activity_bridge_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebActivityBridgeSettings, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    app_settings::load_web_activity_bridge_settings(&pool)
        .await
        .map_err(|error| format!("failed to load web activity bridge settings: {error}"))
}

pub async fn load_privacy_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<PrivacySettings, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    app_settings::load_privacy_settings(&pool)
        .await
        .map_err(|error| format!("failed to load privacy settings: {error}"))
}
