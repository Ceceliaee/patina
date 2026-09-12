use super::*;
use crate::data::schema::{
    ACTIVITY_READ_MODELS_SCHEMA_SQL, CURRENT_BASELINE_SCHEMA_SQL, IMPORT_DATA_ISOLATION_SCHEMA_SQL,
    IMPORT_DATA_SCHEMA_SQL,
};
use sqlx::{Executor, SqlitePool};

pub(super) async fn setup_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    for schema in [
        CURRENT_BASELINE_SCHEMA_SQL,
        IMPORT_DATA_SCHEMA_SQL,
        IMPORT_DATA_ISOLATION_SCHEMA_SQL,
        ACTIVITY_READ_MODELS_SCHEMA_SQL,
    ] {
        pool.execute(schema).await.unwrap();
    }
    pool
}

async fn insert_native(pool: &SqlitePool, start: i64, end: Option<i64>) {
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('Editor', 'editor.exe', ?, ?, ?)",
    )
    .bind(start)
    .bind(end)
    .bind(end.map(|end| end - start))
    .execute(pool)
    .await
    .unwrap();
}

async fn drain(pool: &SqlitePool) {
    for _ in 0..1000 {
        if !maintain_once(pool).await.unwrap() {
            return;
        }
    }
    panic!("hourly maintenance did not converge");
}

#[tokio::test]
async fn native_range_candidates_preserve_boundaries_and_choose_selective_indexes() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    for migration in crate::data::schema::tracker_migrations()
        .into_iter()
        .filter(|m| m.version < 15)
    {
        pool.execute(migration.sql).await.unwrap();
    }
    pool.execute(
        "WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i<19999)
        INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration)
        SELECT 'Editor','editor.exe',i*60000,i*60000+30000,30000 FROM n;
        INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration) VALUES
        ('Editor','editor.exe',-60000,0,60000),
        ('Editor','editor.exe',-30000,-30000,0),
        ('Editor','editor.exe',1200000000,NULL,NULL)",
    )
    .await
    .unwrap();
    pool.execute(crate::data::schema::SESSION_RANGE_INDEX_SCHEMA_SQL)
        .await
        .unwrap();
    for (start, end, index) in [
        (-HOUR_MS, 0, "idx_sessions_date"),
        (0, HOUR_MS, "idx_sessions_date"),
        (1_198_800_000, 1_202_400_000, "idx_sessions_end_start"),
        (1_800_000_000, 1_803_600_000, "idx_sessions_end_start"),
    ] {
        for closed_only in [false, true] {
            let current = now_ms();
            let explain_sql = format!("EXPLAIN QUERY PLAN {FACT_CANDIDATES_SQL}");
            let mut query = sqlx::query(&explain_sql);
            for value in [
                current,
                end,
                start,
                current,
                start,
                i64::from(closed_only),
                end,
                start,
                end,
                start,
            ] {
                query = query.bind(value);
            }
            let plan: Vec<String> = query
                .fetch_all(&pool)
                .await
                .unwrap()
                .iter()
                .map(|row| row.get("detail"))
                .collect();
            assert!(
                plan.iter().any(|line| line.contains(index)),
                "{start}..{end}: {plan:?}"
            );
            let original: Vec<(i64, i64)> = sqlx::query_as(
                "SELECT start_time, MIN(COALESCE(end_time, ?), ?) FROM sessions
                 WHERE start_time < ? AND COALESCE(end_time, ?) > ?
                   AND (? = 0 OR end_time IS NOT NULL)
                 ORDER BY start_time, id, end_time",
            )
            .bind(current)
            .bind(end)
            .bind(end)
            .bind(current)
            .bind(start)
            .bind(i64::from(closed_only))
            .fetch_all(&pool)
            .await
            .unwrap();
            let mut tx = pool.begin().await.unwrap();
            let actual = load_fact_candidates(&mut tx, start, end, closed_only)
                .await
                .unwrap();
            tx.commit().await.unwrap();
            assert_eq!(
                actual
                    .iter()
                    .map(|row| (row.start_ms, row.end_ms.min(end)))
                    .collect::<Vec<_>>(),
                original
            );
            assert!(actual
                .iter()
                .all(|row| matches!(row.origin, ActivityOrigin::Native)));
        }
    }
    pool.close().await;
}

fn total(result: &ActivityAggregateRangeDto) -> i64 {
    result
        .records
        .iter()
        .map(|record| record.end_time - record.start_time)
        .sum()
}

async fn insert_fragment_fixture(pool: &SqlitePool, count: i64) {
    let spacing = HOUR_MS / count;
    let mut tx = pool.begin().await.unwrap();
    for index in 0..count {
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Editor', 'editor.exe', ?, ?, ?)",
        )
        .bind(index * spacing)
        .bind(index * spacing + spacing / 2)
        .bind(spacing / 2)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();
}

#[tokio::test]
async fn production_maintainer_compresses_fragmentation_without_changing_facts() {
    for count in [60, 600, 3600] {
        let pool = setup_pool().await;
        insert_fragment_fixture(&pool, count).await;
        let before = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
        assert_eq!(before.read_path, "facts");
        assert_eq!(total(&before), 1_800_000);
        drain(&pool).await;
        let after = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
        assert_eq!(after.read_path, "projection");
        assert_eq!(total(&after), 1_800_000);
        assert_eq!(after.projection_row_count, 1, "F{count}");
        assert_eq!(after.records.len(), 1, "F{count}");
        let facts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(facts, count);
        assert!(!maintain_once(&pool).await.unwrap());
    }
}

#[tokio::test]
async fn overlapping_native_duration_is_additive_and_never_spills_into_another_hour() {
    let pool = setup_pool().await;
    insert_native(&pool, 0, Some(HOUR_MS)).await;
    insert_native(&pool, 0, Some(HOUR_MS)).await;
    insert_native(&pool, HOUR_MS / 2, Some(HOUR_MS)).await;
    let facts = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(facts.read_path, "facts");
    assert_eq!(total(&facts), 9_000_000);
    drain(&pool).await;
    let result = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(result.read_path, "projection");
    assert_eq!(result.fact_row_count, 0);
    assert_eq!(total(&result), 9_000_000);
    assert_eq!(result.records.len(), 3);
    assert!(result.records.iter().all(|row| row.end_time <= HOUR_MS));
    let shaped =
        super::super::aggregate_records_into_boundaries(result.records, 0, HOUR_MS, &[0, HOUR_MS])
            .unwrap();
    assert_eq!(
        shaped
            .iter()
            .map(|row| row.end_time - row.start_time)
            .sum::<i64>(),
        9_000_000
    );
    let partial = load_range(&pool, 0, HOUR_MS / 2, &[]).await.unwrap();
    assert_eq!(partial.read_path, "facts");
    assert_eq!(total(&partial), HOUR_MS);
}

#[tokio::test]
async fn exact_geometry_survives_gaps_negative_epochs_and_offset_day_boundaries() {
    let pool = setup_pool().await;
    for (start, end) in [
        (-1000, 1000),
        (HOUR_MS - 1000, HOUR_MS + 1000),
        (HOUR_MS + 40 * 60_000, HOUR_MS + 50 * 60_000),
        (24 * HOUR_MS - 1000, 24 * HOUR_MS + 1000),
    ] {
        insert_native(&pool, start, Some(end)).await;
    }
    insert_native(&pool, 500, Some(500)).await;
    insert_native(&pool, 600, Some(500)).await;
    for maintained in [false, true] {
        if maintained {
            drain(&pool).await;
        }
        for (start, end, expected) in [
            (-500, 500, 1000),
            (1000, HOUR_MS - 1000, 0),
            (HOUR_MS - 500, HOUR_MS + 500, 1000),
            (HOUR_MS + 30 * 60_000, HOUR_MS + 45 * 60_000, 300_000),
            (24 * HOUR_MS - 500, 24 * HOUR_MS + 500, 1000),
        ] {
            let result = load_range(&pool, start, end, &[]).await.unwrap();
            assert_eq!(total(&result), expected, "maintained={maintained}");
            assert_eq!(
                result.read_path, "facts",
                "partial hours need exact geometry"
            );
        }
        // These local-day offsets cut the 40..50-minute interval before it
        // begins or halfway through it. The expected buckets come from that geometry.
        for (boundary, expected) in [
            (HOUR_MS * 3 / 2, [4_000, 602_000]),
            (HOUR_MS * 7 / 4, [304_000, 302_000]),
        ] {
            let boundaries = [-HOUR_MS, boundary, 26 * HOUR_MS];
            let result = load_range(&pool, boundaries[0], boundaries[2], &boundaries)
                .await
                .unwrap();
            assert_eq!(
                result.read_path,
                if maintained { "hybrid" } else { "facts" }
            );
            let shaped = super::super::aggregate_records_into_boundaries(
                result.records,
                boundaries[0],
                boundaries[2],
                &boundaries,
            )
            .unwrap();
            let mut durations = [0_i64; 2];
            for record in shaped {
                let index = if record.start_time == boundaries[0] {
                    0
                } else {
                    1
                };
                assert_eq!(record.start_time, boundaries[index]);
                durations[index] += record.end_time - record.start_time;
            }
            assert_eq!(durations, expected, "maintained={maintained}");
        }
    }
}

#[tokio::test]
async fn adjacent_native_facts_keep_app_identity_and_daily_totals_after_projection() {
    let pool = setup_pool().await;
    for (start, end) in [
        (0, HOUR_MS / 2),
        (HOUR_MS / 2, HOUR_MS),
        (HOUR_MS, HOUR_MS * 2),
    ] {
        insert_native(&pool, start, Some(end)).await;
    }
    for expected_path in ["facts", "projection"] {
        if expected_path == "projection" {
            drain(&pool).await;
        }
        let result = load_range(&pool, 0, HOUR_MS * 2, &[]).await.unwrap();
        assert_eq!(result.read_path, expected_path);
        let boundaries = [0, HOUR_MS, HOUR_MS * 2];
        let shaped = super::super::aggregate_records_into_boundaries(
            result.records,
            0,
            HOUR_MS * 2,
            &boundaries,
        )
        .unwrap();
        assert_eq!(shaped.len(), 2);
        for (index, record) in shaped.iter().enumerate() {
            assert_eq!(record.exe_name, "editor.exe");
            assert_eq!(record.start_time, boundaries[index]);
            assert_eq!(record.end_time - record.start_time, HOUR_MS);
        }
    }
}

#[tokio::test]
async fn real_new_york_dst_dates_match_facts_and_projection_per_local_day() {
    // America/New_York local midnights, verified with Intl's IANA timezone data.
    // March 10 loses an hour; November 3 repeats an hour. Neither date is 24 hours.
    for (case, boundaries, expected_durations) in [
        (
            "2024-03-09 through 2024-03-11",
            [
                1_709_960_400_000,
                1_710_046_800_000,
                1_710_129_600_000,
                1_710_216_000_000,
            ],
            [86_400_500, 82_801_500, 86_402_000],
        ),
        (
            "2024-11-02 through 2024-11-04",
            [
                1_730_520_000_000,
                1_730_606_400_000,
                1_730_696_400_000,
                1_730_782_800_000,
            ],
            [86_400_500, 90_001_500, 86_402_000],
        ),
    ] {
        let pool = setup_pool().await;
        // A continuous interval contributes 24/23/24 or 24/25/24 elapsed hours.
        // Two independent overlaps add exactly 500, 1500 and 2000 ms to those days.
        insert_native(&pool, boundaries[0], Some(boundaries[3])).await;
        insert_native(&pool, boundaries[1] - 500, Some(boundaries[1] + 500)).await;
        insert_native(&pool, boundaries[2] - 1000, Some(boundaries[2] + 2000)).await;
        let facts = load_range(&pool, boundaries[0], boundaries[3], &boundaries)
            .await
            .unwrap();
        drain(&pool).await;
        let projection = load_range(&pool, boundaries[0], boundaries[3], &boundaries)
            .await
            .unwrap();

        for (expected_path, result) in [("facts", facts), ("projection", projection)] {
            assert_eq!(result.read_path, expected_path, "{case}");
            if expected_path == "projection" {
                assert_eq!(result.fact_row_count, 0, "{case}");
            }
            let shaped = super::super::aggregate_records_into_boundaries(
                result.records,
                boundaries[0],
                boundaries[3],
                &boundaries,
            )
            .unwrap();
            let mut days = BTreeMap::<i64, i64>::new();
            for record in shaped {
                assert_eq!(record.exe_name, "editor.exe");
                *days.entry(record.start_time).or_default() += record.end_time - record.start_time;
            }
            let expected_days: Vec<(i64, i64)> = boundaries[..3]
                .iter()
                .copied()
                .zip(expected_durations)
                .collect();
            assert_eq!(
                days.into_iter().collect::<Vec<_>>(),
                expected_days,
                "{case}: {expected_path}"
            );
        }
        pool.close().await;
    }
}

#[tokio::test]
async fn projection_query_plan_bounds_both_ends_of_the_requested_hours() {
    let pool = setup_pool().await;
    let plan = sqlx::query(&format!("EXPLAIN QUERY PLAN {PROJECTION_RANGE_SQL}"))
        .bind(365 * 24 * HOUR_MS)
        .bind(366 * 24 * HOUR_MS)
        .bind(365 * 24 * HOUR_MS)
        .fetch_all(&pool)
        .await
        .unwrap()
        .iter()
        .map(|row| row.get::<String, _>("detail"))
        .collect::<Vec<_>>();
    assert!(
        plan.iter().any(|line| {
            line.contains("SEARCH activity_hourly_effective")
                && line.contains("bucket_start_ms>?")
                && line.contains("bucket_start_ms<?")
        }),
        "{plan:?}"
    );
}

#[tokio::test]
async fn active_probe_uses_the_schema_enforced_single_active_index() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::data::sqlite_pool::prepare_pool_schema(
        &pool,
        std::path::Path::new("single-active-contract-memory.db"),
    )
    .await
    .unwrap();
    insert_fragment_fixture(&pool, 600).await;
    let competing_index: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_master
         WHERE type = 'index' AND name = 'idx_sessions_exe_usage_time'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(competing_index, 1);
    let empty = sqlx::query_scalar::<_, i64>(ACTIVE_SESSION_START_SQL)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert_eq!(empty, None);
    insert_native(&pool, HOUR_MS, None).await;
    let duplicate = sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time)
         VALUES ('Other', 'other.exe', 7200000, NULL)",
    )
    .execute(&pool)
    .await
    .unwrap_err();
    assert!(
        duplicate.to_string().contains("idx_sessions_single_active"),
        "{duplicate}"
    );
    let plan = sqlx::query(&format!("EXPLAIN QUERY PLAN {ACTIVE_SESSION_START_SQL}"))
        .fetch_all(&pool)
        .await
        .unwrap()
        .iter()
        .map(|row| row.get::<String, _>("detail"))
        .collect::<Vec<_>>();
    assert!(
        plan.iter()
            .any(|line| line.contains("idx_sessions_single_active")),
        "{plan:?}"
    );
    assert!(
        !plan.iter().any(|line| line.contains("idx_sessions_date")),
        "{plan:?}"
    );
    let version: String = sqlx::query_scalar("SELECT sqlite_version()")
        .fetch_one(&pool)
        .await
        .unwrap();
    eprintln!("SQLx SQLite {version}: active probe {plan:?}");
    let active = sqlx::query_scalar::<_, i64>(ACTIVE_SESSION_START_SQL)
        .fetch_optional(&pool)
        .await
        .unwrap();
    assert_eq!(active, Some(HOUR_MS));
}

#[tokio::test]
async fn active_at_the_end_or_after_the_query_preserves_the_historical_projection() {
    for active_start in [HOUR_MS, HOUR_MS * 2] {
        let pool = setup_pool().await;
        insert_native(&pool, 0, Some(1000)).await;
        drain(&pool).await;
        insert_native(&pool, active_start, None).await;
        let historical = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
        assert!(!historical.has_active_session);
        assert_eq!(historical.read_path, "projection");
        assert_eq!(historical.fact_row_count, 0);
        assert_eq!(total(&historical), 1000);
    }
}

#[tokio::test]
async fn active_at_the_start_or_just_inside_the_end_uses_exact_facts() {
    for (active_start, expected) in [(0, HOUR_MS), (HOUR_MS - 1, 1)] {
        let pool = setup_pool().await;
        insert_native(&pool, 0, Some(1000)).await;
        drain(&pool).await;
        insert_native(&pool, active_start, None).await;
        let overlapping = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
        assert!(overlapping.has_active_session);
        assert_eq!(overlapping.read_path, "facts");
        assert_eq!(total(&overlapping), 1000 + expected);
    }
}

#[tokio::test]
async fn partial_bucket_reads_use_the_entire_hours_precedence_context() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO import_batches(id, imported_at, source_name, source_kind,
           source_fingerprint, exact_session_count, hour_bucket_count)
         VALUES ('source-a', 1, 'fixture', 'csv', 'source-a', 0, 1),
                ('source-b', 1, 'fixture', 'csv', 'source-b', 0, 1);
         INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
           bucket_start_time, duration)
         VALUES ('source-a', 'a', 'Bucket A', 'a.exe', 0, 3600000),
                ('source-b', 'b', 'Bucket B', 'b.exe', 0, 3600000);",
    )
    .execute(&pool)
    .await
    .unwrap();
    // Two independent half-hour native records overlap: both count, but occupy 30 minutes.
    insert_native(&pool, HOUR_MS / 2, Some(HOUR_MS)).await;
    insert_native(&pool, HOUR_MS / 2, Some(HOUR_MS)).await;
    let before = load_range(&pool, 0, HOUR_MS / 2, &[]).await.unwrap();
    assert_eq!(total(&before), 1_800_000);
    assert_eq!(before.records.len(), 2);
    assert!(before
        .records
        .iter()
        .all(|row| row.end_time - row.start_time == 900_000));
    let full_facts = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(full_facts.read_path, "facts");
    drain(&pool).await;
    let complete = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(complete.read_path, "projection");
    for result in [&full_facts, &complete] {
        let mut by_app = BTreeMap::<&str, i64>::new();
        for record in &result.records {
            *by_app.entry(&record.exe_name).or_default() += record.end_time - record.start_time;
        }
        assert_eq!(
            by_app,
            BTreeMap::from([
                ("a.exe", 900_000),
                ("b.exe", 900_000),
                ("editor.exe", 3_600_000),
            ])
        );
    }
    assert_eq!(total(&complete), 5_400_000);
    let partial = load_range(&pool, 0, HOUR_MS / 2, &[]).await.unwrap();
    assert_eq!(total(&partial), 1_800_000);
    assert_eq!(partial.read_path, "facts");
}

#[tokio::test]
async fn exact_source_winner_and_lower_priority_tail_match_facts_and_projection() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO import_batches(id, imported_at, source_name, source_kind,
           source_fingerprint, exact_session_count, hour_bucket_count)
         VALUES ('first', 1, 'first', 'csv', 'first', 1, 0),
                ('second', 2, 'second', 'csv', 'second', 1, 0);
         INSERT INTO import_exact_sessions(batch_id, fingerprint, app_name, exe_name,
           start_time, end_time, duration)
         VALUES ('first', 'first-exact', 'First', 'first.exe', 0, 2700000, 2700000),
                ('second', 'second-exact', 'Second', 'second.exe', 0, 3600000, 3600000);",
    )
    .execute(&pool)
    .await
    .unwrap();
    insert_native(&pool, 900_000, Some(1_800_000)).await;
    // Native owns the second quarter; the first import wins the first/third
    // quarters, and the lower-priority import remains in the final quarter.
    for expected_path in ["facts", "projection"] {
        if expected_path == "projection" {
            drain(&pool).await;
        }
        let result = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
        assert_eq!(result.read_path, expected_path);
        let mut by_app = BTreeMap::<String, i64>::new();
        for record in result.records {
            *by_app.entry(record.exe_name).or_default() += record.end_time - record.start_time;
        }
        assert_eq!(
            by_app,
            BTreeMap::from([
                ("editor.exe".into(), 900_000),
                ("first.exe".into(), 1_800_000),
                ("second.exe".into(), 900_000),
            ])
        );
    }
}

#[tokio::test]
async fn an_algorithm_upgrade_never_exposes_old_rows_and_rebuilds_idempotently() {
    let pool = setup_pool().await;
    insert_fragment_fixture(&pool, 60).await;
    drain(&pool).await;
    sqlx::query(
        "UPDATE activity_hourly_effective SET effective_duration_ms = 1;
         UPDATE read_model_state SET algorithm_version = 1, state = 'ready'
         WHERE model_name = 'activity_hourly';",
    )
    .execute(&pool)
    .await
    .unwrap();
    let old = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(old.fallback_reason, Some("model_not_ready"));
    assert_eq!(total(&old), 1_800_000);
    maintain_once(&pool).await.unwrap();
    let building = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(building.read_path, "facts");
    assert_eq!(total(&building), 1_800_000);
    drain(&pool).await;
    assert_eq!(
        load_range(&pool, 0, HOUR_MS, &[])
            .await
            .unwrap()
            .projection_row_count,
        1
    );
    let version: i64 = sqlx::query_scalar(
        "SELECT algorithm_version FROM read_model_state WHERE model_name = 'activity_hourly'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(version, 2);
    assert!(!maintain_once(&pool).await.unwrap());
    pool.execute(
        "UPDATE read_model_state SET timezone_fingerprint = 'unrecognized-hour-policy'
         WHERE model_name = 'activity_hourly'",
    )
    .await
    .unwrap();
    assert_eq!(
        load_range(&pool, 0, HOUR_MS, &[]).await.unwrap().read_path,
        "facts"
    );
    drain(&pool).await;
    assert_eq!(
        total(&load_range(&pool, 0, HOUR_MS, &[]).await.unwrap()),
        1_800_000
    );
}

#[tokio::test]
async fn failed_rebuild_rolls_back_rows_and_cursor_then_recovers_from_facts() {
    let pool = setup_pool().await;
    insert_native(&pool, 0, Some(1000)).await;
    initialize_backfill(&pool).await.unwrap();
    pool.execute(
        "CREATE TRIGGER abort_projection BEFORE INSERT ON activity_hourly_effective
         BEGIN SELECT RAISE(ABORT, 'injected projection write failure'); END;",
    )
    .await
    .unwrap();
    assert!(maintain_once(&pool).await.is_err());
    let cursor: i64 = sqlx::query_scalar(
        "SELECT backfill_cursor_ms FROM read_model_state WHERE model_name = 'activity_hourly'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cursor, 0);
    assert_eq!(
        total(&load_range(&pool, 0, HOUR_MS, &[]).await.unwrap()),
        1000
    );
    super::super::record_maintenance_failure(&pool)
        .await
        .unwrap();
    pool.execute("DROP TRIGGER abort_projection").await.unwrap();
    drain(&pool).await;
    assert_eq!(
        total(&load_range(&pool, 0, HOUR_MS, &[]).await.unwrap()),
        1000
    );
}

#[tokio::test]
async fn writes_during_backfill_survive_its_completion_and_restore_invalidation() {
    let pool = setup_pool().await;
    insert_native(&pool, 0, Some(1000)).await;
    initialize_backfill(&pool).await.unwrap();
    process_backfill_batch(&pool, 0, HOUR_MS).await.unwrap();
    insert_native(&pool, 2000, Some(3000)).await;
    finish_backfill(&pool).await.unwrap();
    let dirty = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(dirty.read_path, "facts");
    assert_eq!(total(&dirty), 2000);
    drain(&pool).await;
    super::super::invalidate_all(&pool, "database_restore")
        .await
        .unwrap();
    assert_eq!(
        load_range(&pool, 0, HOUR_MS, &[]).await.unwrap().read_path,
        "facts"
    );
    drain(&pool).await;
    assert_eq!(
        total(&load_range(&pool, 0, HOUR_MS, &[]).await.unwrap()),
        2000
    );
}

#[tokio::test]
async fn dirty_rebuild_failure_preserves_committed_projection_and_pending_facts() {
    let pool = setup_pool().await;
    insert_native(&pool, 0, Some(1000)).await;
    drain(&pool).await;
    insert_native(&pool, 2000, Some(3000)).await;
    pool.execute(
        "CREATE TRIGGER abort_projection BEFORE INSERT ON activity_hourly_effective
         BEGIN SELECT RAISE(ABORT, 'injected dirty projection failure'); END;",
    )
    .await
    .unwrap();
    assert!(maintain_once(&pool).await.is_err());
    let committed_total: i64 =
        sqlx::query_scalar("SELECT SUM(effective_duration_ms) FROM activity_hourly_effective")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(committed_total, 1000);
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(pending, 1);
    let fallback = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(fallback.read_path, "facts");
    assert_eq!(total(&fallback), 2000);
    pool.execute("DROP TRIGGER abort_projection").await.unwrap();
    drain(&pool).await;
    assert_eq!(
        total(&load_range(&pool, 0, HOUR_MS, &[]).await.unwrap()),
        2000
    );
}

#[tokio::test]
async fn missing_projection_falls_back_and_schema_repair_rebuilds_from_facts() {
    let pool = setup_pool().await;
    insert_native(&pool, 0, Some(1000)).await;
    drain(&pool).await;
    pool.execute("DROP TABLE activity_hourly_effective")
        .await
        .unwrap();
    let fallback = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(fallback.fallback_reason, Some("projection_unavailable"));
    assert_eq!(total(&fallback), 1000);
    pool.execute(ACTIVITY_READ_MODELS_SCHEMA_SQL).await.unwrap();
    drain(&pool).await;
    assert_eq!(
        load_range(&pool, 0, HOUR_MS, &[]).await.unwrap().read_path,
        "projection"
    );
}

#[tokio::test]
async fn open_sessions_and_seeded_native_intervals_match_independent_intersections() {
    let pool = setup_pool().await;
    let mut intervals = Vec::new();
    let mut seed = 0x95_u64;
    for _ in 0..100 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let start = (seed % (4 * HOUR_MS) as u64) as i64 - HOUR_MS;
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let end = start + (seed % 100_000) as i64 + 1;
        intervals.push((start, end));
        insert_native(&pool, start, Some(end)).await;
    }
    for maintained in [false, true] {
        if maintained {
            drain(&pool).await;
        }
        for (start, end) in [(-HOUR_MS, 0), (0, HOUR_MS * 3), (123, HOUR_MS + 456)] {
            let expected: i64 = intervals
                .iter()
                .map(|(fact_start, fact_end)| (end.min(*fact_end) - start.max(*fact_start)).max(0))
                .sum();
            let result = load_range(&pool, start, end, &[]).await.unwrap();
            assert_eq!(total(&result), expected, "maintained={maintained}");
            assert_eq!(
                result.read_path,
                if maintained && start % HOUR_MS == 0 && end % HOUR_MS == 0 {
                    "projection"
                } else {
                    "facts"
                }
            );
        }
    }
    // The whole fixed historical query precedes now, so the open interval clips deterministically.
    insert_native(&pool, 0, None).await;
    let active = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert!(active.has_active_session);
    assert_eq!(active.read_path, "facts");
    let expected: i64 = intervals
        .iter()
        .map(|(start, end)| (HOUR_MS.min(*end) - 0.max(*start)).max(0))
        .sum();
    assert_eq!(total(&active), expected + HOUR_MS);
}
