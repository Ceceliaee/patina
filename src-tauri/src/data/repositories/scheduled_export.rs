use crate::domain::export_schedule::{
    ScheduledExportCadence, ScheduledExportConfig, ScheduledExportFormat, ScheduledExportRun,
};
use sqlx::{Pool, Row, Sqlite};

pub async fn load_config(pool: &Pool<Sqlite>) -> Result<Option<ScheduledExportConfig>, String> {
    let row = sqlx::query(
        "SELECT enabled, cadence, weekday, local_time_minutes, target_dir, format,
                selected_fields_json, plan_generation, schedule_anchor_at_ms, updated_at_ms
         FROM scheduled_export_config WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to load scheduled export configuration: {error}"))?;
    row.map(config_from_row).transpose()
}

pub async fn save_config(
    pool: &Pool<Sqlite>,
    config: &ScheduledExportConfig,
) -> Result<(), String> {
    save_config_with_cancellation(pool, config, None).await
}

pub async fn save_config_with_cancellation(
    pool: &Pool<Sqlite>,
    config: &ScheduledExportConfig,
    cancellation: Option<(&str, &str, i64)>,
) -> Result<(), String> {
    config.validate_shape()?;
    let fields = serde_json::to_string(&config.selected_fields)
        .map_err(|error| format!("failed to encode scheduled export fields: {error}"))?;
    let mut tx = pool.begin().await.map_err(|error| {
        format!("failed to begin scheduled export configuration update: {error}")
    })?;
    if let Some((error_code, error_message, now_ms)) = cancellation {
        sqlx::query(
            "UPDATE scheduled_export_runs
             SET status = 'failed', retry_at_ms = NULL, completed_at_ms = ?, error_code = ?,
                 error_message = ?, updated_at_ms = ?
             WHERE status IN ('running', 'retry_wait')",
        )
        .bind(now_ms)
        .bind(error_code)
        .bind(error_message)
        .bind(now_ms)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to cancel scheduled export runs: {error}"))?;
    }
    sqlx::query(
        "INSERT INTO scheduled_export_config (
            id, enabled, cadence, weekday, local_time_minutes, target_dir, format,
            selected_fields_json, plan_generation, schedule_anchor_at_ms, updated_at_ms
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            enabled = excluded.enabled,
            cadence = excluded.cadence,
            weekday = excluded.weekday,
            local_time_minutes = excluded.local_time_minutes,
            target_dir = excluded.target_dir,
            format = excluded.format,
            selected_fields_json = excluded.selected_fields_json,
            plan_generation = excluded.plan_generation,
            schedule_anchor_at_ms = excluded.schedule_anchor_at_ms,
            updated_at_ms = excluded.updated_at_ms",
    )
    .bind(i64::from(config.enabled))
    .bind(config.cadence.as_str())
    .bind(config.weekday.map(i64::from))
    .bind(i64::from(config.local_time_minutes))
    .bind(&config.target_dir)
    .bind(config.format.as_str())
    .bind(fields)
    .bind(&config.plan_generation)
    .bind(config.schedule_anchor_at_ms)
    .bind(config.updated_at_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to save scheduled export configuration: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit scheduled export configuration: {error}"))?;
    Ok(())
}

pub async fn claim_run(pool: &Pool<Sqlite>, run: &ScheduledExportRun) -> Result<bool, String> {
    let fields = serde_json::to_string(&run.selected_fields)
        .map_err(|error| format!("failed to encode scheduled export run fields: {error}"))?;
    let affected = sqlx::query(
        "INSERT INTO scheduled_export_runs (
            run_key, plan_generation, cadence, logical_start_date, logical_end_date,
            period_start_ms, period_end_ms, format, selected_fields_json, target_path,
            staging_path, phase, status, file_state, attempt_count, retry_at_ms, row_count,
            size_bytes, sha256, error_code, error_message, started_at_ms, completed_at_ms,
            updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'claimed', 'running', 'absent', 1,
                   NULL, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?)
         ON CONFLICT DO NOTHING",
    )
    .bind(&run.run_key)
    .bind(&run.plan_generation)
    .bind(run.cadence.as_str())
    .bind(&run.logical_start_date)
    .bind(&run.logical_end_date)
    .bind(run.period_start_ms)
    .bind(run.period_end_ms)
    .bind(run.format.as_str())
    .bind(fields)
    .bind(&run.target_path)
    .bind(&run.staging_path)
    .bind(run.started_at_ms)
    .bind(run.updated_at_ms)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to claim scheduled export run: {error}"))?
    .rows_affected();
    Ok(affected == 1)
}

pub async fn load_run(
    pool: &Pool<Sqlite>,
    run_key: &str,
) -> Result<Option<ScheduledExportRun>, String> {
    let row = sqlx::query(&format!("{} WHERE run_key = ? LIMIT 1", run_select_sql()))
        .bind(run_key)
        .fetch_optional(pool)
        .await
        .map_err(|error| format!("failed to load scheduled export run: {error}"))?;
    row.map(run_from_row).transpose()
}

pub async fn load_period(
    pool: &Pool<Sqlite>,
    generation: &str,
    period_start_ms: i64,
    period_end_ms: i64,
) -> Result<Option<ScheduledExportRun>, String> {
    let row = sqlx::query(&format!(
        "{} WHERE plan_generation = ? AND period_start_ms = ? AND period_end_ms = ? LIMIT 1",
        run_select_sql()
    ))
    .bind(generation)
    .bind(period_start_ms)
    .bind(period_end_ms)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to load scheduled export period: {error}"))?;
    row.map(run_from_row).transpose()
}

pub async fn load_active(pool: &Pool<Sqlite>) -> Result<Option<ScheduledExportRun>, String> {
    let row = sqlx::query(&format!(
        "{} WHERE status IN ('running', 'retry_wait') ORDER BY updated_at_ms DESC LIMIT 1",
        run_select_sql()
    ))
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to load active scheduled export: {error}"))?;
    row.map(run_from_row).transpose()
}

pub async fn load_recent_by_status(
    pool: &Pool<Sqlite>,
    generation: &str,
    status: &str,
) -> Result<Option<ScheduledExportRun>, String> {
    let row = sqlx::query(&format!(
        "{} WHERE plan_generation = ? AND status = ? ORDER BY updated_at_ms DESC LIMIT 1",
        run_select_sql()
    ))
    .bind(generation)
    .bind(status)
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to load recent scheduled export state: {error}"))?;
    row.map(run_from_row).transpose()
}

pub async fn start_retry(pool: &Pool<Sqlite>, run_key: &str, now_ms: i64) -> Result<bool, String> {
    let affected = sqlx::query(
        "UPDATE scheduled_export_runs
         SET status = 'running', attempt_count = attempt_count + 1, retry_at_ms = NULL,
             completed_at_ms = NULL, error_code = NULL, error_message = NULL,
             started_at_ms = ?, updated_at_ms = ?
         WHERE run_key = ? AND status = 'retry_wait' AND attempt_count < 3",
    )
    .bind(now_ms)
    .bind(now_ms)
    .bind(run_key)
    .execute(pool)
    .await
    .map_err(|error| format!("failed to start scheduled export retry: {error}"))?
    .rows_affected();
    Ok(affected == 1)
}

pub async fn mark_written(
    pool: &Pool<Sqlite>,
    run_key: &str,
    staging_path: &str,
    row_count: u64,
    now_ms: i64,
) -> Result<(), String> {
    let row_count = i64::try_from(row_count)
        .map_err(|_| "scheduled export row count is too large to record".to_string())?;
    transition(
        sqlx::query(
            "UPDATE scheduled_export_runs
             SET staging_path = ?, phase = 'written', row_count = ?, updated_at_ms = ?
             WHERE run_key = ? AND status = 'running' AND phase = 'claimed'",
        )
        .bind(staging_path)
        .bind(row_count)
        .bind(now_ms)
        .bind(run_key)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to record scheduled export write: {error}"))?
        .rows_affected(),
        "record scheduled export write",
    )
}

pub async fn mark_validated(
    pool: &Pool<Sqlite>,
    run_key: &str,
    sha256: &str,
    size_bytes: u64,
    now_ms: i64,
) -> Result<(), String> {
    let size_bytes = i64::try_from(size_bytes)
        .map_err(|_| "scheduled export file is too large to record".to_string())?;
    transition(
        sqlx::query(
            "UPDATE scheduled_export_runs
             SET phase = 'validated', sha256 = ?, size_bytes = ?, updated_at_ms = ?
             WHERE run_key = ? AND status = 'running' AND phase = 'written'",
        )
        .bind(sha256)
        .bind(size_bytes)
        .bind(now_ms)
        .bind(run_key)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to record scheduled export validation: {error}"))?
        .rows_affected(),
        "record scheduled export validation",
    )
}

pub async fn restart_missing_staging(
    pool: &Pool<Sqlite>,
    run_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    transition(
        sqlx::query(
            "UPDATE scheduled_export_runs
             SET phase = 'claimed', file_state = 'absent', row_count = NULL,
                 size_bytes = NULL, sha256 = NULL, updated_at_ms = ?
             WHERE run_key = ? AND status = 'running'
               AND phase IN ('written', 'validated')",
        )
        .bind(now_ms)
        .bind(run_key)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to restart interrupted scheduled export: {error}"))?
        .rows_affected(),
        "restart interrupted scheduled export",
    )
}

pub async fn mark_published(pool: &Pool<Sqlite>, run_key: &str, now_ms: i64) -> Result<(), String> {
    transition(
        sqlx::query(
            "UPDATE scheduled_export_runs
             SET phase = 'published', file_state = 'present', updated_at_ms = ?
             WHERE run_key = ? AND status = 'running' AND phase = 'validated'",
        )
        .bind(now_ms)
        .bind(run_key)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to record scheduled export publication: {error}"))?
        .rows_affected(),
        "record scheduled export publication",
    )
}

pub async fn mark_succeeded(pool: &Pool<Sqlite>, run_key: &str, now_ms: i64) -> Result<(), String> {
    transition(
        sqlx::query(
            "UPDATE scheduled_export_runs
             SET phase = 'succeeded', status = 'succeeded', file_state = 'present',
                 staging_path = NULL, retry_at_ms = NULL, completed_at_ms = ?, error_code = NULL,
                 error_message = NULL, updated_at_ms = ?
             WHERE run_key = ? AND status = 'running' AND phase = 'published'",
        )
        .bind(now_ms)
        .bind(now_ms)
        .bind(run_key)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to finish scheduled export: {error}"))?
        .rows_affected(),
        "finish scheduled export",
    )
}

pub async fn mark_recovered_success(
    pool: &Pool<Sqlite>,
    run_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    transition(
        sqlx::query(
            "UPDATE scheduled_export_runs
             SET phase = 'succeeded', status = 'succeeded', file_state = 'present',
                 staging_path = NULL, retry_at_ms = NULL, completed_at_ms = ?, error_code = NULL,
                 error_message = NULL, updated_at_ms = ?
             WHERE run_key = ? AND status = 'running' AND phase IN ('validated', 'published')",
        )
        .bind(now_ms)
        .bind(now_ms)
        .bind(run_key)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to reconcile scheduled export success: {error}"))?
        .rows_affected(),
        "reconcile scheduled export success",
    )
}

pub async fn mark_failed_or_retry(
    pool: &Pool<Sqlite>,
    run: &ScheduledExportRun,
    error_code: &str,
    error_message: &str,
    retryable: bool,
    now_ms: i64,
) -> Result<(), String> {
    let retry = retryable && run.attempt_count < 3;
    let retry_at_ms = retry.then_some(now_ms.saturating_add(match run.attempt_count {
        1 => 60_000,
        2 => 5 * 60_000,
        _ => 30 * 60_000,
    }));
    let status = if retry { "retry_wait" } else { "failed" };
    let file_state = if error_code == "target_conflict" {
        "conflict"
    } else {
        "absent"
    };
    transition(
        sqlx::query(
            "UPDATE scheduled_export_runs
             SET status = ?, file_state = ?, retry_at_ms = ?, completed_at_ms = ?,
                 error_code = ?, error_message = ?, updated_at_ms = ?
             WHERE run_key = ? AND status = 'running'",
        )
        .bind(status)
        .bind(file_state)
        .bind(retry_at_ms)
        .bind(now_ms)
        .bind(error_code)
        .bind(error_message)
        .bind(now_ms)
        .bind(&run.run_key)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to record scheduled export failure: {error}"))?
        .rows_affected(),
        "record scheduled export failure",
    )
}

pub async fn mark_superseded(
    pool: &Pool<Sqlite>,
    run_key: &str,
    now_ms: i64,
) -> Result<(), String> {
    transition(
        sqlx::query(
            "UPDATE scheduled_export_runs
             SET status = 'superseded', retry_at_ms = NULL, completed_at_ms = ?,
                 error_code = 'superseded', error_message = 'A newer complete period became due.',
                 updated_at_ms = ?
             WHERE run_key = ?
               AND (
                 status = 'retry_wait'
                 OR (status = 'running' AND phase IN ('claimed', 'written'))
               )",
        )
        .bind(now_ms)
        .bind(now_ms)
        .bind(run_key)
        .execute(pool)
        .await
        .map_err(|error| format!("failed to supersede scheduled export: {error}"))?
        .rows_affected(),
        "supersede scheduled export",
    )
}

pub async fn reset_after_replace_restore(
    pool: &Pool<Sqlite>,
    new_generation: &str,
    now_ms: i64,
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin scheduled export restore reset: {error}"))?;
    sqlx::query(
        "UPDATE scheduled_export_config
         SET enabled = 0, plan_generation = ?, schedule_anchor_at_ms = ?, updated_at_ms = ?
         WHERE id = 1",
    )
    .bind(new_generation)
    .bind(now_ms)
    .bind(now_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to pause scheduled export after restore: {error}"))?;
    sqlx::query(
        "UPDATE scheduled_export_runs
         SET status = 'failed', retry_at_ms = NULL, completed_at_ms = ?,
             error_code = 'restore_replaced_data',
             error_message = 'The database was replaced before this export completed.',
             updated_at_ms = ?
         WHERE status IN ('running', 'retry_wait')",
    )
    .bind(now_ms)
    .bind(now_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to stop scheduled export after restore: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit scheduled export restore reset: {error}"))?;
    Ok(())
}

fn transition(affected: u64, action: &str) -> Result<(), String> {
    if affected == 1 {
        Ok(())
    } else {
        Err(format!(
            "failed to {action}: scheduled export state changed unexpectedly"
        ))
    }
}

fn run_select_sql() -> &'static str {
    "SELECT run_key, plan_generation, cadence, logical_start_date, logical_end_date,
            period_start_ms, period_end_ms, format, selected_fields_json, target_path,
            staging_path, phase, status, file_state, attempt_count, retry_at_ms, row_count,
            size_bytes, sha256, error_code, error_message, started_at_ms, completed_at_ms,
            updated_at_ms
     FROM scheduled_export_runs"
}

fn decode_fields(value: String) -> Result<Vec<String>, String> {
    serde_json::from_str::<Vec<String>>(&value)
        .map_err(|_| "invalid scheduled export fields in storage".to_string())
}

fn config_from_row(row: sqlx::sqlite::SqliteRow) -> Result<ScheduledExportConfig, String> {
    let config = ScheduledExportConfig {
        enabled: row.get::<i64, _>("enabled") != 0,
        cadence: ScheduledExportCadence::parse(&row.get::<String, _>("cadence"))?,
        weekday: row
            .get::<Option<i64>, _>("weekday")
            .map(u8::try_from)
            .transpose()
            .map_err(|_| "invalid scheduled export weekday in storage".to_string())?,
        local_time_minutes: u16::try_from(row.get::<i64, _>("local_time_minutes"))
            .map_err(|_| "invalid scheduled export time in storage".to_string())?,
        target_dir: row.get("target_dir"),
        format: ScheduledExportFormat::parse(&row.get::<String, _>("format"))?,
        selected_fields: decode_fields(row.get("selected_fields_json"))?,
        plan_generation: row.get("plan_generation"),
        schedule_anchor_at_ms: row.get("schedule_anchor_at_ms"),
        updated_at_ms: row.get("updated_at_ms"),
    };
    config.validate_shape()?;
    Ok(config)
}

fn run_from_row(row: sqlx::sqlite::SqliteRow) -> Result<ScheduledExportRun, String> {
    Ok(ScheduledExportRun {
        run_key: row.get("run_key"),
        plan_generation: row.get("plan_generation"),
        cadence: ScheduledExportCadence::parse(&row.get::<String, _>("cadence"))?,
        logical_start_date: row.get("logical_start_date"),
        logical_end_date: row.get("logical_end_date"),
        period_start_ms: row.get("period_start_ms"),
        period_end_ms: row.get("period_end_ms"),
        format: ScheduledExportFormat::parse(&row.get::<String, _>("format"))?,
        selected_fields: decode_fields(row.get("selected_fields_json"))?,
        target_path: row.get("target_path"),
        staging_path: row.get("staging_path"),
        phase: row.get("phase"),
        status: row.get("status"),
        file_state: row.get("file_state"),
        attempt_count: u8::try_from(row.get::<i64, _>("attempt_count"))
            .map_err(|_| "invalid scheduled export attempt count in storage".to_string())?,
        retry_at_ms: row.get("retry_at_ms"),
        row_count: row
            .get::<Option<i64>, _>("row_count")
            .map(u64::try_from)
            .transpose()
            .map_err(|_| "invalid scheduled export row count in storage".to_string())?,
        size_bytes: row
            .get::<Option<i64>, _>("size_bytes")
            .map(u64::try_from)
            .transpose()
            .map_err(|_| "invalid scheduled export size in storage".to_string())?,
        sha256: row.get("sha256"),
        error_code: row.get("error_code"),
        error_message: row.get("error_message"),
        started_at_ms: row.get("started_at_ms"),
        completed_at_ms: row.get("completed_at_ms"),
        updated_at_ms: row.get("updated_at_ms"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema::SCHEDULED_EXPORT_SCHEMA_SQL;
    use sqlx::{Executor, SqlitePool};

    async fn pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(SCHEDULED_EXPORT_SCHEMA_SQL).await.unwrap();
        pool
    }

    fn config() -> ScheduledExportConfig {
        ScheduledExportConfig {
            enabled: true,
            cadence: ScheduledExportCadence::Weekly,
            weekday: Some(1),
            local_time_minutes: 120,
            target_dir: "C:\\Exports".to_string(),
            format: ScheduledExportFormat::Csv,
            selected_fields: vec!["url".to_string(), "record_type".to_string()],
            plan_generation: "generation-a".to_string(),
            schedule_anchor_at_ms: 100,
            updated_at_ms: 100,
        }
    }

    fn run() -> ScheduledExportRun {
        ScheduledExportRun {
            run_key: "scheduled-export:g:daily:2026-08-08:2026-08-08".to_string(),
            plan_generation: "g".to_string(),
            cadence: ScheduledExportCadence::Daily,
            logical_start_date: "2026-08-08".to_string(),
            logical_end_date: "2026-08-08".to_string(),
            period_start_ms: 1,
            period_end_ms: 2,
            format: ScheduledExportFormat::Csv,
            selected_fields: vec!["record_type".to_string()],
            target_path: "C:\\Exports\\Patina-scheduled-export-20260808.csv".to_string(),
            staging_path: Some("C:\\Exports\\.staging.csv".to_string()),
            phase: "claimed".to_string(),
            status: "running".to_string(),
            file_state: "absent".to_string(),
            attempt_count: 1,
            retry_at_ms: None,
            row_count: None,
            size_bytes: None,
            sha256: None,
            error_code: None,
            error_message: None,
            started_at_ms: 100,
            completed_at_ms: None,
            updated_at_ms: 100,
        }
    }

    #[tokio::test]
    async fn configuration_round_trip_preserves_field_order() {
        let pool = pool().await;
        save_config(&pool, &config()).await.unwrap();
        let loaded = load_config(&pool).await.unwrap().unwrap();
        assert_eq!(loaded, config());
        assert_eq!(loaded.selected_fields, vec!["url", "record_type"]);
    }

    #[tokio::test]
    async fn configuration_and_active_run_cancellation_commit_atomically() {
        let pool = pool().await;
        let original = config();
        save_config(&pool, &original).await.unwrap();
        claim_run(&pool, &run()).await.unwrap();
        pool.execute(
            "CREATE TRIGGER reject_scheduled_export_config_update
             BEFORE UPDATE ON scheduled_export_config
             BEGIN SELECT RAISE(ABORT, 'blocked'); END",
        )
        .await
        .unwrap();

        let mut changed = original.clone();
        changed.local_time_minutes = 180;
        changed.updated_at_ms = 200;
        assert!(save_config_with_cancellation(
            &pool,
            &changed,
            Some(("configuration_changed", "changed", 200)),
        )
        .await
        .is_err());

        assert_eq!(load_config(&pool).await.unwrap(), Some(original));
        assert_eq!(
            load_run(&pool, &run().run_key)
                .await
                .unwrap()
                .unwrap()
                .status,
            "running"
        );
    }

    #[tokio::test]
    async fn the_same_generation_and_period_can_only_be_claimed_once() {
        let pool = pool().await;
        assert!(claim_run(&pool, &run()).await.unwrap());
        let mut duplicate = run();
        duplicate.run_key = "another-key".to_string();
        assert!(!claim_run(&pool, &duplicate).await.unwrap());
    }

    #[tokio::test]
    async fn run_transitions_require_the_expected_previous_phase() {
        let pool = pool().await;
        claim_run(&pool, &run()).await.unwrap();
        assert!(mark_validated(&pool, &run().run_key, "hash", 1, 200)
            .await
            .is_err());
        mark_written(&pool, &run().run_key, "C:\\Exports\\.staging.csv", 0, 200)
            .await
            .unwrap();
        mark_validated(&pool, &run().run_key, "hash", 1, 300)
            .await
            .unwrap();
        mark_published(&pool, &run().run_key, 400).await.unwrap();
        mark_succeeded(&pool, &run().run_key, 500).await.unwrap();
        assert_eq!(
            load_run(&pool, &run().run_key)
                .await
                .unwrap()
                .unwrap()
                .status,
            "succeeded"
        );
        assert_eq!(
            load_run(&pool, &run().run_key)
                .await
                .unwrap()
                .unwrap()
                .staging_path,
            None
        );
    }

    #[tokio::test]
    async fn missing_staging_can_restart_from_a_clean_claimed_phase() {
        let pool = pool().await;
        claim_run(&pool, &run()).await.unwrap();
        mark_written(&pool, &run().run_key, "C:\\Exports\\.staging.csv", 2, 200)
            .await
            .unwrap();
        mark_validated(&pool, &run().run_key, "hash", 12, 300)
            .await
            .unwrap();

        restart_missing_staging(&pool, &run().run_key, 400)
            .await
            .unwrap();

        let restarted = load_run(&pool, &run().run_key).await.unwrap().unwrap();
        assert_eq!(restarted.phase, "claimed");
        assert_eq!(restarted.status, "running");
        assert_eq!(restarted.row_count, None);
        assert_eq!(restarted.size_bytes, None);
        assert_eq!(restarted.sha256, None);
    }

    #[tokio::test]
    async fn replace_restore_disables_the_plan_and_terminates_active_ownership() {
        let pool = pool().await;
        save_config(&pool, &config()).await.unwrap();
        claim_run(&pool, &run()).await.unwrap();

        reset_after_replace_restore(&pool, "generation-after-restore", 500)
            .await
            .unwrap();

        let restored = load_config(&pool).await.unwrap().unwrap();
        assert!(!restored.enabled);
        assert_eq!(restored.plan_generation, "generation-after-restore");
        assert_eq!(restored.schedule_anchor_at_ms, 500);
        let interrupted = load_run(&pool, &run().run_key).await.unwrap().unwrap();
        assert_eq!(interrupted.status, "failed");
        assert_eq!(
            interrupted.error_code.as_deref(),
            Some("restore_replaced_data")
        );
        assert!(load_active(&pool).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn supersede_accepts_only_unpublished_running_or_retrying_work() {
        let pool = pool().await;
        claim_run(&pool, &run()).await.unwrap();
        mark_superseded(&pool, &run().run_key, 200).await.unwrap();
        assert_eq!(
            load_run(&pool, &run().run_key)
                .await
                .unwrap()
                .unwrap()
                .status,
            "superseded"
        );

        let mut validated = run();
        validated.run_key = "scheduled-export:g:daily:2026-08-09:2026-08-09".to_string();
        validated.logical_start_date = "2026-08-09".to_string();
        validated.logical_end_date = "2026-08-09".to_string();
        validated.period_start_ms = 3;
        validated.period_end_ms = 4;
        claim_run(&pool, &validated).await.unwrap();
        mark_written(
            &pool,
            &validated.run_key,
            "C:\\Exports\\.validated.csv",
            0,
            300,
        )
        .await
        .unwrap();
        mark_validated(&pool, &validated.run_key, "hash", 1, 400)
            .await
            .unwrap();
        assert!(mark_superseded(&pool, &validated.run_key, 500)
            .await
            .is_err());
    }
}
