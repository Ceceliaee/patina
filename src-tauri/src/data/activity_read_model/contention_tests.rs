use super::*;
use crate::data::{repositories::sessions, sqlite_pool};
use sqlx::{Connection, Executor, SqliteConnection, SqlitePool};
use std::path::PathBuf;
use std::time::Instant;

async fn fixture() -> (PathBuf, SqlitePool) {
    let root = std::env::temp_dir().join(format!("patina-db-contention-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let path = root.join("fixture.db");
    let pool = sqlite_pool::open_single_connection_sqlite_pool(&path, true)
        .await
        .unwrap();
    sqlite_pool::prepare_pool_schema(&pool, &path)
        .await
        .unwrap();
    (root, pool)
}

async fn dispose(root: PathBuf, pool: SqlitePool) {
    pool.close().await;
    std::fs::remove_dir_all(root).unwrap();
}

#[tokio::test]
async fn file_database_wait_failure_and_late_results_preserve_one_active_fact() {
    let (root, pool) = fixture().await;
    let first = sessions::start_session(&pool, "", "a.exe", "", 1000, 1000)
        .await
        .unwrap()
        .unwrap();
    let held = pool.acquire().await.unwrap();
    let writer = {
        let pool = pool.clone();
        tokio::spawn(
            async move { sessions::start_session(&pool, "", "b.exe", "", 2000, 2000).await },
        )
    };
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(
        !writer.is_finished(),
        "connection contention must wait, not invent a completed transition"
    );
    drop(held);
    let second = writer.await.unwrap().unwrap().unwrap();
    assert_ne!(first, second);

    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("fixture.db"));
    let mut blocker = SqliteConnection::connect_with(&options).await.unwrap();
    blocker.execute("BEGIN IMMEDIATE").await.unwrap();
    let failed = sessions::start_session(&pool, "", "c.exe", "", 3000, 3000).await;
    assert!(failed.is_err());
    assert_eq!(
        sessions::load_active_session(&pool)
            .await
            .unwrap()
            .unwrap()
            .id,
        second
    );
    blocker.execute("ROLLBACK").await.unwrap();
    blocker.close().await.unwrap();

    pool.execute("PRAGMA query_only=ON").await.unwrap();
    assert!(sessions::start_session(&pool, "", "c.exe", "", 3000, 3000)
        .await
        .is_err());
    pool.execute("PRAGMA query_only=OFF").await.unwrap();
    assert_eq!(
        sessions::load_active_session(&pool)
            .await
            .unwrap()
            .unwrap()
            .id,
        second
    );

    let (committed, committed_rx) = tokio::sync::oneshot::channel();
    let (deliver, delivery) = tokio::sync::oneshot::channel();
    let delayed = {
        let pool = pool.clone();
        tokio::spawn(async move {
            let result = sessions::start_session(&pool, "", "c.exe", "", 3000, 3000)
                .await
                .unwrap();
            committed.send(()).unwrap();
            delivery.await.unwrap();
            result
        })
    };
    committed_rx.await.unwrap();
    let authoritative = sessions::load_active_session(&pool).await.unwrap().unwrap();
    assert_eq!(authoritative.exe_name, "c.exe");
    assert_eq!(
        sessions::start_session(&pool, "", "c.exe", "", 3000, 3000)
            .await
            .unwrap(),
        None
    );
    deliver.send(()).unwrap();
    assert_eq!(delayed.await.unwrap(), Some(authoritative.id));
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(count, 3);
    pool.close().await;
    assert!(sessions::start_session(&pool, "", "d.exe", "", 4000, 4000)
        .await
        .is_err());
    dispose(root, pool).await;
}

#[tokio::test]
async fn wal_reader_retains_its_snapshot_without_stopping_recording_and_releases_checkpoint() {
    let (root, pool) = fixture().await;
    pool.execute("PRAGMA journal_mode=WAL").await.unwrap();
    sessions::start_session(&pool, "", "first.exe", "", 1000, 1000)
        .await
        .unwrap();
    let options = sqlx::sqlite::SqliteConnectOptions::new().filename(root.join("fixture.db"));
    let mut reader = SqliteConnection::connect_with(&options).await.unwrap();
    reader.execute("BEGIN").await.unwrap();
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&mut reader)
        .await
        .unwrap();
    assert_eq!(before, 1);

    for index in 1..=32 {
        sessions::start_session(
            &pool,
            "",
            &format!("live-{index}.exe"),
            "",
            1000 + index * 1000,
            1000 + index * 1000,
        )
        .await
        .unwrap()
        .unwrap();
    }
    let stable: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&mut reader)
        .await
        .unwrap();
    assert_eq!(
        stable, before,
        "a reader keeps its original consistent snapshot"
    );
    let facts: (i64, i64) = sqlx::query_as("SELECT COUNT(*), SUM(end_time IS NULL) FROM sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        facts,
        (33, 1),
        "commits continue while the old reader is open"
    );
    let (_, frames, checkpointed): (i64, i64, i64) =
        sqlx::query_as("PRAGMA wal_checkpoint(PASSIVE)")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert!(frames > checkpointed, "the held reader must pin WAL frames");
    reader.execute("ROLLBACK").await.unwrap();
    reader.close().await.unwrap();
    let checkpoint: (i64, i64, i64) = sqlx::query_as("PRAGMA wal_checkpoint(TRUNCATE)")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(checkpoint, (0, 0, 0));
    assert_eq!(
        std::fs::metadata(root.join("fixture.db-wal"))
            .unwrap()
            .len(),
        0
    );
    let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(integrity, "ok");
    dispose(root, pool).await;
}

#[tokio::test]
#[ignore = "file-backed mixed-workload performance acceptance; run perf:runtime-db"]
async fn file_database_mixed_workload_capacity() {
    const DAY: i64 = 86_400_000;
    let mut reports = Vec::new();
    for (days, requested_journal) in [(10, "DELETE"), (365, "DELETE"), (10, "WAL"), (365, "WAL")] {
        let (root, pool) = fixture().await;
        pool.execute(format!("PRAGMA journal_mode={requested_journal}").as_str())
            .await
            .unwrap();
        sqlx::query("WITH RECURSIVE days(d) AS (VALUES(0) UNION ALL SELECT d+1 FROM days WHERE d+1<?), fragments(n) AS (VALUES(0) UNION ALL SELECT n+1 FROM fragments WHERE n+1<1000) INSERT INTO sessions(app_name,exe_name,window_title,start_time,end_time,duration,continuity_group_start_time) SELECT 'Fixture','app-'||(n%12)||'.exe','',d*86400000+n*28800,d*86400000+n*28800+14400,14400,d*86400000+n*28800 FROM days CROSS JOIN fragments")
            .bind(days).execute(&pool).await.unwrap();
        let mut turns = 0;
        while maintain_once(&pool).await.unwrap() {
            turns += 1;
            assert!(turns < 2000);
        }
        let journal: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(journal.to_ascii_uppercase(), requested_journal);
        let busy_ms: i64 = sqlx::query_scalar("PRAGMA busy_timeout")
            .fetch_one(&pool)
            .await
            .unwrap();
        let started = Instant::now();
        let writes = async {
            let mut samples = Vec::new();
            for i in 0..60 {
                let started = Instant::now();
                sessions::start_session(
                    &pool,
                    "",
                    &format!("live-{i}.exe"),
                    "",
                    days * DAY + i * 1000,
                    days * DAY + i * 1000,
                )
                .await
                .unwrap()
                .unwrap();
                samples.push(started.elapsed().as_secs_f64() * 1000.0);
                tokio::task::yield_now().await;
            }
            samples
        };
        let reads = async {
            for _ in 0..15 {
                for range in [1, 7] {
                    let history = sessions::read::load_history_range(
                        &pool,
                        (days - range) * DAY,
                        days * DAY,
                        days * DAY,
                        true,
                    )
                    .await
                    .unwrap();
                    assert_eq!(history.sessions.len(), range as usize * 1000);
                }
                let aggregate = hourly::load_range(&pool, 0, days * DAY, &[]).await.unwrap();
                // The requested final day includes empty hours beyond coverage;
                // concurrent writes may also dirty a tail. Verify bounded fact
                // reads and conservation rather than forcing a projection label.
                assert!(matches!(aggregate.read_path, "projection" | "hybrid"));
                assert!(aggregate.projection_row_count > 0);
                assert!(
                    aggregate.fact_row_count <= 1000,
                    "mixed query fell back to the full history"
                );
                assert_eq!(
                    aggregate
                        .records
                        .iter()
                        .map(|row| row.end_time - row.start_time)
                        .sum::<i64>(),
                    days * 1000 * 14400
                );
                maintain_once(&pool).await.unwrap();
            }
        };
        let snapshot = async {
            let _timer = sqlite_pool::diagnostics::start(sqlite_pool::diagnostics::Phase::Backup);
            sqlx::query("VACUUM INTO ?")
                .bind(root.join("snapshot.db").to_string_lossy().to_string())
                .execute(&pool)
                .await
                .unwrap();
        };
        let (mut latency, (), ()) = tokio::join!(writes, reads, snapshot);
        latency.sort_by(f64::total_cmp);
        let max = *latency.last().unwrap();
        assert!(
            max < 8000.0,
            "fixture exceeded the existing tracking seal budget: {max} ms"
        );
        let facts: (i64, i64) =
            sqlx::query_as("SELECT COUNT(*), SUM(end_time IS NULL) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(facts, (days * 1000 + 60, 1));
        let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(integrity, "ok");
        reports.push(serde_json::json!({"historical_rows":days*1000,"journal_mode":journal,"busy_timeout_ms":busy_ms,"database_bytes":std::fs::metadata(root.join("fixture.db")).unwrap().len(),"wal_bytes":std::fs::metadata(root.join("fixture.db-wal")).ok().map(|m|m.len()),"elapsed_ms":started.elapsed().as_millis(),"commit_median_ms":latency[30],"commit_p95_ms":latency[56],"commit_max_ms":max,"commits":60}));
        dispose(root, pool).await;
    }
    let directory =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../artifacts/runtime-reliability");
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join(format!("database-contention-{}.json", uuid::Uuid::new_v4()));
    std::fs::write(&path, serde_json::to_vec_pretty(&reports).unwrap()).unwrap();
    eprintln!(
        "PATINA_DATABASE_CONTENTION {}",
        serde_json::to_string(&reports).unwrap()
    );
}
