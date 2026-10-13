use crate::data::repositories::remote_backup_settings::{self as repository, StoredConfig};
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::platform::credentials::{CredentialStore, WebDavCredentialStore};
use crate::platform::webdav::WebDavConfig;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tauri::{AppHandle, Runtime};

// Save/delete and acquisition of a complete network snapshot share this lock.
// A network request owns its copied password and does not hold the lock during I/O.
pub(crate) static CONFIG_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum PasswordUpdate {
    Keep,
    Replace { password: String },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveConfigInput {
    pub url: String,
    pub username: String,
    pub remote_dir: Option<String>,
    pub password_update: PasswordUpdate,
    pub operation_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    pub url: String,
    pub username: String,
    pub remote_dir: String,
    pub last_backup_at_ms: Option<i64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnapshot {
    pub config: Option<ConfigView>,
    pub has_secret: bool,
    pub operation_id: Option<String>,
    pub cleanup_pending: bool,
    pub runtime_refresh_pending: bool,
}

fn password(store: &impl CredentialStore, state: &StoredConfig) -> Result<Option<String>, String> {
    let Some(config) = &state.config else {
        return Ok(None);
    };
    match state.credential_ref.as_deref() {
        Some(repository::DETACHED_CREDENTIAL) => Ok(None),
        Some(id) => store.read(id, &repository::target_identity(config)),
        None => store.read_legacy(),
    }
}

fn cleanup(store: &impl CredentialStore, active: Option<&str>) -> bool {
    let Ok(ids) = store.candidates() else {
        return true;
    };
    let mut pending = false;
    for id in ids {
        if Some(id.as_str()) != active && store.remove(&id).is_err() {
            pending = true;
        }
    }
    // A committed reference (including a deliberate detach) ends legacy lookup.
    if active.is_some() && store.retire_legacy().is_err() {
        pending = true;
    }
    pending
}

fn view(state: StoredConfig, has_secret: bool, cleanup_pending: bool) -> ConfigSnapshot {
    ConfigSnapshot {
        has_secret,
        cleanup_pending,
        runtime_refresh_pending: false,
        operation_id: state.operation_id,
        config: state.config.map(|config| ConfigView {
            url: config.url,
            username: config.username,
            remote_dir: config.remote_dir,
            last_backup_at_ms: state.last_backup_at_ms,
        }),
    }
}

async fn snapshot_in_pool(
    pool: &SqlitePool,
    store: &impl CredentialStore,
) -> Result<ConfigSnapshot, String> {
    let state = repository::load_state(pool).await?;
    let has_secret = password(store, &state)?.is_some();
    let cleanup_pending = cleanup(store, state.credential_ref.as_deref());
    Ok(view(state, has_secret, cleanup_pending))
}

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

async fn save_in_pool(
    pool: &SqlitePool,
    store: &impl CredentialStore,
    input: SaveConfigInput,
) -> Result<ConfigSnapshot, String> {
    // Validate the entire request before creating even a non-secret candidate record.
    let config = repository::normalize_config(
        &input.url,
        &input.username,
        input.remote_dir.as_deref().unwrap_or(""),
    )?;
    uuid::Uuid::parse_str(&input.operation_id).map_err(|_| "invalid WebDAV save operation id")?;
    if matches!(&input.password_update, PasswordUpdate::Replace { password } if password.is_empty() || password.len() > 2560)
    {
        return Err("WebDAV password must contain 1 to 2560 UTF-8 bytes".into());
    }
    let old = repository::load_state(pool).await?;
    if old.operation_id.as_deref() == Some(input.operation_id.as_str()) {
        if old.config.as_ref() != Some(&config) {
            return Err("WebDAV save operation conflict".into());
        }
        return snapshot_in_pool(pool, store).await;
    }
    let identity = repository::target_identity(&config);
    let (candidate, owned_candidate) = match input.password_update {
        PasswordUpdate::Keep
            if old.config.as_ref() == Some(&config)
                && old
                    .credential_ref
                    .as_deref()
                    .is_some_and(|id| id != repository::DETACHED_CREDENTIAL)
                && password(store, &old)?.is_some() =>
        {
            (old.credential_ref.clone().unwrap(), false)
        }
        update => {
            let secret = match update {
                PasswordUpdate::Replace { password } => password,
                PasswordUpdate::Keep => {
                    password(store, &old)?.ok_or("WebDAV password is missing")?
                }
            };
            let id = store.prepare(&identity)?;
            if let Err(error) = store.write(&id, &config.username, &secret) {
                let _ = store.remove(&id); // A failed cleanup remains in the ledger for recovery.
                return Err(error);
            }
            if store.read(&id, &identity)?.as_deref() != Some(secret.as_str()) {
                let _ = store.remove(&id);
                return Err("failed to verify candidate WebDAV credential".into());
            }
            (id, true)
        }
    };
    let result = repository::commit_config(
        pool,
        Some(&config),
        &candidate,
        &input.operation_id,
        old.last_backup_at_ms,
    )
    .await;
    if let Err(error) = result {
        // A commit error can have an unknown outcome. Never delete a possibly active
        // credential unless a fresh SQLite read proves it is not the committed one.
        if let Ok(current) = repository::load_state(pool).await {
            if current.operation_id.as_deref() == Some(&input.operation_id) {
                return snapshot_in_pool(pool, store).await;
            }
            if owned_candidate && current.credential_ref.as_deref() != Some(&candidate) {
                let _ = store.remove(&candidate);
            }
        }
        return Err(error);
    }
    // The commit point has passed. Cleanup failures are a successful, pending state.
    let cleanup_pending = cleanup(store, Some(&candidate));
    Ok(view(
        StoredConfig {
            config: Some(config),
            credential_ref: Some(candidate),
            operation_id: Some(input.operation_id),
            last_backup_at_ms: old.last_backup_at_ms,
        },
        true,
        cleanup_pending,
    ))
}

pub async fn clear<R: Runtime>(app: &AppHandle<R>) -> Result<ConfigSnapshot, String> {
    let _guard = CONFIG_LOCK.lock().await;
    let pool = wait_for_sqlite_pool(app).await?;
    let store = WebDavCredentialStore::for_app(app)?;
    repository::commit_config(
        &pool,
        None,
        repository::DETACHED_CREDENTIAL,
        &uuid::Uuid::new_v4().to_string(),
        None,
    )
    .await?;
    let cleanup_pending = cleanup(&store, Some(repository::DETACHED_CREDENTIAL));
    Ok(view(StoredConfig::default(), false, cleanup_pending))
}

#[cfg(test)]
mod tests;
