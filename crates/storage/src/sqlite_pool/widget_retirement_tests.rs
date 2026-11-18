mod mini_preferences;
use super::*;
use sqlx::{Executor, SqlitePool};

const MINI_PREFERENCES: &str =
    include_str!("../../../test-support/fixtures/mini-window-preferences.json");

#[tokio::test]
async fn historical_mini_preferences_reopen_without_changing_the_saved_record() {
    use sqlx::sqlite::SqliteConnectOptions;

    let folder = tempfile::tempdir().unwrap();
    let options = SqliteConnectOptions::new()
        .filename(folder.path().join("mini-history.db"))
        .create_if_missing(true);
    for page in [None, Some("tools"), Some("activity"), Some("future-page")] {
        let mut saved: serde_json::Value = serde_json::from_str(MINI_PREFERENCES).unwrap();
        if let Some(page) = page {
            saved["page"] = serde_json::json!(page);
        }
        saved["future-field"] = serde_json::json!([1, 2]);
        let raw = saved.to_string();
        let pool = SqlitePoolOptions::new()
            .connect_with(options.clone())
            .await
            .unwrap();
        pool.execute(
            "CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL)",
        )
        .await
        .unwrap();
        sqlx::query("INSERT OR REPLACE INTO settings VALUES('mini_window_preferences',?)")
            .bind(&raw)
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        let reopened = SqlitePoolOptions::new()
            .connect_with(options.clone())
            .await
            .unwrap();
        let preferences =
            serde_json::to_value(mini_preferences::load(&reopened).await.unwrap()).unwrap();
        assert_eq!(preferences["placement"], saved["placement"]);
        assert_eq!(preferences["held"], true);
        assert_eq!(
            preferences["page"],
            if page == Some("tools") {
                "tools"
            } else {
                "activity"
            }
        );
        let stored: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key='mini_window_preferences'")
                .fetch_one(&reopened)
                .await
                .unwrap();
        assert_eq!(stored, raw);
        reopened.close().await;
    }
}

async fn old_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    prepare_pool_schema(&pool, Path::new("retirement-fixture.db"))
        .await
        .unwrap();
    pool.execute("DELETE FROM _sqlx_migrations WHERE version=17;
        INSERT INTO settings(key,value) VALUES
        ('minimize_behavior','widget'),('widget_placement','broken'),
        ('widget_expansion_preference','pinned'),('widget_side','left'),('widget_anchor_y','0.3'),
        ('mini_window_preferences','{\"held\":true}'),('language','es'),('widget_external_setting','keep');
        INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration) VALUES('Editor','editor.exe',1000,2000,1000);").await.unwrap();
    pool
}

#[tokio::test]
async fn historical_mini_preferences_preserve_default_and_unknown_value_fallbacks() {
    let pool = old_pool().await;
    for page in [
        serde_json::Value::Null,
        serde_json::json!(7),
        serde_json::json!("today"),
    ] {
        let raw = serde_json::json!({"held": true, "placement": {"edge":"left", "anchor":0.25}, "page":page});
        sqlx::query("UPDATE settings SET value=? WHERE key='mini_window_preferences'")
            .bind(raw.to_string())
            .execute(&pool)
            .await
            .unwrap();
        let read = serde_json::to_value(mini_preferences::load(&pool).await.unwrap()).unwrap();
        assert_eq!(read["page"], "activity");
        assert_eq!(read["held"], true);
        assert_eq!(read["placement"]["edge"], "left");
        assert_eq!(read["placement"]["anchor"], 0.25);
    }
    for damaged in ["not JSON", r#"{"placement":{"edge":"unrecognized"}}"#] {
        sqlx::query("UPDATE settings SET value=? WHERE key='mini_window_preferences'")
            .bind(damaged)
            .execute(&pool)
            .await
            .unwrap();
        let read = serde_json::to_value(mini_preferences::load(&pool).await.unwrap()).unwrap();
        assert_eq!(
            read,
            serde_json::json!({"held":false, "page":"activity", "placement":{
                "monitor":null, "edge":"top", "last_edge":"top", "anchor":0.5, "floating":null
            }})
        );
    }
    pool.close().await;
}

#[tokio::test]
async fn widget_retirement_upgrade_repairs_history_without_skipping_data_cleanup() {
    for (corrupt_history, minimize) in [
        (false, "widget"),
        (true, "taskbar"),
        (true, ""),
        (false, "invalid"),
    ] {
        let pool = old_pool().await;
        sqlx::query("UPDATE settings SET value=? WHERE key='minimize_behavior'")
            .bind(minimize)
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE settings SET value=? WHERE key='mini_window_preferences'")
            .bind(MINI_PREFERENCES)
            .execute(&pool)
            .await
            .unwrap();
        if corrupt_history {
            pool.execute(
                "UPDATE _sqlx_migrations SET checksum=x'00', description='legacy' WHERE version=16",
            )
            .await
            .unwrap();
        }
        normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();
        let head: i64 = sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(head, 16, "layout inspection must not premark data cleanup");
        prepare_pool_schema(&pool, Path::new("retirement-fixture.db"))
            .await
            .unwrap();
        let settings: Vec<(String, String)> =
            sqlx::query_as("SELECT key,value FROM settings ORDER BY key")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            settings,
            vec![
                ("language".into(), "es".into()),
                ("mini_window_preferences".into(), MINI_PREFERENCES.into()),
                ("widget_external_setting".into(), "keep".into())
            ]
        );
        let mini = mini_preferences::load(&pool).await.unwrap();
        let mut expected = serde_json::from_str::<serde_json::Value>(MINI_PREFERENCES).unwrap();
        expected["page"] = serde_json::json!("activity");
        assert_eq!(serde_json::to_value(&mini).unwrap(), expected);
        let sessions: Vec<(String, String, i64, i64, i64)> =
            sqlx::query_as("SELECT app_name,exe_name,start_time,end_time,duration FROM sessions")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            sessions,
            vec![("Editor".into(), "editor.exe".into(), 1000, 2000, 1000)]
        );
        assert!(
            !normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap()
        );
        prepare_pool_schema(&pool, Path::new("retirement-fixture.db"))
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM _sqlx_migrations WHERE version=17")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
        pool.close().await;
    }
}

#[tokio::test]
async fn widget_retirement_failure_rolls_back_and_retries() {
    let pool = old_pool().await;
    pool.execute("CREATE TRIGGER reject_retirement BEFORE DELETE ON settings WHEN OLD.key='widget_side' BEGIN SELECT RAISE(ABORT,'retirement failure'); END").await.unwrap();
    let error = prepare_pool_schema(&pool, Path::new("retirement-fixture.db"))
        .await
        .unwrap_err();
    assert!(error.contains("retirement failure"), "{error}");
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM settings")
            .fetch_one(&pool)
            .await
            .unwrap(),
        8
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM _sqlx_migrations WHERE version=17")
            .fetch_one(&pool)
            .await
            .unwrap(),
        0
    );
    pool.execute("DROP TRIGGER reject_retirement")
        .await
        .unwrap();
    prepare_pool_schema(&pool, Path::new("retirement-fixture.db"))
        .await
        .unwrap();
    assert!(schema_contracts::has_retired_widget_preferences(&pool)
        .await
        .unwrap());
    pool.close().await;
}

#[tokio::test]
async fn widget_retirement_fresh_database_is_stable() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    for _ in 0..2 {
        prepare_pool_schema(&pool, Path::new("fresh-retirement.db"))
            .await
            .unwrap();
        assert!(has_current_schema(&pool).await.unwrap());
        assert!(
            !normalize_current_baseline_migration_history_for_pool(&pool)
                .await
                .unwrap()
        );
    }
    pool.close().await;
}

#[tokio::test]
async fn widget_retirement_partial_legacy_settings_do_not_create_mini_preferences() {
    let pool = old_pool().await;
    pool.execute("DELETE FROM settings WHERE key IN ('widget_placement','widget_side','mini_window_preferences'); UPDATE settings SET value='invalid' WHERE key='minimize_behavior'").await.unwrap();
    prepare_pool_schema(&pool, Path::new("partial-retirement.db"))
        .await
        .unwrap();
    let settings: Vec<(String, String)> =
        sqlx::query_as("SELECT key,value FROM settings ORDER BY key")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        settings,
        vec![
            ("language".into(), "es".into()),
            ("widget_external_setting".into(), "keep".into())
        ]
    );
    assert_eq!(
        serde_json::to_value(mini_preferences::load(&pool).await.unwrap()).unwrap(),
        serde_json::to_value(mini_preferences::Preferences::default()).unwrap()
    );
    pool.close().await;
}
