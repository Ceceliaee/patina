use super::schema;
use super::sqlite_pool::import_schema::has_import_data_schema;
use super::sqlite_pool::{
    expected_migration_metadata, has_activity_read_models_schema, has_base_tools_schema,
    has_current_baseline_schema, has_software_reminder_rules_schema, has_web_activity_schema,
    has_web_favicon_cache_schema, prepare_pool_schema,
};
use sqlx::{Executor, Row, SqlitePool};
use std::path::Path;

const LEGACY_ACTIVITY_TARGET_INDEX: &str =
    "CREATE UNIQUE INDEX idx_tool_activity_reminder_rules_unique_target
    ON tool_activity_reminder_rules(target_kind, CASE target_kind
        WHEN 'app' THEN CASE WHEN NULLIF(TRIM(exe_name), '') IS NOT NULL
            THEN 'exe:' || LOWER(TRIM(exe_name)) ELSE 'name:' || LOWER(TRIM(app_name)) END
        WHEN 'category' THEN TRIM(category_id)
        WHEN 'web' THEN LOWER(TRIM(TRIM(normalized_domain), '.'))
    END) WHERE disabled_at IS NULL";

async fn legacy_activity_target_database() -> SqlitePool {
    use sqlx::migrate::{Migrate, Migration, MigrationType};

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let mut connection = pool.acquire().await.unwrap();
    connection.ensure_migrations_table().await.unwrap();
    for migration in schema::tracker_migrations()
        .into_iter()
        .filter(|migration| migration.version <= schema::REMINDER_RECURRENCE_MIGRATION_VERSION)
    {
        connection
            .apply(&Migration::new(
                migration.version,
                migration.description.into(),
                MigrationType::ReversibleUp,
                migration.sql.into(),
                false,
            ))
            .await
            .unwrap();
    }
    drop(connection);
    pool.execute(LEGACY_ACTIVITY_TARGET_INDEX).await.unwrap();
    pool.execute("INSERT INTO tool_activity_reminder_rules(id,target_kind,app_name,exe_name,label_snapshot,limit_ms,message,created_at,updated_at) VALUES
        (1,'app','Editor','editor.exe','Keep',120000,'Original message',1,2),
        (2,'app','Renamed','\"EDITOR.EXE\"','Duplicate',60000,'Duplicate message',3,4);
        INSERT INTO tool_activity_reminder_states(rule_id,enabled) VALUES(1,0),(2,1);
        INSERT INTO tool_activity_reminder_extensions(rule_id,last_fired_at,extension_date_key,extension_limit_ms,last_extended_alert_at)
        VALUES(1,10,'2026-11-03',300000,10),(2,20,'2026-11-03',180000,20);
        INSERT INTO tool_reminders(label,scheduled_at,created_at,status) VALUES('Keep reminder',5000,1000,'scheduled');")
        .await.unwrap();
    pool
}

#[tokio::test]
async fn legacy_activity_reminder_index_upgrade_preserves_data_and_is_repeatable() {
    let pool = legacy_activity_target_database().await;
    let previous: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();
    let mut repaired_rows = None;
    for _ in 0..2 {
        prepare_pool_schema(&pool, Path::new("legacy-activity-targets.db"))
            .await
            .unwrap();
        assert!(
            super::schema_contracts::has_unique_activity_reminder_targets(&pool)
                .await
                .unwrap()
        );
        let rows: Vec<(i64, String, i64, String, i64, Option<i64>, i64, i64)> = sqlx::query_as(
            "SELECT r.id,r.label_snapshot,r.limit_ms,r.message,r.updated_at,r.disabled_at,s.enabled,e.extension_limit_ms
             FROM tool_activity_reminder_rules r JOIN tool_activity_reminder_states s ON s.rule_id=r.id
             JOIN tool_activity_reminder_extensions e ON e.rule_id=r.id ORDER BY r.id",
        ).fetch_all(&pool).await.unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows[0],
            (
                1,
                "Keep".into(),
                120000,
                "Original message".into(),
                2,
                None,
                0,
                300000
            )
        );
        assert_eq!(rows[1].1, "Duplicate");
        assert_eq!(rows[1].2, 60000);
        assert_eq!(rows[1].3, "Duplicate message");
        assert!(rows[1].5.is_some());
        assert_eq!((rows[1].6, rows[1].7), (1, 180000));
        if let Some(ref expected) = repaired_rows {
            assert_eq!(&rows, expected);
        }
        repaired_rows = Some(rows);
        let after: Vec<(i64, Vec<u8>)> = sqlx::query_as(
            "SELECT version, checksum FROM _sqlx_migrations WHERE version<=20 ORDER BY version",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(after, previous);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT MAX(version) FROM _sqlx_migrations")
                .fetch_one(&pool)
                .await
                .unwrap(),
            schema::FOCUS_HISTORY_VERSION
        );
        assert_eq!(
            sqlx::query_scalar::<_, String>("SELECT label FROM tool_reminders")
                .fetch_one(&pool)
                .await
                .unwrap(),
            "Keep reminder"
        );
    }
    assert!(
        sqlx::query("UPDATE tool_activity_reminder_rules SET disabled_at=NULL WHERE id=2")
            .execute(&pool)
            .await
            .is_err()
    );
    pool.close().await;
}

#[tokio::test]
async fn legacy_activity_reminder_index_repair_rolls_back_on_failure() {
    let pool = legacy_activity_target_database().await;
    pool.execute("CREATE TRIGGER reject_activity_index_upgrade BEFORE UPDATE OF disabled_at ON tool_activity_reminder_rules BEGIN SELECT RAISE(ABORT,'synthetic upgrade failure'); END;")
        .await.unwrap();
    let error = prepare_pool_schema(&pool, Path::new("legacy-activity-targets-failure.db"))
        .await
        .unwrap_err();
    assert!(error.contains("synthetic upgrade failure"), "{error}");
    assert_eq!(sqlx::query_scalar::<_,String>("SELECT sql FROM sqlite_master WHERE name='idx_tool_activity_reminder_rules_unique_target'").fetch_one(&pool).await.unwrap(), LEGACY_ACTIVITY_TARGET_INDEX);
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM tool_activity_reminder_rules WHERE disabled_at IS NULL"
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT MAX(version) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .unwrap(),
        schema::REMINDER_RECURRENCE_MIGRATION_VERSION
    );
    pool.execute("DROP TRIGGER reject_activity_index_upgrade")
        .await
        .unwrap();
    prepare_pool_schema(&pool, Path::new("legacy-activity-targets-retry.db"))
        .await
        .unwrap();
    pool.close().await;
}

#[tokio::test]
async fn timer_retirement_preserves_reminders_pomodoro_and_migration_history() {
    use sqlx::migrate::{Migrate, Migration, MigrationType};

    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    let mut connection = pool.acquire().await.unwrap();
    connection.ensure_migrations_table().await.unwrap();
    for migration in schema::tracker_migrations()
        .into_iter()
        .filter(|migration| migration.version < schema::TIMER_RETIREMENT_MIGRATION_VERSION)
    {
        connection
            .apply(&Migration::new(
                migration.version,
                migration.description.into(),
                MigrationType::ReversibleUp,
                migration.sql.into(),
                false,
            ))
            .await
            .unwrap();
    }
    drop(connection);
    pool.execute(
        "INSERT INTO tool_timers(mode, accumulated_ms, status, created_at, updated_at)
        VALUES('stopwatch', 12000, 'running', 1000, 1000);
        INSERT INTO tool_timer_laps(timer_id, lap_index, started_at, ended_at, duration_ms)
        VALUES(1, 1, 1000, 2000, 1000);
        INSERT INTO tool_timers(mode, duration_ms, accumulated_ms, status, created_at, updated_at)
        VALUES('countdown', 60000, 0, 'paused', 2000, 2000);
        INSERT INTO tool_reminders(label, scheduled_at, created_at, status)
        VALUES('Keep reminder', 5000, 1000, 'scheduled');",
    )
    .await
    .unwrap();
    pool.execute("INSERT INTO tool_pomodoro_runs(phase,status,cycle_index,focus_ms,short_break_ms,long_break_ms,long_break_every,phase_started_at,phase_remaining_ms,completed_focus_count,created_at,updated_at)
        VALUES('focus','running',1,60000,10000,20000,4,1000,60000,0,1000,1000)")
        .await
        .unwrap();
    let prior: Vec<(i64, Vec<u8>)> =
        sqlx::query_as("SELECT version, checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(!super::schema_contracts::has_retired_timer(&pool)
        .await
        .unwrap());

    for _ in 0..2 {
        prepare_pool_schema(&pool, Path::new("timer-retirement-synthetic.db"))
            .await
            .unwrap();
        assert!(super::schema_contracts::has_retired_timer(&pool)
            .await
            .unwrap());
        let after: Vec<(i64, Vec<u8>)> = sqlx::query_as(
            "SELECT version, checksum FROM _sqlx_migrations WHERE version < ? ORDER BY version",
        )
        .bind(schema::TIMER_RETIREMENT_MIGRATION_VERSION)
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(prior, after);
        let snapshot = super::repositories::tools::fetch_tools_snapshot(&pool, 2000, "2026-11-02")
            .await
            .unwrap();
        assert_eq!(snapshot.reminders[0].label, "Keep reminder");
        assert_eq!(snapshot.next_reminder_at, Some(5000));
        assert_eq!(snapshot.current_pomodoro.unwrap().focus_ms, 60000);
        let violations = sqlx::query("PRAGMA foreign_key_check")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(violations.is_empty());
    }
    pool.close().await;
}

#[tokio::test]
async fn version_14_upgrade_adds_range_statistics_without_rewriting_existing_migrations() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    for migration in schema::tracker_migrations()
        .into_iter()
        .filter(|m| m.version <= 14)
    {
        pool.execute(migration.sql).await.unwrap();
    }
    pool.execute("CREATE TABLE _sqlx_migrations(version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL)").await.unwrap();
    for (version, description, checksum) in expected_migration_metadata()
        .into_iter()
        .filter(|(v, _, _)| *v <= 14)
    {
        sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(?,?,1,?,0)")
            .bind(version).bind(description).bind(checksum).execute(&pool).await.unwrap();
    }
    pool.execute(
        "WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<1999)
        INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration)
        SELECT 'Editor','editor.exe',i*60000,i*60000+30000,30000 FROM n",
    )
    .await
    .unwrap();
    let prior: Vec<(i64, String, Vec<u8>)> = sqlx::query_as(
        "SELECT version,description,checksum FROM _sqlx_migrations ORDER BY version",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(!super::schema_contracts::has_session_range_index(&pool)
        .await
        .unwrap());
    for _ in 0..2 {
        prepare_pool_schema(&pool, Path::new("version-14-synthetic.db"))
            .await
            .unwrap();
        let after: Vec<(i64, String, Vec<u8>)> = sqlx::query_as("SELECT version,description,checksum FROM _sqlx_migrations WHERE version<=14 ORDER BY version")
            .fetch_all(&pool).await.unwrap();
        assert_eq!(after, prior);
        assert!(super::schema_contracts::has_session_range_index(&pool)
            .await
            .unwrap());
        for index in ["idx_sessions_date", "idx_sessions_end_start"] {
            let samples: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_stat4 WHERE idx=?")
                .bind(index)
                .fetch_one(&pool)
                .await
                .unwrap();
            assert!(samples > 0, "missing range distribution for {index}");
        }
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT MAX(version) FROM _sqlx_migrations")
                .fetch_one(&pool)
                .await
                .unwrap(),
            schema::FOCUS_HISTORY_VERSION
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT SUM(duration) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap(),
            60_000_000
        );
    }
    pool.execute("DROP INDEX idx_sessions_end_start; CREATE INDEX idx_sessions_end_start ON sessions(start_time,end_time)").await.unwrap();
    assert!(!super::schema_contracts::has_session_range_index(&pool)
        .await
        .unwrap());
    assert!(
        prepare_pool_schema(&pool, Path::new("wrong-range-index.db"))
            .await
            .unwrap_err()
            .contains("schema validation failed")
    );
    pool.close().await;
}

#[test]
fn version_13_upgrade_preserves_unowned_web_history_and_relation_queries_use_indexes() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migration in schema::tracker_migrations()
            .into_iter()
            .filter(|m| m.version <= 13)
        {
            pool.execute(migration.sql).await.unwrap();
        }
        pool.execute("CREATE TABLE _sqlx_migrations(version BIGINT PRIMARY KEY, description TEXT NOT NULL, installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, success BOOLEAN NOT NULL, checksum BLOB NOT NULL, execution_time BIGINT NOT NULL)").await.unwrap();
        for (version, description, checksum) in expected_migration_metadata()
            .into_iter()
            .filter(|(v, _, _)| *v <= 13)
        {
            sqlx::query("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) VALUES(?,?,1,?,0)").bind(version).bind(description).bind(checksum).execute(&pool).await.unwrap();
        }
        pool.execute("INSERT INTO sessions(id,app_name,exe_name,start_time,end_time,duration) VALUES(1,'Edge','msedge.exe',1000,10000,9000);
            INSERT INTO web_activity_segments(id,browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,source,created_at,updated_at) VALUES(1,'old','edge','msedge.exe','example.com','example.com',2000,20000,18000,'browser-extension',2000,20000)").await.unwrap();
        for _ in 0..2 {
            prepare_pool_schema(&pool, Path::new("version-13-synthetic.db"))
                .await
                .unwrap();
            let history: (i64, i64, i64) = sqlx::query_as(
                "SELECT start_time,end_time,duration FROM web_activity_segments WHERE id=1",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(history, (2000, 20000, 18000));
            let associations: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM web_activity_native_sessions")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                associations, 0,
                "upgrade must not infer a parent from overlapping intervals"
            );
        }
        let plan: Vec<(i64,i64,i64,String)> = sqlx::query_as("EXPLAIN QUERY PLAN SELECT segment_id FROM web_activity_native_sessions WHERE session_id=1").fetch_all(&pool).await.unwrap();
        assert!(
            plan.iter()
                .any(|row| row.3.contains("idx_web_activity_native_session")),
            "{plan:?}"
        );
        let active_plan: Vec<(i64,i64,i64,String)> = sqlx::query_as("EXPLAIN QUERY PLAN UPDATE web_activity_segments SET end_time=updated_at+45000 WHERE end_time IS NULL AND updated_at+45000<100000").fetch_all(&pool).await.unwrap();
        assert!(
            active_plan
                .iter()
                .any(|row| row.3.contains("idx_web_activity_segments_single_active")),
            "{active_plan:?}"
        );
        let bad_reference = sqlx::query(
            "INSERT INTO web_activity_native_sessions(segment_id,session_id) VALUES(1,999)",
        )
        .execute(&pool)
        .await;
        assert!(bad_reference.is_err());
    });
}

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
        assert_eq!(
            versions,
            schema::tracker_migrations()
                .into_iter()
                .map(|migration| migration.version)
                .collect::<Vec<_>>()
        );
    });
}

#[test]
fn version_twelve_activity_rule_upgrade_preserves_every_legacy_field() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migration in schema::tracker_migrations()
            .into_iter()
            .filter(|migration| migration.version <= 12)
        {
            pool.execute(migration.sql.as_ref()).await.unwrap();
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
            .filter(|(version, _, _)| *version <= 12)
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
            "INSERT INTO tool_software_reminder_rules (
                id, app_name, exe_name, limit_ms, message, created_at, updated_at,
                disabled_at, last_fired_date_key
             ) VALUES (42, 'Editor', 'EDITOR.EXE', 1800000, 'Break', 100, 200, 300, '2026-08-11')",
        )
        .execute(&pool)
        .await
        .unwrap();

        prepare_pool_schema(&pool, Path::new("version-12-patina.db"))
            .await
            .unwrap();

        let old_table_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'tool_software_reminder_rules'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(old_table_count, 0);
        let row = sqlx::query(
            "SELECT id, target_kind, app_name, exe_name, label_snapshot, limit_ms,
                    message, created_at, updated_at, disabled_at, last_fired_date_key
             FROM tool_activity_reminder_rules",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row.get::<i64, _>("id"), 42);
        assert_eq!(row.get::<String, _>("target_kind"), "app");
        assert_eq!(row.get::<String, _>("app_name"), "Editor");
        assert_eq!(row.get::<String, _>("exe_name"), "EDITOR.EXE");
        assert_eq!(row.get::<String, _>("label_snapshot"), "Editor");
        assert_eq!(row.get::<i64, _>("limit_ms"), 1_800_000);
        assert_eq!(row.get::<String, _>("message"), "Break");
        assert_eq!(row.get::<i64, _>("created_at"), 100);
        assert_eq!(row.get::<i64, _>("updated_at"), 200);
        assert_eq!(row.get::<i64, _>("disabled_at"), 300);
        assert_eq!(row.get::<String, _>("last_fired_date_key"), "2026-08-11");
    });
}
