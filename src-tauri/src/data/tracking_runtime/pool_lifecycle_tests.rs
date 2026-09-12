use super::*;
use crate::data::sqlite_pool::{prepare_pool_schema, SQLITE_DB_NAME};
use crate::engine::tracking::ports::{
    TRACKER_LAST_HEARTBEAT_KEY, TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY,
};
use sqlx::sqlite::SqlitePoolOptions;
use sqlx::SqlitePool;
use std::path::Path;
use tauri_plugin_sql::{DbInstances, DbPool};

async fn replace_fixture_pool(instances: &DbInstances, pool: SqlitePool) {
    let previous = instances
        .0
        .write()
        .await
        .insert(SQLITE_DB_NAME.into(), DbPool::Sqlite(pool));
    if let Some(DbPool::Sqlite(previous)) = previous {
        previous.close().await;
    }
}

async fn shared_from_instances(instances: Arc<DbInstances>) -> SharedTrackingDataStore {
    shared_from_pool_source(Arc::new(move || {
        let instances = instances.clone();
        Box::pin(async move {
            let instances = instances.0.read().await;
            match instances.get(SQLITE_DB_NAME) {
                Some(DbPool::Sqlite(pool)) => Ok(pool.clone()),
                _ => Err(sqlx::Error::PoolClosed),
            }
        })
    }))
    .await
    .unwrap()
}

async fn tracking_pool() -> SqlitePool {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    prepare_pool_schema(&pool, Path::new(":memory:"))
        .await
        .unwrap();
    pool
}

#[test]
fn tracking_runtime_store_and_watchdog_clone_follow_registered_pool_replacement() {
    tauri::async_runtime::block_on(async {
        let instances = Arc::new(DbInstances::default());
        let original = tracking_pool().await;
        replace_fixture_pool(&instances, original.clone()).await;
        let tracker = shared_from_instances(instances.clone()).await;
        let watchdog = tracker.clone_store();
        tracker
            .save_tracker_timestamp(TRACKER_LAST_HEARTBEAT_KEY, 1_000)
            .await
            .unwrap();

        let replacement = tracking_pool().await;
        tracker_settings::save_setting_value(&replacement, "tracking_paused", "true")
            .await
            .unwrap();
        tracker_settings::save_setting_value(&replacement, "title_recording_enabled", "false")
            .await
            .unwrap();
        tracker_settings::save_setting_value(&replacement, "timeline_merge_gap_secs", "33")
            .await
            .unwrap();
        tracker_settings::save_setting_value(&replacement, "idle_timeout_secs", "11")
            .await
            .unwrap();
        tracker_settings::save_setting_value(
            &replacement,
            "__app_override::editor.exe",
            r#"{"track":false,"captureTitle":false}"#,
        )
        .await
        .unwrap();
        replace_fixture_pool(&instances, replacement.clone()).await;
        assert!(original.is_closed());

        // These are the same long-lived stores that existed before the registry swap.
        tracker
            .save_tracker_timestamp(TRACKER_LAST_HEARTBEAT_KEY, 5_000)
            .await
            .unwrap();
        assert!(tracker.load_tracking_paused_setting().await.unwrap());
        assert!(!tracker.load_title_recording_enabled().await.unwrap());
        assert_eq!(tracker.load_timeline_merge_gap_secs(30).await.unwrap(), 33);
        assert_eq!(tracker.load_idle_timeout_secs(30).await.unwrap(), 11);
        assert!(!tracker
            .load_tracking_enabled_setting_for_app("editor.exe")
            .await
            .unwrap());
        assert!(!tracker
            .load_capture_window_title_setting_for_app("editor.exe")
            .await
            .unwrap());
        assert_eq!(
            tracker_settings::load_tracker_timestamp(&replacement, TRACKER_LAST_HEARTBEAT_KEY)
                .await
                .unwrap(),
            Some(5_000),
        );
        tracker
            .save_startup_self_heal(5_000, "resumed")
            .await
            .unwrap();
        assert_eq!(
            tracker_settings::load_setting_value(
                &replacement,
                tracker_settings::TRACKER_LAST_STARTUP_SELF_HEAL_SUMMARY_KEY
            )
            .await
            .unwrap()
            .as_deref(),
            Some("resumed"),
        );
        assert!(!tracker.is_icon_cached("editor.exe").await.unwrap());
        tracker
            .upsert_icon("editor.exe", "isolated-icon", 5_000)
            .await
            .unwrap();
        assert!(tracker.is_icon_cached("editor.exe").await.unwrap());
        assert!(tracker
            .start_session("Editor", "editor.exe", "after restore", 6_000, 6_000)
            .await
            .unwrap());
        assert_eq!(
            watchdog
                .load_active_session()
                .await
                .unwrap()
                .unwrap()
                .start_time,
            6_000
        );
        assert!(tracker
            .refresh_active_session_metadata("editor.exe", "resumed title", 7_000)
            .await
            .unwrap());
        assert!(watchdog.end_active_sessions(8_000).await.unwrap());
        assert_eq!(
            tracker.normalize_closed_session_durations().await.unwrap(),
            0
        );
        assert!(!watchdog.seal_interrupted_web_activity(8_000).await.unwrap());
        let facts: Vec<(String, i64, i64, i64)> =
            sqlx::query_as("SELECT exe_name, start_time, end_time, duration FROM sessions")
                .fetch_all(&replacement)
                .await
                .unwrap();
        assert_eq!(facts, vec![("editor.exe".into(), 6_000, 8_000, 2_000)]);
        replacement.close().await;
    });
}

#[test]
fn tracking_runtime_store_recovers_after_closed_pool_gap_and_another_registration() {
    tauri::async_runtime::block_on(async {
        let instances = Arc::new(DbInstances::default());
        let original = tracking_pool().await;
        replace_fixture_pool(&instances, original.clone()).await;
        let tracker = shared_from_instances(instances.clone()).await;
        original.close().await;
        assert!(tracker
            .save_tracker_timestamp(TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY, 9_000)
            .await
            .is_err());
        assert!(tracker
            .start_session("Editor", "editor.exe", "failed", 9_000, 9_000)
            .await
            .is_err());

        // Both successful replace and rollback recovery register a newly opened pool.
        let recovered = tracking_pool().await;
        replace_fixture_pool(&instances, recovered.clone()).await;
        assert_eq!(
            tracker
                .load_tracker_successful_sample_timestamp()
                .await
                .unwrap(),
            None
        );
        assert!(tracker.load_active_session().await.unwrap().is_none());
        tracker
            .save_tracker_timestamp(TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY, 10_000)
            .await
            .unwrap();
        assert_eq!(
            tracker
                .load_tracker_successful_sample_timestamp()
                .await
                .unwrap(),
            Some(10_000)
        );

        let next = tracking_pool().await;
        replace_fixture_pool(&instances, next.clone()).await;
        assert!(recovered.is_closed());
        assert_eq!(
            tracker
                .load_tracker_successful_sample_timestamp()
                .await
                .unwrap(),
            None
        );
        tracker
            .save_tracker_timestamp(TRACKER_LAST_HEARTBEAT_KEY, 12_000)
            .await
            .unwrap();
        assert_eq!(
            tracker_settings::load_tracker_timestamp(&next, TRACKER_LAST_HEARTBEAT_KEY)
                .await
                .unwrap(),
            Some(12_000),
        );
        next.close().await;
    });
}
