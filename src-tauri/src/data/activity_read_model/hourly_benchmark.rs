use super::*;
use serde_json::{json, Value};
use sqlx::SqlitePool;
use std::time::Instant;

const DAY_MS: i64 = 24 * HOUR_MS;

struct CapacityCase {
    name: &'static str,
    days: i64,
    start_ms: i64,
    coverage_end_hour: i64,
    daily_duration_ms: i64,
    projection_rows_per_day: i64,
    native_rows_per_day: i64,
    app_count: i64,
}

#[cfg(windows)]
fn process_cpu_ms() -> Option<f64> {
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessTimes};
    let (mut created, mut exit, mut kernel, mut user) = Default::default();
    unsafe {
        GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exit,
            &mut kernel,
            &mut user,
        )
    }
    .ok()?;
    let ticks = |time: windows::Win32::Foundation::FILETIME| {
        (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
    };
    Some((ticks(kernel) + ticks(user)) as f64 / 10_000.0)
}

#[cfg(not(windows))]
fn process_cpu_ms() -> Option<f64> {
    None
}

async fn seed_native_days(pool: &SqlitePool, days: i64, start_ms: i64) {
    // The deterministic workload has 4 active hours in an 8-hour window per day.
    sqlx::query(
        "WITH RECURSIVE days(day) AS (
           SELECT 0 UNION ALL SELECT day + 1 FROM days WHERE day + 1 < ?1
         ), fragments(fragment) AS (
           SELECT 0 UNION ALL SELECT fragment + 1 FROM fragments WHERE fragment + 1 < 1000
         )
         INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration)
         SELECT 'Editor ' || (fragment % 12), 'editor-' || (fragment % 12) || '.exe',
                'Deterministic capacity fixture',
                ?2 + day * 86400000 + fragment * 28800,
                ?2 + day * 86400000 + fragment * 28800 + 14400,
                14400
         FROM days CROSS JOIN fragments",
    )
    .bind(days)
    .bind(start_ms)
    .execute(pool)
    .await
    .unwrap();
}

async fn measure_capacity(
    pool: &SqlitePool,
    case: &CapacityCase,
    seed_ms: f64,
    sample_count: usize,
) -> Value {
    let CapacityCase { name, days, .. } = case;
    let started = Instant::now();
    let initial_cpu_ms = process_cpu_ms();
    let mut turns = 0;
    // Includes the actual catalog and hourly owners; excludes only the worker's idle sleeps.
    while super::super::maintain_once(pool).await.unwrap() {
        turns += 1;
        assert!(turns < 1000, "maintenance did not converge");
    }
    let maintenance_ms = started.elapsed().as_secs_f64() * 1000.0;
    let maintenance_cpu_ms = initial_cpu_ms
        .zip(process_cpu_ms())
        .map(|(start, end)| end - start);
    eprintln!("{name}: maintained in {maintenance_ms:.1} ms");
    let projection_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM activity_hourly_effective")
        .fetch_one(pool)
        .await
        .unwrap();
    let projection_total: i64 =
        sqlx::query_scalar("SELECT SUM(effective_duration_ms) FROM activity_hourly_effective")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(projection_total, days * case.daily_duration_ms);
    assert_eq!(projection_rows, days * case.projection_rows_per_day);
    let query_days = (*days).min(365);
    let start_ms = case.start_ms + (days - query_days) * DAY_MS;
    let end_ms = case.start_ms + (days - 1) * DAY_MS + case.coverage_end_hour * HOUR_MS;
    let mut boundaries = (0..=query_days)
        .map(|day| start_ms + day * 24 * HOUR_MS)
        .collect::<Vec<_>>();
    boundaries[query_days as usize] = end_ms;
    let mut samples_ms = Vec::new();
    let mut query_samples_ms = Vec::new();
    let mut shaping_samples_ms = Vec::new();
    let mut encoding_samples_ms = Vec::new();
    let mut ipc_records = 0;
    let mut ipc_json_bytes = 0;
    let mut fetched_projection_rows = 0;
    for _ in 0..sample_count {
        let started = Instant::now();
        let mut result = load_range(&pool, start_ms, end_ms, &boundaries)
            .await
            .unwrap();
        query_samples_ms.push(started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(result.read_path, "projection");
        assert_eq!(result.fact_row_count, 0);
        fetched_projection_rows = result.projection_row_count;
        let shaping_started = Instant::now();
        result.records = super::super::aggregate_records_into_boundaries(
            result.records,
            start_ms,
            end_ms,
            &boundaries,
        )
        .unwrap();
        shaping_samples_ms.push(shaping_started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(
            result
                .records
                .iter()
                .map(|record| record.end_time - record.start_time)
                .sum::<i64>(),
            query_days * case.daily_duration_ms
        );
        ipc_records = result.records.len();
        let encoding_started = Instant::now();
        ipc_json_bytes = serde_json::to_vec(&result).unwrap().len();
        encoding_samples_ms.push(encoding_started.elapsed().as_secs_f64() * 1000.0);
        samples_ms.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    let plan = sqlx::query(&format!("EXPLAIN QUERY PLAN {PROJECTION_RANGE_SQL}"))
        .bind(start_ms)
        .bind(end_ms)
        .bind(start_ms)
        .fetch_all(pool)
        .await
        .unwrap()
        .iter()
        .map(|row| row.get::<String, _>("detail"))
        .collect::<Vec<_>>();
    let active_probe_plan = sqlx::query(&format!("EXPLAIN QUERY PLAN {ACTIVE_SESSION_START_SQL}"))
        .fetch_all(pool)
        .await
        .unwrap()
        .iter()
        .map(|row| row.get::<String, _>("detail"))
        .collect::<Vec<_>>();
    assert!(
        active_probe_plan
            .iter()
            .any(|line| line.contains("idx_sessions_single_active")),
        "active probe must stay bounded with the complete schema: {active_probe_plan:?}"
    );
    let pages: i64 = sqlx::query_scalar("PRAGMA page_count")
        .fetch_one(pool)
        .await
        .unwrap();
    let page_size: i64 = sqlx::query_scalar("PRAGMA page_size")
        .fetch_one(pool)
        .await
        .unwrap();
    let mut sorted = samples_ms.clone();
    sorted.sort_by(f64::total_cmp);
    json!({
        "name": name, "nativeFactRows": days * case.native_rows_per_day, "days": days,
        "appCount": case.app_count, "fragmentDurationMs": 14400,
        "totalDurationMs": projection_total, "projectionRows": projection_rows,
        "maintenanceTurns": turns, "maintenanceWallMs": maintenance_ms,
        "maintenanceCpuMs": maintenance_cpu_ms,
        "seedWallMs": seed_ms, "databasePageBytes": pages * page_size,
        "fetchedProjectionRows": fetched_projection_rows,
        "ipcRecords": ipc_records, "ipcJsonBytes": ipc_json_bytes,
        "averageMs": samples_ms.iter().sum::<f64>() / samples_ms.len() as f64,
        "p50Ms": sorted[(sample_count * 50).div_ceil(100) - 1],
        "p95Ms": sorted[(sample_count * 95).div_ceil(100) - 1],
        "maxMs": sorted[sample_count - 1], "sampleCount": sample_count,
        "queryStartMs": start_ms, "queryEndMs": end_ms,
        "samplesMs": samples_ms, "querySamplesMs": query_samples_ms,
        "shapingSamplesMs": shaping_samples_ms, "encodingSamplesMs": encoding_samples_ms,
        "queryPlan": plan,
        "activeProbePlan": active_probe_plan,
    })
}

#[tokio::test]
#[ignore = "run with pnpm run perf:activity-maintenance"]
async fn hourly_maintenance_capacity_report() {
    let dataset = std::env::var("PATINA_ACTIVITY_MAINTENANCE_DATASET")
        .unwrap_or_else(|_| "native".to_string());
    assert_eq!(dataset, "native", "unknown capacity dataset: {dataset}");
    let mut measurements = Vec::new();
    for (name, days) in [("native-R1", 365_i64), ("native-R3", 1095_i64)] {
        let pool = super::contract_tests::setup_pool().await;
        let seed_started = Instant::now();
        seed_native_days(&pool, days, 0).await;
        let seed_ms = seed_started.elapsed().as_secs_f64() * 1000.0;
        eprintln!("{name}: seeded {days} days in {seed_ms:.1} ms");
        measurements.push(
            measure_capacity(
                &pool,
                &CapacityCase {
                    name,
                    days,
                    start_ms: 0,
                    coverage_end_hour: 8,
                    daily_duration_ms: 14_400_000,
                    projection_rows_per_day: 96,
                    native_rows_per_day: 1000,
                    app_count: 12,
                },
                seed_ms,
                30,
            )
            .await,
        );
        pool.close().await;
    }
    println!(
        "PATINA_ACTIVITY_MAINTENANCE_REPORT_JSON:{}",
        json!({
            "benchmark": "production-activity-maintenance-native-capacity",
            "build": if cfg!(debug_assertions) { "debug" } else { "release" },
            "measurements": measurements,
            "limitations": [
                "Synthetic in-memory native-only R1/R3; not a file-backed mixed-source workload.",
                "Logical page bytes are not process memory or on-disk DB/WAL sizes.",
                "Warm backend query, shaping and JSON encoding; no IPC transport, browser rendering or OS cold cache.",
            "Maintenance excludes polling sleeps; CPU time is whole test process CPU and null when unavailable."
            ]
        })
    );
}

#[tokio::test]
async fn native_capacity_fixture_preserves_the_existing_grid() {
    let pool = super::contract_tests::setup_pool().await;
    seed_native_days(&pool, 2, 0).await;
    let facts = sqlx::query(
        "SELECT COUNT(*) rows, MIN(start_time) first_start, MAX(end_time) last_end,
                SUM(duration) duration, COUNT(DISTINCT exe_name) apps FROM sessions",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(facts.get::<i64, _>("rows"), 2000);
    assert_eq!(facts.get::<i64, _>("first_start"), 0);
    assert_eq!(facts.get::<i64, _>("last_end"), 115_185_600);
    assert_eq!(facts.get::<i64, _>("duration"), 28_800_000);
    assert_eq!(facts.get::<i64, _>("apps"), 12);
    let result = measure_capacity(
        &pool,
        &CapacityCase {
            name: "native-fixture",
            days: 2,
            start_ms: 0,
            coverage_end_hour: 8,
            daily_duration_ms: 14_400_000,
            projection_rows_per_day: 96,
            native_rows_per_day: 1000,
            app_count: 12,
        },
        0.0,
        1,
    )
    .await;
    assert_eq!(result["projectionRows"], 192);
    assert_eq!(result["ipcRecords"], 24);
    assert_eq!(result["totalDurationMs"], 28_800_000);
}
