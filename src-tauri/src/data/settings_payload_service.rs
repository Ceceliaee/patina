use crate::data::sqlite_error::SqliteOperationError;
use crate::data::sqlite_pool::run_recoverable_sqlite_write;
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Runtime};

use crate::data::repositories::remote_backup_settings::{
    normalize_config, WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY, WEBDAV_BACKUP_REMOTE_DIR_KEY,
    WEBDAV_BACKUP_URL_KEY, WEBDAV_BACKUP_USERNAME_KEY,
};
use crate::platform::webdav::normalize_remote_dir;
const DATA_BOOTSTRAP_SNAPSHOT_KEY: &str = "data.bootstrap_snapshot";
const HISTORY_BOOTSTRAP_SNAPSHOT_KEY: &str = "history.bootstrap_snapshot.v1";
const MAX_SETTINGS_PAYLOAD_LEN: usize = 10 * 1024 * 1024;
const MAX_HISTORY_BOOTSTRAP_SNAPSHOT_LEN: usize = 256 * 1024;

pub struct RemoteBackupSettingsPatch {
    pub url: String,
    pub username: String,
    pub remote_dir: Option<String>,
    pub last_backup_at_ms: Option<i64>,
}

pub async fn save_remote_backup_settings<R: Runtime>(
    app: &AppHandle<R>,
    patch: RemoteBackupSettingsPatch,
) -> Result<(), SqliteOperationError> {
    let normalized = normalize_config(
        &patch.url,
        &patch.username,
        patch.remote_dir.as_deref().unwrap_or(""),
    )
    .map_err(|error| SqliteOperationError::invalid_input("save remote backup settings", error))?;
    let url = normalized.url;
    let username = normalized.username;
    let remote_dir = normalized.remote_dir;
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
) -> Result<(), SqliteOperationError> {
    let remote_dir = normalize_remote_dir(&remote_dir).map_err(|error| {
        SqliteOperationError::invalid_input("save remote backup directory", error)
    })?;
    upsert_single_setting(app, WEBDAV_BACKUP_REMOTE_DIR_KEY, remote_dir).await
}

pub async fn save_remote_backup_last_backup_at<R: Runtime>(
    app: &AppHandle<R>,
    timestamp_ms: i64,
) -> Result<(), SqliteOperationError> {
    if timestamp_ms <= 0 {
        return Err(SqliteOperationError::invalid_input(
            "save remote backup timestamp",
            "timestamp must be positive",
        ));
    }
    upsert_single_setting(
        app,
        WEBDAV_BACKUP_LAST_BACKUP_AT_MS_KEY,
        timestamp_ms.to_string(),
    )
    .await
}

pub async fn clear_remote_backup_settings<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), SqliteOperationError> {
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
) -> Result<(), SqliteOperationError> {
    if payload.len() > MAX_SETTINGS_PAYLOAD_LEN {
        return Err(SqliteOperationError::invalid_input(
            "save data bootstrap snapshot",
            "payload is too large",
        ));
    }
    upsert_single_setting(app, DATA_BOOTSTRAP_SNAPSHOT_KEY, payload).await
}

pub async fn clear_data_bootstrap_snapshot_payload<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), SqliteOperationError> {
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

pub async fn save_history_bootstrap_snapshot_payload<R: Runtime>(
    app: &AppHandle<R>,
    payload: String,
) -> Result<(), SqliteOperationError> {
    validate_history_bootstrap_snapshot_payload(&payload)?;
    upsert_single_setting(app, HISTORY_BOOTSTRAP_SNAPSHOT_KEY, payload).await
}

pub async fn clear_history_bootstrap_snapshot_payload<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), SqliteOperationError> {
    run_recoverable_sqlite_write(
        app,
        "failed to clear history bootstrap snapshot",
        |pool| async move {
            commit_settings_in_pool(
                &pool,
                &[SettingMutation::delete(HISTORY_BOOTSTRAP_SNAPSHOT_KEY)],
            )
            .await
        },
    )
    .await
}

fn validate_history_bootstrap_snapshot_payload(payload: &str) -> Result<(), SqliteOperationError> {
    if payload.len() > MAX_HISTORY_BOOTSTRAP_SNAPSHOT_LEN {
        return Err(SqliteOperationError::invalid_input(
            "save history bootstrap snapshot",
            "payload is too large",
        ));
    }
    Ok(())
}

async fn upsert_single_setting<R: Runtime>(
    app: &AppHandle<R>,
    key: &'static str,
    value: String,
) -> Result<(), SqliteOperationError> {
    if value.len() > MAX_SETTINGS_PAYLOAD_LEN {
        return Err(SqliteOperationError::invalid_input(
            "save setting payload",
            format!("value is too large for key `{key}`"),
        ));
    }

    run_recoverable_sqlite_write(app, "failed to save setting payload", move |pool| {
        let value = value.clone();
        async move { commit_settings_in_pool(&pool, &[SettingMutation::upsert(key, value)]).await }
    })
    .await
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
) -> Result<(), SqliteOperationError> {
    let mut tx = pool.begin().await.map_err(|error| {
        SqliteOperationError::from_sqlx("start settings payload transaction", error)
    })?;

    for mutation in mutations {
        if let Some(value) = &mutation.value {
            if value.len() > MAX_SETTINGS_PAYLOAD_LEN {
                return Err(SqliteOperationError::invalid_input(
                    "save setting payload",
                    format!("value is too large for key `{}`", mutation.key),
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
            .map_err(|error| SqliteOperationError::from_sqlx("save setting payload", error))?;
        } else {
            sqlx::query("DELETE FROM settings WHERE key = ?")
                .bind(mutation.key)
                .execute(&mut *tx)
                .await
                .map_err(|error| {
                    SqliteOperationError::from_sqlx("delete setting payload", error)
                })?;
        }
    }

    tx.commit().await.map_err(|error| {
        SqliteOperationError::from_sqlx("commit settings payload transaction", error)
    })
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
        assert_eq!(normalize_remote_dir("").unwrap(), "/Patina");
        assert_eq!(normalize_remote_dir("TimeTracker").unwrap(), "/TimeTracker");
        assert_eq!(
            normalize_remote_dir("/Patina/backups/").unwrap(),
            "/Patina/backups"
        );
        assert!(normalize_remote_dir("../outside").is_err());
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
                    SettingMutation::upsert(
                        HISTORY_BOOTSTRAP_SNAPSHOT_KEY,
                        "{\"version\":1}".into(),
                    ),
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
            assert_eq!(
                load_setting(&pool, HISTORY_BOOTSTRAP_SNAPSHOT_KEY).await,
                Some("{\"version\":1}".to_string())
            );
        });
    }

    #[test]
    fn history_bootstrap_payload_has_a_strict_size_limit() {
        assert!(validate_history_bootstrap_snapshot_payload("{}").is_ok());
        assert!(validate_history_bootstrap_snapshot_payload(
            &"x".repeat(MAX_HISTORY_BOOTSTRAP_SNAPSHOT_LEN + 1)
        )
        .is_err());
    }
}
