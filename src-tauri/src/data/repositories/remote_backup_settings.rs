use crate::platform::webdav::{normalize_base_url, normalize_remote_dir, WebDavConfig};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Sqlite};

pub const WEBDAV_BACKUP_URL_KEY: &str = "webdav_backup_url";
pub const WEBDAV_BACKUP_USERNAME_KEY: &str = "webdav_backup_username";
pub const WEBDAV_BACKUP_REMOTE_DIR_KEY: &str = "webdav_backup_remote_dir";
pub const WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY: &str = "webdav_backup_last_backup_at_ms";
pub const DEFAULT_WEBDAV_REMOTE_DIR: &str = "/Patina";

pub const WEBDAV_CREDENTIAL_REF_KEY: &str = "webdav_backup_credential_ref";
pub const WEBDAV_SAVE_ID_KEY: &str = "webdav_backup_save_id";
pub const DETACHED_CREDENTIAL: &str = "detached";

#[derive(Default)]
pub struct StoredConfig {
    pub config: Option<WebDavConfig>,
    pub credential_ref: Option<String>,
    pub operation_id: Option<String>,
    pub last_backup_at_ms: Option<i64>,
}

pub async fn load_state(pool: &Pool<Sqlite>) -> Result<StoredConfig, String> {
    // One statement is one SQLite read snapshot.
    let rows = super::settings::load_rows(pool, None, Some("webdav_backup_"))
        .await
        .map_err(|error| format!("failed to read WebDAV configuration: {error}"))?;
    let mut values: std::collections::HashMap<_, _> =
        rows.into_iter().map(|row| (row.key, row.value)).collect();
    let config = match (
        values.remove(WEBDAV_BACKUP_URL_KEY),
        values.remove(WEBDAV_BACKUP_USERNAME_KEY),
    ) {
        (None, None) => None,
        (Some(url), Some(username)) => Some(normalize_config(
            &url,
            &username,
            values
                .get(WEBDAV_BACKUP_REMOTE_DIR_KEY)
                .map(String::as_str)
                .unwrap_or(DEFAULT_WEBDAV_REMOTE_DIR),
        )?),
        _ => return Err("WebDAV backup configuration is incomplete".into()),
    };
    Ok(StoredConfig {
        config,
        credential_ref: values.remove(WEBDAV_CREDENTIAL_REF_KEY),
        operation_id: values.remove(WEBDAV_SAVE_ID_KEY),
        last_backup_at_ms: values
            .get(WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY)
            .and_then(|v| v.parse().ok())
            .filter(|v| *v > 0),
    })
}

pub async fn load_config(pool: &Pool<Sqlite>) -> Result<Option<WebDavConfig>, String> {
    Ok(load_state(pool).await?.config)
}

pub async fn commit_config(
    pool: &Pool<Sqlite>,
    config: Option<&WebDavConfig>,
    credential_ref: &str,
    operation_id: &str,
    last_backup_at_ms: Option<i64>,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    for (key, value) in [
        (WEBDAV_BACKUP_URL_KEY, config.map(|c| c.url.clone())),
        (
            WEBDAV_BACKUP_USERNAME_KEY,
            config.map(|c| c.username.clone()),
        ),
        (
            WEBDAV_BACKUP_REMOTE_DIR_KEY,
            config.map(|c| c.remote_dir.clone()),
        ),
        (
            WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY,
            last_backup_at_ms.filter(|v| *v > 0).map(|v| v.to_string()),
        ),
        (WEBDAV_CREDENTIAL_REF_KEY, Some(credential_ref.to_string())),
        (WEBDAV_SAVE_ID_KEY, Some(operation_id.to_string())),
    ] {
        match value {
            Some(value) => {
                sqlx::query("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
                .bind(key).bind(value).execute(&mut *tx).await.map_err(|e| e.to_string())?;
            }
            None => {
                sqlx::query("DELETE FROM settings WHERE key=?")
                    .bind(key)
                    .execute(&mut *tx)
                    .await
                    .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}

pub async fn detach_for_restore(tx: &mut sqlx::Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(WEBDAV_CREDENTIAL_REF_KEY).bind(DETACHED_CREDENTIAL).execute(&mut **tx).await.map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM settings WHERE key=?")
        .bind(WEBDAV_SAVE_ID_KEY)
        .execute(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn normalize_config(
    raw_url: &str,
    raw_username: &str,
    raw_remote_dir: &str,
) -> Result<WebDavConfig, String> {
    let username = raw_username.trim();
    if username.is_empty() {
        return Err("WebDAV username cannot be empty".to_string());
    }
    let url = normalize_base_url(raw_url)?;

    Ok(WebDavConfig {
        url,
        username: username.to_string(),
        remote_dir: normalize_remote_dir(raw_remote_dir)?,
    })
}

pub fn target_identity(config: &WebDavConfig) -> String {
    let mut hasher = Sha256::new();
    hasher.update(config.url.as_bytes());
    hasher.update([0]);
    hasher.update(config.username.as_bytes());
    hasher.update([0]);
    hasher.update(config.remote_dir.as_bytes());
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema::CURRENT_BASELINE_SCHEMA_SQL;
    use sqlx::{Executor, SqlitePool};

    #[test]
    fn target_identity_changes_only_with_non_secret_target_fields() {
        let first = normalize_config("https://example.com/dav", "alice", "/Patina").unwrap();
        let same =
            normalize_config("https://example.com/dav#ignored", " alice ", "Patina/").unwrap();
        let other = normalize_config("https://example.com/dav", "bob", "/Patina").unwrap();
        assert_eq!(target_identity(&first), target_identity(&same));
        assert_ne!(target_identity(&first), target_identity(&other));
        assert_eq!(target_identity(&first).len(), 64);
    }

    #[test]
    fn persisted_config_rejects_cleartext_non_loopback_transport() {
        let error = normalize_config("http://example.com/dav", "alice", "/Patina").unwrap_err();
        assert!(error.contains("must use HTTPS"));
        assert!(normalize_config("http://127.0.0.1:8080/dav", "alice", "/Patina").is_ok());
    }

    #[tokio::test]
    async fn persisted_config_is_loaded_without_a_password() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
        for (key, value) in [
            (WEBDAV_BACKUP_URL_KEY, "https://example.com/dav"),
            (WEBDAV_BACKUP_USERNAME_KEY, "alice"),
            (WEBDAV_BACKUP_REMOTE_DIR_KEY, "/Patina"),
        ] {
            sqlx::query("INSERT INTO settings(key, value) VALUES (?, ?)")
                .bind(key)
                .bind(value)
                .execute(&pool)
                .await
                .unwrap();
        }
        let loaded = load_config(&pool).await.unwrap().unwrap();
        assert_eq!(loaded.username, "alice");
        assert_eq!(loaded.remote_dir, "/Patina");
    }
}
