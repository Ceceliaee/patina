use super::{
    now_ms, RecordedAppCatalogCursorDto, RecordedAppCatalogPageDto, RecordedAppCatalogRowDto,
};
use crate::domain::activity_read_model::{
    activity_fact_requires_metadata_check, normalize_app_key, should_track_activity_fact,
};
use sqlx::{sqlite::SqliteRow, Pool, Row, Sqlite, Transaction};

const CATALOG_PAGE_SQL: &str = "SELECT raw_exe_name, display_app_name app_name, last_seen_ms,
                has_native_records, has_import_exact_records, has_import_bucket_records
         FROM recorded_app_catalog
         WHERE (? = 0 OR LOWER(raw_exe_name) LIKE ? ESCAPE '\\'
                        OR LOWER(display_app_name) LIKE ? ESCAPE '\\')
           AND (? = 0 OR last_seen_ms < ? OR (last_seen_ms = ? AND raw_exe_name > ?))
         ORDER BY last_seen_ms DESC, raw_exe_name ASC LIMIT ?";

const CATALOG_SCHEMA_VERSION: i64 = 1;
const CATALOG_ALGORITHM_VERSION: i64 = 1;
const CATALOG_FINGERPRINT: &str = "executable-v1";
const DIRTY_KEY_BATCH_SIZE: i64 = 64;

struct CatalogFact {
    raw_exe_name: String,
    app_name: String,
    last_seen_ms: i64,
    origin_rank: i64,
}

struct CatalogProjection {
    raw_exe_name: String,
    display_app_name: String,
    last_seen_ms: i64,
    has_native: bool,
    has_exact: bool,
    has_bucket: bool,
}

const NORMALIZED_KEY_SQL: &str = "CASE WHEN LOWER(TRIM(exe_name, ' \"')) LIKE '%.exe'
          THEN LOWER(TRIM(exe_name, ' \"'))
          ELSE LOWER(TRIM(exe_name, ' \"')) || '.exe' END";

pub(super) async fn maintain_once(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let state = sqlx::query(
        "SELECT schema_version, algorithm_version, timezone_fingerprint, state
         FROM read_model_state WHERE model_name = 'app_catalog'",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to inspect app catalog state: {error}"))?;
    let compatible = state.get::<i64, _>("schema_version") == CATALOG_SCHEMA_VERSION
        && state.get::<i64, _>("algorithm_version") == CATALOG_ALGORITHM_VERSION
        && state.get::<String, _>("timezone_fingerprint") == CATALOG_FINGERPRINT;
    let state_name: String = state.get("state");
    if !compatible || matches!(state_name.as_str(), "invalid" | "failed" | "building") {
        rebuild(pool).await?;
        return Ok(true);
    }

    let keys = sqlx::query(
        "SELECT app_key, generation
         FROM app_catalog_dirty_keys
         ORDER BY generation ASC, app_key ASC
         LIMIT ?",
    )
    .bind(DIRTY_KEY_BATCH_SIZE)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to select dirty app catalog keys: {error}"))?;
    if keys.is_empty() {
        return Ok(false);
    }

    for row in keys {
        let app_key: String = row.get("app_key");
        let generation: i64 = row.get("generation");
        rebuild_key(pool, &app_key, generation).await?;
    }
    Ok(true)
}

async fn rebuild(pool: &Pool<Sqlite>) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin app catalog rebuild: {error}"))?;
    let source_revision = current_revision(&mut tx).await?;
    let timestamp_ms = now_ms();
    sqlx::query(
        "UPDATE read_model_state
         SET schema_version = ?, algorithm_version = ?, timezone_fingerprint = ?,
             state = 'building', backfill_target_revision = ?, last_error_code = NULL,
             updated_at_ms = ?
         WHERE model_name = 'app_catalog'",
    )
    .bind(CATALOG_SCHEMA_VERSION)
    .bind(CATALOG_ALGORITHM_VERSION)
    .bind(CATALOG_FINGERPRINT)
    .bind(source_revision)
    .bind(timestamp_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to mark app catalog building: {error}"))?;
    sqlx::query("DELETE FROM recorded_app_catalog")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear app catalog projection: {error}"))?;

    let rebuild_sql = format!(
        "WITH facts AS (
           SELECT {NORMALIZED_KEY_SQL} app_key, exe_name raw_exe_name, app_name,
                  start_time last_seen_ms, 0 origin_rank, 1 has_native, 0 has_exact, 0 has_bucket, id record_id
           FROM sessions WHERE TRIM(exe_name) <> ''
           UNION ALL
           SELECT {NORMALIZED_KEY_SQL} app_key, exe_name, app_name,
                  start_time, 1, 0, 1, 0, id
           FROM import_exact_sessions WHERE TRIM(exe_name) <> ''
           UNION ALL
           SELECT {NORMALIZED_KEY_SQL} app_key, exe_name, app_name,
                  bucket_start_time, 2, 0, 0, 1, id
           FROM import_time_buckets WHERE TRIM(exe_name) <> ''
         ), grouped AS (
           SELECT app_key, MAX(last_seen_ms) last_seen_ms,
                  MAX(has_native) has_native, MAX(has_exact) has_exact, MAX(has_bucket) has_bucket
           FROM facts WHERE app_key <> '.exe' GROUP BY app_key
         )
         INSERT INTO recorded_app_catalog(
           app_key, raw_exe_name, display_app_name, last_seen_ms,
           has_native_records, has_import_exact_records, has_import_bucket_records,
           computed_revision, updated_at_ms
         )
         SELECT grouped.app_key,
                (SELECT raw_exe_name FROM facts raw
                 WHERE raw.app_key = grouped.app_key
                 ORDER BY raw.last_seen_ms DESC, raw.origin_rank ASC, raw.record_id DESC LIMIT 1),
                COALESCE((SELECT TRIM(app_name) FROM facts named
                 WHERE named.app_key = grouped.app_key AND TRIM(COALESCE(app_name, '')) <> ''
                 ORDER BY named.origin_rank ASC, named.last_seen_ms DESC, named.record_id DESC LIMIT 1), ''),
                grouped.last_seen_ms, grouped.has_native, grouped.has_exact, grouped.has_bucket, ?, ?
         FROM grouped"
    );
    sqlx::query(&rebuild_sql)
        .bind(source_revision)
        .bind(timestamp_ms)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to rebuild app catalog projection: {error}"))?;
    prune_untrackable_catalog_rows(&mut tx).await?;
    sqlx::query("DELETE FROM app_catalog_dirty_keys WHERE generation <= ?")
        .bind(source_revision)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear rebuilt app catalog keys: {error}"))?;
    sqlx::query(
        "UPDATE read_model_state
         SET state = 'ready', coverage_start_ms = NULL, coverage_end_ms = NULL,
             backfill_cursor_ms = NULL, last_success_revision = ?, updated_at_ms = ?
         WHERE model_name = 'app_catalog'",
    )
    .bind(source_revision)
    .bind(timestamp_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to mark app catalog ready: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit app catalog rebuild: {error}"))
}

async fn rebuild_key(pool: &Pool<Sqlite>, app_key: &str, generation: i64) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin app catalog key rebuild: {error}"))?;
    let current_generation = sqlx::query_scalar::<_, Option<i64>>(
        "SELECT generation FROM app_catalog_dirty_keys WHERE app_key = ?",
    )
    .bind(app_key)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| format!("failed to inspect app catalog key generation: {error}"))?;
    if current_generation != Some(generation) {
        tx.rollback()
            .await
            .map_err(|error| format!("failed to close stale app catalog rebuild: {error}"))?;
        return Ok(());
    }
    let source_revision = current_revision(&mut tx).await?;
    let timestamp_ms = now_ms();
    let facts = load_trackable_catalog_facts(&mut tx, app_key).await?;
    if let Some(projection) = summarize_catalog_facts(&facts) {
        sqlx::query(
            "INSERT INTO recorded_app_catalog(
               app_key, raw_exe_name, display_app_name, last_seen_ms,
               has_native_records, has_import_exact_records, has_import_bucket_records,
               computed_revision, updated_at_ms
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(app_key) DO UPDATE SET
               raw_exe_name = excluded.raw_exe_name,
               display_app_name = excluded.display_app_name,
               last_seen_ms = excluded.last_seen_ms,
               has_native_records = excluded.has_native_records,
               has_import_exact_records = excluded.has_import_exact_records,
               has_import_bucket_records = excluded.has_import_bucket_records,
               computed_revision = excluded.computed_revision,
               updated_at_ms = excluded.updated_at_ms",
        )
        .bind(app_key)
        .bind(projection.raw_exe_name)
        .bind(projection.display_app_name)
        .bind(projection.last_seen_ms)
        .bind(projection.has_native)
        .bind(projection.has_exact)
        .bind(projection.has_bucket)
        .bind(source_revision)
        .bind(timestamp_ms)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to write app catalog key: {error}"))?;
    } else {
        sqlx::query("DELETE FROM recorded_app_catalog WHERE app_key = ?")
            .bind(app_key)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("failed to delete orphaned app catalog key: {error}"))?;
    }
    sqlx::query("DELETE FROM app_catalog_dirty_keys WHERE app_key = ? AND generation = ?")
        .bind(app_key)
        .bind(generation)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear app catalog key generation: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit app catalog key rebuild: {error}"))
}

fn catalog_facts_sql() -> String {
    format!(
        "SELECT raw_exe_name, app_name, window_title, last_seen_ms, origin_rank, record_id
         FROM (
           SELECT exe_name raw_exe_name, app_name, window_title, start_time last_seen_ms, 0 origin_rank, id record_id,
                  {NORMALIZED_KEY_SQL} app_key FROM sessions
           UNION ALL
           SELECT exe_name, app_name, window_title, start_time, 1, id, {NORMALIZED_KEY_SQL} FROM import_exact_sessions
           UNION ALL
           SELECT exe_name, app_name, '', bucket_start_time, 2, id, {NORMALIZED_KEY_SQL} FROM import_time_buckets
         ) WHERE app_key = ?
         ORDER BY last_seen_ms DESC, origin_rank ASC, record_id DESC"
    )
}

async fn load_trackable_catalog_facts(
    tx: &mut Transaction<'_, Sqlite>,
    app_key: &str,
) -> Result<Vec<CatalogFact>, String> {
    let rows = sqlx::query(&catalog_facts_sql())
        .bind(app_key)
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to load facts for app catalog key: {error}"))?;
    Ok(map_trackable_catalog_rows(rows))
}

async fn load_trackable_catalog_facts_from_pool(
    pool: &Pool<Sqlite>,
    app_key: &str,
) -> Result<Vec<CatalogFact>, String> {
    let rows = sqlx::query(&catalog_facts_sql())
        .bind(app_key)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to load fallback facts for app catalog key: {error}"))?;
    Ok(map_trackable_catalog_rows(rows))
}

fn map_trackable_catalog_rows(rows: Vec<SqliteRow>) -> Vec<CatalogFact> {
    rows.into_iter()
        .filter_map(|row| {
            let raw_exe_name: String = row.get("raw_exe_name");
            let app_name: String = row.get("app_name");
            let window_title: String = row.get("window_title");
            should_track_activity_fact(&raw_exe_name, &app_name, &window_title).then_some(
                CatalogFact {
                    raw_exe_name,
                    app_name,
                    last_seen_ms: row.get("last_seen_ms"),
                    origin_rank: row.get("origin_rank"),
                },
            )
        })
        .collect()
}

fn summarize_catalog_facts(facts: &[CatalogFact]) -> Option<CatalogProjection> {
    let first = facts.first()?;
    let mut display_app_name = String::new();
    let mut display_rank = i64::MAX;
    let mut display_seen = i64::MIN;
    let mut has_native = false;
    let mut has_exact = false;
    let mut has_bucket = false;
    for fact in facts {
        has_native |= fact.origin_rank == 0;
        has_exact |= fact.origin_rank == 1;
        has_bucket |= fact.origin_rank == 2;
        if !fact.app_name.trim().is_empty()
            && (fact.origin_rank < display_rank
                || (fact.origin_rank == display_rank && fact.last_seen_ms > display_seen))
        {
            display_app_name = fact.app_name.trim().to_string();
            display_rank = fact.origin_rank;
            display_seen = fact.last_seen_ms;
        }
    }
    Some(CatalogProjection {
        raw_exe_name: first.raw_exe_name.clone(),
        display_app_name,
        last_seen_ms: first.last_seen_ms,
        has_native,
        has_exact,
        has_bucket,
    })
}

pub(super) async fn load_page(
    pool: &Pool<Sqlite>,
    cursor: Option<RecordedAppCatalogCursorDto>,
    search_query: String,
    limit: usize,
) -> Result<RecordedAppCatalogPageDto, String> {
    if let Err(error) = maintain_once(pool).await {
        eprintln!("[read-model] app catalog maintenance deferred to facts: {error}");
    }
    let safe_limit = limit.clamp(1, 500);
    let normalized_search = search_query.trim().to_ascii_lowercase();
    let search_pattern = format!("%{}%", escape_like_pattern(&normalized_search));
    let state_row = sqlx::query(
        "SELECT state, (SELECT source_revision FROM read_model_revision WHERE id = 1) source_revision,
                (SELECT COUNT(*) FROM app_catalog_dirty_keys) dirty_count
         FROM read_model_state WHERE model_name = 'app_catalog'",
    )
    .fetch_optional(pool)
    .await;
    let (ready, source_revision) = match state_row {
        Ok(Some(row)) => (
            row.get::<String, _>("state") == "ready" && row.get::<i64, _>("dirty_count") == 0,
            row.get("source_revision"),
        ),
        Ok(None) | Err(_) => (false, 0),
    };

    let facts_sql = format!(
        "WITH facts AS (
               SELECT {NORMALIZED_KEY_SQL} app_key, exe_name raw_exe_name, app_name,
                      start_time last_seen_ms, 0 origin_rank, 1 has_native, 0 has_exact, 0 has_bucket, id record_id
               FROM sessions WHERE TRIM(exe_name) <> ''
               UNION ALL
               SELECT {NORMALIZED_KEY_SQL}, exe_name, app_name, start_time, 1, 0, 1, 0, id
               FROM import_exact_sessions WHERE TRIM(exe_name) <> ''
               UNION ALL
               SELECT {NORMALIZED_KEY_SQL}, exe_name, app_name, bucket_start_time, 2, 0, 0, 1, id
               FROM import_time_buckets WHERE TRIM(exe_name) <> ''
             ), grouped AS (
               SELECT app_key, MAX(last_seen_ms) last_seen_ms, MAX(has_native) has_native_records,
                      MAX(has_exact) has_import_exact_records, MAX(has_bucket) has_import_bucket_records
               FROM facts WHERE app_key <> '.exe' GROUP BY app_key
             ), catalog AS (
               SELECT grouped.app_key,
                      (SELECT raw_exe_name FROM facts raw WHERE raw.app_key = grouped.app_key
                       ORDER BY raw.last_seen_ms DESC, raw.origin_rank ASC, raw.record_id DESC LIMIT 1) raw_exe_name,
                      COALESCE((SELECT TRIM(app_name) FROM facts named
                       WHERE named.app_key = grouped.app_key AND TRIM(COALESCE(app_name, '')) <> ''
                       ORDER BY named.origin_rank ASC, named.last_seen_ms DESC, named.record_id DESC LIMIT 1), '') app_name,
                      grouped.last_seen_ms, grouped.has_native_records,
                      grouped.has_import_exact_records, grouped.has_import_bucket_records
               FROM grouped
             )
             SELECT raw_exe_name, app_name, last_seen_ms, has_native_records,
                    has_import_exact_records, has_import_bucket_records
             FROM catalog
              WHERE (? = 0 OR LOWER(raw_exe_name) LIKE ? ESCAPE '\\' OR LOWER(app_name) LIKE ? ESCAPE '\\')
                AND (? = 0 OR last_seen_ms < ? OR (last_seen_ms = ? AND raw_exe_name > ?))
              ORDER BY last_seen_ms DESC, raw_exe_name ASC LIMIT ?"
    );
    let requested_sql = if ready { CATALOG_PAGE_SQL } else { &facts_sql };
    let requested_search = if ready {
        normalized_search.as_str()
    } else {
        ""
    };
    let requested_pattern = if ready { search_pattern.as_str() } else { "%%" };
    let rows_result = fetch_catalog_page_rows(
        pool,
        requested_sql,
        requested_search,
        requested_pattern,
        cursor.as_ref(),
        safe_limit,
    )
    .await;
    let (rows, read_path, fallback_reason) = match rows_result {
        Ok(rows) if ready => (rows, "projection", None),
        Ok(rows) => (rows, "facts", Some("catalog_not_ready")),
        Err(projection_error) if ready => {
            let _ = sqlx::query(
                "UPDATE read_model_state
                 SET state = 'invalid', last_error_code = 'projection_read_failed',
                     updated_at_ms = ? WHERE model_name = 'app_catalog'",
            )
            .bind(now_ms())
            .execute(pool)
            .await;
            eprintln!(
                "[read-model] app catalog projection unavailable; using facts: {projection_error}"
            );
            let rows =
                fetch_catalog_page_rows(pool, &facts_sql, "", "%%", cursor.as_ref(), safe_limit)
                    .await
                    .map_err(|error| {
                        format!("failed to load fallback app catalog page: {error}")
                    })?;
            (rows, "facts", Some("projection_unavailable"))
        }
        Err(error) => {
            return Err(format!("failed to load recorded app catalog page: {error}"));
        }
    };
    let raw_has_more = rows.len() == safe_limit;
    let raw_next_cursor = rows.last().map(|row| RecordedAppCatalogCursorDto {
        last_seen_ms: row.get("last_seen_ms"),
        raw_exe_name: row.get("raw_exe_name"),
    });
    let mut mapped = Vec::with_capacity(rows.len());
    for row in rows {
        let mut item = RecordedAppCatalogRowDto {
            raw_exe_name: row.get("raw_exe_name"),
            app_name: row.get("app_name"),
            last_seen_ms: row.get("last_seen_ms"),
            has_native_records: row.get::<i64, _>("has_native_records") == 1,
            has_import_exact_records: row.get::<i64, _>("has_import_exact_records") == 1,
            has_import_bucket_records: row.get::<i64, _>("has_import_bucket_records") == 1,
        };
        let trackable = if activity_fact_requires_metadata_check(&item.raw_exe_name) {
            match normalize_app_key(&item.raw_exe_name) {
                Some(app_key) => {
                    let facts = load_trackable_catalog_facts_from_pool(pool, &app_key).await?;
                    if let Some(projection) = summarize_catalog_facts(&facts) {
                        item.raw_exe_name = projection.raw_exe_name;
                        item.app_name = projection.display_app_name;
                        item.last_seen_ms = projection.last_seen_ms;
                        item.has_native_records = projection.has_native;
                        item.has_import_exact_records = projection.has_exact;
                        item.has_import_bucket_records = projection.has_bucket;
                        true
                    } else {
                        false
                    }
                }
                None => false,
            }
        } else {
            should_track_activity_fact(&item.raw_exe_name, &item.app_name, "")
        };
        let matches_search = normalized_search.is_empty()
            || item
                .raw_exe_name
                .to_ascii_lowercase()
                .contains(&normalized_search)
            || item
                .app_name
                .to_ascii_lowercase()
                .contains(&normalized_search);
        if trackable && matches_search {
            mapped.push(item);
        }
    }
    Ok(RecordedAppCatalogPageDto {
        has_more: raw_has_more,
        rows: mapped,
        next_cursor: raw_next_cursor,
        read_path,
        fallback_reason,
        source_revision,
    })
}

async fn fetch_catalog_page_rows(
    pool: &Pool<Sqlite>,
    sql: &str,
    normalized_search: &str,
    search_pattern: &str,
    cursor: Option<&RecordedAppCatalogCursorDto>,
    safe_limit: usize,
) -> Result<Vec<SqliteRow>, sqlx::Error> {
    sqlx::query(sql)
        .bind(i64::from(!normalized_search.is_empty()))
        .bind(search_pattern)
        .bind(search_pattern)
        .bind(i64::from(cursor.is_some()))
        .bind(cursor.map(|item| item.last_seen_ms).unwrap_or(0))
        .bind(cursor.map(|item| item.last_seen_ms).unwrap_or(0))
        .bind(cursor.map(|item| item.raw_exe_name.as_str()).unwrap_or(""))
        .bind(safe_limit as i64)
        .fetch_all(pool)
        .await
}

async fn prune_untrackable_catalog_rows(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    let rows =
        sqlx::query("SELECT app_key, raw_exe_name, display_app_name FROM recorded_app_catalog")
            .fetch_all(&mut **tx)
            .await
            .map_err(|error| format!("failed to inspect app catalog tracking rules: {error}"))?;
    for row in rows {
        let app_key: String = row.get("app_key");
        let raw_exe_name: String = row.get("raw_exe_name");
        let display_app_name: String = row.get("display_app_name");
        if activity_fact_requires_metadata_check(&raw_exe_name) {
            let facts = load_trackable_catalog_facts(tx, &app_key).await?;
            if let Some(projection) = summarize_catalog_facts(&facts) {
                sqlx::query(
                    "UPDATE recorded_app_catalog
                     SET raw_exe_name = ?, display_app_name = ?, last_seen_ms = ?,
                         has_native_records = ?, has_import_exact_records = ?,
                         has_import_bucket_records = ?
                     WHERE app_key = ?",
                )
                .bind(projection.raw_exe_name)
                .bind(projection.display_app_name)
                .bind(projection.last_seen_ms)
                .bind(projection.has_native)
                .bind(projection.has_exact)
                .bind(projection.has_bucket)
                .bind(&app_key)
                .execute(&mut **tx)
                .await
                .map_err(|error| {
                    format!("failed to reconcile app catalog fact metadata: {error}")
                })?;
                continue;
            }
        } else if should_track_activity_fact(&raw_exe_name, &display_app_name, "") {
            continue;
        }
        {
            sqlx::query("DELETE FROM recorded_app_catalog WHERE app_key = ?")
                .bind(&app_key)
                .execute(&mut **tx)
                .await
                .map_err(|error| format!("failed to prune untrackable app catalog key: {error}"))?;
        }
    }
    Ok(())
}

fn escape_like_pattern(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

async fn current_revision(tx: &mut Transaction<'_, Sqlite>) -> Result<i64, String> {
    sqlx::query_scalar("SELECT source_revision FROM read_model_revision WHERE id = 1")
        .fetch_one(&mut **tx)
        .await
        .map_err(|error| format!("failed to read source revision: {error}"))
}

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
        pool
    }

    #[tokio::test]
    async fn catalog_pages_preserve_ties_empty_names_and_literal_search() {
        let pool = setup_pool().await;
        for (exe, name, time) in [
            ("alpha.exe", "", 1000),
            ("bravo.exe", "100%_\\ literal", 1000),
            ("charlie.exe", "Charlie", 900),
        ] {
            sqlx::query("INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration) VALUES (?, ?, ?, ?, 100)")
                .bind(name).bind(exe).bind(time).bind(time + 100).execute(&pool).await.unwrap();
        }
        let first = load_page(&pool, None, String::new(), 2).await.unwrap();
        assert_eq!(
            first
                .rows
                .iter()
                .map(|row| row.raw_exe_name.as_str())
                .collect::<Vec<_>>(),
            ["alpha.exe", "bravo.exe"]
        );
        assert_eq!(first.rows[0].app_name, "");
        assert!(first.has_more);
        let second = load_page(&pool, first.next_cursor, String::new(), 2)
            .await
            .unwrap();
        assert_eq!(second.rows[0].raw_exe_name, "charlie.exe");
        assert!(!second.has_more);
        for query in ["%", "_", "\\"] {
            let page = load_page(&pool, None, query.into(), 10).await.unwrap();
            assert_eq!(page.rows.len(), 1);
            assert_eq!(page.rows[0].raw_exe_name, "bravo.exe");
        }
        assert!(load_page(&pool, None, "' OR 1=1 --".into(), 10)
            .await
            .unwrap()
            .rows
            .is_empty());
        sqlx::query("DROP TABLE recorded_app_catalog")
            .execute(&pool)
            .await
            .unwrap();
        let fallback = load_page(&pool, None, String::new(), 2).await.unwrap();
        assert_eq!(fallback.read_path, "facts");
        assert_eq!(fallback.rows.len(), 2);
        let second = load_page(&pool, fallback.next_cursor, String::new(), 2)
            .await
            .unwrap();
        assert_eq!(second.rows[0].raw_exe_name, "charlie.exe");
        assert!(!second.has_more);
        pool.close().await;
    }

    #[tokio::test]
    #[ignore = "performance fixture; run with pnpm run perf:classification-app-catalog"]
    async fn catalog_capacity_report() {
        use serde_json::json;
        use std::time::Instant;
        let pool = setup_pool().await;
        pool.execute("INSERT INTO import_batches(id, imported_at, source_name, source_kind, source_fingerprint, exact_session_count, hour_bucket_count) VALUES ('perf',1,'fixture','csv','perf',20000,10000)").await.unwrap();
        pool.execute("WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<79999) INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration) SELECT 'Native App '||(i%1500), printf('catalog-perf-%04d.exe', i%1500), i*1000, i*1000+500, 500 FROM n").await.unwrap();
        pool.execute("WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<19999) INSERT INTO import_exact_sessions(batch_id, fingerprint, app_name, exe_name, start_time, end_time, duration) SELECT 'perf','exact-'||i,'Imported App '||(i%1500),printf('catalog-perf-%04d.exe',(i+300)%1500),i*1200,i*1200+600,600 FROM n").await.unwrap();
        pool.execute("WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<9999) INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name, bucket_start_time, duration) SELECT 'perf','bucket-'||i,'Bucket App '||(i%1500),printf('catalog-perf-%04d.exe',(i+600)%1500),i*3600000,60000 FROM n").await.unwrap();
        rebuild(&pool).await.unwrap();
        pool.execute("ANALYZE").await.unwrap();
        let first = load_page(&pool, None, String::new(), 120).await.unwrap();
        assert_eq!(first.rows.len(), 120);
        let mut cursor = first.next_cursor;
        for _ in 0..8 {
            cursor = load_page(&pool, cursor, String::new(), 120)
                .await
                .unwrap()
                .next_cursor;
        }
        let mut measurements = Vec::new();
        for (name, deep, search, expected) in [
            ("classification-catalog-first-page", false, "", 120),
            ("classification-catalog-deep-page", true, "", 120),
            ("classification-catalog-search", false, "Native App 1499", 1),
        ] {
            let mut durations = Vec::new();
            for _ in 0..12 {
                let at = Instant::now();
                let page = load_page(
                    &pool,
                    if deep { cursor.clone() } else { None },
                    search.into(),
                    120,
                )
                .await
                .unwrap();
                durations.push(at.elapsed().as_secs_f64() * 1000.0);
                assert_eq!(page.read_path, "projection");
                assert_eq!(page.rows.len(), expected);
                assert!(page.source_revision > 0);
            }
            let plan = fetch_catalog_page_rows(
                &pool,
                &format!("EXPLAIN QUERY PLAN {CATALOG_PAGE_SQL}"),
                search,
                &format!("%{}%", escape_like_pattern(search)),
                if deep { cursor.as_ref() } else { None },
                120,
            )
            .await
            .unwrap();
            let details: Vec<String> = plan.iter().map(|row| row.get("detail")).collect();
            let uses_table_scan = details.iter().any(|detail| {
                detail.contains("SCAN ")
                    && !detail.contains("USING INDEX")
                    && !detail.contains("USING COVERING INDEX")
            });
            assert!(
                !uses_table_scan,
                "unexpected projection table scan: {details:?}"
            );
            measurements.push(json!({"name":name,"durations":durations,"returnedRows":expected,"readPath":"projection","queryPlan":details,"usesTableScan":uses_table_scan}));
        }
        pool.close().await;
        // A missing projection must still read facts. Keep this recovery fixture separate
        // from the large steady-state projection fixture and report its actual size.
        let fallback_pool = setup_pool().await;
        fallback_pool.execute("WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i+1 FROM n WHERE i<299) INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration) SELECT 'Fallback '||i,printf('fallback-%04d.exe',i),i*1000,i*1000+500,500 FROM n").await.unwrap();
        rebuild(&fallback_pool).await.unwrap();
        fallback_pool
            .execute("DROP TABLE recorded_app_catalog")
            .await
            .unwrap();
        let mut durations = Vec::new();
        for _ in 0..12 {
            let at = Instant::now();
            let page = load_page(&fallback_pool, None, String::new(), 120)
                .await
                .unwrap();
            durations.push(at.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(page.read_path, "facts");
            assert_eq!(page.rows.len(), 120);
            assert!(page.fallback_reason.is_some());
        }
        measurements.push(json!({"name":"classification-catalog-fallback","durations":durations,"returnedRows":120,"readPath":"facts","fixtureRows":300}));
        fallback_pool.close().await;
        println!(
            "PATINA_CATALOG_BENCH={}",
            json!({"measurements":measurements,"metadata":{"nativeRecords":80000,"exactImportRecords":20000,"bucketImportRecords":10000,"distinctApps":1500,"fallbackNativeRecords":300}})
        );
    }

    #[tokio::test]
    async fn catalog_rebuild_preserves_priority_search_and_last_record_deletion() {
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
             VALUES ('batch', 'exact', 'Exact Name', 'CODE', 100, 200, 100)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
               bucket_start_time, duration)
             VALUES ('batch', 'bucket', 'Bucket Name', 'code.exe', 300, 100)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('Native 100%_Name', '\"Code.EXE\"', 50, 60, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration)
             VALUES ('Alma', 'alma-0.0.750-win-x64.exe', 'Alma 安装', 70, 80, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();

        rebuild(&pool).await.unwrap();
        let page = load_page(&pool, None, "100%_".into(), 20).await.unwrap();
        assert_eq!(page.read_path, "projection");
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].app_name, "Native 100%_Name");
        assert!(page.rows[0].has_native_records);
        assert!(page.rows[0].has_import_exact_records);
        assert!(page.rows[0].has_import_bucket_records);
        let lifecycle_page = load_page(&pool, None, "alma".into(), 20).await.unwrap();
        assert!(lifecycle_page.rows.is_empty());

        sqlx::query("DELETE FROM sessions")
            .execute(&pool)
            .await
            .unwrap();
        maintain_once(&pool).await.unwrap();
        let page = load_page(&pool, None, "code".into(), 20).await.unwrap();
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].app_name, "Exact Name");
        assert!(!page.rows[0].has_native_records);

        sqlx::query("DELETE FROM import_batches WHERE id = 'batch'")
            .execute(&pool)
            .await
            .unwrap();
        while maintain_once(&pool).await.unwrap() {}
        let page = load_page(&pool, None, "code".into(), 20).await.unwrap();
        assert!(page.rows.is_empty());
    }

    #[tokio::test]
    async fn full_rebuild_excludes_untrackable_facts_from_catalog_metadata() {
        let pool = setup_pool().await;
        sqlx::query(
            "INSERT INTO import_batches(id, imported_at, source_name, source_kind,
               source_fingerprint, exact_session_count, hour_bucket_count)
             VALUES ('mixed', 1, 'fixture', 'csv', 'mixed', 1, 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_exact_sessions(batch_id, fingerprint, app_name, exe_name,
               window_title, start_time, end_time, duration)
             VALUES ('mixed', 'normal', 'Alma', 'product-0.0.750-win-x64.exe',
               'Alma', 100, 110, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration)
             VALUES ('Setup Host', 'product-0.0.750-win-x64.exe', 'Alma 安装', 200, 210, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();

        rebuild(&pool).await.unwrap();
        let page = load_page(&pool, None, "alma".into(), 20).await.unwrap();
        assert_eq!(page.rows.len(), 1);
        assert_eq!(page.rows[0].app_name, "Alma");
        assert_eq!(page.rows[0].last_seen_ms, 100);
        assert!(!page.rows[0].has_native_records);
        assert!(page.rows[0].has_import_exact_records);

        sqlx::query("DROP TABLE recorded_app_catalog")
            .execute(&pool)
            .await
            .unwrap();
        let fallback = load_page(&pool, None, "alma".into(), 20).await.unwrap();
        assert_eq!(fallback.read_path, "facts");
        assert_eq!(fallback.fallback_reason, Some("projection_unavailable"));
        assert_eq!(fallback.rows.len(), 1);
        assert_eq!(fallback.rows[0].app_name, "Alma");
        assert_eq!(fallback.rows[0].last_seen_ms, 100);
        assert!(!fallback.rows[0].has_native_records);
        assert!(fallback.rows[0].has_import_exact_records);
        let false_match = load_page(&pool, None, "setup".into(), 20).await.unwrap();
        assert!(false_match.rows.is_empty());
        let state: String = sqlx::query_scalar(
            "SELECT state FROM read_model_state WHERE model_name = 'app_catalog'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(state, "invalid");
    }
}
