use super::sqlite_pool::prepare_pool_schema;
use sqlx::{Executor, SqlitePool};
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
