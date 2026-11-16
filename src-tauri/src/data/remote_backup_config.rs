mod core;
use crate::data::{
    repositories::remote_backup_settings as repository, sqlite_pool::wait_for_sqlite_pool,
};
use crate::platform::{credentials::WebDavCredentialStore, webdav::WebDavConfig};
pub(crate) use core::CONFIG_LOCK;
use core::{password, save_in_pool, snapshot_in_pool};
pub use core::{ConfigSnapshot, SaveConfigInput};
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime};
pub async fn snapshot<R: Runtime>(app: &AppHandle<R>) -> Result<ConfigSnapshot, String> {
    let _guard = CONFIG_LOCK.lock().await;
    snapshot_in_pool(
        &wait_for_sqlite_pool(app).await?,
        &WebDavCredentialStore::for_app(app)?,
    )
    .await
}

pub async fn reveal<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>, String> {
    let _guard = CONFIG_LOCK.lock().await;
    let state = repository::load_state(&wait_for_sqlite_pool(app).await?).await?;
    password(&WebDavCredentialStore::for_app(app)?, &state)
}

pub async fn network_snapshot<R: Runtime>(
    app: &AppHandle<R>,
    pool: &SqlitePool,
) -> Result<(WebDavConfig, String), String> {
    let _guard = CONFIG_LOCK.lock().await;
    let state = repository::load_state(pool).await?;
    let password = password(&WebDavCredentialStore::for_app(app)?, &state)?
        .ok_or_else(|| "credential_missing".to_string())?;
    Ok((
        state
            .config
            .ok_or_else(|| "webdav_not_configured".to_string())?,
        password,
    ))
}

pub async fn save<R: Runtime>(
    app: &AppHandle<R>,
    input: SaveConfigInput,
) -> Result<ConfigSnapshot, String> {
    let _guard = CONFIG_LOCK.lock().await;
    save_in_pool(
        &wait_for_sqlite_pool(app).await?,
        &WebDavCredentialStore::for_app(app)?,
        input,
    )
    .await
}

pub async fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<ConfigSnapshot, String> {
    let _guard = CONFIG_LOCK.lock().await;
    let pool = wait_for_sqlite_pool(app).await?;
    let store = WebDavCredentialStore::for_app(app)?;
    core::clear_in_pool(&pool, &store).await
}
#[cfg(test)]
use crate::platform::credentials::CredentialStore;
#[cfg(test)]
use core::PasswordUpdate;
#[cfg(test)]
mod tests;
