use crate::data::import::model::record_fingerprint;
use crate::data::import::model::{
    CanonicalImportRecord, ImportBatchDto, ImportCommitReportDto, ImportDeleteReportDto,
    ImportRecordType,
};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::HashSet;

pub async fn list(pool: &Pool<Sqlite>) -> Result<Vec<ImportBatchDto>, String> {
    let rows = sqlx::query(
        "SELECT b.id, b.imported_at, b.source_name, b.source_kind,
                (SELECT COUNT(*) FROM import_exact_records e WHERE e.batch_id = b.id)
                    AS exact_session_count,
                (SELECT COUNT(*) FROM import_time_buckets h WHERE h.batch_id = b.id)
                    AS hour_bucket_count
         FROM import_batches b
         ORDER BY b.imported_at ASC, b.id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to list import batches: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let exact_sessions = row.get::<i64, _>("exact_session_count");
            let hour_buckets = row.get::<i64, _>("hour_bucket_count");
            ImportBatchDto {
                id: row.get("id"),
                imported_at: row.get("imported_at"),
                source_name: row.get("source_name"),
                source_kind: row.get("source_kind"),
                exact_sessions,
                hour_buckets,
                total_records: exact_sessions + hour_buckets,
            }
        })
        .collect())
}

pub async fn delete(pool: &Pool<Sqlite>, batch_id: &str) -> Result<ImportDeleteReportDto, String> {
    if batch_id.trim().is_empty() {
        return Err("import batch id cannot be empty".to_string());
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin import batch deletion: {error}"))?;
    let row = sqlx::query(
        "SELECT
            (SELECT COUNT(*) FROM import_exact_records WHERE batch_id = b.id)
                AS exact_session_count,
            (SELECT COUNT(*) FROM import_time_buckets WHERE batch_id = b.id)
                AS hour_bucket_count
         FROM import_batches b
         WHERE b.id = ?",
    )
    .bind(batch_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|error| format!("failed to inspect import batch: {error}"))?
    .ok_or_else(|| "import batch no longer exists".to_string())?;
    let deleted_exact_sessions = row.get::<i64, _>("exact_session_count");
    let deleted_hour_buckets = row.get::<i64, _>("hour_bucket_count");

    sqlx::query(
        "DELETE FROM sessions
         WHERE id IN (
             SELECT session_id FROM import_exact_records WHERE batch_id = ?
         )",
    )
    .bind(batch_id)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to delete imported sessions: {error}"))?;
    let deleted = sqlx::query("DELETE FROM import_batches WHERE id = ?")
        .bind(batch_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to delete import batch: {error}"))?;
    if deleted.rows_affected() != 1 {
        return Err("import batch changed during deletion".to_string());
    }
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit import batch deletion: {error}"))?;

    Ok(ImportDeleteReportDto {
        deleted_exact_sessions,
        deleted_hour_buckets,
    })
}

pub async fn load_fingerprints(pool: &Pool<Sqlite>) -> Result<HashSet<String>, String> {
    sqlx::query(
        "SELECT fingerprint FROM import_exact_records
         UNION ALL
         SELECT fingerprint FROM import_time_buckets",
    )
    .fetch_all(pool)
    .await
    .map(|rows| rows.into_iter().map(|row| row.get("fingerprint")).collect())
    .map_err(|error| format!("failed to load imported record identities: {error}"))
}

pub async fn commit_records(
    pool: &Pool<Sqlite>,
    source_name: &str,
    source_kind: &str,
    source_fingerprint: &str,
    records: &[CanonicalImportRecord],
    error_records: usize,
) -> Result<ImportCommitReportDto, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin canonical import: {error}"))?;
    let mut known_fingerprints = load_fingerprints_in_tx(&mut tx).await?;
    let mut duplicate_records = 0usize;
    let mut new_records = Vec::with_capacity(records.len());
    for record in records {
        if !known_fingerprints.insert(record_fingerprint(record)) {
            duplicate_records += 1;
        } else {
            new_records.push(record);
        }
    }

    if new_records.is_empty() {
        tx.rollback()
            .await
            .map_err(|error| format!("failed to close empty import transaction: {error}"))?;
        return Ok(ImportCommitReportDto {
            batch_id: None,
            imported_records: 0,
            duplicate_records,
            error_records,
            exact_sessions: 0,
            hour_buckets: 0,
        });
    }

    let imported_at = now_ms();
    let batch_id = build_batch_id(source_fingerprint, imported_at);
    let exact_sessions = new_records
        .iter()
        .filter(|record| record.record_type == ImportRecordType::ExactSession)
        .count();
    let hour_buckets = new_records.len() - exact_sessions;
    sqlx::query(
        "INSERT INTO import_batches (
            id, imported_at, source_name, source_kind, source_fingerprint,
            exact_session_count, hour_bucket_count
         ) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&batch_id)
    .bind(imported_at)
    .bind(source_name)
    .bind(source_kind)
    .bind(source_fingerprint)
    .bind(exact_sessions as i64)
    .bind(hour_buckets as i64)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to create import batch: {error}"))?;

    for record in new_records {
        match record.record_type {
            ImportRecordType::ExactSession => {
                insert_exact_record(&mut tx, &batch_id, record).await?
            }
            ImportRecordType::HourBucket => insert_hour_bucket(&mut tx, &batch_id, record).await?,
        }
    }

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit canonical import: {error}"))?;
    Ok(ImportCommitReportDto {
        batch_id: Some(batch_id),
        imported_records: exact_sessions + hour_buckets,
        duplicate_records,
        error_records,
        exact_sessions,
        hour_buckets,
    })
}

async fn load_fingerprints_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<HashSet<String>, String> {
    sqlx::query(
        "SELECT fingerprint FROM import_exact_records
         UNION ALL
         SELECT fingerprint FROM import_time_buckets",
    )
    .fetch_all(&mut **tx)
    .await
    .map(|rows| rows.into_iter().map(|row| row.get("fingerprint")).collect())
    .map_err(|error| format!("failed to load imported record identities: {error}"))
}

async fn insert_exact_record(
    tx: &mut Transaction<'_, Sqlite>,
    batch_id: &str,
    record: &CanonicalImportRecord,
) -> Result<(), String> {
    let end_time = record
        .end_time_ms
        .ok_or_else(|| "exact import record is missing end_time".to_string())?;
    let app_name = record.app_name.as_deref().unwrap_or(&record.exe_name);
    let inserted = sqlx::query(
        "INSERT INTO sessions (
            app_name, exe_name, window_title, start_time, end_time, duration,
            continuity_group_start_time
         ) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(app_name)
    .bind(&record.exe_name)
    .bind(&record.title)
    .bind(record.start_time_ms)
    .bind(end_time)
    .bind(record.duration_ms)
    .bind(record.start_time_ms)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to insert exact imported session: {error}"))?;
    let session_id = inserted.last_insert_rowid();
    if let Some(title) = record.title.as_deref() {
        sqlx::query(
            "INSERT INTO session_title_samples (
                session_id, title, start_time, end_time
             ) VALUES (?, ?, ?, ?)",
        )
        .bind(session_id)
        .bind(title)
        .bind(record.start_time_ms)
        .bind(end_time)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to insert imported title sample: {error}"))?;
    }
    sqlx::query(
        "INSERT INTO import_exact_records (
            batch_id, session_id, fingerprint, source_category, source_path
         ) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(batch_id)
    .bind(session_id)
    .bind(record_fingerprint(record))
    .bind(&record.category)
    .bind(&record.path)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to associate exact imported session: {error}"))?;
    Ok(())
}

async fn insert_hour_bucket(
    tx: &mut Transaction<'_, Sqlite>,
    batch_id: &str,
    record: &CanonicalImportRecord,
) -> Result<(), String> {
    let app_name = record.app_name.as_deref().unwrap_or(&record.exe_name);
    sqlx::query(
        "INSERT INTO import_time_buckets (
            batch_id, fingerprint, app_name, exe_name, bucket_start_time,
            duration, source_category, source_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(batch_id)
    .bind(record_fingerprint(record))
    .bind(app_name)
    .bind(&record.exe_name)
    .bind(record.start_time_ms)
    .bind(record.duration_ms)
    .bind(&record.category)
    .bind(&record.path)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to insert imported hour bucket: {error}"))?;
    Ok(())
}

fn build_batch_id(source_fingerprint: &str, imported_at: i64) -> String {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let mut digest = Sha256::new();
    digest.update(source_fingerprint.as_bytes());
    digest.update(imported_at.to_le_bytes());
    digest.update(nonce.to_le_bytes());
    format!("import-{:x}", digest.finalize())
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema::{CURRENT_BASELINE_SCHEMA_SQL, IMPORT_DATA_SCHEMA_SQL};
    use sqlx::Executor;

    async fn setup_pool() -> Pool<Sqlite> {
        let pool = Pool::<Sqlite>::connect("sqlite::memory:").await.unwrap();
        pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
        pool.execute(IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool
    }

    fn record(record_type: ImportRecordType, start: i64) -> CanonicalImportRecord {
        CanonicalImportRecord {
            source_line: 2,
            record_type,
            start_time_ms: start,
            end_time_ms: (record_type == ImportRecordType::ExactSession).then_some(start + 1_000),
            duration_ms: 1_000,
            exe_name: "code.exe".to_string(),
            app_name: Some("Code".to_string()),
            title: Some("Editor".to_string()),
            path: None,
            category: Some("Development".to_string()),
            source: Some("test".to_string()),
        }
    }

    #[test]
    fn commit_is_idempotent_and_delete_only_removes_selected_batch() {
        tauri::async_runtime::block_on(async {
            let pool = setup_pool().await;
            let first_records = vec![
                record(ImportRecordType::ExactSession, 1_000),
                record(ImportRecordType::ExactSession, 1_000),
                record(ImportRecordType::HourBucket, 2_000),
            ];
            let first = commit_records(&pool, "one.csv", "patina-csv", "one", &first_records, 0)
                .await
                .unwrap();
            assert_eq!(first.imported_records, 2);
            assert_eq!(first.duplicate_records, 1);
            let duplicate =
                commit_records(&pool, "one.csv", "patina-csv", "one", &first_records, 0)
                    .await
                    .unwrap();
            assert_eq!(duplicate.imported_records, 0);
            assert_eq!(duplicate.duplicate_records, 3);
            assert_eq!(list(&pool).await.unwrap().len(), 1);

            sqlx::query(
                "INSERT INTO sessions (
                    app_name, exe_name, start_time, end_time, duration,
                    continuity_group_start_time
                 ) VALUES ('Native', 'native.exe', 5, 10, 5, 5)",
            )
            .execute(&pool)
            .await
            .unwrap();
            let report = delete(&pool, first.batch_id.as_deref().unwrap())
                .await
                .unwrap();
            assert_eq!(report.deleted_exact_sessions, 1);
            assert_eq!(report.deleted_hour_buckets, 1);
            let native_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE exe_name = 'native.exe'")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(native_count, 1);
            assert!(list(&pool).await.unwrap().is_empty());
        });
    }

    #[test]
    fn failed_delete_rolls_back_without_touching_native_data() {
        tauri::async_runtime::block_on(async {
            let pool = setup_pool().await;
            let error = delete(&pool, "missing").await.unwrap_err();
            assert!(error.contains("no longer exists"));
            assert!(list(&pool).await.unwrap().is_empty());
        });
    }
}
