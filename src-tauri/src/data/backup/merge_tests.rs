use super::merge::merge_backup_records_in_tx;
use crate::data::schema as db_schema;
use crate::domain::backup::{
    BackupIconCache, BackupRecords, BackupSession, BackupSetting, BackupTitleSample,
};
use sqlx::{Executor, SqlitePool};

async fn merge_records(pool: &SqlitePool, records: &BackupRecords) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    merge_backup_records_in_tx(&mut tx, records).await?;
    tx.commit().await.map_err(|e| e.to_string())
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
    for schema in [
        db_schema::SCHEDULED_BACKUP_SCHEMA_SQL,
        db_schema::SCHEDULED_BACKUP_TARGETS_SCHEMA_SQL,
        db_schema::SCHEDULED_EXPORT_SCHEMA_SQL,
    ] {
        pool.execute(schema).await.unwrap();
    }
    pool
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

        let payload = BackupRecords {
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
        };

        merge_records(&pool, &payload).await.unwrap();

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

        merge_records(&pool, &payload).await.unwrap();
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

        let payload = BackupRecords {
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
        };

        merge_records(&pool, &payload).await.unwrap();

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
