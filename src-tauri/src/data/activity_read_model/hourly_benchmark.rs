use super::*;
use crate::data::sqlite_pool::{
    checkpoint_sqlite_pool, open_single_connection_sqlite_pool, prepare_pool_schema,
};
use futures_util::FutureExt;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Executor, SqlitePool};
use std::io::{Read, Write};
use std::panic::AssertUnwindSafe;
use std::path::{Path, PathBuf};
use std::time::Instant;

const DAY_MS: i64 = 24 * HOUR_MS;
const MIXED_START_MS: i64 = 1_672_531_200_000;

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
    if dataset == "fixture-v2" {
        let profile = std::env::var("PATINA_ACTIVITY_MAINTENANCE_FIXTURE_PROFILE")
            .expect("fixture-v2 requires PATINA_ACTIVITY_MAINTENANCE_FIXTURE_PROFILE=e0|30d|r1|r3");
        let days = match profile.as_str() {
            "e0" => 0,
            "30d" => 30,
            "r1" => 365,
            "r3" => 1095,
            _ => panic!("unknown fixture-v2 profile: {profile}"),
        };
        let destination =
            std::env::var_os("PATINA_ACTIVITY_MAINTENANCE_FIXTURE_DIR").map(PathBuf::from);
        let manifest = export_fixture_v2(&profile, days, 365, 30, destination.as_deref()).await;
        println!("PATINA_ACTIVITY_MAINTENANCE_REPORT_JSON:{manifest}");
        return;
    }
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
                "Synthetic in-memory native-only R1/R3; use fixture-v2 for isolated file-backed mixed sources.",
                "Logical page bytes and observed DB/WAL file sizes are separate; observed WAL sizes are not a continuously sampled peak.",
                "Warm backend query, shaping and JSON encoding; no IPC transport, browser rendering or OS cold cache.",
            "Maintenance excludes polling sleeps; CPU time is whole test process CPU and null when unavailable."
            ]
        })
    );
}

async fn seed_mixed_days(pool: &SqlitePool, days: i64) {
    seed_native_days(pool, days, MIXED_START_MS).await;
    sqlx::query(
        "WITH RECURSIVE days(day) AS (
           SELECT 0 UNION ALL SELECT day + 1 FROM days WHERE day + 1 < ?1
         )
         INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration)
         SELECT 'Chrome', 'chrome.exe', 'Mixed browser fixture',
                ?2 + day * 86400000 + 32400000, ?2 + day * 86400000 + 34200000, 1800000
         FROM days",
    )
    .bind(days)
    .bind(MIXED_START_MS)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO import_batches(id, imported_at, source_name, source_kind,
           source_fingerprint, exact_session_count, hour_bucket_count)
         VALUES ('mixed-a', ?1, 'Fixture source A', 'csv', 'mixed-a', ?2, ?2),
                ('mixed-b', ?1, 'Fixture source B', 'csv', 'mixed-b', ?2 * 2, ?2)",
    )
    .bind(MIXED_START_MS)
    .bind(days)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "WITH RECURSIVE days(day) AS (
           SELECT 0 UNION ALL SELECT day + 1 FROM days WHERE day + 1 < ?1
         ), exact(batch, app, start_offset, length, identity) AS (
           VALUES ('mixed-a', 'import-a.exe', 0, 3600000, 'first'),
                  ('mixed-b', 'import-b.exe', 0, 3600000, 'masked'),
                  ('mixed-b', 'import-b.exe', 28800000, 1800000, 'later')
         )
         INSERT INTO import_exact_sessions(batch_id, fingerprint, app_name, exe_name,
           window_title, start_time, end_time, duration)
         SELECT batch, 'mixed-exact-' || day || '-' || identity, app, app, 'Mixed import fixture',
                ?2 + day * 86400000 + start_offset,
                ?2 + day * 86400000 + start_offset + length, length
         FROM days CROSS JOIN exact ORDER BY day, start_offset, batch",
    )
    .bind(days)
    .bind(MIXED_START_MS)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "WITH RECURSIVE days(day) AS (
           SELECT 0 UNION ALL SELECT day + 1 FROM days WHERE day + 1 < ?1
         ), sources(batch, app) AS (
           VALUES ('mixed-a', 'bucket-a.exe'), ('mixed-b', 'bucket-b.exe')
         )
         INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
           bucket_start_time, duration)
         SELECT batch, 'mixed-bucket-' || day || '-' || batch, app, app,
                ?2 + day * 86400000 + 28800000, 2700000
         FROM days CROSS JOIN sources",
    )
    .bind(days)
    .bind(MIXED_START_MS)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "WITH RECURSIVE days(day) AS (
           SELECT 0 UNION ALL SELECT day + 1 FROM days WHERE day + 1 < ?1
         ), segments(segment) AS (
           SELECT 0 UNION ALL SELECT segment + 1 FROM segments WHERE segment + 1 < 50
         ), facts AS (
           SELECT 'domain-' || (segment % 10) || '.test' domain,
                  ?2 + day * 86400000 + 32400000 + segment * 36000 start_ms
           FROM days CROSS JOIN segments
         )
         INSERT INTO web_activity_segments(browser_client_id, browser_kind, browser_exe_name,
           domain, normalized_domain, url, title, start_time, end_time, duration,
           source, created_at, updated_at)
         SELECT 'mixed-fixture-browser', 'chrome', 'chrome.exe', domain, domain,
                'https://' || domain || '/fixture', 'Mixed web fixture',
                start_ms, start_ms + 30000, 30000, 'browser-extension', start_ms, start_ms + 30000
         FROM facts",
    )
    .bind(days)
    .bind(MIXED_START_MS)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO web_activity_native_sessions(segment_id, session_id)
         SELECT web.id, native.id FROM web_activity_segments web
         JOIN sessions native ON native.exe_name = 'chrome.exe'
           AND native.start_time = ?1 + ((web.start_time - ?1) / 86400000) * 86400000 + 32400000",
    )
    .bind(MIXED_START_MS)
    .execute(pool)
    .await
    .unwrap();
}

async fn mixed_fact_inventory(pool: &SqlitePool, days: i64, cohorts: i64) -> Value {
    let row = sqlx::query(
        "SELECT
           (SELECT COUNT(*) FROM sessions) native_rows,
           (SELECT COALESCE(SUM(end_time - start_time), 0) FROM sessions) native_ms,
           (SELECT COUNT(DISTINCT exe_name) FROM sessions) native_apps,
           (SELECT COUNT(*) FROM import_exact_sessions) exact_rows,
           (SELECT COALESCE(SUM(duration), 0) FROM import_exact_sessions) exact_requested_ms,
           (SELECT COUNT(*) FROM import_time_buckets) bucket_rows,
           (SELECT COALESCE(SUM(duration), 0) FROM import_time_buckets) bucket_requested_ms,
           (SELECT COUNT(*) FROM import_batches) import_sources,
           (SELECT COUNT(*) FROM web_activity_segments) web_rows,
           (SELECT COALESCE(SUM(duration), 0) FROM web_activity_segments) web_ms,
           (SELECT COUNT(DISTINCT normalized_domain) FROM web_activity_segments) domains,
           (SELECT COUNT(*) FROM web_activity_native_sessions) linked_web_rows,
           (SELECT COUNT(DISTINCT exe_name) FROM (
               SELECT exe_name FROM sessions UNION ALL SELECT exe_name FROM import_exact_sessions
               UNION ALL SELECT exe_name FROM import_time_buckets)) all_apps,
           (SELECT MIN(start_time) FROM sessions) first_start,
           (SELECT MAX(end_time) FROM sessions) last_end",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    for (field, expected) in [
        ("native_rows", days * 1001),
        ("native_ms", days * 16_200_000),
        ("native_apps", cohorts * 12 + i64::from(days > 0)),
        ("exact_rows", days * 3),
        ("exact_requested_ms", days * 9_000_000),
        ("bucket_rows", days * 2),
        ("bucket_requested_ms", days * 5_400_000),
        ("import_sources", cohorts * 2),
        ("web_rows", days * 50),
        ("web_ms", days * 1_500_000),
        ("domains", cohorts * 10),
        ("linked_web_rows", days * 50),
        ("all_apps", cohorts * 16 + i64::from(days > 0)),
    ] {
        assert_eq!(row.get::<i64, _>(field), expected, "mixed fixture {field}");
    }
    assert_eq!(
        row.get::<Option<i64>, _>("first_start"),
        (days > 0).then_some(MIXED_START_MS)
    );
    assert_eq!(
        row.get::<Option<i64>, _>("last_end"),
        (days > 0).then_some(MIXED_START_MS + (days - 1) * DAY_MS + 34_200_000)
    );
    let inventory = json!({
        "nativeRows": row.get::<i64, _>("native_rows"),
        "nativeDurationMs": row.get::<i64, _>("native_ms"),
        "nativeAppCount": row.get::<i64, _>("native_apps"),
        "exactRows": row.get::<i64, _>("exact_rows"),
        "exactRequestedDurationMs": row.get::<i64, _>("exact_requested_ms"),
        "bucketRows": row.get::<i64, _>("bucket_rows"),
        "bucketRequestedDurationMs": row.get::<i64, _>("bucket_requested_ms"),
        "importSourceCount": row.get::<i64, _>("import_sources"),
        "webRows": row.get::<i64, _>("web_rows"),
        "webDurationMs": row.get::<i64, _>("web_ms"),
        "domainCount": row.get::<i64, _>("domains"),
        "linkedWebRows": row.get::<i64, _>("linked_web_rows"),
        "appCount": row.get::<i64, _>("all_apps"),
        "firstFactStartMs": row.get::<Option<i64>, _>("first_start"),
        "lastFactEndMs": row.get::<Option<i64>, _>("last_end"),
        "expectedEffectiveAppDurationMs": days * 21_600_000,
    });
    let checksum = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&inventory).unwrap())
    );
    json!({"countsAndDuration": inventory, "countsAndDurationSha256": checksum})
}

fn sqlite_file_sizes(db_path: &Path) -> Value {
    let size = |path: PathBuf| match std::fs::metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => panic!("cannot inspect benchmark database file size: {error}"),
    };
    json!({
        "databaseBytes": size(db_path.to_path_buf()),
        "walBytes": size(PathBuf::from(format!("{}-wal", db_path.display()))),
        "shmBytes": size(PathBuf::from(format!("{}-shm", db_path.display()))),
    })
}

async fn seed_fixture_v2(pool: &SqlitePool, days: i64, cohort_days: i64) {
    use crate::data::repositories::classification_settings::{
        commit_classification_setting_mutations, ClassificationSettingMutation,
    };
    if days == 0 {
        return;
    }
    // Keep the v1 timeline and precedence recipe; v2 changes only descriptive diversity.
    seed_mixed_days(pool, days).await;
    let mut tx = pool.begin().await.unwrap();
    let cohorts = (days + cohort_days - 1) / cohort_days;
    for cohort in 0..cohorts {
        let cohort_length = (days + cohorts - 1 - cohort) / cohorts;
        let start = MIXED_START_MS + cohort * DAY_MS;
        let end = MIXED_START_MS + days * DAY_MS;
        for source in ["a", "b"] {
            sqlx::query(
                "INSERT INTO import_batches(id, imported_at, source_name, source_kind,
                   source_fingerprint, exact_session_count, hour_bucket_count)
                 VALUES (?1, ?2, ?1, 'csv', ?1, ?3, ?4)",
            )
            .bind(format!("mixed-{source}-c{cohort}"))
            .bind(start)
            .bind(cohort_length * if source == "a" { 1 } else { 2 })
            .bind(cohort_length)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        for (table, timestamp) in [
            ("sessions", "start_time"),
            ("import_exact_sessions", "start_time"),
            ("import_time_buckets", "bucket_start_time"),
        ] {
            let batch = if table == "sessions" {
                ""
            } else {
                ", batch_id = batch_id || '-c' || ?3"
            };
            sqlx::query(&format!(
                "UPDATE {table} SET exe_name = replace(exe_name, '.exe', '-c' || ?3 || '.exe'),
                 app_name = app_name || ' cohort ' || ?3 {batch}
                 WHERE {timestamp} >= ?1 AND {timestamp} < ?2 AND exe_name <> 'chrome.exe'
                   AND (({timestamp} - ?4) / 86400000) % ?5 = ?3"
            ))
            .bind(start)
            .bind(end)
            .bind(cohort)
            .bind(MIXED_START_MS)
            .bind(cohorts)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
        sqlx::query(
            "UPDATE web_activity_segments
             SET domain = replace(domain, '.test', '-c' || ?3 || '.test'),
                 normalized_domain = replace(normalized_domain, '.test', '-c' || ?3 || '.test'),
                 url = replace(url, '.test', '-c' || ?3 || '.test')
             WHERE start_time >= ?1 AND start_time < ?2
               AND ((start_time - ?4) / 86400000) % ?5 = ?3",
        )
        .bind(start)
        .bind(end)
        .bind(cohort)
        .bind(MIXED_START_MS)
        .bind(cohorts)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    sqlx::query("DELETE FROM import_batches WHERE id IN ('mixed-a', 'mixed-b')")
        .execute(&mut *tx)
        .await
        .unwrap();
    let title = "Fixture v2 long title — ".repeat(24);
    for (table, column, offset) in [
        ("sessions", "window_title", 0),
        ("import_exact_sessions", "window_title", 0),
        ("web_activity_segments", "title", 32_400_000),
    ] {
        sqlx::query(&format!(
            "UPDATE {table} SET {column} = ?1 WHERE (start_time - ?2) % 86400000 = ?3"
        ))
        .bind(&title)
        .bind(MIXED_START_MS)
        .bind(offset)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();
    let mut mutations = Vec::new();
    for (id, label, color) in [
        ("work", "Fixture Work", "#3B82F6"),
        ("import", "Fixture Import", "#10B981"),
        ("web", "Fixture Web", "#F59E0B"),
    ] {
        for (prefix, value) in [
            ("__custom_category::", "1"),
            ("__category_label_override::", label),
            ("__category_color_override::", color),
        ] {
            mutations.push(ClassificationSettingMutation {
                key: format!("{prefix}custom:fixture-{id}"),
                value: Some(value.to_string()),
            });
        }
    }
    let apps: Vec<String> = sqlx::query_scalar(
        "SELECT exe_name FROM sessions UNION SELECT exe_name FROM import_exact_sessions
         UNION SELECT exe_name FROM import_time_buckets",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    let domains: Vec<String> =
        sqlx::query_scalar("SELECT DISTINCT normalized_domain FROM web_activity_segments")
            .fetch_all(pool)
            .await
            .unwrap();
    for (prefix, identifier, category) in apps
        .into_iter()
        .map(|app| {
            let category = if app == "chrome.exe" {
                "web"
            } else if app.starts_with("editor-") {
                "work"
            } else {
                "import"
            };
            ("__app_override::", app, category)
        })
        .chain(
            domains
                .into_iter()
                .map(|domain| ("__web_domain_override::", domain, "web")),
        )
    {
        mutations.push(ClassificationSettingMutation {
            key: format!("{prefix}{identifier}"),
            value: Some(
                json!({"category": format!("custom:fixture-{category}"), "enabled": true})
                    .to_string(),
            ),
        });
    }
    commit_classification_setting_mutations(pool, &mutations)
        .await
        .unwrap();
}

async fn fixture_v2_oracle(pool: &SqlitePool, days: i64, cohort_days: i64) -> Value {
    use crate::data::repositories::classification_settings::load_classification_snapshot;
    let rows = sqlx::query(
        "SELECT (bucket_start_ms - ?1) / 86400000 day, origin,
                SUM(effective_duration_ms) duration FROM activity_hourly_effective GROUP BY day, origin",
    ).bind(MIXED_START_MS).fetch_all(pool).await.unwrap();
    let observed = rows
        .iter()
        .map(|row| {
            (
                (row.get::<i64, _>("day"), row.get::<String, _>("origin")),
                row.get::<i64, _>("duration"),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let expected = (0..days)
        .flat_map(|day| {
            [
                ((day, "native".to_string()), 16_200_000),
                ((day, "import_exact".to_string()), 3_600_000),
                ((day, "import_bucket".to_string()), 1_800_000),
            ]
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(
        observed, expected,
        "every day and origin must match the independent duration oracle"
    );
    let snapshot = load_classification_snapshot(pool).await.unwrap();
    let mut sources = Vec::new();
    let mut categories = BTreeMap::new();
    let cohorts = (days + cohort_days - 1) / cohort_days;
    for cohort in 0..cohorts {
        let length = (days + cohorts - 1 - cohort) / cohorts;
        for source in ["a", "b"] {
            let id = format!("mixed-{source}-c{cohort}");
            let row = sqlx::query(
                "SELECT (SELECT COUNT(*) FROM import_exact_sessions WHERE batch_id = ?1) exact_rows,
                        (SELECT COUNT(*) FROM import_time_buckets WHERE batch_id = ?1) bucket_rows,
                        exact_session_count, hour_bucket_count FROM import_batches WHERE id = ?1",
            ).bind(&id).fetch_one(pool).await.unwrap();
            let exact = length * if source == "a" { 1 } else { 2 };
            assert_eq!(row.get::<i64, _>("exact_rows"), exact);
            assert_eq!(row.get::<i64, _>("exact_session_count"), exact);
            assert_eq!(row.get::<i64, _>("bucket_rows"), length);
            assert_eq!(row.get::<i64, _>("hour_bucket_count"), length);
            sources.push(json!({"id": id, "exactRows": exact, "bucketRows": length}));
        }
        for app in (0..12)
            .map(|index| format!("editor-{index}-c{cohort}.exe"))
            .chain(
                ["import-a", "import-b", "bucket-a", "bucket-b"]
                    .map(|app| format!("{app}-c{cohort}.exe")),
            )
        {
            let category = if app.starts_with("editor-") {
                "custom:fixture-work"
            } else {
                "custom:fixture-import"
            };
            assert_eq!(snapshot.resolve_session_category(&app).id, category);
            categories.insert(app, category);
        }
        for domain in (0..10).map(|index| format!("domain-{index}-c{cohort}.test")) {
            assert_eq!(
                snapshot.resolve_web_category(&domain).id,
                "custom:fixture-web"
            );
        }
    }
    if days > 0 {
        assert_eq!(
            snapshot.resolve_session_category("chrome.exe").id,
            "custom:fixture-web"
        );
        categories.insert("chrome.exe".to_string(), "custom:fixture-web");
    }
    let long_titles: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE length(window_title) > 256")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(long_titles, days);
    json!({
        "verifiedDailyDurationByOriginMs": {"native": 16_200_000, "import_exact": 3_600_000, "import_bucket": 1_800_000},
        "importSources": sources, "appCategories": categories,
        "customCategoryCount": if days == 0 {0} else {3},
        "longNativeTitleRows": long_titles, "longTitleCharacters": "Fixture v2 long title — ".repeat(24).chars().count(),
        "webIncludedInApplicationAggregate": false,
        "webNote": "Web duration is counted separately; the app aggregate contains native Chrome duration once."
    })
}

async fn fixture_v2_range_diversity(
    pool: &SqlitePool,
    days: i64,
    cohorts: i64,
    start: i64,
    end: i64,
) -> Value {
    let row = sqlx::query(
        "SELECT
           (SELECT COUNT(DISTINCT exe_name) FROM (
              SELECT exe_name FROM sessions WHERE start_time >= ?1 AND end_time <= ?2
              UNION ALL SELECT exe_name FROM import_exact_sessions WHERE start_time >= ?1 AND end_time <= ?2
              UNION ALL SELECT exe_name FROM import_time_buckets WHERE bucket_start_time >= ?1 AND bucket_start_time + 3600000 <= ?2)) apps,
           (SELECT COUNT(DISTINCT batch_id) FROM import_exact_sessions WHERE start_time >= ?1 AND end_time <= ?2) sources,
           (SELECT COUNT(DISTINCT normalized_domain) FROM web_activity_segments WHERE start_time >= ?1 AND end_time <= ?2) domains,
           (SELECT COUNT(DISTINCT raw_exe_name) FROM activity_hourly_effective WHERE bucket_start_ms >= ?1 AND bucket_end_ms <= ?2) projection_apps",
    ).bind(start).bind(end).fetch_one(pool).await.unwrap();
    let cohort_count = (0..days)
        .filter(|day| {
            let day_start = MIXED_START_MS + day * DAY_MS;
            day_start >= start && day_start + 10 * HOUR_MS <= end
        })
        .map(|day| day % cohorts)
        .collect::<std::collections::BTreeSet<_>>()
        .len() as i64;
    let apps = cohort_count * 16 + i64::from(cohort_count > 0);
    assert_eq!(row.get::<i64, _>("apps"), apps);
    assert_eq!(row.get::<i64, _>("projection_apps"), apps);
    assert_eq!(row.get::<i64, _>("sources"), cohort_count * 2);
    assert_eq!(row.get::<i64, _>("domains"), cohort_count * 10);
    json!({"appCount": apps, "projectionAppCount": apps, "importSourceCount": cohort_count * 2, "domainCount": cohort_count * 10})
}

fn create_fixture_v2_directory(requested: Option<&Path>) -> PathBuf {
    let temp = std::env::temp_dir().canonicalize().unwrap();
    let path = requested
        .map(Path::to_path_buf)
        .unwrap_or_else(|| temp.join(format!("patina-fixture-v2-{}", uuid::Uuid::new_v4())));
    assert!(path.is_absolute(), "fixture output must be absolute");
    assert!(
        !path
            .components()
            .any(|component| component == std::path::Component::ParentDir),
        "fixture output cannot contain parent traversal"
    );
    assert_eq!(
        path.parent().unwrap().canonicalize().unwrap(),
        temp,
        "fixture output must be a direct child of the OS temporary directory"
    );
    let name = path.file_name().unwrap().to_str().unwrap();
    let id = name
        .strip_prefix("patina-fixture-v2-")
        .expect("fixture output must use the patina-fixture-v2-UUID name");
    uuid::Uuid::parse_str(id).expect("fixture output requires a UUID suffix");
    // create_dir is exclusive: existing directories, files and directory links are rejected.
    std::fs::create_dir(&path).expect("fixture output must not exist");
    path.canonicalize().unwrap()
}

fn remove_fixture_v2_directory(root: &Path) {
    assert_eq!(root.canonicalize().unwrap(), root);
    assert_eq!(
        root.parent().unwrap(),
        std::env::temp_dir().canonicalize().unwrap()
    );
    assert!(root
        .file_name()
        .unwrap()
        .to_str()
        .unwrap()
        .starts_with("patina-fixture-v2-"));
    // Flat, known owned outputs only. An unexpected file prevents directory removal.
    for name in [
        ".building.db",
        ".building.db-wal",
        ".building.db-shm",
        "patina.db",
        "patina.db-wal",
        "patina.db-shm",
        "manifest.json",
    ] {
        match std::fs::remove_file(root.join(name)) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => panic!("cannot remove owned fixture output: {error}"),
        }
    }
    std::fs::remove_dir(root).unwrap();
}

fn fixture_file_sha256(path: &Path) -> String {
    let mut file = std::fs::File::open(path).unwrap();
    let mut digest = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    loop {
        let count = file.read(&mut buffer).unwrap();
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    format!("{:x}", digest.finalize())
}

async fn export_fixture_v2(
    profile: &str,
    days: i64,
    cohort_days: i64,
    sample_count: usize,
    requested: Option<&Path>,
) -> Value {
    assert!(days >= 0 && cohort_days > 0 && sample_count > 0);
    let root = create_fixture_v2_directory(requested);
    let db_path = root.join(".building.db");
    let mut opened_pool = None;
    let outcome = AssertUnwindSafe(async {
        let pool = open_single_connection_sqlite_pool(&db_path, true).await.unwrap();
        opened_pool = Some(pool.clone());
        prepare_pool_schema(&pool, &db_path).await.unwrap();
        pool.execute("PRAGMA journal_mode = WAL").await.unwrap();
        let started = Instant::now();
        seed_fixture_v2(&pool, days, cohort_days).await;
        let seed_ms = started.elapsed().as_secs_f64() * 1000.0;
        let cohorts = (days + cohort_days - 1) / cohort_days;
        let inventory = mixed_fact_inventory(&pool, days, cohorts).await;
        let seeded_sizes = sqlite_file_sizes(&db_path);
        let measurement = if days == 0 {
            while super::super::maintain_once(&pool).await.unwrap() {}
            let empty = load_range(&pool, MIXED_START_MS, MIXED_START_MS + DAY_MS, &[MIXED_START_MS, MIXED_START_MS + DAY_MS]).await.unwrap();
            assert!(empty.records.is_empty());
            json!({"name": "fixture-v2-e0", "totalDurationMs": 0, "projectionRows": 0, "seedWallMs": seed_ms, "sampleCount": 0})
        } else {
            measure_capacity(&pool, &CapacityCase {
                name: "fixture-v2", days, start_ms: MIXED_START_MS, coverage_end_hour: 10,
                daily_duration_ms: 21_600_000, projection_rows_per_day: 101,
                native_rows_per_day: 1001, app_count: cohorts * 16 + 1,
            }, seed_ms, sample_count).await
        };
        let oracle = fixture_v2_oracle(&pool, days, cohort_days).await;
        let user_version: i64 = sqlx::query_scalar("PRAGMA user_version").fetch_one(&pool).await.unwrap();
        let migrations = sqlx::query("SELECT version, hex(checksum) checksum, success FROM _sqlx_migrations ORDER BY version")
            .fetch_all(&pool).await.unwrap().iter().map(|row| json!({
                "version": row.get::<i64, _>("version"), "checksum": row.get::<String, _>("checksum"), "success": row.get::<bool, _>("success")
            })).collect::<Vec<_>>();
        let query_days = days.min(365);
        let query_start = MIXED_START_MS + (days - query_days) * DAY_MS;
        let query_end = if days == 0 { MIXED_START_MS + DAY_MS } else { MIXED_START_MS + (days - 1) * DAY_MS + 10 * HOUR_MS };
        let mut boundaries = (0..=query_days.max(1)).map(|day| query_start + day * DAY_MS).collect::<Vec<_>>();
        *boundaries.last_mut().unwrap() = query_end;
        let year = if profile == "r3" { 2025 } else { 2023 };
        let year_start = chrono::NaiveDate::from_ymd_opt(year, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis();
        let year_end = chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1).unwrap().and_hms_opt(0, 0, 0).unwrap().and_utc().timestamp_millis();
        let year_fact_days = (0..days).filter(|day| (year_start..year_end).contains(&(MIXED_START_MS + day * DAY_MS))).count() as i64;
        let query_diversity = fixture_v2_range_diversity(&pool, days, cohorts, query_start, query_end).await;
        let year_diversity = fixture_v2_range_diversity(&pool, days, cohorts, year_start, year_end).await;
        let maintained_sizes = sqlite_file_sizes(&db_path);
        checkpoint_sqlite_pool(&pool).await.unwrap();
        let checkpointed_sizes = sqlite_file_sizes(&db_path);
        assert_eq!(checkpointed_sizes["walBytes"], 0);
        pool.close().await;
        assert!(pool.is_closed());
        let destination = root.join("patina.db");
        let mut output = std::fs::OpenOptions::new().write(true).create_new(true).open(&destination).unwrap();
        std::io::copy(&mut std::fs::File::open(&db_path).unwrap(), &mut output).unwrap();
        output.sync_all().unwrap();
        drop(output);
        std::fs::remove_file(&db_path).unwrap();
        let daily_oracle = (0..days).map(|day| json!({"dayStartMs": MIXED_START_MS + day * DAY_MS, "totalDurationMs": 21_600_000, "nativeDurationMs": 16_200_000, "importedDurationMs": 5_400_000})).collect::<Vec<_>>();
        let manifest = json!({
            "fixtureVersion": 2, "profile": profile, "days": days,
            "seed": {"kind": "deterministic-grid", "version": 2, "utcStartMs": MIXED_START_MS, "cohortDays": cohort_days, "cohortCount": cohorts, "cohortAssignment": "utc-day-index-modulo-cohort-count", "dailyCoverageStartOffsetMs": 0, "dailyCoverageEndOffsetMs": 36_000_000},
            "generatorSourceSha256": format!("{:x}", Sha256::digest(include_bytes!("hourly_benchmark.rs"))),
            "exportDirectory": root, "manifestPath": root.join("manifest.json"),
            "database": {"file": "patina.db", "sha256": fixture_file_sha256(&destination), "bytes": destination.metadata().unwrap().len(), "checkpointed": true, "closed": true},
            "schemaIdentity": {"userVersion": user_version, "sqlxMigrations": migrations, "hourlySchemaVersion": HOURLY_SCHEMA_VERSION, "hourlyAlgorithmVersion": HOURLY_ALGORITHM_VERSION},
            "query": {"startMs": query_start, "endMs": query_end, "localDayBoundariesMs": boundaries, "boundaryTimezone": "UTC", "expectedTotalDurationMs": query_days * 21_600_000, "expectedDailyDurationMs": if days == 0 {0} else {21_600_000}, "verifiedDiversity": query_diversity},
            "yearQuery": {"year": year, "startMs": year_start, "endMs": year_end, "boundaryTimezone": "UTC", "localDayBoundariesMs": (year_start..=year_end).step_by(DAY_MS as usize).collect::<Vec<_>>(), "expectedTotalDurationMs": year_fact_days * 21_600_000, "expectedNativeDurationMs": year_fact_days * 16_200_000, "expectedImportedDurationMs": year_fact_days * 5_400_000, "factDays": year_fact_days, "verifiedDiversity": year_diversity},
            "dailyOracle": daily_oracle,
            "inventory": inventory["countsAndDuration"], "inventorySha256": inventory["countsAndDurationSha256"],
            "oracle": oracle, "measurement": measurement,
            "storage": {"afterSeed": seeded_sizes, "afterMaintenance": maintained_sizes, "afterTruncateCheckpoint": checkpointed_sizes, "afterCloseExport": sqlite_file_sizes(&destination)},
            "limitations": ["Synthetic historical fixture; runtime must select the manifest query range.", "fixture-v2 seed timing includes diversity transformations and is not comparable with mixed-file v1 seed timing.", "Warm backend timing excludes IPC transport, browser rendering and OS cold-cache costs."]
        });
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(root.join("manifest.json")).unwrap();
        file.write_all(&serde_json::to_vec_pretty(&manifest).unwrap()).unwrap();
        file.sync_all().unwrap();
        manifest
    }).catch_unwind().await;
    if let Some(pool) = opened_pool {
        pool.close().await;
    }
    match outcome {
        Ok(manifest) => manifest,
        Err(panic) => {
            remove_fixture_v2_directory(&root);
            std::panic::resume_unwind(panic)
        }
    }
}

#[tokio::test]
async fn fixture_v2_exports_empty_and_diverse_closed_databases_with_independent_oracles() {
    for (profile, days, expected_apps, expected_sources, expected_domains) in
        [("e0", 0, 0, 0, 0), ("small-rotating-cohorts", 6, 49, 6, 30)]
    {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("patina-fixture-v2-{}", uuid::Uuid::new_v4()));
        let mut exported = false;
        let mut opened_pool = None;
        let outcome = AssertUnwindSafe(async {
            let manifest = export_fixture_v2(profile, days, 2, 1, Some(&root)).await;
            exported = true;
            assert_eq!(manifest["exportDirectory"].as_str().unwrap(), root.to_str().unwrap());
            let path = root.join("patina.db");
            assert_eq!(manifest["inventory"]["appCount"], expected_apps);
            assert_eq!(manifest["inventory"]["importSourceCount"], expected_sources);
            assert_eq!(manifest["inventory"]["domainCount"], expected_domains);
            assert_eq!(manifest["inventory"]["nativeRows"], days * 1001);
            assert_eq!(manifest["oracle"]["longNativeTitleRows"], days);
            assert_eq!(manifest["storage"]["afterCloseExport"]["walBytes"], 0);
            assert_eq!(manifest["storage"]["afterCloseExport"]["shmBytes"], 0);
            assert!(!root.join(".building.db").exists());
            assert_eq!(
                std::fs::read(root.join("manifest.json")).unwrap(),
                serde_json::to_vec_pretty(&manifest).unwrap()
            );
            assert_eq!(manifest["database"]["sha256"], fixture_file_sha256(&path));
            assert_eq!(
                manifest["database"]["bytes"],
                path.metadata().unwrap().len()
            );
            assert_eq!(
                manifest["yearQuery"]["expectedTotalDurationMs"],
                days * 21_600_000
            );
            let pool = open_single_connection_sqlite_pool(&path, false)
                .await
                .unwrap();
            opened_pool = Some(pool.clone());
            let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(integrity, "ok");
            // Reopening the delivered file must retain the true maintainer's result and classification settings.
            assert_eq!(fixture_v2_oracle(&pool, days, 2).await, manifest["oracle"]);
            if days > 0 {
                let daily_first_apps: Vec<String> = sqlx::query_scalar(
                    "SELECT exe_name FROM sessions WHERE (start_time - ?1) % 86400000 = 0 ORDER BY start_time",
                ).bind(MIXED_START_MS).fetch_all(&pool).await.unwrap();
                assert_eq!(
                    daily_first_apps,
                    [
                        "editor-0-c0.exe",
                        "editor-0-c1.exe",
                        "editor-0-c2.exe",
                        "editor-0-c0.exe",
                        "editor-0-c1.exe",
                        "editor-0-c2.exe"
                    ]
                );
                // Continuous two-day cohorts would leave only 33 apps in these last three days.
                assert_eq!(
                    fixture_v2_range_diversity(
                        &pool,
                        days,
                        3,
                        MIXED_START_MS + 3 * DAY_MS,
                        MIXED_START_MS + 6 * DAY_MS
                    )
                    .await,
                    json!({"appCount": 49, "projectionAppCount": 49, "importSourceCount": 6, "domainCount": 30})
                );
            }
            let start = manifest["query"]["startMs"].as_i64().unwrap();
            let end = manifest["query"]["endMs"].as_i64().unwrap();
            let boundaries = manifest["query"]["localDayBoundariesMs"]
                .as_array()
                .unwrap()
                .iter()
                .map(|value| value.as_i64().unwrap())
                .collect::<Vec<_>>();
            let result = load_range(&pool, start, end, &boundaries).await.unwrap();
            if days > 0 {
                assert_eq!(result.read_path, "projection");
            }
            assert_eq!(
                result
                    .records
                    .iter()
                    .map(|record| record.end_time - record.start_time)
                    .sum::<i64>(),
                days * 21_600_000
            );
        }).catch_unwind().await;
        if let Some(pool) = opened_pool {
            pool.close().await;
        }
        let cleanup = std::panic::catch_unwind(|| {
            if exported {
                remove_fixture_v2_directory(&root);
                assert!(!root.exists());
            }
        });
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
        cleanup.unwrap();
    }
}

#[test]
fn fixture_v2_rejects_existing_and_non_temporary_destinations_and_preserves_unowned_files() {
    let root = create_fixture_v2_directory(None);
    let sentinel = root.join("unowned-sentinel.txt");
    let outcome = std::panic::catch_unwind(|| {
        std::fs::write(&sentinel, "keep").unwrap();
        assert!(std::panic::catch_unwind(|| create_fixture_v2_directory(Some(&root))).is_err());
        assert!(
            std::panic::catch_unwind(|| create_fixture_v2_directory(Some(Path::new(
                "patina-fixture-v2-relative"
            ))))
            .is_err()
        );
        let outside = std::env::current_dir()
            .unwrap()
            .join(format!("patina-fixture-v2-{}", uuid::Uuid::new_v4()));
        assert!(std::panic::catch_unwind(|| create_fixture_v2_directory(Some(&outside))).is_err());
        assert!(!outside.exists());
        // PathBuf::push on a Windows verbatim prefix normalizes away parent components.
        let traversal = PathBuf::from(format!(
            "{}{sep}..{sep}patina-fixture-v2-{}",
            root.display(),
            uuid::Uuid::new_v4(),
            sep = std::path::MAIN_SEPARATOR
        ));
        assert!(
            std::panic::catch_unwind(|| create_fixture_v2_directory(Some(&traversal))).is_err()
        );
        std::fs::write(root.join(".building.db"), "owned incomplete fixture").unwrap();
        assert!(std::panic::catch_unwind(|| remove_fixture_v2_directory(&root)).is_err());
        assert!(!root.join(".building.db").exists());
        assert_eq!(std::fs::read_to_string(&sentinel).unwrap(), "keep");
    });
    let cleanup = std::panic::catch_unwind(|| {
        match std::fs::remove_file(&sentinel) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => panic!("cannot remove the owned test sentinel: {error}"),
        }
        remove_fixture_v2_directory(&root);
    });
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
    cleanup.unwrap();
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
