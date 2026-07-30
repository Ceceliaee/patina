pub use crate::data::repositories::app_settings::AppSettingMutation;
use crate::data::repositories::app_settings::{self, commit_app_setting_mutations};
use crate::data::repositories::update_state;
use crate::data::sqlite_error::SqliteOperationError;
use crate::data::sqlite_pool::{reopen_sqlite_pool, wait_for_sqlite_pool};
use crate::domain::settings::{
    DesktopBehaviorSettings, WebActivityBridgeSettings, WebActivitySettings,
};
use tauri::{AppHandle, Runtime};

pub struct DesktopBehaviorStartupState {
    pub settings: DesktopBehaviorSettings,
    pub should_reopen_main_window: bool,
}

pub async fn commit_app_setting_mutations_with_recovery<R: Runtime>(
    app: &AppHandle<R>,
    mutations: &[AppSettingMutation],
) -> Result<(), SqliteOperationError> {
    let pool = wait_for_sqlite_pool(app)
        .await
        .map_err(|error| SqliteOperationError::operation_failed("load app settings pool", error))?;
    match commit_app_setting_mutations(&pool, mutations).await {
        Ok(()) => Ok(()),
        Err(error) if error.retryable() => {
            let reopened_pool = reopen_sqlite_pool(app).await.map_err(|error| {
                SqliteOperationError::operation_failed("reopen app settings pool", error)
            })?;
            commit_app_setting_mutations(&reopened_pool, mutations).await
        }
        Err(error) => Err(error),
    }
}

pub async fn load_desktop_behavior_startup_state<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<DesktopBehaviorStartupState, String> {
    let settings = load_desktop_behavior_settings(app).await?;
    let pool = wait_for_sqlite_pool(app).await?;
    let should_reopen_main_window = update_state::load_post_install_reopen_main_window(&pool)
        .await
        .map_err(|error| format!("failed to load post-install reopen intent: {error}"))?;

    Ok(DesktopBehaviorStartupState {
        settings,
        should_reopen_main_window,
    })
}

pub async fn clear_post_install_reopen_main_window<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    update_state::clear_post_install_reopen_main_window(&pool)
        .await
        .map_err(|error| format!("failed to clear post-install reopen intent: {error}"))
}

pub async fn load_desktop_behavior_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<DesktopBehaviorSettings, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    app_settings::load_desktop_behavior_settings(&pool)
        .await
        .map_err(|error| format!("failed to load desktop behavior settings: {error}"))
}

pub async fn load_language_setting<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Option<String>, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    app_settings::load_language_setting(&pool)
        .await
        .map_err(|error| format!("failed to load language setting: {error}"))
}

pub async fn load_web_activity_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebActivitySettings, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    app_settings::load_web_activity_settings(&pool)
        .await
        .map_err(|error| format!("failed to load web activity settings: {error}"))
}

pub async fn load_title_recording_enabled<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    crate::data::repositories::tracker_settings::load_title_recording_enabled(&pool)
        .await
        .map_err(|error| format!("failed to load title recording setting: {error}"))
}

pub async fn disable_active_app_title<R: Runtime>(
    app: &AppHandle<R>,
    timestamp_ms: i64,
) -> Result<bool, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    crate::data::repositories::sessions::disable_active_title(&pool, timestamp_ms)
        .await
        .map_err(|error| format!("failed to close active app title: {error}"))
}

pub async fn load_web_activity_bridge_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebActivityBridgeSettings, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    app_settings::load_web_activity_bridge_settings(&pool)
        .await
        .map_err(|error| format!("failed to load web activity bridge settings: {error}"))
}
