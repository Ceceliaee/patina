use chrono::Utc;
use patina_storage::schema::{
    ACTIVITY_READ_MODELS_SCHEMA_SQL, CURRENT_BASELINE_SCHEMA_SQL, IMPORT_DATA_ISOLATION_SCHEMA_SQL,
    IMPORT_DATA_SCHEMA_SQL, WEB_ACTIVITY_SCHEMA_SQL,
};
use serde::Serialize;
use sqlx::{Executor, Row, SqlitePool};
use std::time::Instant;

const DAY_MS: i64 = 24 * 60 * 60 * 1000;
const NOW_MS: i64 = 1_781_614_400_000;
const RANGE_START_MS: i64 = NOW_MS - 365 * DAY_MS;
const RANGE_END_MS: i64 = NOW_MS;
const SESSION_COUNT: i64 = 48_000;
const WEB_SEGMENT_COUNT: i64 = 12_000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryMeasurement {
    name: &'static str,
    row_count: usize,
    duration_ms: f64,
    plan: Vec<String>,
    uses_table_scan: bool,
    uses_temp_sort: bool,
    uses_index: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryPlanReport {
    benchmark: &'static str,
    measured_at: String,
    measurements: Vec<QueryMeasurement>,
    metadata: QueryPlanMetadata,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QueryPlanMetadata {
    session_count: i64,
    web_segment_count: i64,
    range_start_ms: i64,
    range_end_ms: i64,
    web_range: Vec<serde_json::Value>,
    notes: Vec<&'static str>,
}

async fn create_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
    pool.execute(WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
    pool.execute(IMPORT_DATA_SCHEMA_SQL).await.unwrap();
    pool.execute(IMPORT_DATA_ISOLATION_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(ACTIVITY_READ_MODELS_SCHEMA_SQL).await.unwrap();
    pool
}

async fn seed_sessions(pool: &SqlitePool) {
    let mut tx = pool.begin().await.unwrap();
    for index in 0..SESSION_COUNT {
        let start_time = RANGE_START_MS + (index * 11 * 60 * 1000);
        let duration = 2 * 60 * 1000 + (index % 17) * 45 * 1000;
        let end_time = if index == SESSION_COUNT - 1 {
            None
        } else {
            Some(start_time + duration)
        };
        let app_index = index % 12;
        sqlx::query(
            "INSERT INTO sessions (
                    app_name,
                    exe_name,
                    window_title,
                    start_time,
                    end_time,
                    duration,
                    continuity_group_start_time
                 ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(format!("App {app_index}"))
        .bind(format!("app-{app_index}.exe"))
        .bind("Synthetic title")
        .bind(start_time)
        .bind(end_time)
        .bind(end_time.map(|value| value - start_time))
        .bind(start_time)
        .execute(&mut *tx)
        .await
        .unwrap();
    }

    for session_id in 1..=2_000_i64 {
        let start_time = RANGE_START_MS + (session_id * 13 * 60 * 1000);
        sqlx::query(
            "INSERT INTO session_title_samples (
                    session_id,
                    title,
                    start_time,
                    end_time
                 ) VALUES (?, ?, ?, ?)",
        )
        .bind(session_id)
        .bind("Synthetic title sample")
        .bind(start_time)
        .bind(start_time + 60 * 1000)
        .execute(&mut *tx)
        .await
        .unwrap();
    }

    tx.commit().await.unwrap();
}

async fn seed_web_segments(pool: &SqlitePool) {
    let mut tx = pool.begin().await.unwrap();
    for index in 0..WEB_SEGMENT_COUNT {
        let start_time = RANGE_START_MS + (index * 29 * 60 * 1000);
        let duration = 30 * 1000 + (index % 11) * 20 * 1000;
        let end_time = if index == WEB_SEGMENT_COUNT - 1 {
            None
        } else {
            Some(start_time + duration)
        };
        let domain_index = index % 30;
        sqlx::query(
            "INSERT INTO web_activity_segments (
                    browser_client_id,
                    browser_kind,
                    browser_exe_name,
                    domain,
                    normalized_domain,
                    url,
                    title,
                    favicon_url,
                    start_time,
                    end_time,
                    duration,
                    source,
                    created_at,
                    updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind("synthetic-browser")
        .bind("chrome")
        .bind("chrome.exe")
        .bind(format!("example-{domain_index}.test"))
        .bind(format!("example-{domain_index}.test"))
        .bind(None::<String>)
        .bind(None::<String>)
        .bind(None::<String>)
        .bind(start_time)
        .bind(end_time)
        .bind(end_time.map(|value| value - start_time))
        .bind("query-plan-test")
        .bind(start_time)
        .bind(start_time)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();
}

async fn explain_query(pool: &SqlitePool, sql: &str, binds: &[i64]) -> Vec<String> {
    let explain_sql = format!("EXPLAIN QUERY PLAN {sql}");
    let mut query = sqlx::query(sqlx::AssertSqlSafe(explain_sql));
    for bind in binds {
        query = query.bind(*bind);
    }

    query
        .fetch_all(pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.get::<String, _>("detail"))
        .collect()
}

fn summarize_plan(plan: &[String]) -> (bool, bool, bool) {
    let joined = plan.join("\n").to_ascii_uppercase();
    (
        joined.contains("SCAN SESSIONS") || joined.contains("SCAN WEB_ACTIVITY_SEGMENTS"),
        joined.contains("USE TEMP B-TREE"),
        joined.contains("USING INDEX") || joined.contains("USING COVERING INDEX"),
    )
}

async fn measure_session_summary_current(pool: &SqlitePool) -> QueryMeasurement {
    let sql = "SELECT app_name,
                          exe_name,
                          window_title,
                          start_time,
                          COALESCE(end_time, ?) AS effective_end_time
                   FROM sessions
                   WHERE start_time < ?
                     AND COALESCE(end_time, ?) > ?
                   ORDER BY start_time ASC";
    let plan = explain_query(pool, sql, &[NOW_MS, RANGE_END_MS, NOW_MS, RANGE_START_MS]).await;
    let started_at = Instant::now();
    let rows = sqlx::query(sql)
        .bind(NOW_MS)
        .bind(RANGE_END_MS)
        .bind(NOW_MS)
        .bind(RANGE_START_MS)
        .fetch_all(pool)
        .await
        .unwrap();
    build_measurement("sessions-current-coalesce", rows.len(), started_at, plan)
}

async fn measure_session_summary_split(pool: &SqlitePool, name: &'static str) -> QueryMeasurement {
    let closed_sql = "SELECT app_name,
                                 exe_name,
                                 window_title,
                                 start_time,
                                 end_time AS effective_end_time
                          FROM sessions
                          WHERE start_time < ?
                            AND end_time IS NOT NULL
                            AND end_time > ?
                          ORDER BY start_time ASC";
    let active_sql = "SELECT app_name,
                                 exe_name,
                                 window_title,
                                 start_time,
                                 ? AS effective_end_time
                          FROM sessions
                          WHERE start_time < ?
                            AND end_time IS NULL
                          ORDER BY start_time ASC";
    let mut plan = explain_query(pool, closed_sql, &[RANGE_END_MS, RANGE_START_MS]).await;
    plan.extend(
        explain_query(pool, active_sql, &[NOW_MS, RANGE_END_MS])
            .await
            .into_iter()
            .map(|detail| format!("active: {detail}")),
    );

    let started_at = Instant::now();
    let closed_rows = sqlx::query(closed_sql)
        .bind(RANGE_END_MS)
        .bind(RANGE_START_MS)
        .fetch_all(pool)
        .await
        .unwrap();
    let active_rows = sqlx::query(active_sql)
        .bind(NOW_MS)
        .bind(RANGE_END_MS)
        .fetch_all(pool)
        .await
        .unwrap();
    build_measurement(
        name,
        closed_rows.len() + active_rows.len(),
        started_at,
        plan,
    )
}

async fn measure_title_samples(pool: &SqlitePool) -> QueryMeasurement {
    let sample_ids = (1..=64).map(|_| "?").collect::<Vec<_>>().join(", ");
    let sql = format!(
        "SELECT session_id, title, start_time, end_time
             FROM session_title_samples
             WHERE session_id IN ({sample_ids})
               AND start_time < ?
               AND COALESCE(end_time, ?) > ?
             ORDER BY session_id ASC, start_time ASC, id ASC",
    );
    let mut binds = (1..=64).collect::<Vec<_>>();
    binds.extend([RANGE_END_MS, NOW_MS, RANGE_START_MS]);
    let plan = explain_query(pool, &sql, &binds).await;
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql));
    for bind in &binds {
        query = query.bind(*bind);
    }
    let started_at = Instant::now();
    let rows = query.fetch_all(pool).await.unwrap();
    build_measurement(
        "session-title-samples-current",
        rows.len(),
        started_at,
        plan,
    )
}

async fn measure_web_activity_current(pool: &SqlitePool) -> QueryMeasurement {
    let sql = "SELECT id,
                          browser_client_id,
                          browser_kind,
                          browser_exe_name,
                          domain,
                          normalized_domain,
                          start_time,
                          end_time,
                          COALESCE(duration, MAX(0, ? - start_time)) AS duration
                   FROM web_activity_segments
                   WHERE start_time < ?
                     AND COALESCE(end_time, ?) > ?
                   ORDER BY start_time ASC, id ASC";
    let plan = explain_query(pool, sql, &[NOW_MS, RANGE_END_MS, NOW_MS, RANGE_START_MS]).await;
    let started_at = Instant::now();
    let rows = sqlx::query(sql)
        .bind(NOW_MS)
        .bind(RANGE_END_MS)
        .bind(NOW_MS)
        .bind(RANGE_START_MS)
        .fetch_all(pool)
        .await
        .unwrap();
    build_measurement(
        "web-activity-current-coalesce",
        rows.len(),
        started_at,
        plan,
    )
}

async fn measure_web_activity_analysis_range(pool: &SqlitePool) -> QueryMeasurement {
    let sql = "SELECT normalized_domain, start_time, COALESCE(end_time, ?) effective_end_time
                   FROM web_activity_segments
                   WHERE start_time < ?
                     AND COALESCE(end_time, ?) > ?";
    let plan = explain_query(pool, sql, &[NOW_MS, RANGE_END_MS, NOW_MS, RANGE_START_MS]).await;
    let started_at = Instant::now();
    let rows = sqlx::query(sql)
        .bind(NOW_MS)
        .bind(RANGE_END_MS)
        .bind(NOW_MS)
        .bind(RANGE_START_MS)
        .fetch_all(pool)
        .await
        .unwrap();
    build_measurement(
        "web-activity-analysis-range-index",
        rows.len(),
        started_at,
        plan,
    )
}

async fn measure_web_activity_analysis_domain_range(pool: &SqlitePool) -> QueryMeasurement {
    let sql = "SELECT normalized_domain, start_time, COALESCE(end_time, ?) effective_end_time
                   FROM web_activity_segments
                   WHERE normalized_domain = ?
                     AND start_time < ?
                     AND COALESCE(end_time, ?) > ?";
    let explain_sql = format!("EXPLAIN QUERY PLAN {sql}");
    let plan = sqlx::query(sqlx::AssertSqlSafe(explain_sql))
        .bind(NOW_MS)
        .bind("example-1.test")
        .bind(RANGE_END_MS)
        .bind(NOW_MS)
        .bind(RANGE_START_MS)
        .fetch_all(pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.get::<String, _>("detail"))
        .collect();
    let started_at = Instant::now();
    let rows = sqlx::query(sql)
        .bind(NOW_MS)
        .bind("example-1.test")
        .bind(RANGE_END_MS)
        .bind(NOW_MS)
        .bind(RANGE_START_MS)
        .fetch_all(pool)
        .await
        .unwrap();
    build_measurement(
        "web-activity-analysis-domain-range-index",
        rows.len(),
        started_at,
        plan,
    )
}

async fn seed_activity_projections(pool: &SqlitePool) {
    let mut tx = pool.begin().await.unwrap();
    for day in 0..365_i64 {
        let bucket_start_ms = RANGE_START_MS + day * DAY_MS + 9 * 60 * 60 * 1000;
        for app_index in 0..12_i64 {
            sqlx::query(
                "INSERT INTO activity_hourly_effective(
                       bucket_start_ms, bucket_end_ms, app_key, raw_exe_name,
                       display_app_name, origin, source_id, effective_duration_ms,
                       computed_revision, updated_at_ms
                     ) VALUES (?, ?, ?, ?, ?, 'native', ?, ?, 1, ?)",
            )
            .bind(bucket_start_ms)
            .bind(bucket_start_ms + 60 * 60 * 1000)
            .bind(format!("app-{app_index}.exe"))
            .bind(format!("app-{app_index}.exe"))
            .bind(format!("App {app_index}"))
            .bind(format!("native:{day}:{app_index}"))
            .bind(10 * 60 * 1000 + app_index * 1000)
            .bind(NOW_MS)
            .execute(&mut *tx)
            .await
            .unwrap();
        }
    }
    for app_index in 0..12_i64 {
        sqlx::query(
            "INSERT INTO recorded_app_catalog(
                   app_key, raw_exe_name, display_app_name, last_seen_ms,
                   has_native_records, has_import_exact_records, has_import_bucket_records,
                   computed_revision, updated_at_ms
                 ) VALUES (?, ?, ?, ?, 1, 0, 0, 1, ?)",
        )
        .bind(format!("app-{app_index}.exe"))
        .bind(format!("app-{app_index}.exe"))
        .bind(format!("App {app_index}"))
        .bind(NOW_MS - app_index * DAY_MS)
        .bind(NOW_MS)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();
}

async fn measure_hourly_projection(pool: &SqlitePool) -> QueryMeasurement {
    let sql = "SELECT bucket_start_ms, bucket_end_ms, raw_exe_name,
                          display_app_name, effective_duration_ms
                   FROM activity_hourly_effective
                   WHERE bucket_start_ms < ? AND bucket_end_ms > ?
                   ORDER BY bucket_start_ms ASC, app_key ASC, origin ASC, source_id ASC";
    let plan = explain_query(pool, sql, &[RANGE_END_MS, RANGE_START_MS]).await;
    let started_at = Instant::now();
    let rows = sqlx::query(sql)
        .bind(RANGE_END_MS)
        .bind(RANGE_START_MS)
        .fetch_all(pool)
        .await
        .unwrap();
    build_measurement(
        "activity-hourly-projection-year",
        rows.len(),
        started_at,
        plan,
    )
}

async fn measure_catalog_projection(pool: &SqlitePool) -> QueryMeasurement {
    let sql = "SELECT raw_exe_name, display_app_name, last_seen_ms, has_native_records
                   FROM recorded_app_catalog
                   ORDER BY last_seen_ms DESC, raw_exe_name ASC LIMIT 60";
    let plan = explain_query(pool, sql, &[]).await;
    let started_at = Instant::now();
    let rows = sqlx::query(sql).fetch_all(pool).await.unwrap();
    build_measurement(
        "recorded-app-catalog-projection",
        rows.len(),
        started_at,
        plan,
    )
}

fn build_measurement(
    name: &'static str,
    row_count: usize,
    started_at: Instant,
    plan: Vec<String>,
) -> QueryMeasurement {
    let (uses_table_scan, uses_temp_sort, uses_index) = summarize_plan(&plan);
    QueryMeasurement {
        name,
        row_count,
        duration_ms: started_at.elapsed().as_secs_f64() * 1000.0,
        plan,
        uses_table_scan,
        uses_temp_sort,
        uses_index,
    }
}

#[tokio::test]
#[ignore = "run with pnpm run perf:sqlite-query-plan"]
async fn session_range_query_plan_report() {
    let pool = create_pool().await;
    seed_sessions(&pool).await;
    seed_web_segments(&pool).await;
    seed_activity_projections(&pool).await;

    let mut measurements = vec![
        measure_session_summary_current(&pool).await,
        measure_session_summary_split(&pool, "sessions-split-closed-active-baseline").await,
        measure_title_samples(&pool).await,
        measure_web_activity_current(&pool).await,
        measure_web_activity_analysis_range(&pool).await,
        measure_web_activity_analysis_domain_range(&pool).await,
        measure_hourly_projection(&pool).await,
        measure_catalog_projection(&pool).await,
    ];

    pool.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_closed_end_start_candidate
             ON sessions(end_time, start_time)
             WHERE end_time IS NOT NULL",
    )
    .await
    .unwrap();
    pool.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_active_start_candidate
             ON sessions(start_time)
             WHERE end_time IS NULL",
    )
    .await
    .unwrap();
    measurements.push(
        measure_session_summary_split(&pool, "sessions-split-closed-active-candidate-indexes")
            .await,
    );

    let report = QueryPlanReport {
            benchmark: "sqlite-session-query-plan",
            measured_at: Utc::now().to_rfc3339(),
            measurements,
            metadata: QueryPlanMetadata {
                session_count: SESSION_COUNT,
                web_segment_count: WEB_SEGMENT_COUNT,
                range_start_ms: RANGE_START_MS,
                range_end_ms: RANGE_END_MS,
                web_range: crate::data::web_activity_analysis::capacity::measure().await,
                notes: vec![
                    "Synthetic in-memory SQLite data; no product migration or user database is modified.",
                    "Candidate indexes are created only after baseline measurements in the temporary database.",
                    "Use this report to decide whether a real migration deserves a separate execution plan.",
                ],
            },
        };
    println!(
        "PATINA_QUERY_PLAN_REPORT_JSON:{}",
        serde_json::to_string_pretty(&report).unwrap()
    );
}
