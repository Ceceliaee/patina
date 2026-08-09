use crate::data::repositories::tracker_settings::load_setting_value;
use crate::platform::webdav::{normalize_remote_dir, WebDavConfig};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Sqlite};
use url::Url;

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
    let mut url = Url::parse(raw_url.trim())
        .map_err(|error| format!("invalid WebDAV server address: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("WebDAV server address must use http or https".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("WebDAV server address must not contain credentials".to_string());
    }
    url.set_query(None);
    url.set_fragment(None);

    Ok(WebDavConfig {
        url: url.to_string(),
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
