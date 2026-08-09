use super::schema;
use super::sqlite_pool::import_schema::has_import_data_schema;
use super::sqlite_pool::{
    expected_migration_metadata, has_activity_read_models_schema, has_base_tools_schema,
    has_current_baseline_schema, has_software_reminder_rules_schema, has_web_activity_schema,
    has_web_favicon_cache_schema, prepare_pool_schema,
};
use sqlx::{Executor, Row, SqlitePool};
use std::path::Path;

async fn create_supported_legacy_schema(pool: &SqlitePool) {
    pool.execute(
        "CREATE TABLE sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_name TEXT NOT NULL,
            exe_name TEXT NOT NULL,
            window_title TEXT,
            start_time INTEGER NOT NULL,
            end_time INTEGER,
            duration INTEGER
        );
        CREATE INDEX idx_sessions_date ON sessions(start_time);
        CREATE UNIQUE INDEX idx_sessions_single_active ON sessions((1)) WHERE end_time IS NULL;
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE icon_cache (
            exe_name TEXT PRIMARY KEY,
            icon_base64 TEXT NOT NULL,
            last_updated INTEGER
        );
        CREATE TABLE _sqlx_migrations (
            version BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN NOT NULL,
            checksum BLOB NOT NULL,
            execution_time BIGINT NOT NULL
        );
        INSERT INTO _sqlx_migrations
            (version, description, success, checksum, execution_time)
        VALUES (1, 'old_v1', 1, x'01', 0);",
    )
    .await
    .unwrap();
}

async fn load_classification_settings_snapshot(pool: &SqlitePool) -> Vec<(String, String)> {
    sqlx::query_as(
        "SELECT key, value
         FROM settings
         WHERE key LIKE '__app_override::%'
            OR key LIKE '__web_domain_override::%'
            OR key LIKE '__category_color_override::%'
            OR key LIKE '__category_label_override::%'
            OR key LIKE '__category_default_color_assignment::%'
            OR key LIKE '__custom_category::%'
            OR key LIKE '__deleted_category::%'
            OR key LIKE '__classification_manual_confirmation_migration::%'
         ORDER BY key ASC",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

#[test]
fn supported_legacy_upgrade_preserves_classification_settings_across_restarts() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_supported_legacy_schema(&pool).await;

        let seeded_settings = [
            (
                "__app_override::editor.exe",
                r##"{"category":"custom:Deep%20Work","displayName":"Editor","color":"#123456","track":true,"captureTitle":false,"enabled":true,"updatedAt":123}"##,
            ),
            (
                "__web_domain_override::docs.example.com",
                r#"{"category":"reading","displayName":"Docs"}"#,
            ),
            ("__category_color_override::development", "#ABCDEF"),
            ("__category_label_override::development", "Development"),
            ("__category_default_color_assignment::development", "blue"),
            ("__custom_category::custom:Deep%20Work", "Deep Work"),
            ("__deleted_category::music", "1710000000000"),
            (
                "__classification_manual_confirmation_migration::v1",
                "completed",
            ),
        ];
        for (key, value) in seeded_settings {
            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
                .bind(key)
                .bind(value)
                .execute(&pool)
                .await
                .unwrap();
        }
        let before = load_classification_settings_snapshot(&pool).await;

        prepare_pool_schema(&pool, Path::new("supported-v1.5.2-patina.db"))
            .await
            .unwrap();
        let after_upgrade = load_classification_settings_snapshot(&pool).await;

        prepare_pool_schema(&pool, Path::new("supported-v1.5.2-patina.db"))
            .await
            .unwrap();
        let after_restart = load_classification_settings_snapshot(&pool).await;

        assert_eq!(after_upgrade, before);
        assert_eq!(after_restart, before);
    });
}

#[test]
fn version_seven_upgrade_creates_empty_read_models_without_touching_facts() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        for sql in [
            schema::CURRENT_BASELINE_SCHEMA_SQL,
            schema::TOOLS_TABLES_SCHEMA_SQL,
            schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL,
            schema::WEB_ACTIVITY_SCHEMA_SQL,
            schema::WEB_FAVICON_CACHE_SCHEMA_SQL,
            schema::IMPORT_DATA_SCHEMA_SQL,
            schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL,
        ] {
            pool.execute(sql).await.unwrap();
        }
        pool.execute(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
        )
        .await
        .unwrap();
        for (version, description, checksum) in expected_migration_metadata()
            .into_iter()
            .filter(|(version, _, _)| *version <= schema::IMPORT_DATA_ISOLATION_MIGRATION_VERSION)
        {
            sqlx::query(
                "INSERT INTO _sqlx_migrations(version, description, success, checksum, execution_time)
                 VALUES (?, ?, 1, ?, 0)",
            )
            .bind(version)
            .bind(description)
            .bind(checksum)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Native', 'native.exe', 10, 20, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_batches(id, imported_at, source_name, source_kind,
               source_fingerprint, exact_session_count, hour_bucket_count)
             VALUES ('batch', 1, 'fixture', 'csv', 'fixture', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_exact_sessions(batch_id, fingerprint, app_name, exe_name,
               start_time, end_time, duration)
             VALUES ('batch', 'exact', 'Exact', 'exact.exe', 20, 30, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
               bucket_start_time, duration)
             VALUES ('batch', 'bucket', 'Bucket', 'bucket.exe', 0, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let before = sqlx::query(
            "SELECT (SELECT COUNT(*) FROM sessions) native_count,
                    (SELECT COUNT(*) FROM import_exact_sessions) exact_count,
                    (SELECT COUNT(*) FROM import_time_buckets) bucket_count",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let before_counts = (
            before.get::<i64, _>("native_count"),
            before.get::<i64, _>("exact_count"),
            before.get::<i64, _>("bucket_count"),
        );

        if let Err(error) = prepare_pool_schema(&pool, Path::new("supported-v7-patina.db")).await {
            let read_model_objects = sqlx::query(
                "SELECT type, name FROM sqlite_master
                 WHERE name LIKE '%read_model%' OR name LIKE '%activity_%'
                    OR name LIKE '%app_catalog%' OR name LIKE 'trg_read_model_%'
                 ORDER BY type, name",
            )
            .fetch_all(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| (row.get::<String, _>("type"), row.get::<String, _>("name")))
            .collect::<Vec<_>>();
            panic!(
                "{error}; baseline={:?}; tools={:?}; reminder={:?}; web={:?}; favicon={:?}; import={:?}; read_models={:?}; objects={read_model_objects:?}",
                has_current_baseline_schema(&pool).await,
                has_base_tools_schema(&pool).await,
                has_software_reminder_rules_schema(&pool).await,
                has_web_activity_schema(&pool).await,
                has_web_favicon_cache_schema(&pool).await,
                has_import_data_schema(&pool).await,
                has_activity_read_models_schema(&pool).await,
            );
        }

        let after = sqlx::query(
            "SELECT (SELECT COUNT(*) FROM sessions) native_count,
                    (SELECT COUNT(*) FROM import_exact_sessions) exact_count,
                    (SELECT COUNT(*) FROM import_time_buckets) bucket_count,
                    (SELECT COUNT(*) FROM recorded_app_catalog) catalog_count,
                    (SELECT COUNT(*) FROM activity_hourly_effective) hourly_count,
                    (SELECT COUNT(*) FROM read_model_state WHERE state = 'invalid') invalid_count",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            (
                after.get::<i64, _>("native_count"),
                after.get::<i64, _>("exact_count"),
                after.get::<i64, _>("bucket_count"),
            ),
            before_counts
        );
        assert_eq!(after.get::<i64, _>("catalog_count"), 0);
        assert_eq!(after.get::<i64, _>("hourly_count"), 0);
        assert_eq!(after.get::<i64, _>("invalid_count"), 2);
    });
}

#[test]
fn version_eight_draft_triggers_are_reinstalled_without_touching_facts() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        for sql in [
            schema::CURRENT_BASELINE_SCHEMA_SQL,
            schema::TOOLS_TABLES_SCHEMA_SQL,
            schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL,
            schema::WEB_ACTIVITY_SCHEMA_SQL,
            schema::WEB_FAVICON_CACHE_SCHEMA_SQL,
            schema::IMPORT_DATA_SCHEMA_SQL,
            schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL,
            schema::ACTIVITY_READ_MODELS_SCHEMA_SQL,
            schema::WEB_ACTIVITY_REVISION_SCHEMA_SQL,
        ] {
            pool.execute(sql).await.unwrap();
        }
        pool.execute(
            "CREATE TABLE _sqlx_migrations (
                version BIGINT PRIMARY KEY,
                description TEXT NOT NULL,
                installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                success BOOLEAN NOT NULL,
                checksum BLOB NOT NULL,
                execution_time BIGINT NOT NULL
            )",
        )
        .await
        .unwrap();
        for (version, description, checksum) in expected_migration_metadata() {
            sqlx::query(
                "INSERT INTO _sqlx_migrations(version, description, success, checksum, execution_time)
                 VALUES (?, ?, 1, ?, 0)",
            )
            .bind(version)
            .bind(description)
            .bind(checksum)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Preserved', 'preserved.exe', 10, 20, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool.execute("DROP TRIGGER trg_read_model_bucket_insert")
            .await
            .unwrap();
        pool.execute(
            "CREATE TRIGGER trg_read_model_bucket_insert
             AFTER INSERT ON import_time_buckets BEGIN SELECT 1; END",
        )
        .await
        .unwrap();
        assert!(!has_activity_read_models_schema(&pool).await.unwrap());

        prepare_pool_schema(&pool, Path::new("draft-v8-patina.db"))
            .await
            .unwrap();

        assert!(has_activity_read_models_schema(&pool).await.unwrap());
        let fact_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fact_count, 1);
        let versions: Vec<i64> =
            sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(versions, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    });
}
