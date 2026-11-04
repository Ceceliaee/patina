use crate::domain::tool_notifications::{Preferences, PreferencesPatch};
use tauri::{AppHandle, Runtime};

pub async fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Preferences, String> {
    let pool = super::sqlite_pool::wait_for_sqlite_pool(app).await?;
    super::repositories::tools::notification_preferences::load(&pool).await
}

pub async fn save<R: Runtime>(
    app: &AppHandle<R>,
    patch: PreferencesPatch,
) -> Result<Preferences, String> {
    let pool = super::sqlite_pool::wait_for_sqlite_pool(app).await?;
    super::repositories::tools::notification_preferences::save(&pool, patch).await
}

pub async fn appearance<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let pool = super::sqlite_pool::wait_for_sqlite_pool(app).await?;
    super::repositories::tools::notification_preferences::appearance(&pool).await
}

pub async fn target_icon<R: Runtime>(
    app: &AppHandle<R>,
    alert: Option<&crate::domain::tools::ToolAlert>,
) -> Result<Option<String>, String> {
    use crate::domain::tools::ActivityReminderTarget;
    let Some(details) = alert.and_then(|a| a.activity_reminder.as_ref()) else {
        return Ok(None);
    };
    let pool = super::sqlite_pool::wait_for_sqlite_pool(app).await?;
    match &details.target {
        ActivityReminderTarget::App {
            exe_name: Some(exe),
            ..
        } => super::repositories::icon_cache::fetch_icon_for_exe(&pool, exe).await,
        ActivityReminderTarget::Web { normalized_domain } => {
            super::repositories::web_activity::read::favicons(
                &pool,
                std::slice::from_ref(normalized_domain),
            )
            .await
            .map(|rows| rows.into_iter().next().map(|r| r.favicon_url))
            .map_err(|e| e.to_string())
        }
        _ => Ok(None),
    }
}
