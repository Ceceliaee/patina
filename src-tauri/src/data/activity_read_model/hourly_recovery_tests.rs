use super::*;
use crate::data::sqlite_pool::{open_single_connection_sqlite_pool, prepare_pool_schema};
use futures_util::FutureExt;
use sqlx::{Executor, SqlitePool};
use std::panic::AssertUnwindSafe;

async fn settle(pool: &SqlitePool) {
    for _ in 0..100 {
        if !super::super::maintain_once(pool).await.unwrap() {
            return;
        }
    }
    panic!("read model maintenance did not settle");
}

async fn transactional_snapshot(pool: &SqlitePool) -> (i64, i64, i64, i64, i64, i64, i64) {
    let row = sqlx::query(
        "SELECT
           (SELECT SUM(end_time - start_time) FROM sessions) native_duration,
           (SELECT SUM(end_time - start_time) FROM import_exact_sessions) exact_duration,
           (SELECT SUM(duration) FROM import_time_buckets) bucket_duration,
           (SELECT source_revision FROM read_model_revision WHERE id = 1) revision,
           (SELECT COUNT(*) FROM activity_summary_dirty_ranges) dirty_ranges,
           (SELECT COUNT(*) FROM app_catalog_dirty_keys) dirty_keys,
           (SELECT SUM(effective_duration_ms) FROM activity_hourly_effective) projected_duration",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (
        row.get("native_duration"),
        row.get("exact_duration"),
        row.get("bucket_duration"),
        row.get("revision"),
        row.get("dirty_ranges"),
        row.get("dirty_keys"),
        row.get("projected_duration"),
    )
}

#[tokio::test]
async fn derived_signal_write_failures_roll_back_native_and_import_fact_mutations() {
    let pool = super::contract_tests::setup_pool().await;
    pool.execute(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('Editor', 'editor.exe', 0, 1000, 1000);
         INSERT INTO import_batches(id, imported_at, source_name, source_kind,
           source_fingerprint, exact_session_count, hour_bucket_count)
         VALUES ('batch', 1, 'fixture', 'csv', 'fixture', 1, 1);
         INSERT INTO import_exact_sessions(batch_id, fingerprint, app_name, exe_name,
           start_time, end_time, duration)
         VALUES ('batch', 'exact', 'Imported', 'imported.exe', 2000, 3000, 1000);
         INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
           bucket_start_time, duration)
         VALUES ('batch', 'bucket', 'Bucket', 'bucket.exe', 0, 1000);",
    )
    .await
    .unwrap();
    settle(&pool).await;
    let before = transactional_snapshot(&pool).await;
    assert_eq!(before, (1000, 1000, 1000, 3, 0, 0, 3000));
    for failure_point in [
        "BEFORE UPDATE ON read_model_revision",
        "BEFORE INSERT ON activity_summary_dirty_ranges",
        "BEFORE INSERT ON app_catalog_dirty_keys",
    ] {
        pool.execute(
            format!(
                "CREATE TRIGGER reject_derived_signal {failure_point}
             BEGIN SELECT RAISE(ABORT, 'injected signal write failure'); END;"
            )
            .as_str(),
        )
        .await
        .unwrap();
        for mutation in [
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Later', 'later.exe', 4000, 5000, 1000)",
            "UPDATE sessions SET end_time = 1500, duration = 1500",
            "DELETE FROM sessions",
            "INSERT INTO import_exact_sessions(batch_id, fingerprint, app_name, exe_name,
               start_time, end_time, duration)
             VALUES ('batch', 'another', 'Another', 'another.exe', 5000, 6000, 1000)",
            "UPDATE import_exact_sessions SET end_time = 3500, duration = 1500",
            "DELETE FROM import_exact_sessions",
            "INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
               bucket_start_time, duration)
             VALUES ('batch', 'another', 'Another', 'another.exe', 3600000, 1000)",
            "UPDATE import_time_buckets SET duration = 1500",
            "DELETE FROM import_time_buckets",
        ] {
            let error = sqlx::query(mutation).execute(&pool).await.unwrap_err();
            assert!(
                error.to_string().contains("injected signal write failure"),
                "{error}"
            );
            assert_eq!(
                transactional_snapshot(&pool).await,
                before,
                "{failure_point}: {mutation}"
            );
            let read = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
            assert_eq!(read.read_path, "projection");
            assert_eq!(
                read.records
                    .iter()
                    .map(|row| row.end_time - row.start_time)
                    .sum::<i64>(),
                3000
            );
        }
        pool.execute("DROP TRIGGER reject_derived_signal")
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn failed_algorithm_upgrade_resumes_after_file_database_reopens() {
    let root = std::env::temp_dir().join(format!("patina-hourly-reopen-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let db_path = root.join("patina.db");
    let mut opened_pools = Vec::new();
    let outcome = AssertUnwindSafe(async {
        let first = open_single_connection_sqlite_pool(&db_path, true).await.unwrap();
        opened_pools.push(first.clone());
        prepare_pool_schema(&first, &db_path).await.unwrap();
        first.execute(
            "PRAGMA journal_mode = WAL;
             INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Editor', 'editor.exe', 0, 1000, 1000),
                    ('Editor', 'editor.exe', 2000, 3000, 1000);",
        ).await.unwrap();
        settle(&first).await;
        first.execute(
            "UPDATE activity_hourly_effective SET effective_duration_ms = 1;
             UPDATE read_model_state SET algorithm_version = 1 WHERE model_name = 'activity_hourly';
             CREATE TRIGGER reject_upgrade BEFORE INSERT ON activity_hourly_effective
             BEGIN SELECT RAISE(ABORT, 'injected upgrade failure'); END;",
        ).await.unwrap();
        first.close().await;

        let second = open_single_connection_sqlite_pool(&db_path, false).await.unwrap();
        opened_pools.push(second.clone());
        prepare_pool_schema(&second, &db_path).await.unwrap();
        let untrusted = load_range(&second, 0, HOUR_MS, &[]).await.unwrap();
        assert_eq!(untrusted.read_path, "facts");
        assert_eq!(untrusted.records.iter().map(|row| row.end_time - row.start_time).sum::<i64>(), 2000);
        assert!(maintain_once(&second).await.unwrap());
        assert!(maintain_once(&second).await.unwrap_err().contains("injected upgrade failure"));
        super::super::record_maintenance_failure(&second).await.unwrap();
        second.close().await;

        let third = open_single_connection_sqlite_pool(&db_path, false).await.unwrap();
        opened_pools.push(third.clone());
        prepare_pool_schema(&third, &db_path).await.unwrap();
        let failed: String = sqlx::query_scalar(
            "SELECT state FROM read_model_state WHERE model_name = 'activity_hourly'",
        ).fetch_one(&third).await.unwrap();
        assert_eq!(failed, "failed");
        third.execute("DROP TRIGGER reject_upgrade").await.unwrap();
        assert!(maintain_once(&third).await.unwrap());
        assert!(maintain_once(&third).await.unwrap());
        let checkpoint = sqlx::query(
            "SELECT state, backfill_cursor_ms FROM read_model_state WHERE model_name = 'activity_hourly'",
        ).fetch_one(&third).await.unwrap();
        assert_eq!(checkpoint.get::<String, _>("state"), "building");
        assert_eq!(checkpoint.get::<i64, _>("backfill_cursor_ms"), HOUR_MS);
        third.close().await;

        let fourth = open_single_connection_sqlite_pool(&db_path, false).await.unwrap();
        opened_pools.push(fourth.clone());
        prepare_pool_schema(&fourth, &db_path).await.unwrap();
        settle(&fourth).await;
        let trusted = load_range(&fourth, 0, HOUR_MS, &[]).await.unwrap();
        assert_eq!(trusted.read_path, "projection");
        assert_eq!(trusted.projection_row_count, 1);
        assert_eq!(trusted.records[0].end_time - trusted.records[0].start_time, 2000);
        fourth.close().await;

        let fifth = open_single_connection_sqlite_pool(&db_path, false).await.unwrap();
        opened_pools.push(fifth.clone());
        prepare_pool_schema(&fifth, &db_path).await.unwrap();
        assert!(!maintain_once(&fifth).await.unwrap());
        let persisted = load_range(&fifth, 0, HOUR_MS, &[]).await.unwrap();
        assert_eq!(persisted.read_path, "projection");
        assert_eq!(persisted.records[0].end_time - persisted.records[0].start_time, 2000);
        fifth.execute("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<99)
            INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration)
            SELECT 'Editor','editor.exe',10000+i*1000,10500+i*1000,500 FROM n").await.unwrap();
        settle(&fifth).await;
        let stat: String = sqlx::query_scalar("SELECT stat FROM sqlite_stat1 WHERE idx='idx_sessions_end_start'")
            .fetch_one(&fifth).await.unwrap();
        assert_eq!(stat.split_whitespace().next(), Some("102"));
        let samples: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_stat4 WHERE idx='idx_sessions_end_start'")
            .fetch_one(&fifth).await.unwrap();
        assert!(samples > 0, "reopened pool must refresh range statistics after growth");
    }).catch_unwind().await;
    for pool in opened_pools {
        pool.close().await;
    }
    assert_eq!(db_path.parent(), Some(root.as_path()));
    let cleanup_path = root.canonicalize().unwrap();
    assert!(cleanup_path.starts_with(std::env::temp_dir().canonicalize().unwrap()));
    std::fs::remove_dir_all(&cleanup_path).unwrap();
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
