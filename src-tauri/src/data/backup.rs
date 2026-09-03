use crate::data::sqlite_pool::{acquire_sqlite_maintenance, wait_for_sqlite_pool};
#[cfg(test)]
use crate::domain::backup::BackupPayload;
use crate::domain::backup::BackupPreview;
#[cfg(test)]
use crate::domain::backup::{BackupMeta, CURRENT_BACKUP_SCHEMA_VERSION, CURRENT_BACKUP_VERSION};
#[cfg(test)]
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::sync::Mutex;

mod archive;
#[cfg(test)]
mod archive_tests;
mod import_data;
mod paths;
mod payload;
mod prepared_source;
mod restore_payload;
mod snapshot;

static BACKUP_SNAPSHOT_LOCK: Mutex<()> = Mutex::const_new(());

#[cfg(test)]
use archive::encode_backup_archive;
use archive::read_backup_payload;
use paths::resolve_backup_path;
use prepared_source::prepare_backup_source;
use restore_payload::restore_backup_payload;

pub use paths::{pick_backup_file, pick_backup_save_file};
pub use payload::RestoreStrategy;
pub(crate) use snapshot::{export_scheduled_backup_create_new, validate_scheduled_snapshot};

#[cfg(test)]
use archive::*;
#[cfg(test)]
use paths::backup_file_name_for_timestamp;
#[cfg(test)]
use std::collections::BTreeMap;
#[cfg(test)]
use std::io::{Cursor, Read};
#[cfg(test)]
use zip::write::SimpleFileOptions;
#[cfg(test)]
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub async fn export_backup(backup_path: Option<String>, app: AppHandle) -> Result<String, String> {
    let target_path = resolve_backup_path(&app, backup_path)?;
    let pool = wait_for_sqlite_pool(&app).await?;
    let _snapshot = BACKUP_SNAPSHOT_LOCK.lock().await;
    let _maintenance = acquire_sqlite_maintenance().await;
    snapshot::write_snapshot_archive(&pool, &target_path, env!("CARGO_PKG_VERSION")).await?;

    Ok(target_path.to_string_lossy().to_string())
}

pub async fn restore_backup(
    backup_path: String,
    expected_content_sha256: String,
    app: AppHandle,
    strategy: RestoreStrategy,
) -> Result<(), String> {
    let backup_path = PathBuf::from(backup_path.trim());
    if backup_path.as_os_str().is_empty() {
        return Err("backup path cannot be empty".to_string());
    }
    let _maintenance = acquire_sqlite_maintenance().await;
    let prepared = prepare_backup_source(&backup_path, Some(expected_content_sha256.trim()))?;

    if snapshot::is_snapshot_archive(&prepared.path)? {
        return snapshot::restore_snapshot_backup(&prepared.path, &app, strategy).await;
    }

    let mut payload = read_backup_payload(&prepared.path)?;
    let restore_safety = payload.restore_safety();
    if !restore_safety.supported {
        return Err(restore_safety.message);
    }
    restore_payload::seal_interrupted_payload_activity(&mut payload);

    let pool = wait_for_sqlite_pool(&app).await?;
    restore_backup_payload(&pool, &payload, strategy).await?;
    Ok(())
}

pub async fn preview_backup(backup_path: String) -> Result<BackupPreview, String> {
    let backup_path = PathBuf::from(backup_path.trim());
    if backup_path.as_os_str().is_empty() {
        return Err("backup path cannot be empty".to_string());
    }

    let prepared = prepare_backup_source(&backup_path, None)?;
    let mut preview = if snapshot::is_snapshot_archive(&prepared.path)? {
        snapshot::extract_snapshot_archive(&prepared.path, false)
            .await?
            .preview
            .clone()
    } else {
        read_backup_payload(&prepared.path)?.preview()
    };
    preview.hash = prepared.content_sha256.clone();
    Ok(preview)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema as db_schema;
    use crate::domain::backup::{BackupIconCache, BackupSession, BackupSetting, BackupTitleSample};
    use sqlx::{Executor, SqlitePool};
    use std::path::Path;

    #[test]
    fn backup_file_name_uses_timestamp_zip_format() {
        assert_eq!(
            backup_file_name_for_timestamp("20260515-213045"),
            "Patina-backup-20260515-213045.zip"
        );
    }

    #[test]
    fn backup_archive_uses_manifest_data_and_checksums_layout() {
        let payload = BackupPayload {
            version: CURRENT_BACKUP_VERSION,
            meta: BackupMeta {
                exported_at_ms: 1_714_000_000_000,
                schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
                app_version: "test".to_string(),
            },
            sessions: vec![BackupSession {
                id: 1,
                app_name: "App".to_string(),
                exe_name: "app.exe".to_string(),
                window_title: Some("Window".to_string()),
                start_time: 10,
                end_time: Some(20),
                duration: Some(10),
                continuity_group_start_time: Some(10),
            }],
            title_samples: vec![BackupTitleSample {
                id: 1,
                session_id: 1,
                title: "Window".to_string(),
                start_time: 10,
                end_time: Some(20),
            }],
            settings: vec![BackupSetting {
                key: "language".to_string(),
                value: "zh-CN".to_string(),
            }],
            icon_cache: vec![BackupIconCache {
                exe_name: "app.exe".to_string(),
                icon_base64: "aWNvbg==".to_string(),
                last_updated: Some(30),
            }],
            web_activity_segments: Vec::new(),
            web_favicon_cache: Vec::new(),
            tool_reminders: Vec::new(),
            tool_timers: Vec::new(),
            tool_timer_laps: Vec::new(),
            tool_pomodoro_runs: Vec::new(),
            tool_daily_stats: Vec::new(),
            tool_software_reminder_rules: Vec::new(),
        };

        let archive = encode_backup_archive(&payload).unwrap();
        let mut zip = ZipArchive::new(Cursor::new(archive)).unwrap();
        assert!(zip.by_name(BACKUP_MANIFEST_ENTRY_NAME).is_ok());
        let mut manifest_json = String::new();
        zip.by_name(BACKUP_MANIFEST_ENTRY_NAME)
            .unwrap()
            .read_to_string(&mut manifest_json)
            .unwrap();
        let manifest: BackupArchiveManifest =
            serde_json::from_str(&manifest_json).expect("manifest json");
        assert_eq!(manifest.format, BACKUP_FORMAT);
        assert!(zip.by_name(BACKUP_SESSIONS_ENTRY_NAME).is_ok());
        assert!(zip.by_name(BACKUP_TITLE_SAMPLES_ENTRY_NAME).is_ok());
        assert!(zip.by_name(BACKUP_SETTINGS_ENTRY_NAME).is_ok());
        assert!(zip.by_name(BACKUP_ICON_CACHE_ENTRY_NAME).is_ok());
        assert!(zip.by_name(BACKUP_WEB_ACTIVITY_SEGMENTS_ENTRY_NAME).is_ok());
        assert!(zip.by_name(BACKUP_CHECKSUMS_ENTRY_NAME).is_ok());
    }

    #[test]
    fn structured_backup_archive_round_trips_payload() {
        let payload = BackupPayload {
            version: CURRENT_BACKUP_VERSION,
            meta: BackupMeta {
                exported_at_ms: 1_714_000_000_000,
                schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
                app_version: "test".to_string(),
            },
            sessions: vec![BackupSession {
                id: 1,
                app_name: "App".to_string(),
                exe_name: "app.exe".to_string(),
                window_title: Some("Window".to_string()),
                start_time: 10,
                end_time: Some(20),
                duration: Some(10),
                continuity_group_start_time: Some(10),
            }],
            title_samples: vec![BackupTitleSample {
                id: 1,
                session_id: 1,
                title: "Window".to_string(),
                start_time: 10,
                end_time: Some(20),
            }],
            settings: vec![BackupSetting {
                key: "language".to_string(),
                value: "zh-CN".to_string(),
            }],
            icon_cache: vec![BackupIconCache {
                exe_name: "app.exe".to_string(),
                icon_base64: "aWNvbg==".to_string(),
                last_updated: Some(30),
            }],
            web_activity_segments: Vec::new(),
            web_favicon_cache: Vec::new(),
            tool_reminders: Vec::new(),
            tool_timers: Vec::new(),
            tool_timer_laps: Vec::new(),
            tool_pomodoro_runs: Vec::new(),
            tool_daily_stats: Vec::new(),
            tool_software_reminder_rules: Vec::new(),
        };

        let archive = encode_backup_archive(&payload).unwrap();
        let mut zip = ZipArchive::new(Cursor::new(archive)).unwrap();
        let decoded = decode_structured_backup_archive(&mut zip, Path::new("backup.zip")).unwrap();
        assert_eq!(decoded.version, payload.version);
        assert_eq!(decoded.meta.exported_at_ms, payload.meta.exported_at_ms);
        assert_eq!(decoded.sessions.len(), 1);
        assert_eq!(decoded.title_samples.len(), 1);
        assert_eq!(decoded.settings.len(), 1);
        assert_eq!(decoded.icon_cache.len(), 1);
    }

    #[test]
    fn structured_backup_archive_without_title_samples_still_decodes() {
        let manifest = BackupArchiveManifest {
            format: BACKUP_FORMAT.to_string(),
            backup_version: CURRENT_BACKUP_VERSION,
            exported_at_ms: 1_714_000_000_000,
            schema_version: CURRENT_BACKUP_SCHEMA_VERSION - 1,
            app_version: "test".to_string(),
            files: BackupArchiveFiles {
                sessions: BACKUP_SESSIONS_ENTRY_NAME.to_string(),
                title_samples: String::new(),
                settings: BACKUP_SETTINGS_ENTRY_NAME.to_string(),
                icon_cache: BACKUP_ICON_CACHE_ENTRY_NAME.to_string(),
                web_activity_segments: String::new(),
                tool_reminders: String::new(),
                tool_timers: String::new(),
                tool_timer_laps: String::new(),
                tool_pomodoro_runs: String::new(),
                tool_daily_stats: String::new(),
            },
            counts: BackupArchiveCounts {
                sessions: 0,
                title_samples: 0,
                settings: 0,
                icon_cache: 0,
                web_activity_segments: 0,
                tool_reminders: 0,
                tool_timers: 0,
                tool_timer_laps: 0,
                tool_pomodoro_runs: 0,
                tool_daily_stats: 0,
            },
        };
        let manifest_json = serialize_pretty(&manifest, "manifest").unwrap();
        let sessions = "[]";
        let settings = "[]";
        let icon_cache = "[]";
        let checksums = BackupArchiveChecksums {
            algorithm: "crc32".to_string(),
            files: BTreeMap::from([
                (
                    BACKUP_MANIFEST_ENTRY_NAME.to_string(),
                    checksum(&manifest_json),
                ),
                (BACKUP_SESSIONS_ENTRY_NAME.to_string(), checksum(sessions)),
                (BACKUP_SETTINGS_ENTRY_NAME.to_string(), checksum(settings)),
                (
                    BACKUP_ICON_CACHE_ENTRY_NAME.to_string(),
                    checksum(icon_cache),
                ),
            ]),
        };
        let checksums_json = serialize_pretty(&checksums, "checksums").unwrap();
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip_write_file(
            &mut archive,
            BACKUP_MANIFEST_ENTRY_NAME,
            &manifest_json,
            options,
        )
        .unwrap();
        zip_write_file(&mut archive, BACKUP_SESSIONS_ENTRY_NAME, sessions, options).unwrap();
        zip_write_file(&mut archive, BACKUP_SETTINGS_ENTRY_NAME, settings, options).unwrap();
        zip_write_file(
            &mut archive,
            BACKUP_ICON_CACHE_ENTRY_NAME,
            icon_cache,
            options,
        )
        .unwrap();
        zip_write_file(
            &mut archive,
            BACKUP_CHECKSUMS_ENTRY_NAME,
            &checksums_json,
            options,
        )
        .unwrap();

        let archive_bytes = archive.finish().unwrap().into_inner();
        let mut zip = ZipArchive::new(Cursor::new(archive_bytes)).unwrap();
        let decoded = decode_structured_backup_archive(&mut zip, Path::new("backup.zip")).unwrap();

        assert!(decoded.title_samples.is_empty());
    }

    #[test]
    fn structured_backup_archive_rejects_time_tracker_format() {
        let manifest = BackupArchiveManifest {
            format: "TimeTrackerBackup".to_string(),
            backup_version: CURRENT_BACKUP_VERSION,
            exported_at_ms: 1_714_000_000_000,
            schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
            app_version: "test".to_string(),
            files: BackupArchiveFiles {
                sessions: BACKUP_SESSIONS_ENTRY_NAME.to_string(),
                title_samples: String::new(),
                settings: BACKUP_SETTINGS_ENTRY_NAME.to_string(),
                icon_cache: BACKUP_ICON_CACHE_ENTRY_NAME.to_string(),
                web_activity_segments: String::new(),
                tool_reminders: String::new(),
                tool_timers: String::new(),
                tool_timer_laps: String::new(),
                tool_pomodoro_runs: String::new(),
                tool_daily_stats: String::new(),
            },
            counts: BackupArchiveCounts {
                sessions: 0,
                title_samples: 0,
                settings: 0,
                icon_cache: 0,
                web_activity_segments: 0,
                tool_reminders: 0,
                tool_timers: 0,
                tool_timer_laps: 0,
                tool_pomodoro_runs: 0,
                tool_daily_stats: 0,
            },
        };
        let manifest_json = serialize_pretty(&manifest, "manifest").unwrap();
        let sessions = "[]";
        let settings = "[]";
        let icon_cache = "[]";
        let checksums = BackupArchiveChecksums {
            algorithm: "crc32".to_string(),
            files: BTreeMap::from([
                (
                    BACKUP_MANIFEST_ENTRY_NAME.to_string(),
                    checksum(&manifest_json),
                ),
                (BACKUP_SESSIONS_ENTRY_NAME.to_string(), checksum(sessions)),
                (BACKUP_SETTINGS_ENTRY_NAME.to_string(), checksum(settings)),
                (
                    BACKUP_ICON_CACHE_ENTRY_NAME.to_string(),
                    checksum(icon_cache),
                ),
            ]),
        };
        let checksums_json = serialize_pretty(&checksums, "checksums").unwrap();
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip_write_file(
            &mut archive,
            BACKUP_MANIFEST_ENTRY_NAME,
            &manifest_json,
            options,
        )
        .unwrap();
        zip_write_file(&mut archive, BACKUP_SESSIONS_ENTRY_NAME, sessions, options).unwrap();
        zip_write_file(&mut archive, BACKUP_SETTINGS_ENTRY_NAME, settings, options).unwrap();
        zip_write_file(
            &mut archive,
            BACKUP_ICON_CACHE_ENTRY_NAME,
            icon_cache,
            options,
        )
        .unwrap();
        zip_write_file(
            &mut archive,
            BACKUP_CHECKSUMS_ENTRY_NAME,
            &checksums_json,
            options,
        )
        .unwrap();

        let archive_bytes = archive.finish().unwrap().into_inner();
        let mut zip = ZipArchive::new(Cursor::new(archive_bytes)).unwrap();
        let error =
            decode_structured_backup_archive(&mut zip, Path::new("backup.zip")).unwrap_err();

        assert!(error.contains("unsupported format `TimeTrackerBackup`"));
    }

    #[test]
    fn structured_backup_archive_declaring_title_samples_requires_the_file() {
        let manifest = BackupArchiveManifest {
            format: BACKUP_FORMAT.to_string(),
            backup_version: CURRENT_BACKUP_VERSION,
            exported_at_ms: 1_714_000_000_000,
            schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
            app_version: "test".to_string(),
            files: BackupArchiveFiles {
                sessions: BACKUP_SESSIONS_ENTRY_NAME.to_string(),
                title_samples: BACKUP_TITLE_SAMPLES_ENTRY_NAME.to_string(),
                settings: BACKUP_SETTINGS_ENTRY_NAME.to_string(),
                icon_cache: BACKUP_ICON_CACHE_ENTRY_NAME.to_string(),
                web_activity_segments: String::new(),
                tool_reminders: String::new(),
                tool_timers: String::new(),
                tool_timer_laps: String::new(),
                tool_pomodoro_runs: String::new(),
                tool_daily_stats: String::new(),
            },
            counts: BackupArchiveCounts {
                sessions: 0,
                title_samples: 1,
                settings: 0,
                icon_cache: 0,
                web_activity_segments: 0,
                tool_reminders: 0,
                tool_timers: 0,
                tool_timer_laps: 0,
                tool_pomodoro_runs: 0,
                tool_daily_stats: 0,
            },
        };
        let manifest_json = serialize_pretty(&manifest, "manifest").unwrap();
        let sessions = "[]";
        let settings = "[]";
        let icon_cache = "[]";
        let checksums = BackupArchiveChecksums {
            algorithm: "crc32".to_string(),
            files: BTreeMap::from([
                (
                    BACKUP_MANIFEST_ENTRY_NAME.to_string(),
                    checksum(&manifest_json),
                ),
                (BACKUP_SESSIONS_ENTRY_NAME.to_string(), checksum(sessions)),
                (BACKUP_TITLE_SAMPLES_ENTRY_NAME.to_string(), checksum("[]")),
                (BACKUP_SETTINGS_ENTRY_NAME.to_string(), checksum(settings)),
                (
                    BACKUP_ICON_CACHE_ENTRY_NAME.to_string(),
                    checksum(icon_cache),
                ),
            ]),
        };
        let checksums_json = serialize_pretty(&checksums, "checksums").unwrap();
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip_write_file(
            &mut archive,
            BACKUP_MANIFEST_ENTRY_NAME,
            &manifest_json,
            options,
        )
        .unwrap();
        zip_write_file(&mut archive, BACKUP_SESSIONS_ENTRY_NAME, sessions, options).unwrap();
        zip_write_file(&mut archive, BACKUP_SETTINGS_ENTRY_NAME, settings, options).unwrap();
        zip_write_file(
            &mut archive,
            BACKUP_ICON_CACHE_ENTRY_NAME,
            icon_cache,
            options,
        )
        .unwrap();
        zip_write_file(
            &mut archive,
            BACKUP_CHECKSUMS_ENTRY_NAME,
            &checksums_json,
            options,
        )
        .unwrap();

        let archive_bytes = archive.finish().unwrap().into_inner();
        let mut zip = ZipArchive::new(Cursor::new(archive_bytes)).unwrap();
        let error =
            decode_structured_backup_archive(&mut zip, Path::new("backup.zip")).unwrap_err();

        assert!(error.contains(BACKUP_TITLE_SAMPLES_ENTRY_NAME));
    }

    #[test]
    fn plain_json_backup_payload_is_not_supported() {
        let backup_path = std::env::temp_dir().join(format!(
            "timetracker-legacy-json-{}.json",
            std::process::id()
        ));
        fs::write(&backup_path, r#"{"version":1}"#).unwrap();

        let error = read_backup_payload(&backup_path).unwrap_err();
        let _ = fs::remove_file(&backup_path);
        assert!(error.contains("not a supported structured Patina backup"));
    }

    #[test]
    fn legacy_zip_backup_json_payload_is_not_supported() {
        let backup_path =
            std::env::temp_dir().join(format!("timetracker-legacy-zip-{}.zip", std::process::id()));
        let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        zip_write_file(&mut archive, "backup.json", r#"{"version":1}"#, options).unwrap();
        let archive_bytes = archive.finish().unwrap().into_inner();
        fs::write(&backup_path, archive_bytes).unwrap();

        let error = read_backup_payload(&backup_path).unwrap_err();
        let _ = fs::remove_file(&backup_path);
        assert!(error.contains("not a supported structured Patina backup"));
    }

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::TOOLS_TABLES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::ACTIVITY_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::IMPORT_DATA_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();
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
                    continuity_group_start_time: Some(3000),
                }],
                title_samples: vec![BackupTitleSample {
                    id: 100,
                    session_id: 100,
                    title: "New Window".to_string(),
                    start_time: 3000,
                    end_time: Some(4000),
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
                web_activity_segments: Vec::new(),
                web_favicon_cache: Vec::new(),
                tool_reminders: Vec::new(),
                tool_timers: Vec::new(),
                tool_timer_laps: Vec::new(),
                tool_pomodoro_runs: Vec::new(),
                tool_daily_stats: Vec::new(),
                tool_software_reminder_rules: Vec::new(),
            };

            let result =
                restore_backup_payload(&pool, &bad_payload, RestoreStrategy::Replace).await;
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

    #[test]
    fn replace_restore_restores_title_samples() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let payload = BackupPayload {
                version: CURRENT_BACKUP_VERSION,
                meta: BackupMeta {
                    exported_at_ms: 1,
                    schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
                    app_version: "test".to_string(),
                },
                sessions: vec![BackupSession {
                    id: 10,
                    app_name: "Editor".to_string(),
                    exe_name: "editor.exe".to_string(),
                    window_title: Some("Doc B".to_string()),
                    start_time: 1000,
                    end_time: Some(3000),
                    duration: Some(2000),
                    continuity_group_start_time: Some(1000),
                }],
                title_samples: vec![
                    BackupTitleSample {
                        id: 1,
                        session_id: 10,
                        title: "Doc A".to_string(),
                        start_time: 1000,
                        end_time: Some(2000),
                    },
                    BackupTitleSample {
                        id: 2,
                        session_id: 10,
                        title: "Doc B".to_string(),
                        start_time: 2000,
                        end_time: Some(3000),
                    },
                ],
                settings: Vec::new(),
                icon_cache: Vec::new(),
                web_activity_segments: Vec::new(),
                web_favicon_cache: Vec::new(),
                tool_reminders: Vec::new(),
                tool_timers: Vec::new(),
                tool_timer_laps: Vec::new(),
                tool_pomodoro_runs: Vec::new(),
                tool_daily_stats: Vec::new(),
                tool_software_reminder_rules: Vec::new(),
            };

            restore_backup_payload(&pool, &payload, RestoreStrategy::Replace)
                .await
                .unwrap();

            let samples: Vec<(i64, String, i64, Option<i64>)> = sqlx::query_as(
                "SELECT session_id, title, start_time, end_time
                 FROM session_title_samples
                 ORDER BY id ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(
                samples,
                vec![
                    (10, "Doc A".to_string(), 1000, Some(2000)),
                    (10, "Doc B".to_string(), 2000, Some(3000)),
                ]
            );
        });
    }

    #[test]
    fn replace_restore_skips_orphan_title_samples() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let payload = BackupPayload {
                version: CURRENT_BACKUP_VERSION,
                meta: BackupMeta {
                    exported_at_ms: 1,
                    schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
                    app_version: "test".to_string(),
                },
                sessions: vec![BackupSession {
                    id: 10,
                    app_name: "Editor".to_string(),
                    exe_name: "editor.exe".to_string(),
                    window_title: Some("Doc".to_string()),
                    start_time: 1000,
                    end_time: Some(2000),
                    duration: Some(1000),
                    continuity_group_start_time: Some(1000),
                }],
                title_samples: vec![
                    BackupTitleSample {
                        id: 1,
                        session_id: 10,
                        title: "Doc".to_string(),
                        start_time: 1000,
                        end_time: Some(2000),
                    },
                    BackupTitleSample {
                        id: 2,
                        session_id: 99,
                        title: "Orphan".to_string(),
                        start_time: 1000,
                        end_time: Some(2000),
                    },
                ],
                settings: Vec::new(),
                icon_cache: Vec::new(),
                web_activity_segments: Vec::new(),
                web_favicon_cache: Vec::new(),
                tool_reminders: Vec::new(),
                tool_timers: Vec::new(),
                tool_timer_laps: Vec::new(),
                tool_pomodoro_runs: Vec::new(),
                tool_daily_stats: Vec::new(),
                tool_software_reminder_rules: Vec::new(),
            };

            restore_backup_payload(&pool, &payload, RestoreStrategy::Replace)
                .await
                .unwrap();

            let samples: Vec<(i64, String)> = sqlx::query_as(
                "SELECT session_id, title
                 FROM session_title_samples
                 ORDER BY id ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(samples, vec![(10, "Doc".to_string())]);
        });
    }

    #[test]
    fn merge_restore_payload_preserves_existing_data_and_imports_missing_data() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            sqlx::query(
                "INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time)
                 VALUES ('Existing App', 'existing.exe', 'Existing Window', 1000, 2000, 1000, 1000)",
            )
            .execute(&pool)
            .await
            .unwrap();
            sqlx::query("INSERT INTO settings (key, value) VALUES ('language', 'zh-CN')")
                .execute(&pool)
                .await
                .unwrap();
            sqlx::query(
                "INSERT INTO icon_cache (exe_name, icon_base64, last_updated)
                 VALUES ('existing.exe', 'old', 1)",
            )
            .execute(&pool)
            .await
            .unwrap();

            let payload = BackupPayload {
                version: CURRENT_BACKUP_VERSION,
                meta: BackupMeta {
                    exported_at_ms: 1,
                    schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
                    app_version: "test".to_string(),
                },
                sessions: vec![
                    BackupSession {
                        id: 1,
                        app_name: "Existing App".to_string(),
                        exe_name: "existing.exe".to_string(),
                        window_title: Some("Existing Window".to_string()),
                        start_time: 1000,
                        end_time: Some(2000),
                        duration: Some(1000),
                        continuity_group_start_time: Some(1000),
                    },
                    BackupSession {
                        id: 2,
                        app_name: "Imported App".to_string(),
                        exe_name: "imported.exe".to_string(),
                        window_title: Some("Imported Window".to_string()),
                        start_time: 3000,
                        end_time: Some(4000),
                        duration: Some(1000),
                        continuity_group_start_time: Some(3000),
                    },
                ],
                title_samples: vec![BackupTitleSample {
                    id: 1,
                    session_id: 2,
                    title: "Imported Window".to_string(),
                    start_time: 3000,
                    end_time: Some(4000),
                }],
                settings: vec![
                    BackupSetting {
                        key: "language".to_string(),
                        value: "en-US".to_string(),
                    },
                    BackupSetting {
                        key: "theme_mode".to_string(),
                        value: "dark".to_string(),
                    },
                ],
                icon_cache: vec![
                    BackupIconCache {
                        exe_name: "existing.exe".to_string(),
                        icon_base64: "new".to_string(),
                        last_updated: Some(2),
                    },
                    BackupIconCache {
                        exe_name: "imported.exe".to_string(),
                        icon_base64: "imported".to_string(),
                        last_updated: Some(3),
                    },
                ],
                web_activity_segments: Vec::new(),
                web_favicon_cache: Vec::new(),
                tool_reminders: Vec::new(),
                tool_timers: Vec::new(),
                tool_timer_laps: Vec::new(),
                tool_pomodoro_runs: Vec::new(),
                tool_daily_stats: Vec::new(),
                tool_software_reminder_rules: Vec::new(),
            };

            restore_backup_payload(&pool, &payload, RestoreStrategy::Merge)
                .await
                .unwrap();

            let session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
            let language: String =
                sqlx::query_scalar("SELECT value FROM settings WHERE key = 'language'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let theme_mode: String =
                sqlx::query_scalar("SELECT value FROM settings WHERE key = 'theme_mode'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let existing_icon: String = sqlx::query_scalar(
                "SELECT icon_base64 FROM icon_cache WHERE exe_name = 'existing.exe'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let imported_icon: String = sqlx::query_scalar(
                "SELECT icon_base64 FROM icon_cache WHERE exe_name = 'imported.exe'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_eq!(session_count, 2);
            assert_eq!(language, "zh-CN");
            assert_eq!(theme_mode, "dark");
            assert_eq!(existing_icon, "old");
            assert_eq!(imported_icon, "imported");

            let title_sample_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM session_title_samples")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title_sample_count, 1);

            restore_backup_payload(&pool, &payload, RestoreStrategy::Merge)
                .await
                .unwrap();
            let title_sample_count_after_second_restore: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM session_title_samples")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title_sample_count_after_second_restore, 1);
        });
    }

    #[test]
    fn merge_restore_maps_title_samples_to_inserted_session_ids() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            sqlx::query(
                "INSERT INTO sessions (id, app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time)
                 VALUES (2, 'Different App', 'different.exe', 'Different Window', 10, 20, 10, 10)",
            )
            .execute(&pool)
            .await
            .unwrap();

            let payload = BackupPayload {
                version: CURRENT_BACKUP_VERSION,
                meta: BackupMeta {
                    exported_at_ms: 1,
                    schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
                    app_version: "test".to_string(),
                },
                sessions: vec![BackupSession {
                    id: 2,
                    app_name: "Imported App".to_string(),
                    exe_name: "imported.exe".to_string(),
                    window_title: Some("Imported Window".to_string()),
                    start_time: 3000,
                    end_time: Some(4000),
                    duration: Some(1000),
                    continuity_group_start_time: Some(3000),
                }],
                title_samples: vec![BackupTitleSample {
                    id: 8,
                    session_id: 2,
                    title: "Imported Window".to_string(),
                    start_time: 3000,
                    end_time: Some(4000),
                }],
                settings: Vec::new(),
                icon_cache: Vec::new(),
                web_activity_segments: Vec::new(),
                web_favicon_cache: Vec::new(),
                tool_reminders: Vec::new(),
                tool_timers: Vec::new(),
                tool_timer_laps: Vec::new(),
                tool_pomodoro_runs: Vec::new(),
                tool_daily_stats: Vec::new(),
                tool_software_reminder_rules: Vec::new(),
            };

            restore_backup_payload(&pool, &payload, RestoreStrategy::Merge)
                .await
                .unwrap();

            let restored: (i64, String) = sqlx::query_as(
                "SELECT samples.session_id, sessions.exe_name
                 FROM session_title_samples samples
                 JOIN sessions ON sessions.id = samples.session_id
                 WHERE samples.title = 'Imported Window'
                 LIMIT 1",
            )
            .fetch_one(&pool)
            .await
            .unwrap();

            assert_ne!(restored.0, 2);
            assert_eq!(restored.1, "imported.exe");
        });
    }
}
