use crate::data::import::model::record_fingerprint;
use crate::data::import::model::{
    CanonicalImportRecord, ImportBatchDto, ImportCommitReportDto, ImportDeleteReportDto,
    ImportRecordType,
};
use crate::data::repositories::classification_settings::{
    apply_classification_setting_mutations_in_tx, ClassificationSettingMutation,
};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::HashSet;

pub async fn list(pool: &Pool<Sqlite>) -> Result<Vec<ImportBatchDto>, String> {
    let rows = sqlx::query(
        "SELECT b.id, b.imported_at, b.source_name, b.source_kind,
                (SELECT COUNT(*) FROM import_exact_sessions e WHERE e.batch_id = b.id)
                    AS exact_session_count,
                (SELECT COUNT(*) FROM import_time_buckets h WHERE h.batch_id = b.id)
                    AS hour_bucket_count
         FROM import_batches b
         ORDER BY b.rowid ASC",
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
            (SELECT COUNT(*) FROM import_exact_sessions WHERE batch_id = b.id)
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
        "SELECT fingerprint FROM import_exact_sessions
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
    classification_mutations: &[ClassificationSettingMutation],
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

    apply_classification_setting_mutations_in_tx(&mut tx, classification_mutations)
        .await
        .map_err(|error| format!("failed to apply imported classifications: {error}"))?;

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
        "SELECT fingerprint FROM import_exact_sessions
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
    sqlx::query(
        "INSERT INTO import_exact_sessions (
            batch_id, fingerprint, app_name, exe_name, window_title,
            start_time, end_time, duration, source_category
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(batch_id)
    .bind(record_fingerprint(record))
    .bind(app_name)
    .bind(&record.exe_name)
    .bind(record.title.as_deref().unwrap_or(""))
    .bind(record.start_time_ms)
    .bind(end_time)
    .bind(record.duration_ms)
    .bind(&record.category)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to insert exact imported session: {error}"))?;
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
            duration, source_category
         ) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(batch_id)
    .bind(record_fingerprint(record))
    .bind(app_name)
    .bind(&record.exe_name)
    .bind(record.start_time_ms)
    .bind(record.duration_ms)
    .bind(&record.category)
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
    use crate::data::schema::{
        CURRENT_BASELINE_SCHEMA_SQL, IMPORT_DATA_ISOLATION_SCHEMA_SQL, IMPORT_DATA_SCHEMA_SQL,
    };
    use sqlx::Executor;

    async fn setup_pool() -> Pool<Sqlite> {
        let pool = Pool::<Sqlite>::connect("sqlite::memory:").await.unwrap();
        pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
        pool.execute(IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool.execute(IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();
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
            title: (record_type == ImportRecordType::ExactSession).then(|| "Editor".to_string()),
            category: Some("Development".to_string()),
        }
    }

    #[test]
    fn commit_is_idempotent_and_delete_only_removes_selected_batch() {
        tauri::async_runtime::block_on(async {
            let pool = setup_pool().await;
            let mut exact_record = record(ImportRecordType::ExactSession, 1_000);
            exact_record.title = None;
            let first_records = vec![
                exact_record.clone(),
                exact_record,
                record(ImportRecordType::HourBucket, 2_000),
            ];
            let first = commit_records(
                &pool,
                "one.csv",
                "patina-csv",
                "one",
                &first_records,
                0,
                &[],
            )
            .await
            .unwrap();
            assert_eq!(first.imported_records, 2);
            assert_eq!(first.duplicate_records, 1);
            let native_session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(native_session_count, 0);
            let imported_title: String = sqlx::query_scalar(
                "SELECT window_title FROM import_exact_sessions WHERE exe_name = 'code.exe'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert!(imported_title.is_empty());
            let imported_source_path_count: i64 = sqlx::query_scalar(
                "SELECT
                    (SELECT COUNT(*) FROM import_exact_sessions WHERE source_path IS NOT NULL) +
                    (SELECT COUNT(*) FROM import_time_buckets WHERE source_path IS NOT NULL)",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(imported_source_path_count, 0);
            let duplicate = commit_records(
                &pool,
                "one.csv",
                "patina-csv",
                "one",
                &first_records,
                0,
                &[],
            )
            .await
            .unwrap();
            assert_eq!(duplicate.imported_records, 0);
            assert_eq!(duplicate.duplicate_records, 3);
            assert_eq!(list(&pool).await.unwrap().len(), 1);

            sqlx::query(
                "INSERT INTO sessions (
                    app_name, exe_name, window_title, start_time, end_time, duration,
                    continuity_group_start_time
                 ) VALUES ('Native', 'code.exe', 'Native editor', 1000, 2000, 1000, 1000)",
            )
            .execute(&pool)
            .await
            .unwrap();
            let report = delete(&pool, first.batch_id.as_deref().unwrap())
                .await
                .unwrap();
            assert_eq!(report.deleted_exact_sessions, 1);
            assert_eq!(report.deleted_hour_buckets, 1);
            let native: (String, String, String, i64, i64, i64) = sqlx::query_as(
                "SELECT app_name, exe_name, window_title, start_time, end_time, duration
                 FROM sessions",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                native,
                (
                    "Native".to_string(),
                    "code.exe".to_string(),
                    "Native editor".to_string(),
                    1_000,
                    2_000,
                    1_000,
                )
            );
            let exact_import_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM import_exact_sessions")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let bucket_import_count: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM import_time_buckets")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!((exact_import_count, bucket_import_count), (0, 0));
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

    #[test]
    fn deleting_one_import_batch_preserves_other_external_batches() {
        tauri::async_runtime::block_on(async {
            let pool = setup_pool().await;
            let first = commit_records(
                &pool,
                "one.csv",
                "patina-csv",
                "source-one",
                &[record(ImportRecordType::ExactSession, 1_000)],
                0,
                &[],
            )
            .await
            .unwrap();
            let second = commit_records(
                &pool,
                "two.csv",
                "patina-csv",
                "source-two",
                &[record(ImportRecordType::ExactSession, 3_000)],
                0,
                &[],
            )
            .await
            .unwrap();

            delete(&pool, first.batch_id.as_deref().unwrap())
                .await
                .unwrap();

            let batches = list(&pool).await.unwrap();
            assert_eq!(batches.len(), 1);
            assert_eq!(batches[0].id, second.batch_id.unwrap());
            let remaining_starts: Vec<i64> = sqlx::query_scalar(
                "SELECT start_time FROM import_exact_sessions ORDER BY start_time",
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(remaining_starts, vec![3_000]);
            let native_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(native_count, 0);
        });
    }

    #[test]
    fn classification_validation_failure_rolls_back_the_entire_import_transaction() {
        tauri::async_runtime::block_on(async {
            let pool = setup_pool().await;
            let valid_key = "__custom_category::custom:category_focus";
            let result = commit_records(
                &pool,
                "one.csv",
                "patina-csv",
                "atomic-source",
                &[record(ImportRecordType::ExactSession, 1_000)],
                0,
                &[
                    ClassificationSettingMutation {
                        key: valid_key.to_string(),
                        value: Some("1".to_string()),
                    },
                    ClassificationSettingMutation {
                        key: "tracking_paused".to_string(),
                        value: Some("1".to_string()),
                    },
                ],
            )
            .await;

            assert!(result.is_err());
            assert!(list(&pool).await.unwrap().is_empty());
            let exact_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_exact_sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
            let category_value: Option<String> =
                sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
                    .bind(valid_key)
                    .fetch_optional(&pool)
                    .await
                    .unwrap();
            assert_eq!(exact_count, 0);
            assert_eq!(category_value, None);
        });
    }

    #[test]
    fn deleting_an_import_batch_preserves_categories_created_during_import() {
        tauri::async_runtime::block_on(async {
            let pool = setup_pool().await;
            let category_key = "__custom_category::custom:category_focus";
            let report = commit_records(
                &pool,
                "one.csv",
                "patina-csv",
                "category-source",
                &[record(ImportRecordType::ExactSession, 1_000)],
                0,
                &[ClassificationSettingMutation {
                    key: category_key.to_string(),
                    value: Some("1".to_string()),
                }],
            )
            .await
            .unwrap();

            delete(&pool, report.batch_id.as_deref().unwrap())
                .await
                .unwrap();

            let category_value: Option<String> =
                sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
                    .bind(category_key)
                    .fetch_optional(&pool)
                    .await
                    .unwrap();
            assert_eq!(category_value.as_deref(), Some("1"));
            assert!(list(&pool).await.unwrap().is_empty());
        });
    }
}
