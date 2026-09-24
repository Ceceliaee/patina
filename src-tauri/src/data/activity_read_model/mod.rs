mod catalog;
mod hourly;

use crate::data::sqlite_pool::{optimize_query_statistics, wait_for_sqlite_pool};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Row, Sqlite};
use std::collections::BTreeMap;
use tauri::{AppHandle, Runtime};
use tokio::time::{sleep, Duration};

const WORKER_ACTIVE_DELAY: Duration = Duration::from_millis(50);
const WORKER_IDLE_DELAY: Duration = Duration::from_secs(3);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedAppCatalogCursorDto {
    pub last_seen_ms: i64,
    pub raw_exe_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedAppCatalogRowDto {
    pub raw_exe_name: String,
    pub app_name: String,
    pub last_seen_ms: i64,
    pub has_native_records: bool,
    pub has_import_exact_records: bool,
    pub has_import_bucket_records: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedAppCatalogPageDto {
    pub rows: Vec<RecordedAppCatalogRowDto>,
    pub next_cursor: Option<RecordedAppCatalogCursorDto>,
    pub has_more: bool,
    pub read_path: &'static str,
    pub fallback_reason: Option<&'static str>,
    pub source_revision: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityAggregateRecordDto {
    pub anonymous: bool,
    pub app_name: String,
    pub exe_name: String,
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityAggregateRangeDto {
    pub records: Vec<ActivityAggregateRecordDto>,
    pub read_path: &'static str,
    pub fallback_reason: Option<&'static str>,
    pub source_revision: i64,
    pub projection_row_count: usize,
    pub fact_row_count: usize,
    pub has_active_session: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadModelStatusDto {
    pub source_revision: i64,
    pub app_catalog_state: String,
    pub activity_hourly_state: String,
    pub activity_coverage_start_ms: Option<i64>,
    pub activity_coverage_end_ms: Option<i64>,
    pub dirty_app_count: i64,
    pub dirty_range_count: i64,
}

pub async fn load_recorded_app_catalog_page<R: Runtime>(
    app: &AppHandle<R>,
    cursor: Option<RecordedAppCatalogCursorDto>,
    search_query: String,
    limit: usize,
) -> Result<RecordedAppCatalogPageDto, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    catalog::load_page(&pool, cursor, search_query, limit).await
}

pub async fn load_activity_aggregate_range<R: Runtime>(
    app: &AppHandle<R>,
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: Option<Vec<i64>>,
) -> Result<ActivityAggregateRangeDto, String> {
    if end_ms <= start_ms {
        return Ok(ActivityAggregateRangeDto {
            records: Vec::new(),
            read_path: "projection",
            fallback_reason: None,
            source_revision: 0,
            projection_row_count: 0,
            fact_row_count: 0,
            has_active_session: false,
        });
    }
    if let Some(boundaries) = bucket_boundaries_ms.as_deref() {
        validate_aggregate_boundaries(start_ms, end_ms, boundaries)?;
    }
    let pool = wait_for_sqlite_pool(app).await?;
    let mut response = hourly::load_range(
        &pool,
        start_ms,
        end_ms,
        bucket_boundaries_ms.as_deref().unwrap_or(&[]),
    )
    .await?;
    if let Some(boundaries) = bucket_boundaries_ms {
        response.records =
            aggregate_records_into_boundaries(response.records, start_ms, end_ms, &boundaries)?;
    }
    Ok(response)
}

fn aggregate_records_into_boundaries(
    records: Vec<ActivityAggregateRecordDto>,
    start_ms: i64,
    end_ms: i64,
    boundaries: &[i64],
) -> Result<Vec<ActivityAggregateRecordDto>, String> {
    validate_aggregate_boundaries(start_ms, end_ms, boundaries)?;
    let mut aggregated: BTreeMap<(usize, bool, String), (String, i64)> = BTreeMap::new();
    for record in records {
        let first_bucket = boundaries
            .partition_point(|boundary| *boundary <= record.start_time)
            .saturating_sub(1);
        for (index, pair) in boundaries.windows(2).enumerate().skip(first_bucket) {
            if pair[0] >= record.end_time {
                break;
            }
            let clipped_start = record.start_time.max(pair[0]);
            let clipped_end = record.end_time.min(pair[1]);
            let duration_ms = clipped_end - clipped_start;
            if duration_ms <= 0 {
                continue;
            }
            let key = (index, record.anonymous, record.exe_name.clone());
            let entry = aggregated
                .entry(key)
                .or_insert((record.app_name.clone(), 0));
            if !record.app_name.trim().is_empty() {
                entry.0 = record.app_name.clone();
            }
            entry.1 += duration_ms;
        }
    }
    let mut result = Vec::new();
    for ((index, anonymous, exe_name), (app_name, duration_ms)) in aggregated {
        let bucket_duration_ms = boundaries[index + 1] - boundaries[index];
        let mut remaining_ms = duration_ms;
        while remaining_ms > 0 {
            let chunk_ms = remaining_ms.min(bucket_duration_ms);
            result.push(ActivityAggregateRecordDto {
                anonymous,
                app_name: app_name.clone(),
                exe_name: exe_name.clone(),
                start_time: boundaries[index],
                end_time: boundaries[index] + chunk_ms,
            });
            remaining_ms -= chunk_ms;
        }
    }
    Ok(result)
}

fn validate_aggregate_boundaries(
    start_ms: i64,
    end_ms: i64,
    boundaries: &[i64],
) -> Result<(), String> {
    if boundaries.len() < 2
        || boundaries.len() > 5_000
        || boundaries.first().copied() != Some(start_ms)
        || boundaries.last().copied() != Some(end_ms)
        || boundaries.windows(2).any(|pair| pair[1] <= pair[0])
    {
        return Err("activity aggregate bucket boundaries are invalid".to_string());
    }
    Ok(())
}

pub async fn load_status<R: Runtime>(app: &AppHandle<R>) -> Result<ReadModelStatusDto, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let row = sqlx::query(
        "SELECT
            (SELECT source_revision FROM read_model_revision WHERE id = 1) source_revision,
            (SELECT state FROM read_model_state WHERE model_name = 'app_catalog') app_catalog_state,
            (SELECT state FROM read_model_state WHERE model_name = 'activity_hourly') activity_hourly_state,
            (SELECT coverage_start_ms FROM read_model_state WHERE model_name = 'activity_hourly') activity_coverage_start_ms,
            (SELECT coverage_end_ms FROM read_model_state WHERE model_name = 'activity_hourly') activity_coverage_end_ms,
            (SELECT COUNT(*) FROM app_catalog_dirty_keys) dirty_app_count,
            (SELECT COUNT(*) FROM activity_summary_dirty_ranges) dirty_range_count",
    )
    .fetch_one(&pool)
    .await
    .map_err(|error| format!("failed to read activity model status: {error}"))?;
    Ok(ReadModelStatusDto {
        source_revision: row.get("source_revision"),
        app_catalog_state: row.get("app_catalog_state"),
        activity_hourly_state: row.get("activity_hourly_state"),
        activity_coverage_start_ms: row.get("activity_coverage_start_ms"),
        activity_coverage_end_ms: row.get("activity_coverage_end_ms"),
        dirty_app_count: row.get("dirty_app_count"),
        dirty_range_count: row.get("dirty_range_count"),
    })
}

pub async fn invalidate_all(pool: &Pool<Sqlite>, reason: &'static str) -> Result<(), String> {
    let now_ms = now_ms();
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin read model invalidation: {error}"))?;
    sqlx::query(
        "UPDATE read_model_state
         SET state = 'invalid', coverage_start_ms = NULL, coverage_end_ms = NULL,
             backfill_cursor_ms = NULL, last_error_code = ?, updated_at_ms = ?",
    )
    .bind(reason)
    .bind(now_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to invalidate activity read models: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit read model invalidation: {error}"))
}

pub fn spawn_background_worker<R: Runtime + 'static>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let pool = wait_for_sqlite_pool(&app).await;
            let result = match pool {
                Ok(pool) => {
                    let result = maintain_once(&pool).await;
                    if result.is_err() {
                        let _ = record_maintenance_failure(&pool).await;
                    }
                    result
                }
                Err(error) => Err(error),
            };
            match result {
                Ok(did_work) => {
                    sleep(if did_work {
                        WORKER_ACTIVE_DELAY
                    } else {
                        WORKER_IDLE_DELAY
                    })
                    .await;
                }
                Err(error) => {
                    eprintln!("[read-model] background maintenance failed: {error}");
                    sleep(WORKER_IDLE_DELAY).await;
                }
            }
        }
    });
}

async fn record_maintenance_failure(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        "UPDATE read_model_state
         SET state = CASE WHEN state = 'building' THEN 'failed' ELSE state END,
             last_error_code = 'maintenance_failed', updated_at_ms = ?",
    )
    .bind(now_ms())
    .execute(pool)
    .await
    .map(|_| ())
    .map_err(|error| format!("failed to record read model maintenance failure: {error}"))
}

pub(crate) async fn maintain_once(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if catalog::maintain_once(pool).await? {
        return Ok(true);
    }
    if hourly::maintain_once(pool).await? {
        return Ok(true);
    }
    if let Err(error) = optimize_query_statistics(pool).await {
        eprintln!("[sql] query statistics optimization deferred: {error}");
    }
    Ok(false)
}

pub(crate) fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::activity_read_model::HOUR_MS;

    #[tokio::test]
    async fn idle_statistics_follow_empty_install_and_growth_without_invalidating_read_models() {
        use sqlx::Executor;
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        crate::data::sqlite_pool::prepare_pool_schema(
            &pool,
            std::path::Path::new("statistics-lifecycle.db"),
        )
        .await
        .unwrap();
        let empty_samples: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_stat4 WHERE idx='idx_sessions_end_start'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(empty_samples, 0);
        for (offset, count) in [(0, 1000), (1000, 20000)] {
            sqlx::query(
                "WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i+1<?)
                INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration)
                SELECT 'Editor','editor.exe',(i+?)*1000,(i+?)*1000+500,500 FROM n",
            )
            .bind(count)
            .bind(offset)
            .bind(offset)
            .execute(&pool)
            .await
            .unwrap();
            let mut idle = false;
            for _ in 0..1000 {
                if !maintain_once(&pool).await.unwrap() {
                    idle = true;
                    break;
                }
            }
            assert!(idle);
            for index in ["idx_sessions_date", "idx_sessions_end_start"] {
                let samples: i64 =
                    sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_stat4 WHERE idx=?")
                        .bind(index)
                        .fetch_one(&pool)
                        .await
                        .unwrap();
                assert!(
                    samples > 0,
                    "missing histogram after {count} rows for {index}"
                );
            }
            let stat: String = sqlx::query_scalar(
                "SELECT stat FROM sqlite_stat1 WHERE idx='idx_sessions_end_start'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                stat.split_whitespace()
                    .next()
                    .unwrap()
                    .parse::<i64>()
                    .unwrap(),
                offset + count
            );
        }
        let changes: i64 = sqlx::query_scalar("SELECT total_changes()")
            .fetch_one(&pool)
            .await
            .unwrap();
        crate::data::repositories::scheduled_backup::load_config(&pool)
            .await
            .unwrap();
        crate::data::repositories::scheduled_export::load_config(&pool)
            .await
            .unwrap();
        for _ in 0..3 {
            let debug_sql = format!(
                "PRAGMA optimize({})",
                crate::data::sqlite_pool::QUERY_STATISTICS_OPTIMIZE_MASK | 1
            );
            let pending: Vec<String> = sqlx::query_scalar(&debug_sql)
                .fetch_all(&pool)
                .await
                .unwrap();
            assert!(
                pending.is_empty(),
                "unchanged closed history must not request repeated ANALYZE: {pending:?}"
            );
            assert!(!maintain_once(&pool).await.unwrap());
        }
        assert!(!maintain_once(&pool).await.unwrap());
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT total_changes()")
                .fetch_one(&pool)
                .await
                .unwrap(),
            changes
        );
        let before: Vec<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT model_name,state,last_error_code FROM read_model_state ORDER BY model_name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        pool.execute("DELETE FROM sqlite_stat1; DELETE FROM sqlite_stat4; ANALYZE sqlite_schema; PRAGMA query_only=ON").await.unwrap();
        assert!(optimize_query_statistics(&pool)
            .await
            .unwrap_err()
            .contains("readonly"));
        assert!(
            !maintain_once(&pool).await.unwrap(),
            "optimization failure is not a read-model failure"
        );
        let after: Vec<(String, String, Option<String>)> = sqlx::query_as(
            "SELECT model_name,state,last_error_code FROM read_model_state ORDER BY model_name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(after, before);
        pool.close().await;
    }

    #[test]
    fn page_shaped_boundaries_reduce_records_without_changing_duration() {
        let records = vec![
            ActivityAggregateRecordDto {
                app_name: "Code".into(),
                anonymous: false,
                exe_name: "code.exe".into(),
                start_time: 0,
                end_time: 10,
            },
            ActivityAggregateRecordDto {
                app_name: "Code".into(),
                anonymous: false,
                exe_name: "code.exe".into(),
                start_time: 20,
                end_time: 40,
            },
        ];
        let result = aggregate_records_into_boundaries(records, 0, 100, &[0, 50, 100]).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].end_time - result[0].start_time, 30);
    }

    #[test]
    fn page_shaped_boundaries_preserve_overlapping_duration_without_crossing_the_bucket() {
        let records = vec![
            ActivityAggregateRecordDto {
                app_name: "App".into(),
                anonymous: false,
                exe_name: "app.exe".into(),
                start_time: 0,
                end_time: HOUR_MS,
            },
            ActivityAggregateRecordDto {
                app_name: "App".into(),
                anonymous: false,
                exe_name: "app.exe".into(),
                start_time: 0,
                end_time: HOUR_MS,
            },
        ];
        let shaped = aggregate_records_into_boundaries(records, 0, HOUR_MS, &[0, HOUR_MS]).unwrap();
        assert_eq!(shaped.len(), 2);
        assert!(shaped.iter().all(|record| record.end_time <= HOUR_MS));
        assert_eq!(
            shaped
                .iter()
                .map(|record| record.end_time - record.start_time)
                .sum::<i64>(),
            HOUR_MS * 2
        );
    }

    #[test]
    fn invalid_page_boundaries_fail_closed() {
        assert!(aggregate_records_into_boundaries(Vec::new(), 0, 10, &[0, 5, 5, 10]).is_err());
    }

    #[test]
    fn page_shaping_clips_straddling_records_and_ignores_outside_or_empty_intervals() {
        let records =
            [(-20, 100), (10, 50), (100, 120), (40, 40), (60, 20)].map(|(start_time, end_time)| {
                ActivityAggregateRecordDto {
                    app_name: "Editor".into(),
                    anonymous: false,
                    exe_name: "editor.exe".into(),
                    start_time,
                    end_time,
                }
            });
        let result =
            aggregate_records_into_boundaries(records.into(), 0, 100, &[0, 10, 50, 100]).unwrap();
        let mut buckets = BTreeMap::<i64, i64>::new();
        for record in result {
            *buckets.entry(record.start_time).or_default() += record.end_time - record.start_time;
        }
        assert_eq!(
            buckets.into_iter().collect::<Vec<_>>(),
            [(0, 10), (10, 80), (50, 50)]
        );
    }
}
