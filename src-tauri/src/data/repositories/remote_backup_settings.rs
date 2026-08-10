use crate::data::repositories::tracker_settings::load_setting_value;
use crate::platform::webdav::{normalize_base_url, normalize_remote_dir, WebDavConfig};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Sqlite};

pub const WEBDAV_BACKUP_URL_KEY: &str = "webdav_backup_url";
pub const WEBDAV_BACKUP_USERNAME_KEY: &str = "webdav_backup_username";
pub const WEBDAV_BACKUP_REMOTE_DIR_KEY: &str = "webdav_backup_remote_dir";
pub const WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY: &str = "webdav_backup_last_backup_at_ms";
pub const DEFAULT_WEBDAV_REMOTE_DIR: &str = "/Patina";

pub async fn load_config(pool: &Pool<Sqlite>) -> Result<Option<WebDavConfig>, String> {
    let url = load_setting_value(pool, WEBDAV_BACKUP_URL_KEY)
        .await
        .map_err(|error| format!("failed to load WebDAV backup URL: {error}"))?;
    let username = load_setting_value(pool, WEBDAV_BACKUP_USERNAME_KEY)
        .await
        .map_err(|error| format!("failed to load WebDAV backup username: {error}"))?;
    let remote_dir = load_setting_value(pool, WEBDAV_BACKUP_REMOTE_DIR_KEY)
        .await
        .map_err(|error| format!("failed to load WebDAV backup directory: {error}"))?;

    match (url, username) {
        (None, None) => Ok(None),
        (Some(url), Some(username)) => Ok(Some(normalize_config(
            &url,
            &username,
            remote_dir.as_deref().unwrap_or(DEFAULT_WEBDAV_REMOTE_DIR),
        )?)),
        _ => Err("WebDAV backup configuration is incomplete".to_string()),
    }
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
