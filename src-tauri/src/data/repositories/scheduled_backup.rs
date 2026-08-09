use crate::domain::backup_schedule::{
    ScheduledBackupCadence, ScheduledBackupConfig, ScheduledBackupRun, ScheduledBackupTarget,
    SCHEDULED_BACKUP_KEEP_COUNT,
};
use sqlx::{Pool, Row, Sqlite};

pub async fn load_config(pool: &Pool<Sqlite>) -> Result<Option<ScheduledBackupConfig>, String> {
    let row = sqlx::query(
        "SELECT enabled, cadence, weekday, local_time_minutes, target_kind, target_dir,
                target_identity, target_generation, schedule_anchor_at_ms, updated_at_ms
         FROM scheduled_backup_config WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to load scheduled backup configuration: {error}"))?;
    row.map(config_from_row).transpose()
}

pub async fn save_config(
    pool: &Pool<Sqlite>,
    config: &ScheduledBackupConfig,
) -> Result<(), String> {
    config.validate()?;
    sqlx::query(
        "INSERT INTO scheduled_backup_config (
            id, enabled, cadence, weekday, local_time_minutes, target_kind, target_dir,
            target_identity, retention_count, target_generation, schedule_anchor_at_ms, updated_at_ms
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            cadence = excluded.cadence,
            weekday = excluded.weekday,
            local_time_minutes = excluded.local_time_minutes,
            target_kind = excluded.target_kind,
            target_dir = excluded.target_dir,
            target_identity = excluded.target_identity,
            retention_count = excluded.retention_count,
            target_generation = excluded.target_generation,
            schedule_anchor_at_ms = excluded.schedule_anchor_at_ms,
            updated_at_ms = excluded.updated_at_ms",
    )
    .bind(i64::from(config.enabled))
    .bind(config.cadence.as_str())
    .bind(config.weekday.map(i64::from))
    .bind(i64::from(config.local_time_minutes))
    .bind(config.target.kind())
    .bind(config.target.local_target_dir())
    .bind(config.target.target_identity())
    .bind(i64::from(SCHEDULED_BACKUP_KEEP_COUNT))
    .bind(&config.target_generation)
    .bind(config.schedule_anchor_at_ms)
    .bind(config.updated_at_ms)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to save scheduled backup configuration: {error}"))?;
    Ok(())
}

pub async fn claim_run(pool: &Pool<Sqlite>, run: &ScheduledBackupRun) -> Result<bool, String> {
    let affected = sqlx::query(
        "INSERT INTO scheduled_backup_runs (
            run_key, target_generation, target_kind, logical_date, logical_time_minutes, target_path,
            staging_path, phase, remote_etag, status, file_state, attempt_count, retry_at_ms,
            started_at_ms, completed_at_ms, archive_sha256, size_bytes, error_code, error_message,
            cleanup_warning, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', 'absent', 1, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, ?)
         ON CONFLICT DO NOTHING",
    )
    .bind(&run.run_key)
    .bind(&run.target_generation)
    .bind(&run.target_kind)
    .bind(&run.logical_date)
    .bind(i64::from(run.logical_time_minutes))
    .bind(&run.target_path)
    .bind(&run.staging_path)
    .bind(&run.phase)
    .bind(&run.remote_etag)
    .bind(run.started_at_ms)
    .bind(run.updated_at_ms)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to claim scheduled backup run: {error}"))?
    .rows_affected();
    Ok(affected == 1)
}

pub async fn load_run(
    pool: &Pool<Sqlite>,
    run_key: &str,
) -> Result<Option<ScheduledBackupRun>, String> {
    let row = sqlx::query(&format!("{} WHERE run_key = ? LIMIT 1", run_select_sql()))
        .bind(run_key)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("failed to load scheduled backup run: {error}"))?;
    row.map(run_from_row).transpose()
}

pub async fn start_retry(pool: &Pool<Sqlite>, run_key: &str, now_ms: i64) -> Result<bool, String> {
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs
         SET status = 'running', attempt_count = attempt_count + 1,
             retry_at_ms = NULL, started_at_ms = ?, completed_at_ms = NULL,
             error_code = NULL, error_message = NULL, updated_at_ms = ?
         WHERE run_key = ? AND status = 'retry_wait' AND attempt_count < 3",
    )
    .bind(now_ms)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to start scheduled backup retry: {error}"))?
    .rows_affected();
    Ok(affected == 1)
}

pub async fn update_target_path(
    pool: &Pool<Sqlite>,
    run_key: &str,
    target_path: &str,
    now_ms: i64,
) -> Result<(), String> {
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs SET target_path = ?, updated_at_ms = ?
         WHERE run_key = ? AND status = 'running'",
    )
    .bind(target_path)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to reserve scheduled backup path: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "reserve scheduled backup path")
}

pub async fn mark_staged(
    pool: &Pool<Sqlite>,
    run_key: &str,
    staging_path: &str,
    archive_sha256: &str,
    size_bytes: u64,
    now_ms: i64,
) -> Result<(), String> {
    let size_bytes = i64::try_from(size_bytes)
        .map_err(|_| "scheduled backup file is too large to record".to_string())?;
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs
         SET staging_path = ?, phase = 'staged', archive_sha256 = ?, size_bytes = ?,
             updated_at_ms = ?
         WHERE run_key = ? AND status = 'running' AND phase = 'claimed'",
    )
    .bind(staging_path)
    .bind(archive_sha256)
    .bind(size_bytes)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to record scheduled backup staging: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "record scheduled backup staging")
}

pub async fn mark_uploaded(
    pool: &Pool<Sqlite>,
    run_key: &str,
    remote_etag: Option<&str>,
    now_ms: i64,
) -> Result<(), String> {
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs
         SET phase = 'uploaded', remote_etag = ?, updated_at_ms = ?
         WHERE run_key = ? AND status = 'running' AND phase = 'staged'",
    )
    .bind(remote_etag)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to record scheduled backup upload: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "record scheduled backup upload")
}

async fn advance_phase(
    pool: &Pool<Sqlite>,
    run_key: &str,
    expected: &str,
    next: &str,
    now_ms: i64,
) -> Result<(), String> {
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs SET phase = ?, updated_at_ms = ?
         WHERE run_key = ? AND status = 'running' AND phase = ?",
    )
    .bind(next)
    .bind(now_ms)
    .bind(run_key)
    .bind(expected)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to advance scheduled backup phase: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "advance scheduled backup phase")
}

pub async fn mark_remote_verified(
    pool: &Pool<Sqlite>,
    run_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    advance_phase(pool, run_key, "uploaded", "remote_verified", now_ms).await
}

pub async fn mark_indexed(pool: &Pool<Sqlite>, run_key: &str, now_ms: i64) -> Result<(), String> {
    advance_phase(pool, run_key, "remote_verified", "indexed", now_ms).await
}

pub async fn mark_succeeded(
    pool: &Pool<Sqlite>,
    run_key: &str,
    archive_sha256: &str,
    size_bytes: u64,
    completed_at_ms: i64,
) -> Result<(), String> {
    let size_bytes = i64::try_from(size_bytes)
        .map_err(|_| "scheduled backup file is too large to record".to_string())?;
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs
         SET status = 'succeeded', file_state = 'present', phase = 'succeeded', retry_at_ms = NULL,
             completed_at_ms = ?, archive_sha256 = ?, size_bytes = ?,
             error_code = NULL, error_message = NULL, updated_at_ms = ?
         WHERE run_key = ? AND status = 'running' AND phase IN ('claimed', 'indexed')",
    )
    .bind(completed_at_ms)
    .bind(archive_sha256)
    .bind(size_bytes)
    .bind(completed_at_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to record scheduled backup success: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "record scheduled backup success")
}

pub async fn mark_failed_or_retry(
    pool: &Pool<Sqlite>,
    run_key: &str,
    attempt_count: u8,
    error_code: &str,
    error_message: &str,
    now_ms: i64,
) -> Result<(), String> {
    let retry_at_ms = match attempt_count {
        1 => Some(now_ms.saturating_add(5 * 60 * 1000)),
        2 => Some(now_ms.saturating_add(30 * 60 * 1000)),
        _ => None,
    };
    let status = if retry_at_ms.is_some() {
        "retry_wait"
    } else {
        "failed"
    };
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs
         SET status = ?, retry_at_ms = ?, completed_at_ms = ?,
             error_code = ?, error_message = ?, updated_at_ms = ?
         WHERE run_key = ? AND status = 'running'",
    )
    .bind(status)
    .bind(retry_at_ms)
    .bind(now_ms)
    .bind(error_code)
    .bind(error_message)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to record scheduled backup failure: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "record scheduled backup failure")
}

pub async fn mark_failed(
    pool: &Pool<Sqlite>,
    run_key: &str,
    error_code: &str,
    error_message: &str,
    now_ms: i64,
) -> Result<(), String> {
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs
         SET status = 'failed', retry_at_ms = NULL, completed_at_ms = ?,
             error_code = ?, error_message = ?, updated_at_ms = ?
         WHERE run_key = ? AND status = 'running'",
    )
    .bind(now_ms)
    .bind(error_code)
    .bind(error_message)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to record terminal scheduled backup failure: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "record terminal scheduled backup failure")
}

pub async fn mark_recovered_success(
    pool: &Pool<Sqlite>,
    run_key: &str,
    archive_sha256: &str,
    size_bytes: u64,
    now_ms: i64,
) -> Result<(), String> {
    let size_bytes = i64::try_from(size_bytes)
        .map_err(|_| "scheduled backup file is too large to record".to_string())?;
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs
         SET status = 'succeeded', file_state = 'present', phase = 'succeeded', retry_at_ms = NULL,
             completed_at_ms = ?, archive_sha256 = ?, size_bytes = ?,
             error_code = NULL, error_message = NULL, updated_at_ms = ?
         WHERE run_key = ? AND status = 'running'",
    )
    .bind(now_ms)
    .bind(archive_sha256)
    .bind(size_bytes)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to reconcile scheduled backup success: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "reconcile scheduled backup success")
}

pub async fn mark_interrupted_for_retry(
    pool: &Pool<Sqlite>,
    run_key: &str,
    attempt_count: u8,
    now_ms: i64,
) -> Result<(), String> {
    mark_failed_or_retry(
        pool,
        run_key,
        attempt_count,
        "interrupted",
        "The previous scheduled backup was interrupted before completion.",
        now_ms,
    )
    .await
}

pub async fn mark_validation_conflict(
    pool: &Pool<Sqlite>,
    run_key: &str,
    attempt_count: u8,
    error_message: &str,
    now_ms: i64,
) -> Result<(), String> {
    let retry_at_ms = match attempt_count {
        1 => Some(now_ms.saturating_add(5 * 60 * 1000)),
        2 => Some(now_ms.saturating_add(30 * 60 * 1000)),
        _ => None,
    };
    let status = if retry_at_ms.is_some() {
        "retry_wait"
    } else {
        "failed"
    };
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs
         SET status = ?, file_state = 'conflict', retry_at_ms = ?, completed_at_ms = ?,
             error_code = 'validation_failed', error_message = ?, updated_at_ms = ?
         WHERE run_key = ? AND status = 'running'",
    )
    .bind(status)
    .bind(retry_at_ms)
    .bind(now_ms)
    .bind(error_message)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to record scheduled backup validation conflict: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "record scheduled backup validation conflict")
}

pub async fn mark_superseded(
    pool: &Pool<Sqlite>,
    run_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs
         SET status = 'failed', retry_at_ms = NULL, completed_at_ms = ?,
             error_code = 'superseded_by_newer_slot',
             error_message = 'A newer scheduled backup slot became due; the older retry was not backfilled.',
             updated_at_ms = ?
         WHERE run_key = ? AND status = 'retry_wait'",
    )
    .bind(now_ms)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to supersede stale scheduled backup retry: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "supersede stale scheduled backup retry")
}

pub async fn compact_terminal_history(pool: &Pool<Sqlite>) -> Result<(), String> {
    sqlx::query(
        "DELETE FROM scheduled_backup_runs
         WHERE run_key IN (
           SELECT run_key FROM scheduled_backup_runs
           WHERE status IN ('succeeded', 'failed')
             AND file_state IN ('absent', 'pruned', 'missing', 'conflict')
           ORDER BY updated_at_ms DESC
           LIMIT -1 OFFSET 32
         )",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("failed to compact scheduled backup run history: {error}"))?;
    Ok(())
}

pub async fn list_retention_candidates(
    pool: &Pool<Sqlite>,
    generation: &str,
) -> Result<Vec<ScheduledBackupRun>, String> {
    let rows = sqlx::query(&format!(
        "{} WHERE target_generation = ? AND status = 'succeeded' AND file_state = 'present'
         ORDER BY logical_date DESC, logical_time_minutes DESC, completed_at_ms DESC, run_key DESC",
        run_select_sql()
    ))
    .bind(generation)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to list scheduled backup retention candidates: {error}"))?;
    rows.into_iter().map(run_from_row).collect()
}

pub async fn mark_pruned(pool: &Pool<Sqlite>, run_key: &str, now_ms: i64) -> Result<(), String> {
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs SET file_state = 'pruned', updated_at_ms = ?
         WHERE run_key = ? AND status = 'succeeded' AND file_state = 'present'",
    )
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to record scheduled backup cleanup: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "record scheduled backup cleanup")
}

pub async fn mark_missing(
    pool: &Pool<Sqlite>,
    run_key: &str,
    warning: &str,
    now_ms: i64,
) -> Result<(), String> {
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs
         SET file_state = 'missing', cleanup_warning = ?, updated_at_ms = ?
         WHERE run_key = ? AND status = 'succeeded' AND file_state = 'present'",
    )
    .bind(warning)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to record missing scheduled backup: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "record missing scheduled backup")
}

pub async fn set_cleanup_warning(
    pool: &Pool<Sqlite>,
    run_key: &str,
    warning: Option<&str>,
    now_ms: i64,
) -> Result<(), String> {
    let affected = sqlx::query(
        "UPDATE scheduled_backup_runs SET cleanup_warning = ?, updated_at_ms = ?
         WHERE run_key = ?",
    )
    .bind(warning)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to record scheduled backup cleanup warning: {error}"))?
    .rows_affected();
    ensure_single_transition(affected, "record scheduled backup cleanup warning")
}

fn ensure_single_transition(affected: u64, action: &str) -> Result<(), String> {
    if affected == 1 {
        Ok(())
    } else {
        Err(format!(
            "failed to {action}: scheduled backup state changed unexpectedly"
        ))
    }
}

pub async fn load_recent_by_status(
    pool: &Pool<Sqlite>,
    generation: &str,
    status: &str,
) -> Result<Option<ScheduledBackupRun>, String> {
    let row = sqlx::query(&format!(
        "{} WHERE target_generation = ? AND status = ? ORDER BY updated_at_ms DESC LIMIT 1",
        run_select_sql()
    ))
    .bind(generation)
    .bind(status)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to load recent scheduled backup state: {error}"))?;
    row.map(run_from_row).transpose()
}

pub async fn load_active(pool: &Pool<Sqlite>) -> Result<Option<ScheduledBackupRun>, String> {
    let row = sqlx::query(&format!(
        "{} WHERE status IN ('running', 'retry_wait') ORDER BY updated_at_ms DESC LIMIT 1",
        run_select_sql()
    ))
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to load active scheduled backup state: {error}"))?;
    row.map(run_from_row).transpose()
}

pub async fn cancel_active_runs(
    pool: &Pool<Sqlite>,
    error_code: &str,
    error_message: &str,
    now_ms: i64,
) -> Result<(), String> {
    sqlx::query(
        "UPDATE scheduled_backup_runs
         SET status = 'failed', file_state = CASE WHEN file_state = 'present' THEN 'present' ELSE 'absent' END,
             retry_at_ms = NULL, completed_at_ms = ?, error_code = ?, error_message = ?, updated_at_ms = ?
         WHERE status IN ('running', 'retry_wait')",
    )
    .bind(now_ms)
    .bind(error_code)
    .bind(error_message)
    .bind(now_ms)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to cancel obsolete scheduled backup runs: {error}"))?;
    Ok(())
}

pub async fn reset_after_replace_restore(
    pool: &Pool<Sqlite>,
    new_generation: &str,
    now_ms: i64,
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin scheduled backup restore reset: {error}"))?;
    sqlx::query(
        "UPDATE scheduled_backup_config
         SET enabled = 0, target_generation = ?, schedule_anchor_at_ms = ?, updated_at_ms = ?
         WHERE id = 1",
    )
    .bind(new_generation)
    .bind(now_ms)
    .bind(now_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to pause scheduled backup after restore: {error}"))?;
    sqlx::query("DELETE FROM scheduled_backup_runs")
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            format!("failed to clear scheduled backup runtime after restore: {error}")
        })?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit scheduled backup restore reset: {error}"))?;
    Ok(())
}

fn run_select_sql() -> &'static str {
    "SELECT run_key, target_generation, target_kind, logical_date, logical_time_minutes, target_path,
            staging_path, phase, remote_etag, status, file_state, attempt_count, retry_at_ms,
            started_at_ms, completed_at_ms, archive_sha256, size_bytes, error_code, error_message,
            cleanup_warning, updated_at_ms
     FROM scheduled_backup_runs"
}

fn config_from_row(row: sqlx::sqlite::SqliteRow) -> Result<ScheduledBackupConfig, String> {
    let config = ScheduledBackupConfig {
        enabled: row.get::<i64, _>("enabled") != 0,
        cadence: ScheduledBackupCadence::parse(&row.get::<String, _>("cadence"))?,
        weekday: row
            .get::<Option<i64>, _>("weekday")
            .map(u8::try_from)
            .transpose()
            .map_err(|_| "invalid scheduled backup weekday in storage".to_string())?,
        local_time_minutes: u16::try_from(row.get::<i64, _>("local_time_minutes"))
            .map_err(|_| "invalid scheduled backup time in storage".to_string())?,
        target: match row.get::<String, _>("target_kind").as_str() {
            "local" => ScheduledBackupTarget::Local {
                target_dir: row.get::<Option<String>, _>("target_dir").ok_or_else(|| {
                    "local scheduled backup target is missing its directory".to_string()
                })?,
            },
            "webdav" => ScheduledBackupTarget::WebDav {
                target_identity: row
                    .get::<Option<String>, _>("target_identity")
                    .ok_or_else(|| "scheduled WebDAV target is missing its identity".to_string())?,
            },
            _ => return Err("invalid scheduled backup target kind in storage".to_string()),
        },
        target_generation: row.get("target_generation"),
        schedule_anchor_at_ms: row.get("schedule_anchor_at_ms"),
        updated_at_ms: row.get("updated_at_ms"),
    };
    config.validate()?;
    Ok(config)
}

fn run_from_row(row: sqlx::sqlite::SqliteRow) -> Result<ScheduledBackupRun, String> {
    Ok(ScheduledBackupRun {
        run_key: row.get("run_key"),
        target_generation: row.get("target_generation"),
        target_kind: row.get("target_kind"),
        logical_date: row.get("logical_date"),
        logical_time_minutes: u16::try_from(row.get::<i64, _>("logical_time_minutes"))
            .map_err(|_| "invalid scheduled backup run time in storage".to_string())?,
        target_path: row.get("target_path"),
        staging_path: row.get("staging_path"),
        phase: row.get("phase"),
        remote_etag: row.get("remote_etag"),
        status: row.get("status"),
        file_state: row.get("file_state"),
        attempt_count: u8::try_from(row.get::<i64, _>("attempt_count"))
            .map_err(|_| "invalid scheduled backup attempt count in storage".to_string())?,
        retry_at_ms: row.get("retry_at_ms"),
        started_at_ms: row.get("started_at_ms"),
        completed_at_ms: row.get("completed_at_ms"),
        archive_sha256: row.get("archive_sha256"),
        size_bytes: row
            .get::<Option<i64>, _>("size_bytes")
            .map(u64::try_from)
            .transpose()
            .map_err(|_| "invalid scheduled backup size in storage".to_string())?,
        error_code: row.get("error_code"),
        error_message: row.get("error_message"),
        cleanup_warning: row.get("cleanup_warning"),
        updated_at_ms: row.get("updated_at_ms"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema::{SCHEDULED_BACKUP_SCHEMA_SQL, SCHEDULED_BACKUP_TARGETS_SCHEMA_SQL};
    use crate::domain::backup_schedule::{
        ScheduledBackupCadence, ScheduledBackupConfig, ScheduledBackupTarget,
    };
    use sqlx::{Executor, SqlitePool};

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(SCHEDULED_BACKUP_SCHEMA_SQL).await.unwrap();
        pool.execute(SCHEDULED_BACKUP_TARGETS_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    fn config() -> ScheduledBackupConfig {
        ScheduledBackupConfig {
            enabled: true,
            cadence: ScheduledBackupCadence::Daily,
            weekday: None,
            local_time_minutes: 120,
            target: ScheduledBackupTarget::Local {
                target_dir: "C:\\Backups".to_string(),
            },
            target_generation: "generation-a".to_string(),
            schedule_anchor_at_ms: 100,
            updated_at_ms: 100,
        }
    }

    fn run() -> ScheduledBackupRun {
        ScheduledBackupRun {
            run_key: "scheduled-backup:g:2026-08-09:0120".to_string(),
            target_generation: "g".to_string(),
            target_kind: "local".to_string(),
            logical_date: "2026-08-09".to_string(),
            logical_time_minutes: 120,
            target_path: "C:\\Backups\\one.zip".to_string(),
            staging_path: None,
            phase: "claimed".to_string(),
            remote_etag: None,
            status: "running".to_string(),
            file_state: "absent".to_string(),
            attempt_count: 1,
            retry_at_ms: None,
            started_at_ms: 200,
            completed_at_ms: None,
            archive_sha256: None,
            size_bytes: None,
            error_code: None,
            error_message: None,
            cleanup_warning: None,
            updated_at_ms: 200,
        }
    }

    #[tokio::test]
    async fn config_round_trips_and_enforces_singleton() {
        let pool = pool().await;
        let original = config();
        save_config(&pool, &original).await.unwrap();
        assert_eq!(load_config(&pool).await.unwrap(), Some(original));

        let mut changed = config();
        changed.local_time_minutes = 180;
        save_config(&pool, &changed).await.unwrap();
        assert_eq!(load_config(&pool).await.unwrap(), Some(changed));
        let stored_keep_count: i64 =
            sqlx::query_scalar("SELECT retention_count FROM scheduled_backup_config WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(stored_keep_count, i64::from(SCHEDULED_BACKUP_KEEP_COUNT));
    }

    #[tokio::test]
    async fn webdav_config_round_trips_without_persisting_credentials() {
        let pool = pool().await;
        let mut webdav = config();
        webdav.target = ScheduledBackupTarget::WebDav {
            target_identity: "a".repeat(64),
        };
        save_config(&pool, &webdav).await.unwrap();
        assert_eq!(load_config(&pool).await.unwrap(), Some(webdav));

        let stored = sqlx::query(
            "SELECT target_kind, target_dir, target_identity FROM scheduled_backup_config WHERE id = 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(stored.get::<String, _>("target_kind"), "webdav");
        assert_eq!(stored.get::<Option<String>, _>("target_dir"), None);
        assert_eq!(
            stored
                .get::<Option<String>, _>("target_identity")
                .unwrap()
                .len(),
            64
        );
    }

    #[tokio::test]
    async fn duplicate_slot_claim_is_idempotent() {
        let pool = pool().await;
        let first = run();
        assert!(claim_run(&pool, &first).await.unwrap());
        let mut duplicate = first.clone();
        duplicate.run_key = "different-key".to_string();
        assert!(!claim_run(&pool, &duplicate).await.unwrap());
        assert_eq!(load_run(&pool, &first.run_key).await.unwrap(), Some(first));
    }

    #[tokio::test]
    async fn failures_use_bounded_retry_schedule() {
        let pool = pool().await;
        let run = run();
        claim_run(&pool, &run).await.unwrap();
        mark_failed_or_retry(&pool, &run.run_key, 1, "io", "failed", 1_000)
            .await
            .unwrap();
        let retry = load_run(&pool, &run.run_key).await.unwrap().unwrap();
        assert_eq!(retry.status, "retry_wait");
        assert_eq!(retry.retry_at_ms, Some(301_000));
        assert!(start_retry(&pool, &run.run_key, 301_000).await.unwrap());
        mark_failed_or_retry(&pool, &run.run_key, 2, "io", "failed", 302_000)
            .await
            .unwrap();
        assert_eq!(
            load_run(&pool, &run.run_key)
                .await
                .unwrap()
                .unwrap()
                .retry_at_ms,
            Some(2_102_000)
        );
    }

    #[tokio::test]
    async fn permanent_failures_never_enter_retry_wait() {
        let pool = pool().await;
        let run = run();
        claim_run(&pool, &run).await.unwrap();
        mark_failed(
            &pool,
            &run.run_key,
            "credential_missing",
            "credential missing",
            1_000,
        )
        .await
        .unwrap();

        let failed = load_run(&pool, &run.run_key).await.unwrap().unwrap();
        assert_eq!(failed.status, "failed");
        assert_eq!(failed.retry_at_ms, None);
        assert_eq!(failed.attempt_count, 1);
        assert_eq!(failed.error_code.as_deref(), Some("credential_missing"));
    }

    #[tokio::test]
    async fn remote_phases_advance_without_losing_retry_progress() {
        let pool = pool().await;
        let mut run = run();
        run.target_kind = "webdav".to_string();
        run.target_path = "pending://webdav".to_string();
        claim_run(&pool, &run).await.unwrap();
        mark_staged(
            &pool,
            &run.run_key,
            "C:\\Temp\\stage.zip",
            &"a".repeat(64),
            42,
            300,
        )
        .await
        .unwrap();
        update_target_path(&pool, &run.run_key, "/Patina/automatic.zip", 301)
            .await
            .unwrap();
        mark_uploaded(&pool, &run.run_key, Some("etag"), 302)
            .await
            .unwrap();
        mark_failed_or_retry(&pool, &run.run_key, 1, "network", "temporary", 303)
            .await
            .unwrap();
        assert!(start_retry(&pool, &run.run_key, 303 + 5 * 60 * 1000)
            .await
            .unwrap());
        let resumed = load_run(&pool, &run.run_key).await.unwrap().unwrap();
        assert_eq!(resumed.phase, "uploaded");
        assert_eq!(resumed.target_path, "/Patina/automatic.zip");
        assert_eq!(resumed.archive_sha256, Some("a".repeat(64)));
    }

    #[tokio::test]
    async fn published_validation_failure_is_never_downgraded_to_absent() {
        let pool = pool().await;
        let run = run();
        claim_run(&pool, &run).await.unwrap();
        mark_validation_conflict(&pool, &run.run_key, 1, "invalid archive", 1_000)
            .await
            .unwrap();

        let conflicted = load_run(&pool, &run.run_key).await.unwrap().unwrap();
        assert_eq!(conflicted.status, "retry_wait");
        assert_eq!(conflicted.file_state, "conflict");
        assert_eq!(conflicted.error_code.as_deref(), Some("validation_failed"));

        assert!(
            mark_failed_or_retry(&pool, &run.run_key, 1, "io", "missing", 2_000)
                .await
                .is_err()
        );
        assert_eq!(
            load_run(&pool, &run.run_key)
                .await
                .unwrap()
                .unwrap()
                .file_state,
            "conflict"
        );
    }

    #[tokio::test]
    async fn superseding_an_old_retry_preserves_its_file_state() {
        let pool = pool().await;
        let run = run();
        claim_run(&pool, &run).await.unwrap();
        mark_validation_conflict(&pool, &run.run_key, 1, "invalid archive", 1_000)
            .await
            .unwrap();
        mark_superseded(&pool, &run.run_key, 2_000).await.unwrap();

        let superseded = load_run(&pool, &run.run_key).await.unwrap().unwrap();
        assert_eq!(superseded.status, "failed");
        assert_eq!(superseded.file_state, "conflict");
        assert_eq!(
            superseded.error_code.as_deref(),
            Some("superseded_by_newer_slot")
        );
        assert_eq!(superseded.retry_at_ms, None);
    }

    #[tokio::test]
    async fn retention_candidates_are_sorted_and_isolated_by_generation() {
        let pool = pool().await;
        for (index, (generation, date)) in [
            ("g", "2026-08-05"),
            ("g", "2026-08-06"),
            ("g", "2026-08-08"),
            ("other", "2026-08-09"),
            ("g", "2026-08-07"),
        ]
        .into_iter()
        .enumerate()
        {
            let mut candidate = run();
            candidate.run_key = format!("run-{index}");
            candidate.target_generation = generation.to_string();
            candidate.logical_date = date.to_string();
            candidate.target_path = format!("C:\\Backups\\{index}.zip");
            assert!(claim_run(&pool, &candidate).await.unwrap());
            mark_succeeded(
                &pool,
                &candidate.run_key,
                &format!("{index:064x}"),
                100 + index as u64,
                1_000 + index as i64,
            )
            .await
            .unwrap();
        }

        let candidates = list_retention_candidates(&pool, "g").await.unwrap();
        assert_eq!(
            candidates
                .iter()
                .map(|run| run.logical_date.as_str())
                .collect::<Vec<_>>(),
            vec!["2026-08-08", "2026-08-07", "2026-08-06", "2026-08-05"]
        );
        assert!(candidates.iter().all(|run| run.target_generation == "g"));
        assert_eq!(
            candidates
                .iter()
                .skip(usize::from(SCHEDULED_BACKUP_KEEP_COUNT))
                .map(|run| run.logical_date.as_str())
                .collect::<Vec<_>>(),
            vec!["2026-08-07", "2026-08-06", "2026-08-05"]
        );
    }
}
