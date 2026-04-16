use crate::data::repositories;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::backup::{
    BackupMeta, BackupPayload, BackupPreview, CURRENT_BACKUP_SCHEMA_VERSION, CURRENT_BACKUP_VERSION,
};
use sqlx::{Pool, Sqlite};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

const BACKUP_FILE_EXT: &str = "ttbackup.json";

fn default_backup_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data dir: {error}"))?;
    let backup_dir = app_data_dir.join("backups");
    fs::create_dir_all(&backup_dir)
        .map_err(|error| format!("failed to create backup dir: {error}"))?;

    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    Ok(backup_dir.join(format!("time-tracker-backup-{timestamp}.{BACKUP_FILE_EXT}")))
}

fn backup_file_name() -> String {
    let timestamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    format!("time-tracker-backup-{timestamp}.{BACKUP_FILE_EXT}")
}

fn resolve_backup_path<R: Runtime>(
    app: &AppHandle<R>,
    raw_path: Option<String>,
) -> Result<PathBuf, String> {
    let Some(raw_path) = raw_path.map(|value| value.trim().to_string()) else {
        return default_backup_path(app);
    };

    if raw_path.is_empty() {
        return default_backup_path(app);
    }

    let mut path = PathBuf::from(&raw_path);
    let ends_with_separator = raw_path.ends_with('\\') || raw_path.ends_with('/');
    if path.is_dir() || ends_with_separator {
        fs::create_dir_all(&path)
            .map_err(|error| format!("failed to create backup target dir: {error}"))?;
        path = path.join(backup_file_name());
    }

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to create backup parent dir: {error}"))?;
        }
    }

    Ok(path)
}

async fn load_backup_payload<R: Runtime>(app: &AppHandle<R>) -> Result<BackupPayload, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let sessions = repositories::sessions::fetch_all_for_backup(&pool).await?;
    let settings = repositories::settings::fetch_all_for_backup(&pool).await?;
    let icon_cache = repositories::icon_cache::fetch_all_for_backup(&pool).await?;

    Ok(BackupPayload {
        version: CURRENT_BACKUP_VERSION,
        meta: BackupMeta {
            exported_at_ms: now_ms(),
            schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        },
        sessions,
        settings,
        icon_cache,
    })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn resolve_dialog_directory(initial_path: Option<String>) -> Option<PathBuf> {
    let raw = initial_path?.trim().to_string();
    if raw.is_empty() {
        return None;
    }

    let path = PathBuf::from(raw);
    if path.is_dir() {
        return Some(path);
    }

    path.parent().and_then(|parent| {
        if parent.as_os_str().is_empty() {
            None
        } else {
            Some(parent.to_path_buf())
        }
    })
}

pub fn pick_backup_save_file(initial_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("Backup files", &["json", "ttbackup"]);
    if let Some(dir) = resolve_dialog_directory(initial_path) {
        dialog = dialog.set_directory(dir);
    }
    dialog = dialog.set_file_name(&backup_file_name());

    dialog
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

pub fn pick_backup_file(initial_path: Option<String>) -> Option<String> {
    let mut dialog = rfd::FileDialog::new().add_filter("Backup files", &["json", "ttbackup"]);
    if let Some(dir) = resolve_dialog_directory(initial_path) {
        dialog = dialog.set_directory(dir);
    }

    dialog
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

fn decode_backup_payload(raw_json: &str, source_path: &Path) -> Result<BackupPayload, String> {
    let payload = serde_json::from_str::<BackupPayload>(raw_json).map_err(|error| {
        format!(
            "failed to parse backup file `{}`: {error}",
            source_path.display()
        )
    })?;

    Ok(payload)
}

pub async fn export_backup(backup_path: Option<String>, app: AppHandle) -> Result<String, String> {
    let payload = load_backup_payload(&app).await?;
    let target_path = resolve_backup_path(&app, backup_path)?;

    let serialized = serde_json::to_string_pretty(&payload)
        .map_err(|error| format!("failed to serialize backup payload: {error}"))?;
    fs::write(&target_path, serialized)
        .map_err(|error| format!("failed to write backup file: {error}"))?;

    Ok(target_path.to_string_lossy().to_string())
}

pub async fn restore_backup(backup_path: String, app: AppHandle) -> Result<(), String> {
    let backup_path = PathBuf::from(backup_path.trim());
    if backup_path.as_os_str().is_empty() {
        return Err("backup path cannot be empty".to_string());
    }

    let raw_json = fs::read_to_string(&backup_path).map_err(|error| {
        format!(
            "failed to read backup file `{}`: {error}",
            backup_path.display()
        )
    })?;
    let payload = decode_backup_payload(&raw_json, &backup_path)?;
    let compatibility = payload.compatibility();
    if !compatibility.supported {
        return Err(compatibility.message);
    }

    let pool = wait_for_sqlite_pool(&app).await?;
    restore_backup_payload(&pool, &payload).await?;
    Ok(())
}

async fn restore_backup_payload(
    pool: &Pool<Sqlite>,
    payload: &BackupPayload,
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start restore transaction: {error}"))?;
    repositories::sessions::clear_for_restore(&mut tx).await?;
    repositories::settings::clear_for_restore(&mut tx).await?;
    repositories::icon_cache::clear_for_restore(&mut tx).await?;

    repositories::sessions::insert_for_restore(&mut tx, &payload.sessions).await?;
    repositories::settings::insert_for_restore(&mut tx, &payload.settings).await?;
    repositories::icon_cache::insert_for_restore(&mut tx, &payload.icon_cache).await?;

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit restore transaction: {error}"))?;
    Ok(())
}

pub async fn preview_backup(backup_path: String) -> Result<BackupPreview, String> {
    let backup_path = PathBuf::from(backup_path.trim());
    if backup_path.as_os_str().is_empty() {
        return Err("backup path cannot be empty".to_string());
    }

    let raw_json = fs::read_to_string(&backup_path).map_err(|error| {
        format!(
            "failed to read backup file `{}`: {error}",
            backup_path.display()
        )
    })?;
    let payload = decode_backup_payload(&raw_json, &backup_path)?;

    Ok(payload.preview())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::migrations as db_schema;
    use crate::domain::backup::{BackupIconCache, BackupSession, BackupSetting};
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::MIGRATION_1_SQL).await.unwrap();
        pool.execute(db_schema::MIGRATION_2_SQL).await.unwrap();
        pool.execute(db_schema::MIGRATION_3_SQL).await.unwrap();
        pool
    }

    #[test]
    fn restore_backup_payload_rolls_back_when_insert_fails() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            sqlx::query(
                "INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)\n                 VALUES ('Baseline App', 'baseline.exe', 'Baseline Window', 1000, 2000, 1000)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO settings (key, value) VALUES ('baseline_key', 'baseline_value')",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO icon_cache (exe_name, icon_base64, last_updated)\n                 VALUES ('baseline.exe', 'aWNvbg==', 1234)",
            )
            .execute(&pool)
            .await
            .unwrap();

            let bad_payload = BackupPayload {
                version: CURRENT_BACKUP_VERSION,
                meta: BackupMeta {
                    exported_at_ms: 1,
                    schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
                    app_version: "test".to_string(),
                },
                sessions: vec![BackupSession {
                    id: 100,
                    app_name: "New App".to_string(),
                    exe_name: "new.exe".to_string(),
                    window_title: Some("New Window".to_string()),
                    start_time: 3000,
                    end_time: Some(4000),
                    duration: Some(1000),
                }],
                settings: vec![
                    BackupSetting {
                        key: "dup_key".to_string(),
                        value: "v1".to_string(),
                    },
                    BackupSetting {
                        key: "dup_key".to_string(),
                        value: "v2".to_string(),
                    },
                ],
                icon_cache: vec![BackupIconCache {
                    exe_name: "new.exe".to_string(),
                    icon_base64: "bmV3aWNvbg==".to_string(),
                    last_updated: Some(5678),
                }],
            };

            let result = restore_backup_payload(&pool, &bad_payload).await;
            assert!(result.is_err());
            assert!(
                result.unwrap_err().contains("failed to restore settings"),
                "restore should fail in settings stage"
            );

            let session_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE exe_name = 'baseline.exe'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let setting_value: Option<String> =
                sqlx::query_scalar("SELECT value FROM settings WHERE key = 'baseline_key' LIMIT 1")
                    .fetch_optional(&pool)
                    .await
                    .unwrap();
            let icon_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM icon_cache WHERE exe_name = 'baseline.exe'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(session_count, 1, "original session should be preserved");
            assert_eq!(
                setting_value.as_deref(),
                Some("baseline_value"),
                "original setting should be preserved"
            );
            assert_eq!(icon_count, 1, "original icon cache should be preserved");
        });
    }
}
