use super::{now_ms, ActivityAggregateRangeDto, ActivityAggregateRecordDto};
use crate::domain::activity_read_model::{
    ceil_to_hour, floor_to_hour, normalize_app_key, resolve_activity_precedence,
    should_track_activity_fact, ActivityOrigin, OwnedActivityRange, HOUR_MS,
};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::BTreeMap;

const HOURLY_SCHEMA_VERSION: i64 = 1;
const HOURLY_ALGORITHM_VERSION: i64 = 3;
use crate::domain::activity_read_model::ANONYMOUS_ACTIVITY_KEY as ANONYMOUS_APP_KEY;
const HOURLY_FINGERPRINT: &str = "epoch-hour-v1";
const BACKFILL_BATCH_MS: i64 = 7 * 24 * HOUR_MS;
const DIRTY_REBUILD_BATCH_SIZE: i64 = 128;
// The schema permits at most one open session. Pin its partial index so a covering
// index cannot turn this bounded probe into a scan of the closed-session history.
const ACTIVE_SESSION_START_SQL: &str = "SELECT start_time
     FROM sessions INDEXED BY idx_sessions_single_active
     WHERE end_time IS NULL LIMIT 1";
const PROJECTION_RANGE_SQL: &str =
    "SELECT bucket_start_ms, bucket_end_ms, app_key, raw_exe_name, display_app_name,
            effective_duration_ms
     FROM activity_hourly_effective
     WHERE bucket_start_ms >= ? AND bucket_start_ms < ? AND bucket_end_ms > ?
     ORDER BY bucket_start_ms ASC, app_key ASC, origin ASC, source_id ASC";
const FACT_CANDIDATES_SQL: &str =
    "SELECT record_id, origin, app_name, exe_name, window_title, start_ms, end_ms, capacity_end_ms,
            source_id
     FROM (
       SELECT id record_id, 'native' origin, app_name, exe_name, window_title, start_time start_ms,
              COALESCE(end_time, ?) end_ms, NULL capacity_end_ms,
              'native' source_id, 0 origin_rank
       FROM sessions
       WHERE start_time < ? AND (end_time > ? OR (end_time IS NULL AND ? > ?))
         AND (? = 0 OR end_time IS NOT NULL)
       UNION ALL
       SELECT id, 'import_exact', app_name, exe_name, window_title, start_time, end_time, NULL,
              batch_id, 1
       FROM import_exact_sessions WHERE start_time < ? AND end_time > ?
       UNION ALL
       SELECT id, 'import_bucket', COALESCE(NULLIF(app_name, ''), exe_name), exe_name, '',
              bucket_start_time, bucket_start_time + duration,
              bucket_start_time + 3600000, batch_id, 2
       FROM import_time_buckets
       WHERE bucket_start_time < ? AND bucket_start_time + 3600000 > ?
     )
     ORDER BY start_ms ASC, origin_rank ASC, record_id ASC, end_ms ASC";

#[derive(Clone, Debug)]
struct CandidateValue {
    anonymous: bool,
    app_name: String,
    exe_name: String,
    source_id: String,
}

#[derive(Debug)]
struct HourlyAccumulator {
    raw_exe_name: String,
    display_app_name: String,
    duration_ms: i64,
    latest_start_ms: i64,
}

#[derive(Clone, Copy, Debug)]
struct Interval {
    start_ms: i64,
    end_ms: i64,
}

pub(super) async fn maintain_once(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let state = sqlx::query(
        "SELECT schema_version, algorithm_version, timezone_fingerprint, state,
                backfill_cursor_ms, coverage_end_ms
         FROM read_model_state WHERE model_name = 'activity_hourly'",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to inspect hourly activity state: {error}"))?;
    let compatible = state.get::<i64, _>("schema_version") == HOURLY_SCHEMA_VERSION
        && state.get::<i64, _>("algorithm_version") == HOURLY_ALGORITHM_VERSION
        && state.get::<String, _>("timezone_fingerprint") == HOURLY_FINGERPRINT;
    let state_name: String = state.get("state");
    if !compatible || matches!(state_name.as_str(), "invalid" | "failed") {
        initialize_backfill(pool).await?;
        return Ok(true);
    }
    if state_name == "building" {
        let cursor: Option<i64> = state.get("backfill_cursor_ms");
        let target_end: Option<i64> = state.get("coverage_end_ms");
        if let (Some(cursor), Some(target_end)) = (cursor, target_end) {
            if cursor < target_end {
                process_backfill_batch(pool, cursor, target_end).await?;
            } else {
                finish_backfill(pool).await?;
            }
        } else {
            finish_backfill(pool).await?;
        }
        return Ok(true);
    }

    let dirty_rows = sqlx::query(
        "SELECT id, start_ms, end_ms, generation
         FROM activity_summary_dirty_ranges
         ORDER BY generation ASC, start_ms ASC, id ASC LIMIT ?",
    )
    .bind(DIRTY_REBUILD_BATCH_SIZE)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to select dirty activity ranges: {error}"))?;
    if !dirty_rows.is_empty() {
        let dirty = dirty_rows
            .into_iter()
            .map(|row| DirtyWork {
                id: row.get("id"),
                start_ms: row.get("start_ms"),
                end_ms: row.get("end_ms"),
                generation: row.get("generation"),
            })
            .collect();
        process_dirty_ranges(pool, dirty).await?;
        return Ok(true);
    }
    Ok(false)
}

async fn initialize_backfill(pool: &Pool<Sqlite>) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin hourly backfill initialization: {error}"))?;
    let source_revision = current_revision(&mut tx).await?;
    let bounds = sqlx::query(
        "SELECT MIN(start_ms) start_ms, MAX(end_ms) end_ms
         FROM (
           SELECT start_time start_ms, end_time end_ms FROM sessions WHERE end_time IS NOT NULL
           UNION ALL
           SELECT start_time, end_time FROM anonymous_activity WHERE end_time IS NOT NULL
           UNION ALL
           SELECT start_time, end_time FROM import_exact_sessions
           UNION ALL
           SELECT bucket_start_time, bucket_start_time + 3600000 FROM import_time_buckets
         )",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| format!("failed to inspect hourly backfill bounds: {error}"))?;
    let start_ms = bounds.get::<Option<i64>, _>("start_ms").map(floor_to_hour);
    let end_ms = bounds.get::<Option<i64>, _>("end_ms").map(ceil_to_hour);
    let timestamp_ms = now_ms();
    sqlx::query("DELETE FROM activity_hourly_effective")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear hourly projection for rebuild: {error}"))?;
    sqlx::query(
        "UPDATE read_model_state
         SET schema_version = ?, algorithm_version = ?, timezone_fingerprint = ?,
             state = 'building', coverage_start_ms = ?, coverage_end_ms = ?,
             backfill_cursor_ms = ?, backfill_target_revision = ?,
             last_error_code = NULL, updated_at_ms = ?
         WHERE model_name = 'activity_hourly'",
    )
    .bind(HOURLY_SCHEMA_VERSION)
    .bind(HOURLY_ALGORITHM_VERSION)
    .bind(HOURLY_FINGERPRINT)
    .bind(start_ms)
    .bind(end_ms)
    .bind(start_ms)
    .bind(source_revision)
    .bind(timestamp_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to mark hourly projection building: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit hourly backfill initialization: {error}"))
}

async fn process_backfill_batch(
    pool: &Pool<Sqlite>,
    cursor_ms: i64,
    target_end_ms: i64,
) -> Result<(), String> {
    let batch_end_ms = (cursor_ms + BACKFILL_BATCH_MS).min(target_end_ms);
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin hourly backfill batch: {error}"))?;
    let source_revision = current_revision(&mut tx).await?;
    replace_projection_range(&mut tx, cursor_ms, batch_end_ms, source_revision).await?;
    sqlx::query(
        "UPDATE read_model_state
         SET backfill_cursor_ms = ?, updated_at_ms = ?
         WHERE model_name = 'activity_hourly' AND state = 'building' AND backfill_cursor_ms = ?",
    )
    .bind(batch_end_ms)
    .bind(now_ms())
    .bind(cursor_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to advance hourly backfill cursor: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit hourly backfill batch: {error}"))
}

async fn finish_backfill(pool: &Pool<Sqlite>) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin hourly backfill completion: {error}"))?;
    let source_revision = current_revision(&mut tx).await?;
    let target_revision = sqlx::query_scalar::<_, i64>(
        "SELECT backfill_target_revision FROM read_model_state
         WHERE model_name = 'activity_hourly'",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| format!("failed to read hourly backfill target revision: {error}"))?;
    sqlx::query("DELETE FROM activity_summary_dirty_ranges WHERE generation <= ?")
        .bind(target_revision)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear covered backfill dirty ranges: {error}"))?;
    sqlx::query(
        "UPDATE read_model_state
         SET state = 'ready', backfill_cursor_ms = NULL,
             last_success_revision = ?, last_error_code = NULL, updated_at_ms = ?
         WHERE model_name = 'activity_hourly' AND state = 'building'",
    )
    .bind(source_revision)
    .bind(now_ms())
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to mark hourly projection ready: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit hourly backfill completion: {error}"))
}

#[derive(Clone, Copy, Debug)]
struct DirtyWork {
    id: i64,
    start_ms: i64,
    end_ms: i64,
    generation: i64,
}

#[cfg(test)]
async fn process_dirty_batch(
    pool: &Pool<Sqlite>,
    dirty_id: i64,
    start_ms: i64,
    end_ms: i64,
    generation: i64,
) -> Result<(), String> {
    process_dirty_ranges(
        pool,
        vec![DirtyWork {
            id: dirty_id,
            start_ms,
            end_ms,
            generation,
        }],
    )
    .await
}

async fn process_dirty_ranges(
    pool: &Pool<Sqlite>,
    requested: Vec<DirtyWork>,
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin dirty activity rebuild: {error}"))?;
    let mut selected = Vec::with_capacity(requested.len());
    for dirty in requested {
        let current = sqlx::query(
            "SELECT start_ms, end_ms, generation
             FROM activity_summary_dirty_ranges WHERE id = ?",
        )
        .bind(dirty.id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| format!("failed to recheck dirty activity generation: {error}"))?;
        if current.is_some_and(|current| {
            current.get::<i64, _>("start_ms") == dirty.start_ms
                && current.get::<i64, _>("end_ms") == dirty.end_ms
                && current.get::<i64, _>("generation") == dirty.generation
        }) {
            selected.push(dirty);
        }
    }
    if selected.is_empty() {
        tx.rollback()
            .await
            .map_err(|error| format!("failed to close stale dirty rebuild: {error}"))?;
        return Ok(());
    }
    let source_revision = current_revision(&mut tx).await?;
    let coverage_start_ms = selected
        .iter()
        .map(|dirty| dirty.start_ms)
        .min()
        .unwrap_or(0);
    let mut coverage_end_ms = coverage_start_ms;
    let rebuild_intervals = selected
        .iter()
        .map(|dirty| {
            let batch_end_ms = (dirty.start_ms + BACKFILL_BATCH_MS).min(dirty.end_ms);
            coverage_end_ms = coverage_end_ms.max(batch_end_ms);
            Interval {
                start_ms: dirty.start_ms,
                end_ms: batch_end_ms,
            }
        })
        .collect::<Vec<_>>();
    for interval in merge_intervals(rebuild_intervals, coverage_start_ms, coverage_end_ms) {
        replace_projection_range(&mut tx, interval.start_ms, interval.end_ms, source_revision)
            .await?;
    }
    for dirty in selected {
        let batch_end_ms = (dirty.start_ms + BACKFILL_BATCH_MS).min(dirty.end_ms);
        if batch_end_ms == dirty.end_ms {
            sqlx::query(
                "DELETE FROM activity_summary_dirty_ranges WHERE id = ? AND generation = ?",
            )
            .bind(dirty.id)
            .bind(dirty.generation)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("failed to clear dirty activity generation: {error}"))?;
        } else {
            sqlx::query(
                "UPDATE activity_summary_dirty_ranges SET start_ms = ?
                 WHERE id = ? AND generation = ? AND start_ms = ?",
            )
            .bind(batch_end_ms)
            .bind(dirty.id)
            .bind(dirty.generation)
            .bind(dirty.start_ms)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("failed to advance dirty activity range: {error}"))?;
        }
    }
    sqlx::query(
        "UPDATE read_model_state
         SET coverage_start_ms = CASE
               WHEN coverage_start_ms IS NULL THEN ? ELSE MIN(coverage_start_ms, ?) END,
             coverage_end_ms = CASE
               WHEN coverage_end_ms IS NULL THEN ? ELSE MAX(coverage_end_ms, ?) END,
             last_success_revision = ?, updated_at_ms = ?
         WHERE model_name = 'activity_hourly' AND state = 'ready'",
    )
    .bind(coverage_start_ms)
    .bind(coverage_start_ms)
    .bind(coverage_end_ms)
    .bind(coverage_end_ms)
    .bind(source_revision)
    .bind(now_ms())
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to update hourly coverage after dirty rebuild: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit dirty activity rebuild: {error}"))
}

async fn replace_projection_range(
    tx: &mut Transaction<'_, Sqlite>,
    start_ms: i64,
    end_ms: i64,
    source_revision: i64,
) -> Result<(), String> {
    let candidates = load_fact_candidates(tx, start_ms, end_ms, true).await?;
    let resolved = resolve_activity_precedence(&candidates);
    let mut rows: BTreeMap<(i64, String, ActivityOrigin, String), HourlyAccumulator> =
        BTreeMap::new();
    for range in resolved {
        let clipped_start = range.start_ms.max(start_ms);
        let clipped_end = range.end_ms.min(end_ms);
        if clipped_end <= clipped_start {
            continue;
        }
        let Some(app_key) = (if range.value.anonymous {
            Some(ANONYMOUS_APP_KEY.to_string())
        } else {
            normalize_app_key(&range.value.exe_name)
        }) else {
            continue;
        };
        let mut cursor_ms = clipped_start;
        while cursor_ms < clipped_end {
            let bucket_start_ms = floor_to_hour(cursor_ms);
            let bucket_end_ms = bucket_start_ms + HOUR_MS;
            let segment_end_ms = clipped_end.min(bucket_end_ms);
            let duration_ms = segment_end_ms - cursor_ms;
            if duration_ms > 0 {
                let key = (
                    bucket_start_ms,
                    app_key.clone(),
                    range.origin,
                    range.value.source_id.clone(),
                );
                let entry = rows.entry(key).or_insert_with(|| HourlyAccumulator {
                    raw_exe_name: range.value.exe_name.clone(),
                    display_app_name: range.value.app_name.trim().to_string(),
                    duration_ms: 0,
                    latest_start_ms: cursor_ms,
                });
                entry.duration_ms += duration_ms;
                if cursor_ms >= entry.latest_start_ms {
                    entry.raw_exe_name = range.value.exe_name.clone();
                    if !range.value.app_name.trim().is_empty() {
                        entry.display_app_name = range.value.app_name.trim().to_string();
                    }
                    entry.latest_start_ms = cursor_ms;
                }
            }
            cursor_ms = segment_end_ms;
        }
    }

    sqlx::query(
        "DELETE FROM activity_hourly_effective
         WHERE bucket_start_ms >= ? AND bucket_start_ms < ?",
    )
    .bind(start_ms)
    .bind(end_ms)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to clear hourly projection range: {error}"))?;
    let timestamp_ms = now_ms();
    for ((bucket_start_ms, app_key, origin, source_id), row) in rows {
        // Native facts remain additive when they overlap. Capacity rows preserve that total
        // without fabricating activity in the next hour or retaining every session identity.
        let mut remaining_ms = row.duration_ms;
        let mut capacity_index = 0;
        while remaining_ms > 0 {
            let duration_ms = remaining_ms.min(HOUR_MS);
            let row_source_id = if origin == ActivityOrigin::Native {
                format!("native:{capacity_index}")
            } else {
                source_id.clone()
            };
            sqlx::query(
                "INSERT INTO activity_hourly_effective(
                   bucket_start_ms, bucket_end_ms, app_key, raw_exe_name, display_app_name,
                   origin, source_id, effective_duration_ms, computed_revision, updated_at_ms
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(bucket_start_ms)
            .bind(bucket_start_ms + HOUR_MS)
            .bind(&app_key)
            // This derived table requires a nonempty key in its historical exe column.
            // The reserved key is never written into facts or returned as an executable.
            .bind(if app_key == ANONYMOUS_APP_KEY {
                ANONYMOUS_APP_KEY
            } else {
                &row.raw_exe_name
            })
            .bind(&row.display_app_name)
            .bind(origin.as_str())
            .bind(row_source_id)
            .bind(duration_ms)
            .bind(source_revision)
            .bind(timestamp_ms)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to insert hourly projection row: {error}"))?;
            remaining_ms -= duration_ms;
            capacity_index += 1;
        }
    }
    Ok(())
}

pub(super) async fn load_range(
    pool: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: &[i64],
) -> Result<ActivityAggregateRangeDto, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin activity aggregate read: {error}"))?;
    let state_result = sqlx::query(
        "SELECT state, schema_version, algorithm_version, timezone_fingerprint,
                coverage_start_ms, coverage_end_ms,
                (SELECT source_revision FROM read_model_revision WHERE id = 1) source_revision
         FROM read_model_state WHERE model_name = 'activity_hourly'",
    )
    .fetch_optional(&mut *tx)
    .await;
    let (ready, coverage_start, coverage_end, source_revision) = match state_result {
        Ok(Some(state)) => (
            state.get::<String, _>("state") == "ready"
                && state.get::<i64, _>("schema_version") == HOURLY_SCHEMA_VERSION
                && state.get::<i64, _>("algorithm_version") == HOURLY_ALGORITHM_VERSION
                && state.get::<String, _>("timezone_fingerprint") == HOURLY_FINGERPRINT,
            state.get::<Option<i64>, _>("coverage_start_ms"),
            state.get::<Option<i64>, _>("coverage_end_ms"),
            state.get::<i64, _>("source_revision"),
        ),
        Ok(None) | Err(_) => (false, None, None, 0),
    };
    let active_start = sqlx::query_scalar::<_, i64>(ACTIVE_SESSION_START_SQL)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| format!("failed to inspect active session overlay: {error}"))?
        .filter(|active_start| *active_start < end_ms);
    let anonymous_start = sqlx::query_scalar::<_, i64>(
        "SELECT start_time FROM anonymous_activity INDEXED BY idx_anonymous_activity_active WHERE end_time IS NULL LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| format!("failed to inspect anonymous overlay: {error}"))?
    .filter(|start| *start < end_ms);
    let active_start = active_start.into_iter().chain(anonymous_start).min();

    let mut fact_intervals = Vec::new();
    let mut outside_projection_coverage = false;
    if !ready {
        fact_intervals.push(Interval { start_ms, end_ms });
    } else {
        if start_ms.rem_euclid(HOUR_MS) != 0 {
            fact_intervals.push(Interval {
                start_ms,
                end_ms: end_ms.min(ceil_to_hour(start_ms)),
            });
        }
        if end_ms.rem_euclid(HOUR_MS) != 0 {
            fact_intervals.push(Interval {
                start_ms: start_ms.max(floor_to_hour(end_ms)),
                end_ms,
            });
        }
        for boundary_ms in bucket_boundaries_ms {
            if boundary_ms.rem_euclid(HOUR_MS) != 0 {
                fact_intervals.push(Interval {
                    start_ms: floor_to_hour(*boundary_ms),
                    end_ms: ceil_to_hour(*boundary_ms),
                });
            }
        }
        match (coverage_start, coverage_end) {
            (Some(coverage_start), Some(coverage_end)) => {
                if start_ms < coverage_start {
                    outside_projection_coverage = true;
                    fact_intervals.push(Interval {
                        start_ms,
                        end_ms: end_ms.min(coverage_start),
                    });
                }
                if end_ms > coverage_end {
                    outside_projection_coverage = true;
                    fact_intervals.push(Interval {
                        start_ms: start_ms.max(coverage_end),
                        end_ms,
                    });
                }
            }
            _ => {
                outside_projection_coverage = true;
                fact_intervals.push(Interval { start_ms, end_ms });
            }
        }
        let dirty_rows = sqlx::query(
            "SELECT start_ms, end_ms FROM activity_summary_dirty_ranges
             WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms ASC",
        )
        .bind(end_ms)
        .bind(start_ms)
        .fetch_all(&mut *tx)
        .await
        .map_err(|error| format!("failed to inspect dirty activity overlaps: {error}"))?;
        for dirty in dirty_rows {
            fact_intervals.push(Interval {
                start_ms: start_ms.max(dirty.get("start_ms")),
                end_ms: end_ms.min(dirty.get("end_ms")),
            });
        }
        if let Some(active_start) = active_start {
            let active_end = now_ms().min(end_ms);
            if active_end > start_ms.max(active_start) {
                fact_intervals.push(Interval {
                    start_ms: start_ms.max(floor_to_hour(active_start)),
                    end_ms: end_ms.min(ceil_to_hour(active_end)),
                });
            }
        }
    }
    let mut fact_intervals = merge_intervals(fact_intervals, start_ms, end_ms);

    let mut projection_unavailable = false;
    let projection_rows = if ready {
        match sqlx::query(PROJECTION_RANGE_SQL)
            .bind(floor_to_hour(start_ms))
            .bind(end_ms)
            .bind(start_ms)
            .fetch_all(&mut *tx)
            .await
        {
            Ok(rows) => rows,
            Err(error) => {
                projection_unavailable = true;
                fact_intervals = vec![Interval { start_ms, end_ms }];
                let _ = sqlx::query(
                    "UPDATE read_model_state
                     SET state = 'invalid', last_error_code = 'projection_read_failed',
                         updated_at_ms = ?
                     WHERE model_name = 'activity_hourly'",
                )
                .bind(now_ms())
                .execute(&mut *tx)
                .await;
                eprintln!("[read-model] hourly projection unavailable; using facts: {error}");
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };
    let mut records = Vec::new();
    let mut projection_row_count = 0;
    for row in projection_rows {
        let bucket_start_ms: i64 = row.get("bucket_start_ms");
        let bucket_end_ms: i64 = row.get("bucket_end_ms");
        if overlaps_any(&fact_intervals, bucket_start_ms, bucket_end_ms) {
            continue;
        }
        let duration_ms: i64 = row.get("effective_duration_ms");
        records.push(ActivityAggregateRecordDto {
            anonymous: row.get::<String, _>("app_key") == ANONYMOUS_APP_KEY,
            app_name: row.get("display_app_name"),
            exe_name: if row.get::<String, _>("app_key") == ANONYMOUS_APP_KEY {
                String::new()
            } else {
                row.get("raw_exe_name")
            },
            start_time: bucket_start_ms,
            end_time: bucket_start_ms + duration_ms,
        });
        projection_row_count += 1;
    }

    let mut fact_row_count = 0;
    for interval in &fact_intervals {
        let candidates =
            load_fact_candidates(&mut tx, interval.start_ms, interval.end_ms, false).await?;
        for range in resolve_activity_precedence(&candidates) {
            let clipped_start = range.start_ms.max(interval.start_ms);
            let clipped_end = range.end_ms.min(interval.end_ms);
            if clipped_end <= clipped_start {
                continue;
            }
            records.push(ActivityAggregateRecordDto {
                anonymous: range.value.anonymous,
                app_name: range.value.app_name,
                exe_name: range.value.exe_name,
                start_time: clipped_start,
                end_time: clipped_end,
            });
            fact_row_count += 1;
        }
    }
    records.sort_by(|left, right| {
        left.start_time
            .cmp(&right.start_time)
            .then_with(|| left.exe_name.cmp(&right.exe_name))
            .then_with(|| left.end_time.cmp(&right.end_time))
    });
    tx.commit()
        .await
        .map_err(|error| format!("failed to finish activity aggregate read: {error}"))?;

    let fallback_reason = if fact_intervals.is_empty() {
        None
    } else if projection_unavailable {
        Some("projection_unavailable")
    } else if !ready {
        Some("model_not_ready")
    } else if outside_projection_coverage {
        Some("outside_projection_coverage")
    } else {
        Some("partial_dirty_or_active")
    };
    Ok(ActivityAggregateRangeDto {
        records,
        read_path: if fact_intervals.is_empty() {
            "projection"
        } else if projection_row_count == 0 {
            "facts"
        } else {
            "hybrid"
        },
        fallback_reason,
        source_revision,
        projection_row_count,
        fact_row_count,
        has_active_session: active_start.is_some(),
    })
}

async fn load_fact_candidates(
    tx: &mut Transaction<'_, Sqlite>,
    start_ms: i64,
    end_ms: i64,
    closed_only: bool,
) -> Result<Vec<OwnedActivityRange<CandidateValue>>, String> {
    // Import buckets allocate the hour's remaining capacity. A partial query must include
    // native/exact facts elsewhere in that hour before clipping the resolved geometry.
    let start_ms = floor_to_hour(start_ms);
    let end_ms = ceil_to_hour(end_ms);
    let current_ms = now_ms();
    let rows = sqlx::query(FACT_CANDIDATES_SQL)
        .bind(current_ms)
        .bind(end_ms)
        .bind(start_ms)
        .bind(current_ms)
        .bind(start_ms)
        .bind(i64::from(closed_only))
        .bind(end_ms)
        .bind(start_ms)
        .bind(end_ms)
        .bind(start_ms)
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to load activity facts for projection: {error}"))?;
    let mut candidates = Vec::with_capacity(rows.len());
    for row in rows {
        let app_name: String = row.get("app_name");
        let exe_name: String = row.get("exe_name");
        let window_title: String = row.get("window_title");
        if !should_track_activity_fact(&exe_name, &app_name, &window_title) {
            continue;
        }
        let origin = match row.get::<String, _>("origin").as_str() {
            "native" => ActivityOrigin::Native,
            "import_exact" => ActivityOrigin::ImportExact,
            "import_bucket" => ActivityOrigin::ImportBucket,
            value => return Err(format!("unknown activity fact origin `{value}`")),
        };
        candidates.push(OwnedActivityRange {
            origin,
            start_ms: row.get("start_ms"),
            end_ms: row.get("end_ms"),
            capacity_end_ms: row.get("capacity_end_ms"),
            value: CandidateValue {
                anonymous: false,
                app_name,
                exe_name,
                source_id: row.get("source_id"),
            },
        });
    }
    for row in sqlx::query(
        "SELECT start_time, COALESCE(end_time, observed_until) end_time
        FROM anonymous_activity WHERE start_time < ? AND COALESCE(end_time, observed_until) > ?
        AND (? = 0 OR end_time IS NOT NULL)",
    )
    .bind(end_ms)
    .bind(start_ms)
    .bind(i64::from(closed_only))
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| format!("failed to read anonymous facts: {error}"))?
    {
        candidates.push(OwnedActivityRange {
            origin: ActivityOrigin::Native,
            start_ms: row.get("start_time"),
            end_ms: row.get("end_time"),
            capacity_end_ms: None,
            value: CandidateValue {
                anonymous: true,
                app_name: String::new(),
                exe_name: String::new(),
                source_id: "native".into(),
            },
        });
    }
    Ok(candidates)
}

fn merge_intervals(mut intervals: Vec<Interval>, start_ms: i64, end_ms: i64) -> Vec<Interval> {
    for interval in &mut intervals {
        interval.start_ms = interval.start_ms.max(start_ms);
        interval.end_ms = interval.end_ms.min(end_ms);
    }
    intervals.retain(|interval| interval.end_ms > interval.start_ms);
    intervals.sort_by_key(|interval| (interval.start_ms, interval.end_ms));
    let mut merged: Vec<Interval> = Vec::new();
    for interval in intervals {
        if let Some(previous) = merged.last_mut() {
            if interval.start_ms <= previous.end_ms {
                previous.end_ms = previous.end_ms.max(interval.end_ms);
                continue;
            }
        }
        merged.push(interval);
    }
    merged
}

fn overlaps_any(intervals: &[Interval], start_ms: i64, end_ms: i64) -> bool {
    intervals
        .iter()
        .any(|interval| interval.start_ms < end_ms && interval.end_ms > start_ms)
}

async fn current_revision(tx: &mut Transaction<'_, Sqlite>) -> Result<i64, String> {
    sqlx::query_scalar("SELECT source_revision FROM read_model_revision WHERE id = 1")
        .fetch_one(&mut **tx)
        .await
        .map_err(|error| format!("failed to read source revision: {error}"))
}

#[cfg(test)]
#[path = "hourly_contract_tests.rs"]
mod contract_tests;

#[cfg(test)]
#[path = "hourly_recovery_tests.rs"]
mod recovery_tests;

#[cfg(test)]
#[path = "hourly_benchmark.rs"]
mod benchmark;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema::{
        ACTIVITY_READ_MODELS_SCHEMA_SQL, CURRENT_BASELINE_SCHEMA_SQL,
        IMPORT_DATA_ISOLATION_SCHEMA_SQL, IMPORT_DATA_SCHEMA_SQL,
    };
    use sqlx::{Executor, SqlitePool};

    async fn setup_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
        pool.execute(IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool.execute(IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(ACTIVITY_READ_MODELS_SCHEMA_SQL).await.unwrap();
        pool.execute(crate::data::repositories::anonymous_activity::SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn migration_triggers_mark_fact_changes_in_the_same_transaction() {
        let pool = setup_pool().await;
        let mut tx = pool.begin().await.unwrap();
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Code', 'Code.EXE', 10, 20, 10)",
        )
        .execute(&mut *tx)
        .await
        .unwrap();
        let revision: i64 =
            sqlx::query_scalar("SELECT source_revision FROM read_model_revision WHERE id = 1")
                .fetch_one(&mut *tx)
                .await
                .unwrap();
        assert_eq!(revision, 1);
        tx.rollback().await.unwrap();
        let revision: i64 =
            sqlx::query_scalar("SELECT source_revision FROM read_model_revision WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(revision, 0);
        let dirty_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(dirty_count, 0);
    }

    #[tokio::test]
    async fn migration_triggers_floor_negative_epoch_ranges_correctly() {
        let pool = setup_pool().await;
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Archive', 'archive.exe', -1000, -1, 999)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let native_range = sqlx::query(
            "SELECT start_ms, end_ms FROM activity_summary_dirty_ranges
             WHERE reason = 'native_insert'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(native_range.get::<i64, _>("start_ms"), -HOUR_MS);
        assert_eq!(native_range.get::<i64, _>("end_ms"), 0);

        sqlx::query(
            "INSERT INTO import_batches(id, imported_at, source_name, source_kind,
               source_fingerprint, exact_session_count, hour_bucket_count)
             VALUES ('negative', 1, 'fixture', 'csv', 'negative', 0, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
               bucket_start_time, duration)
             VALUES ('negative', 'bucket', 'Archive', 'archive.exe', -1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let bucket_range = sqlx::query(
            "SELECT start_ms, end_ms FROM activity_summary_dirty_ranges
             WHERE reason = 'import_bucket_insert'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(bucket_range.get::<i64, _>("start_ms"), -HOUR_MS);
        assert_eq!(bucket_range.get::<i64, _>("end_ms"), 0);
    }

    #[tokio::test]
    async fn stale_worker_generation_never_clears_a_newer_dirty_signal() {
        let pool = setup_pool().await;
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Code', 'code.exe', 0, 1000, 1000)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "UPDATE read_model_state SET state = 'ready', algorithm_version = 3, coverage_start_ms = 0,
                    coverage_end_ms = 3600000 WHERE model_name = 'activity_hourly'",
        )
        .execute(&pool)
        .await
        .unwrap();
        let dirty = sqlx::query(
            "SELECT id, start_ms, end_ms, generation
             FROM activity_summary_dirty_ranges LIMIT 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let dirty_id: i64 = dirty.get("id");
        let old_generation: i64 = dirty.get("generation");
        sqlx::query(
            "UPDATE activity_summary_dirty_ranges SET generation = generation + 1 WHERE id = ?",
        )
        .bind(dirty_id)
        .execute(&pool)
        .await
        .unwrap();

        process_dirty_batch(
            &pool,
            dirty_id,
            dirty.get("start_ms"),
            dirty.get("end_ms"),
            old_generation,
        )
        .await
        .unwrap();

        let surviving_generation: i64 =
            sqlx::query_scalar("SELECT generation FROM activity_summary_dirty_ranges WHERE id = ?")
                .bind(dirty_id)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(surviving_generation, old_generation + 1);
    }

    #[tokio::test]
    async fn dirty_rebuild_drains_a_bounded_bulk_write_batch_per_worker_turn() {
        let pool = setup_pool().await;
        for index in 0..200 {
            sqlx::query(
                "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
                 VALUES (?, ?, ?, ?, 1000)",
            )
            .bind(format!("App {index}"))
            .bind(format!("app-{index}.exe"))
            .bind(index * 1000)
            .bind(index * 1000 + 1000)
            .execute(&pool)
            .await
            .unwrap();
        }
        sqlx::query(
            "UPDATE read_model_state SET state = 'ready', algorithm_version = 3, coverage_start_ms = 0,
                    coverage_end_ms = 3600000 WHERE model_name = 'activity_hourly'",
        )
        .execute(&pool)
        .await
        .unwrap();

        maintain_once(&pool).await.unwrap();
        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(remaining, 200 - DIRTY_REBUILD_BATCH_SIZE);

        maintain_once(&pool).await.unwrap();
        let remaining: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(remaining, 0);
    }

    #[tokio::test]
    async fn rebuild_matches_global_native_exact_and_bucket_precedence() {
        let pool = setup_pool().await;
        sqlx::query(
            "INSERT INTO import_batches(id, imported_at, source_name, source_kind,
               source_fingerprint, exact_session_count, hour_bucket_count)
             VALUES ('batch', 1, 'fixture', 'csv', 'fixture', 1, 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_exact_sessions(batch_id, fingerprint, app_name, exe_name,
               start_time, end_time, duration)
             VALUES ('batch', 'exact', 'Exact App', 'exact.exe', 0, 3600000, 3600000)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
               bucket_start_time, duration)
             VALUES ('batch', 'bucket', 'Bucket App', 'bucket.exe', 0, 3600000)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Native App', 'native.exe', 900000, 1800000, 900000)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let facts = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
        assert_eq!(facts.read_path, "facts");
        initialize_backfill(&pool).await.unwrap();
        process_backfill_batch(&pool, 0, 3600000).await.unwrap();
        finish_backfill(&pool).await.unwrap();

        let total: i64 =
            sqlx::query_scalar("SELECT SUM(effective_duration_ms) FROM activity_hourly_effective")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(total, 3600000);
        let native: i64 = sqlx::query_scalar(
            "SELECT SUM(effective_duration_ms) FROM activity_hourly_effective WHERE origin = 'native'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(native, 900000);
        let exact: i64 = sqlx::query_scalar(
            "SELECT SUM(effective_duration_ms) FROM activity_hourly_effective WHERE origin = 'import_exact'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(exact, 2700000);
        let bucket: Option<i64> = sqlx::query_scalar(
            "SELECT SUM(effective_duration_ms) FROM activity_hourly_effective WHERE origin = 'import_bucket'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(bucket, None);

        let projected = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
        assert_eq!(projected.read_path, "projection");
        assert_eq!(projected.fact_row_count, 0);
        for result in [&facts, &projected] {
            let mut by_app = BTreeMap::<&str, i64>::new();
            for record in &result.records {
                *by_app.entry(&record.exe_name).or_default() += record.end_time - record.start_time;
            }
            assert_eq!(
                by_app,
                BTreeMap::from([("exact.exe", 2_700_000), ("native.exe", 900_000),])
            );
        }
        assert_eq!(
            projected
                .records
                .iter()
                .map(|row| row.end_time - row.start_time)
                .sum::<i64>(),
            HOUR_MS
        );

        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Later', 'later.exe', ?, ?, 1000)",
        )
        .bind(HOUR_MS * 2)
        .bind(HOUR_MS * 2 + 1000)
        .execute(&pool)
        .await
        .unwrap();
        let clean_earlier_range = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
        assert_eq!(clean_earlier_range.read_path, "projection");

        let current_ms = now_ms();
        let current_hour = floor_to_hour(current_ms);
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Active', 'active.exe', ?, NULL, NULL)",
        )
        .bind(current_ms - 1000)
        .execute(&pool)
        .await
        .unwrap();
        let active = load_range(&pool, current_hour, current_hour + HOUR_MS, &[])
            .await
            .unwrap();
        assert!(active.has_active_session);
        assert_eq!(active.read_path, "facts");
        assert!(active
            .records
            .iter()
            .any(|row| row.exe_name == "active.exe"));
    }

    #[tokio::test]
    async fn rebuild_excludes_legacy_lifecycle_facts_using_title_metadata() {
        let pool = setup_pool().await;
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration)
             VALUES ('Alma', 'alma-0.0.750-win-x64.exe', 'Alma 安装', 0, 1800000, 1800000),
                    ('Alma', 'alma.exe', 'Alma', 1800000, 3600000, 1800000)",
        )
        .execute(&pool)
        .await
        .unwrap();

        initialize_backfill(&pool).await.unwrap();
        process_backfill_batch(&pool, 0, HOUR_MS).await.unwrap();
        finish_backfill(&pool).await.unwrap();

        let rows = sqlx::query(
            "SELECT raw_exe_name, effective_duration_ms FROM activity_hourly_effective
             ORDER BY raw_exe_name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get::<String, _>("raw_exe_name"), "alma.exe");
        assert_eq!(rows[0].get::<i64, _>("effective_duration_ms"), 1800000);
    }

    #[tokio::test]
    async fn non_hour_internal_boundaries_fall_back_to_exact_fact_geometry() {
        let pool = setup_pool().await;
        let start_ms = HOUR_MS + 40 * 60 * 1000;
        let end_ms = HOUR_MS + 50 * 60 * 1000;
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Archive', 'archive.exe', ?, ?, ?)",
        )
        .bind(start_ms)
        .bind(end_ms)
        .bind(end_ms - start_ms)
        .execute(&pool)
        .await
        .unwrap();
        initialize_backfill(&pool).await.unwrap();
        process_backfill_batch(&pool, HOUR_MS, HOUR_MS * 2)
            .await
            .unwrap();
        finish_backfill(&pool).await.unwrap();

        let boundary_ms = HOUR_MS + HOUR_MS / 2;
        let result = load_range(
            &pool,
            HOUR_MS,
            HOUR_MS * 2,
            &[HOUR_MS, boundary_ms, HOUR_MS * 2],
        )
        .await
        .unwrap();
        assert_eq!(result.read_path, "facts");
        assert_eq!(result.records.len(), 1);
        assert_eq!(result.records[0].start_time, start_ms);
        assert_eq!(result.records[0].end_time, end_ms);
    }
}
