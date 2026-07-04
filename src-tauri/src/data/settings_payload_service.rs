use crate::data::sqlite_pool::run_recoverable_sqlite_write;
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Runtime};

const WEBDAV_BACKUP_URL_KEY: &str = "webdav_backup_url";
const WEBDAV_BACKUP_USERNAME_KEY: &str = "webdav_backup_username";
const WEBDAV_BACKUP_REMOTE_DIR_KEY: &str = "webdav_backup_remote_dir";
const WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY: &str = "webdav_backup_last_backup_at_ms";
const DATA_BOOTSTRAP_SNAPSHOT_KEY: &str = "data.bootstrap_snapshot";
const DEFAULT_WEBDAV_REMOTE_DIR: &str = "/Patina";
const MAX_SETTINGS_PAYLOAD_LEN: usize = 10 * 1024 * 1024;

pub struct RemoteBackupSettingsPatch {
    pub url: String,
    pub username: String,
    pub remote_dir: Option<String>,
    pub last_backup_at_ms: Option<i64>,
}

pub async fn save_remote_backup_settings<R: Runtime>(
    app: &AppHandle<R>,
    patch: RemoteBackupSettingsPatch,
) -> Result<(), String> {
    let url = patch.url.trim().to_string();
    let username = patch.username.trim().to_string();
    if url.is_empty() {
        return Err("WebDAV URL cannot be empty".to_string());
    }
    if username.is_empty() {
        return Err("WebDAV username cannot be empty".to_string());
    }

    let remote_dir = normalize_remote_dir(patch.remote_dir.as_deref());
    let last_backup_at_ms = patch.last_backup_at_ms.filter(|timestamp| *timestamp > 0);

    run_recoverable_sqlite_write(app, "failed to save remote backup settings", move |pool| {
        let url = url.clone();
        let username = username.clone();
        let remote_dir = remote_dir.clone();
        async move {
            let mut mutations = vec![
                SettingMutation::upsert(WEBDAV_BACKUP_URL_KEY, url),
                SettingMutation::upsert(WEBDAV_BACKUP_USERNAME_KEY, username),
                SettingMutation::upsert(WEBDAV_BACKUP_REMOTE_DIR_KEY, remote_dir),
            ];
            if let Some(timestamp) = last_backup_at_ms {
                mutations.push(SettingMutation::upsert(
                    WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY,
                    timestamp.to_string(),
                ));
            }
            commit_settings_in_pool(&pool, &mutations).await
        }
    })
    .await
}

pub async fn save_remote_backup_remote_dir<R: Runtime>(
    app: &AppHandle<R>,
    remote_dir: String,
) -> Result<(), String> {
    let remote_dir = normalize_remote_dir(Some(&remote_dir));
    upsert_single_setting(app, WEBDAV_BACKUP_REMOTE_DIR_KEY, remote_dir).await
}

pub async fn save_remote_backup_last_backup_at<R: Runtime>(
    app: &AppHandle<R>,
    timestamp_ms: i64,
) -> Result<(), String> {
    if timestamp_ms <= 0 {
        return Err("remote backup timestamp must be positive".to_string());
    }
    upsert_single_setting(
        app,
        WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY,
        timestamp_ms.to_string(),
    )
    .await
}

pub async fn clear_remote_backup_settings<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    run_recoverable_sqlite_write(
        app,
        "failed to clear remote backup settings",
        |pool| async move {
            commit_settings_in_pool(
                &pool,
                &[
                    SettingMutation::delete(WEBDAV_BACKUP_URL_KEY),
                    SettingMutation::delete(WEBDAV_BACKUP_USERNAME_KEY),
                    SettingMutation::delete(WEBDAV_BACKUP_REMOTE_DIR_KEY),
                    SettingMutation::delete(WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY),
                ],
            )
            .await
        },
    )
    .await
}

pub async fn save_data_bootstrap_snapshot_payload<R: Runtime>(
    app: &AppHandle<R>,
    payload: String,
) -> Result<(), String> {
    if payload.len() > MAX_SETTINGS_PAYLOAD_LEN {
        return Err("data bootstrap snapshot payload is too large".to_string());
    }
    upsert_single_setting(app, DATA_BOOTSTRAP_SNAPSHOT_KEY, payload).await
}

pub async fn clear_data_bootstrap_snapshot_payload<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    run_recoverable_sqlite_write(
        app,
        "failed to clear data bootstrap snapshot",
        |pool| async move {
            commit_settings_in_pool(
                &pool,
                &[SettingMutation::delete(DATA_BOOTSTRAP_SNAPSHOT_KEY)],
            )
            .await
        },
    )
    .await
}

async fn upsert_single_setting<R: Runtime>(
    app: &AppHandle<R>,
    key: &'static str,
    value: String,
) -> Result<(), String> {
    if value.len() > MAX_SETTINGS_PAYLOAD_LEN {
        return Err(format!("setting value is too large for key `{key}`"));
    }

    run_recoverable_sqlite_write(app, "failed to save setting payload", move |pool| {
        let value = value.clone();
        async move { commit_settings_in_pool(&pool, &[SettingMutation::upsert(key, value)]).await }
    })
    .await
}

fn normalize_remote_dir(value: Option<&str>) -> String {
    let trimmed = value.unwrap_or("").trim();
    if trimmed.is_empty() {
        return DEFAULT_WEBDAV_REMOTE_DIR.to_string();
    }

    let with_leading_slash = if trimmed.starts_with('/') {
        trimmed.to_string()
    } else {
        format!("/{trimmed}")
    };

    if with_leading_slash.len() > 1 && with_leading_slash.ends_with('/') {
        with_leading_slash[..with_leading_slash.len() - 1].to_string()
    } else {
        with_leading_slash
    }
}

struct SettingMutation {
    key: &'static str,
    value: Option<String>,
}

impl SettingMutation {
    fn upsert(key: &'static str, value: String) -> Self {
        Self {
            key,
            value: Some(value),
        }
    }

    fn delete(key: &'static str) -> Self {
        Self { key, value: None }
    }
}

async fn commit_settings_in_pool(
    pool: &Pool<Sqlite>,
    mutations: &[SettingMutation],
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start settings payload transaction: {error}"))?;

    for mutation in mutations {
        if let Some(value) = &mutation.value {
            if value.len() > MAX_SETTINGS_PAYLOAD_LEN {
                return Err(format!(
                    "setting value is too large for key `{}`",
                    mutation.key
                ));
            }

            sqlx::query(
                "INSERT INTO settings (key, value) VALUES (?, ?)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            )
            .bind(mutation.key)
            .bind(value)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("failed to save setting `{}`: {error}", mutation.key))?;
        } else {
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind(mutation.key)
                .execute(&mut *tx)
                .await
                .map_err(|error| format!("failed to delete setting `{}`: {error}", mutation.key))?;
        }
    }

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit settings payload transaction: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema as db_schema;
    use sqlx::{Executor, Row, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    async fn load_setting(pool: &SqlitePool, key: &str) -> Option<String> {
        sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .unwrap()
            .and_then(|row| row.try_get::<String, _>("value").ok())
    }

    #[test]
    fn remote_dir_normalization_matches_frontend_contract() {
        assert_eq!(normalize_remote_dir(None), "/Patina");
        assert_eq!(normalize_remote_dir(Some("")), "/Patina");
        assert_eq!(normalize_remote_dir(Some("TimeTracker")), "/TimeTracker");
        assert_eq!(
            normalize_remote_dir(Some("/Patina/backups/")),
            "/Patina/backups"
        );
    }

    #[test]
    fn commit_settings_in_pool_upserts_and_deletes_known_payloads() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            commit_settings_in_pool(
                &pool,
                &[
                    SettingMutation::upsert(WEBDAV_BACKUP_URL_KEY, "https://example.test".into()),
                    SettingMutation::upsert(DATA_BOOTSTRAP_SNAPSHOT_KEY, "{\"ok\":true}".into()),
                ],
            )
            .await
            .unwrap();
            assert_eq!(
                load_setting(&pool, WEBDAV_BACKUP_URL_KEY).await,
                Some("https://example.test".to_string())
            );

            commit_settings_in_pool(
                &pool,
                &[SettingMutation::delete(DATA_BOOTSTRAP_SNAPSHOT_KEY)],
            )
            .await
            .unwrap();
            assert_eq!(load_setting(&pool, DATA_BOOTSTRAP_SNAPSHOT_KEY).await, None);
        });
    }
}
