use sha2::{Digest, Sha256};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug)]
pub(super) struct ExternalImportBackup {
    batches: Vec<ExternalImportBatch>,
}

#[derive(Clone, Debug)]
struct ExternalImportBatch {
    id: String,
    imported_at: i64,
    source_name: String,
    source_kind: String,
    source_fingerprint: String,
    exact_sessions: Vec<ExternalExactSession>,
    time_buckets: Vec<ExternalTimeBucket>,
}

#[derive(Clone, Debug)]
struct ExternalExactSession {
    fingerprint: String,
    app_name: String,
    exe_name: String,
    window_title: String,
    start_time: i64,
    end_time: i64,
    duration: i64,
    source_category: Option<String>,
    source_path: Option<String>,
}

#[derive(Clone, Debug)]
struct ExternalTimeBucket {
    fingerprint: String,
    app_name: String,
    exe_name: String,
    bucket_start_time: i64,
    duration: i64,
    source_category: Option<String>,
    source_path: Option<String>,
}

pub(super) async fn load_external_import_backup_from_pool(
    pool: &Pool<Sqlite>,
) -> Result<ExternalImportBackup, String> {
    let batch_rows = sqlx::query(
        "SELECT id, imported_at, source_name, source_kind, source_fingerprint
         FROM import_batches
         ORDER BY imported_at ASC, id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read backup import batches: {error}"))?;

    let mut exact_by_batch = HashMap::<String, Vec<ExternalExactSession>>::new();
    for record in sqlx::query(
        "SELECT batch_id, fingerprint, app_name, exe_name, window_title,
                start_time, end_time, duration, source_category, source_path
         FROM import_exact_sessions
         ORDER BY batch_id ASC, id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read backup exact imports: {error}"))?
    {
        exact_by_batch
            .entry(record.get("batch_id"))
            .or_default()
            .push(ExternalExactSession {
                fingerprint: record.get("fingerprint"),
                app_name: record.get("app_name"),
                exe_name: record.get("exe_name"),
                window_title: record.get("window_title"),
                start_time: record.get("start_time"),
                end_time: record.get("end_time"),
                duration: record.get("duration"),
                source_category: record.get("source_category"),
                source_path: record.get("source_path"),
            });
    }
    let mut buckets_by_batch = HashMap::<String, Vec<ExternalTimeBucket>>::new();
    for record in sqlx::query(
        "SELECT batch_id, fingerprint, app_name, exe_name, bucket_start_time,
                duration, source_category, source_path
         FROM import_time_buckets
         ORDER BY batch_id ASC, id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read backup hour imports: {error}"))?
    {
        buckets_by_batch
            .entry(record.get("batch_id"))
            .or_default()
            .push(ExternalTimeBucket {
                fingerprint: record.get("fingerprint"),
                app_name: record.get("app_name"),
                exe_name: record.get("exe_name"),
                bucket_start_time: record.get("bucket_start_time"),
                duration: record.get("duration"),
                source_category: record.get("source_category"),
                source_path: record.get("source_path"),
            });
    }

    let mut batches = Vec::with_capacity(batch_rows.len());
    for row in batch_rows {
        let id: String = row.get("id");
        batches.push(ExternalImportBatch {
            exact_sessions: exact_by_batch.remove(&id).unwrap_or_default(),
            time_buckets: buckets_by_batch.remove(&id).unwrap_or_default(),
            id,
            imported_at: row.get("imported_at"),
            source_name: row.get("source_name"),
            source_kind: row.get("source_kind"),
            source_fingerprint: row.get("source_fingerprint"),
        });
    }
    Ok(ExternalImportBackup { batches })
}

pub(super) async fn clear_external_imports_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<(), String> {
    sqlx::query("DELETE FROM import_batches")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear external imports for restore: {error}"))?;
    Ok(())
}

pub(super) async fn merge_external_import_backup_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    backup: &ExternalImportBackup,
) -> Result<(), String> {
    let mut known_exact_fingerprints = sqlx::query("SELECT fingerprint FROM import_exact_sessions")
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to read current external exact identities: {error}"))?
        .into_iter()
        .map(|row| row.get::<String, _>("fingerprint"))
        .collect::<HashSet<_>>();
    let mut known_bucket_fingerprints = sqlx::query("SELECT fingerprint FROM import_time_buckets")
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to read current external hour identities: {error}"))?
        .into_iter()
        .map(|row| row.get::<String, _>("fingerprint"))
        .collect::<HashSet<_>>();
    let mut known_batch_ids = sqlx::query("SELECT id FROM import_batches")
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to read current import batch ids: {error}"))?
        .into_iter()
        .map(|row| row.get::<String, _>("id"))
        .collect::<HashSet<_>>();

    for batch in &backup.batches {
        let new_exact_sessions = batch
            .exact_sessions
            .iter()
            .filter(|record| known_exact_fingerprints.insert(record.fingerprint.clone()))
            .collect::<Vec<_>>();
        let new_time_buckets = batch
            .time_buckets
            .iter()
            .filter(|record| known_bucket_fingerprints.insert(record.fingerprint.clone()))
            .collect::<Vec<_>>();
        if new_exact_sessions.is_empty() && new_time_buckets.is_empty() {
            continue;
        }

        let target_batch_id = available_batch_id(batch, &known_batch_ids);
        known_batch_ids.insert(target_batch_id.clone());
        sqlx::query(
            "INSERT INTO import_batches (
                id, imported_at, source_name, source_kind, source_fingerprint,
                exact_session_count, hour_bucket_count
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&target_batch_id)
        .bind(batch.imported_at)
        .bind(&batch.source_name)
        .bind(&batch.source_kind)
        .bind(&batch.source_fingerprint)
        .bind(new_exact_sessions.len() as i64)
        .bind(new_time_buckets.len() as i64)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore external import batch: {error}"))?;

        for record in new_exact_sessions {
            sqlx::query(
                "INSERT INTO import_exact_sessions (
                    batch_id, fingerprint, app_name, exe_name, window_title,
                    start_time, end_time, duration, source_category, source_path
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&target_batch_id)
            .bind(&record.fingerprint)
            .bind(&record.app_name)
            .bind(&record.exe_name)
            .bind(&record.window_title)
            .bind(record.start_time)
            .bind(record.end_time)
            .bind(record.duration)
            .bind(&record.source_category)
            .bind(&record.source_path)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to restore external exact session: {error}"))?;
        }
        for record in new_time_buckets {
            sqlx::query(
                "INSERT INTO import_time_buckets (
                    batch_id, fingerprint, app_name, exe_name, bucket_start_time,
                    duration, source_category, source_path
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&target_batch_id)
            .bind(&record.fingerprint)
            .bind(&record.app_name)
            .bind(&record.exe_name)
            .bind(record.bucket_start_time)
            .bind(record.duration)
            .bind(&record.source_category)
            .bind(&record.source_path)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to restore external hour bucket: {error}"))?;
        }
    }
    Ok(())
}

fn available_batch_id(batch: &ExternalImportBatch, known: &HashSet<String>) -> String {
    if !known.contains(&batch.id) {
        return batch.id.clone();
    }
    for attempt in 0_u64.. {
        let mut digest = Sha256::new();
        digest.update(b"patina-external-restore-batch");
        digest.update(batch.id.as_bytes());
        digest.update(batch.source_fingerprint.as_bytes());
        digest.update(attempt.to_le_bytes());
        let candidate = format!("restore-{:x}", digest.finalize());
        if !known.contains(&candidate) {
            return candidate;
        }
    }
    unreachable!("unbounded restore batch id search exhausted")
}

#[cfg(test)]
mod tests {
    use super::{
        clear_external_imports_in_tx, load_external_import_backup_from_pool,
        merge_external_import_backup_in_tx,
    };
    use crate::data::backup::payload::RestoreStrategy;
    use crate::data::backup::restore_payload::restore_backup_payload_in_tx;
    use crate::data::schema::{
        CURRENT_BASELINE_SCHEMA_SQL, IMPORT_DATA_ISOLATION_SCHEMA_SQL, IMPORT_DATA_SCHEMA_SQL,
        SOFTWARE_REMINDER_RULES_SCHEMA_SQL, TOOLS_TABLES_SCHEMA_SQL, WEB_ACTIVITY_SCHEMA_SQL,
        WEB_FAVICON_CACHE_SCHEMA_SQL,
    };
    use crate::domain::backup::{
        BackupMeta, BackupPayload, BackupSession, CURRENT_BACKUP_SCHEMA_VERSION,
        CURRENT_BACKUP_VERSION,
    };
    use sqlx::{Executor, Pool, Row, Sqlite};

    async fn setup_pool() -> Pool<Sqlite> {
        let pool = Pool::<Sqlite>::connect("sqlite::memory:").await.unwrap();
        pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
        pool.execute(TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
        pool.execute(SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
        pool.execute(WEB_FAVICON_CACHE_SCHEMA_SQL).await.unwrap();
        pool.execute(IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool.execute(IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    async fn insert_batch(
        pool: &Pool<Sqlite>,
        id: &str,
        fingerprint_suffix: &str,
        exact_fingerprint: &str,
        bucket_fingerprint: &str,
    ) {
        sqlx::query(
            "INSERT INTO import_batches (
                id, imported_at, source_name, source_kind, source_fingerprint,
                exact_session_count, hour_bucket_count
             ) VALUES (?, 100, 'external.csv', 'patina-csv', ?, 1, 1)",
        )
        .bind(id)
        .bind(format!("source-{fingerprint_suffix}"))
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_exact_sessions (
                batch_id, fingerprint, app_name, exe_name, window_title,
                start_time, end_time, duration, source_category
             ) VALUES (?, ?, 'External', 'external.exe', 'Window', 1000, 2000, 1000, 'Work')",
        )
        .bind(id)
        .bind(exact_fingerprint)
        .execute(pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO import_time_buckets (
                batch_id, fingerprint, app_name, exe_name,
                bucket_start_time, duration, source_category
             ) VALUES (?, ?, 'External', 'external.exe', 0, 1000, 'Work')",
        )
        .bind(id)
        .bind(bucket_fingerprint)
        .execute(pool)
        .await
        .unwrap();
    }

    fn payload_with_native_session(exe_name: &str) -> BackupPayload {
        BackupPayload {
            version: CURRENT_BACKUP_VERSION,
            meta: BackupMeta {
                exported_at_ms: 1,
                schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
                app_version: "test".to_string(),
            },
            sessions: vec![BackupSession {
                id: 100,
                app_name: "Backup Native".to_string(),
                exe_name: exe_name.to_string(),
                window_title: Some("Backup Window".to_string()),
                start_time: 3_000,
                end_time: Some(4_000),
                duration: Some(1_000),
                continuity_group_start_time: Some(3_000),
            }],
            title_samples: Vec::new(),
            settings: Vec::new(),
            icon_cache: Vec::new(),
            web_activity_segments: Vec::new(),
            web_favicon_cache: Vec::new(),
            tool_reminders: Vec::new(),
            tool_timers: Vec::new(),
            tool_timer_laps: Vec::new(),
            tool_pomodoro_runs: Vec::new(),
            tool_daily_stats: Vec::new(),
            tool_software_reminder_rules: Vec::new(),
        }
    }

    #[tokio::test]
    async fn merge_keeps_native_sessions_and_is_idempotent() {
        let source = setup_pool().await;
        insert_batch(&source, "source-batch", "one", "exact-one", "bucket-one").await;
        let target = setup_pool().await;
        sqlx::query(
            "INSERT INTO sessions (
                app_name, exe_name, window_title, start_time, end_time, duration,
                continuity_group_start_time
             ) VALUES ('Native', 'native.exe', 'Native', 10, 20, 10, 10)",
        )
        .execute(&target)
        .await
        .unwrap();

        let backup = load_external_import_backup_from_pool(&source)
            .await
            .unwrap();
        for _ in 0..2 {
            let mut tx = target.begin().await.unwrap();
            merge_external_import_backup_in_tx(&mut tx, &backup)
                .await
                .unwrap();
            tx.commit().await.unwrap();
        }

        let native_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&target)
            .await
            .unwrap();
        let external_counts: (i64, i64, i64) = sqlx::query(
            "SELECT
                (SELECT COUNT(*) FROM import_batches) AS batches,
                (SELECT COUNT(*) FROM import_exact_sessions) AS exacts,
                (SELECT COUNT(*) FROM import_time_buckets) AS buckets",
        )
        .fetch_one(&target)
        .await
        .map(|row| (row.get("batches"), row.get("exacts"), row.get("buckets")))
        .unwrap();
        assert_eq!(native_count, 1);
        assert_eq!(external_counts, (1, 1, 1));
    }

    #[tokio::test]
    async fn merge_remaps_a_conflicting_batch_id_without_overwriting() {
        let source = setup_pool().await;
        insert_batch(
            &source,
            "shared-id",
            "source",
            "exact-source",
            "bucket-source",
        )
        .await;
        let target = setup_pool().await;
        insert_batch(
            &target,
            "shared-id",
            "target",
            "exact-target",
            "bucket-target",
        )
        .await;

        let backup = load_external_import_backup_from_pool(&source)
            .await
            .unwrap();
        let mut tx = target.begin().await.unwrap();
        merge_external_import_backup_in_tx(&mut tx, &backup)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let batch_ids: Vec<String> =
            sqlx::query_scalar("SELECT id FROM import_batches ORDER BY id")
                .fetch_all(&target)
                .await
                .unwrap();
        assert_eq!(batch_ids.len(), 2);
        assert!(batch_ids.iter().any(|id| id == "shared-id"));
        assert!(batch_ids.iter().any(|id| id.starts_with("restore-")));
    }

    #[tokio::test]
    async fn merge_keeps_equal_fingerprints_when_record_types_differ() {
        let source = setup_pool().await;
        insert_batch(&source, "source", "source", "shared", "shared").await;
        let target = setup_pool().await;

        let backup = load_external_import_backup_from_pool(&source)
            .await
            .unwrap();
        let mut tx = target.begin().await.unwrap();
        merge_external_import_backup_in_tx(&mut tx, &backup)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        let external_counts: (i64, i64) = sqlx::query(
            "SELECT
                (SELECT COUNT(*) FROM import_exact_sessions) AS exacts,
                (SELECT COUNT(*) FROM import_time_buckets) AS buckets",
        )
        .fetch_one(&target)
        .await
        .map(|row| (row.get("exacts"), row.get("buckets")))
        .unwrap();
        assert_eq!(external_counts, (1, 1));
    }

    #[tokio::test]
    async fn clearing_external_imports_never_changes_native_sessions() {
        let pool = setup_pool().await;
        insert_batch(&pool, "batch", "one", "exact", "bucket").await;
        sqlx::query(
            "INSERT INTO sessions (
                app_name, exe_name, window_title, start_time, end_time, duration,
                continuity_group_start_time
             ) VALUES ('Native', 'native.exe', 'Native', 10, 20, 10, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        clear_external_imports_in_tx(&mut tx).await.unwrap();
        tx.commit().await.unwrap();

        let native_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        let batch_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_batches")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(native_count, 1);
        assert_eq!(batch_count, 0);
    }

    #[tokio::test]
    async fn legacy_replace_restore_clears_current_external_data() {
        let pool = setup_pool().await;
        insert_batch(
            &pool,
            "current",
            "current",
            "exact-current",
            "bucket-current",
        )
        .await;
        sqlx::query(
            "INSERT INTO sessions (
                app_name, exe_name, window_title, start_time, end_time, duration,
                continuity_group_start_time
             ) VALUES ('Current Native', 'current.exe', 'Current', 10, 20, 10, 10)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        restore_backup_payload_in_tx(
            &mut tx,
            &payload_with_native_session("backup.exe"),
            RestoreStrategy::Replace,
            SessionMergePolicy::ByNaturalKey,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let native_exes: Vec<String> =
            sqlx::query_scalar("SELECT exe_name FROM sessions ORDER BY exe_name")
                .fetch_all(&pool)
                .await
                .unwrap();
        let external_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_batches")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(native_exes, vec!["backup.exe"]);
        assert_eq!(external_count, 0);
    }

    #[tokio::test]
    async fn legacy_merge_restore_preserves_current_external_data() {
        let pool = setup_pool().await;
        insert_batch(
            &pool,
            "current",
            "current",
            "exact-current",
            "bucket-current",
        )
        .await;

        let mut tx = pool.begin().await.unwrap();
        restore_backup_payload_in_tx(
            &mut tx,
            &payload_with_native_session("backup.exe"),
            RestoreStrategy::Merge,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();

        let native_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        let external_counts: (i64, i64, i64) = sqlx::query(
            "SELECT
                (SELECT COUNT(*) FROM import_batches) AS batches,
                (SELECT COUNT(*) FROM import_exact_sessions) AS exacts,
                (SELECT COUNT(*) FROM import_time_buckets) AS buckets",
        )
        .fetch_one(&pool)
        .await
        .map(|row| (row.get("batches"), row.get("exacts"), row.get("buckets")))
        .unwrap();
        assert_eq!(native_count, 1);
        assert_eq!(external_counts, (1, 1, 1));
    }

    #[tokio::test]
    async fn combined_restore_rolls_back_native_when_external_merge_fails() {
        let source = setup_pool().await;
        insert_batch(&source, "source", "source", "exact-source", "bucket-source").await;
        let mut backup = load_external_import_backup_from_pool(&source)
            .await
            .unwrap();
        backup.batches[0].time_buckets[0].duration = 0;

        let target = setup_pool().await;
        let mut tx = target.begin().await.unwrap();
        restore_backup_payload_in_tx(
            &mut tx,
            &payload_with_native_session("rolled-back.exe"),
            RestoreStrategy::Merge,
        )
        .await
        .unwrap();
        let error = merge_external_import_backup_in_tx(&mut tx, &backup)
            .await
            .unwrap_err();
        assert!(error.contains("failed to restore external hour bucket"));
        tx.rollback().await.unwrap();

        let native_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&target)
            .await
            .unwrap();
        let external_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_batches")
            .fetch_one(&target)
            .await
            .unwrap();
        assert_eq!(native_count, 0);
        assert_eq!(external_count, 0);
    }
}
