use tauri_plugin_sql::{Migration, MigrationKind};

pub const CURRENT_BASELINE_MIGRATION_VERSION: i64 = 1;
pub const CURRENT_BASELINE_MIGRATION_DESCRIPTION: &str = "create_current_baseline_schema";
pub const TOOLS_TABLES_MIGRATION_VERSION: i64 = 2;
pub const TOOLS_TABLES_MIGRATION_DESCRIPTION: &str = "create_tools_tables";
pub const SOFTWARE_REMINDER_RULES_MIGRATION_VERSION: i64 = 3;
pub const SOFTWARE_REMINDER_RULES_MIGRATION_DESCRIPTION: &str = "create_software_reminder_rules";
pub const WEB_ACTIVITY_MIGRATION_VERSION: i64 = 4;
pub const WEB_ACTIVITY_MIGRATION_DESCRIPTION: &str = "create_web_activity_segments";
pub const WEB_FAVICON_CACHE_MIGRATION_VERSION: i64 = 5;
pub const WEB_FAVICON_CACHE_MIGRATION_DESCRIPTION: &str = "create_web_favicon_cache";
pub const SCREENSHOTS_MIGRATION_VERSION: i64 = 6;
pub const SCREENSHOTS_MIGRATION_DESCRIPTION: &str = "create_screenshots";

pub const CURRENT_BASELINE_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_name TEXT NOT NULL,
        exe_name TEXT NOT NULL,
        window_title TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration INTEGER,
        continuity_group_start_time INTEGER
    );

    CREATE TABLE IF NOT EXISTS session_title_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    UPDATE sessions
    SET end_time = start_time,
        duration = 0
    WHERE end_time IS NULL
      AND id NOT IN (
        SELECT id
        FROM sessions
        WHERE end_time IS NULL
        ORDER BY start_time DESC, id DESC
        LIMIT 1
      );

    UPDATE sessions
    SET continuity_group_start_time = start_time
    WHERE continuity_group_start_time IS NULL;

    CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(start_time);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_active
    ON sessions((1))
    WHERE end_time IS NULL;

    CREATE INDEX IF NOT EXISTS idx_session_title_samples_session_time
    ON session_title_samples(session_id, start_time);

    CREATE INDEX IF NOT EXISTS idx_session_title_samples_time
    ON session_title_samples(start_time, end_time);

    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS icon_cache (
        exe_name TEXT PRIMARY KEY,
        icon_base64 TEXT NOT NULL,
        last_updated INTEGER
    );
";

pub const TOOLS_TABLES_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS tool_reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        scheduled_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        fired_at INTEGER,
        cancelled_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tool_reminders_schedule_status
    ON tool_reminders(status, scheduled_at);

    CREATE TABLE IF NOT EXISTS tool_timers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        mode TEXT NOT NULL,
        label TEXT,
        duration_ms INTEGER,
        accumulated_ms INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER,
        paused_at INTEGER,
        completed_at INTEGER,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tool_timers_status_updated
    ON tool_timers(status, updated_at);

    CREATE TABLE IF NOT EXISTS tool_timer_laps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timer_id INTEGER NOT NULL,
        lap_index INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        FOREIGN KEY(timer_id) REFERENCES tool_timers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_tool_timer_laps_timer_id
    ON tool_timer_laps(timer_id, lap_index);

    CREATE TABLE IF NOT EXISTS tool_pomodoro_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        cycle_index INTEGER NOT NULL,
        focus_ms INTEGER NOT NULL,
        short_break_ms INTEGER NOT NULL,
        long_break_ms INTEGER NOT NULL,
        long_break_every INTEGER NOT NULL,
        phase_started_at INTEGER,
        phase_paused_at INTEGER,
        phase_remaining_ms INTEGER,
        completed_focus_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tool_pomodoro_runs_status_updated
    ON tool_pomodoro_runs(status, updated_at);

    CREATE TABLE IF NOT EXISTS tool_daily_stats (
        date_key TEXT PRIMARY KEY,
        completed_pomodoros INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_tool_daily_stats_updated
    ON tool_daily_stats(updated_at);
";

pub const SOFTWARE_REMINDER_RULES_SCHEMA_SQL: &str = "
    CREATE INDEX IF NOT EXISTS idx_sessions_app_usage_time
    ON sessions(app_name COLLATE NOCASE, start_time, end_time);

    CREATE INDEX IF NOT EXISTS idx_sessions_exe_usage_time
    ON sessions(exe_name COLLATE NOCASE, start_time, end_time);

    CREATE TABLE IF NOT EXISTS tool_software_reminder_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_name TEXT NOT NULL,
        exe_name TEXT,
        limit_ms INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        disabled_at INTEGER,
        last_fired_date_key TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tool_software_reminder_rules_active
    ON tool_software_reminder_rules(disabled_at, app_name, exe_name);
";

pub const WEB_ACTIVITY_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS web_activity_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        browser_client_id TEXT NOT NULL,
        browser_kind TEXT NOT NULL,
        browser_exe_name TEXT NOT NULL,
        domain TEXT NOT NULL,
        normalized_domain TEXT NOT NULL,
        url TEXT,
        title TEXT,
        favicon_url TEXT,
        start_time INTEGER NOT NULL,
        end_time INTEGER,
        duration INTEGER,
        source TEXT NOT NULL DEFAULT 'browser-extension',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_web_activity_segments_time
    ON web_activity_segments(start_time, end_time);

    CREATE INDEX IF NOT EXISTS idx_web_activity_segments_domain_time
    ON web_activity_segments(normalized_domain, start_time, end_time);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_web_activity_segments_single_active
    ON web_activity_segments((1))
    WHERE end_time IS NULL;
";

pub const WEB_FAVICON_CACHE_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS web_favicon_cache (
        normalized_domain TEXT PRIMARY KEY,
        favicon_url TEXT NOT NULL,
        updated_at INTEGER NOT NULL
    );

    INSERT INTO web_favicon_cache (normalized_domain, favicon_url, updated_at)
    SELECT domain.normalized_domain,
           (
             SELECT icon.favicon_url
             FROM web_activity_segments AS icon
             WHERE icon.normalized_domain = domain.normalized_domain
               AND icon.favicon_url IS NOT NULL
               AND TRIM(icon.favicon_url) <> ''
             ORDER BY CASE WHEN icon.favicon_url LIKE 'data:%' THEN 0 ELSE 1 END,
                      icon.start_time DESC,
                      icon.id DESC
             LIMIT 1
           ) AS favicon_url,
           COALESCE((
             SELECT icon.updated_at
             FROM web_activity_segments AS icon
             WHERE icon.normalized_domain = domain.normalized_domain
               AND icon.favicon_url IS NOT NULL
               AND TRIM(icon.favicon_url) <> ''
             ORDER BY CASE WHEN icon.favicon_url LIKE 'data:%' THEN 0 ELSE 1 END,
                      icon.start_time DESC,
                      icon.id DESC
             LIMIT 1
           ), 0) AS updated_at
    FROM (
        SELECT DISTINCT normalized_domain
        FROM web_activity_segments
        WHERE normalized_domain IS NOT NULL
          AND TRIM(normalized_domain) <> ''
    ) AS domain
    WHERE EXISTS (
        SELECT 1
        FROM web_activity_segments AS icon
        WHERE icon.normalized_domain = domain.normalized_domain
          AND icon.favicon_url IS NOT NULL
          AND TRIM(icon.favicon_url) <> ''
    )
    ON CONFLICT(normalized_domain) DO UPDATE SET
        favicon_url = excluded.favicon_url,
        updated_at = excluded.updated_at
    WHERE web_favicon_cache.favicon_url <> excluded.favicon_url;
";

pub const SCREENSHOTS_SCHEMA_SQL: &str = "
    CREATE TABLE IF NOT EXISTS screenshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT NOT NULL,
        captured_at INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        thumbnail_base64 TEXT NOT NULL,
        session_id INTEGER REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at
    ON screenshots(captured_at);

    CREATE INDEX IF NOT EXISTS idx_screenshots_session_id
    ON screenshots(session_id);
";

pub fn tracker_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: CURRENT_BASELINE_MIGRATION_VERSION,
            description: CURRENT_BASELINE_MIGRATION_DESCRIPTION,
            sql: CURRENT_BASELINE_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: TOOLS_TABLES_MIGRATION_VERSION,
            description: TOOLS_TABLES_MIGRATION_DESCRIPTION,
            sql: TOOLS_TABLES_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: SOFTWARE_REMINDER_RULES_MIGRATION_VERSION,
            description: SOFTWARE_REMINDER_RULES_MIGRATION_DESCRIPTION,
            sql: SOFTWARE_REMINDER_RULES_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: WEB_ACTIVITY_MIGRATION_VERSION,
            description: WEB_ACTIVITY_MIGRATION_DESCRIPTION,
            sql: WEB_ACTIVITY_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: WEB_FAVICON_CACHE_MIGRATION_VERSION,
            description: WEB_FAVICON_CACHE_MIGRATION_DESCRIPTION,
            sql: WEB_FAVICON_CACHE_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
        Migration {
            version: SCREENSHOTS_MIGRATION_VERSION,
            description: SCREENSHOTS_MIGRATION_DESCRIPTION,
            sql: SCREENSHOTS_SCHEMA_SQL,
            kind: MigrationKind::Up,
        },
    ]
}

#[cfg(test)]
mod query_plan_diagnostics {
    use super::{CURRENT_BASELINE_SCHEMA_SQL, WEB_ACTIVITY_SCHEMA_SQL};
    use chrono::Utc;
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
        notes: Vec<&'static str>,
    }

    async fn create_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
        pool.execute(WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
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
        let mut query = sqlx::query(&explain_sql);
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

    async fn measure_session_summary_split(
        pool: &SqlitePool,
        name: &'static str,
    ) -> QueryMeasurement {
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
        let mut query = sqlx::query(&sql);
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
    #[ignore = "run with npm run perf:sqlite-query-plan"]
    async fn session_range_query_plan_report() {
        let pool = create_pool().await;
        seed_sessions(&pool).await;
        seed_web_segments(&pool).await;

        let mut measurements = vec![
            measure_session_summary_current(&pool).await,
            measure_session_summary_split(&pool, "sessions-split-closed-active-baseline").await,
            measure_title_samples(&pool).await,
            measure_web_activity_current(&pool).await,
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
}
