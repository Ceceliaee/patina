use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::mini_window::Preferences;
use tauri::{AppHandle, Runtime};

pub async fn load<R: Runtime>(app: &AppHandle<R>) -> Result<Preferences, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    super::repositories::mini_window::load(&pool)
        .await
        .map_err(|error| error.to_string())
}

pub async fn save<R: Runtime>(app: &AppHandle<R>, preferences: &Preferences) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    super::repositories::mini_window::save(&pool, preferences)
        .await
        .map_err(|error| error.to_string())
}

pub async fn load_bootstrap<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<super::repositories::mini_window::MiniBootstrapSnapshot, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    super::repositories::mini_window::load_mini_bootstrap_snapshot(&pool)
        .await
        .map_err(|error| format!("failed to load mini bootstrap snapshot: {error}"))
}
