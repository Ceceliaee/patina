use sqlx::{Pool, Row, Sqlite};
use std::collections::BTreeSet;

pub async fn has_web_activity_session_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let columns = table_columns(pool, "web_activity_native_sessions").await?;
    let indexes = table_indexes(pool, "web_activity_native_sessions").await?;
    let trigger: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_native_session_web_boundary'")
        .fetch_one(pool).await.map_err(|error| error.to_string())?;
    Ok(columns.contains("segment_id")
        && columns.contains("session_id")
        && indexes.contains("idx_web_activity_native_session")
        && trigger == 1)
}

pub async fn has_web_activity_revision_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let rows = sqlx::query("PRAGMA table_info(web_activity_revision)")
        .fetch_all(pool)
        .await
        .map_err(|error| {
            format!("failed to inspect web_activity_revision schema columns: {error}")
        })?;
    let columns = rows
        .iter()
        .map(|row| row.get::<String, _>("name"))
        .collect::<Vec<_>>();

    Ok(["id", "source_revision", "updated_at_ms"]
        .iter()
        .all(|required| columns.iter().any(|column| column == required)))
}

async fn table_columns(pool: &Pool<Sqlite>, table: &str) -> Result<BTreeSet<String>, String> {
    let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect {table} schema columns: {error}"))?;
    Ok(rows
        .iter()
        .map(|row| row.get::<String, _>("name"))
        .collect())
}

async fn table_indexes(pool: &Pool<Sqlite>, table: &str) -> Result<BTreeSet<String>, String> {
    let rows = sqlx::query(&format!("PRAGMA index_list({table})"))
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect {table} schema indexes: {error}"))?;
    Ok(rows
        .iter()
        .map(|row| row.get::<String, _>("name"))
        .collect())
}

pub async fn has_activity_reminder_rules_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let columns = table_columns(pool, "tool_activity_reminder_rules").await?;
    let indexes = table_indexes(pool, "tool_activity_reminder_rules").await?;
    let legacy_columns = table_columns(pool, "tool_software_reminder_rules").await?;
    Ok([
        "id",
        "target_kind",
        "app_name",
        "exe_name",
        "category_id",
        "normalized_domain",
        "label_snapshot",
        "limit_ms",
        "message",
        "created_at",
        "updated_at",
        "disabled_at",
        "last_fired_date_key",
    ]
    .iter()
    .all(|column| columns.contains(*column))
        && [
            "idx_tool_activity_reminder_rules_active",
            "idx_tool_activity_reminder_rules_app",
            "idx_tool_activity_reminder_rules_category",
            "idx_tool_activity_reminder_rules_web",
        ]
        .iter()
        .all(|index| indexes.contains(*index))
        && legacy_columns.is_empty())
}

pub async fn has_scheduled_backup_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let config_columns = table_columns(pool, "scheduled_backup_config").await?;
    let run_columns = table_columns(pool, "scheduled_backup_runs").await?;
    let run_indexes = table_indexes(pool, "scheduled_backup_runs").await?;

    Ok([
        "id",
        "enabled",
        "cadence",
        "weekday",
        "local_time_minutes",
        "target_kind",
        "target_dir",
        "target_identity",
        "retention_count",
        "target_generation",
        "schedule_anchor_at_ms",
        "updated_at_ms",
    ]
    .iter()
    .all(|column| config_columns.contains(*column))
        && [
            "run_key",
            "target_generation",
            "target_kind",
            "logical_date",
            "logical_time_minutes",
            "status",
            "attempt_count",
            "target_path",
            "staging_path",
            "phase",
            "remote_etag",
            "archive_sha256",
            "size_bytes",
            "file_state",
            "retry_at_ms",
            "error_code",
            "error_message",
            "cleanup_warning",
            "started_at_ms",
            "completed_at_ms",
            "updated_at_ms",
        ]
        .iter()
        .all(|column| run_columns.contains(*column))
        && run_indexes.contains("idx_scheduled_backup_runs_retention")
        && run_indexes.contains("idx_scheduled_backup_runs_status_retry"))
}

pub async fn has_scheduled_export_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let config_columns = table_columns(pool, "scheduled_export_config").await?;
    let run_columns = table_columns(pool, "scheduled_export_runs").await?;
    let run_indexes = table_indexes(pool, "scheduled_export_runs").await?;

    Ok([
        "id",
        "enabled",
        "cadence",
        "weekday",
        "local_time_minutes",
        "target_dir",
        "format",
        "selected_fields_json",
        "plan_generation",
        "schedule_anchor_at_ms",
        "updated_at_ms",
    ]
    .iter()
    .all(|column| config_columns.contains(*column))
        && [
            "run_key",
            "plan_generation",
            "cadence",
            "logical_start_date",
            "logical_end_date",
            "period_start_ms",
            "period_end_ms",
            "format",
            "selected_fields_json",
            "target_path",
            "staging_path",
            "phase",
            "status",
            "file_state",
            "attempt_count",
            "retry_at_ms",
            "row_count",
            "size_bytes",
            "sha256",
            "error_code",
            "error_message",
            "started_at_ms",
            "completed_at_ms",
            "updated_at_ms",
        ]
        .iter()
        .all(|column| run_columns.contains(*column))
        && run_indexes.contains("idx_scheduled_export_runs_status_retry")
        && run_indexes.contains("idx_scheduled_export_runs_recent"))
}

pub async fn has_local_only_scheduled_backup_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let config_columns = table_columns(pool, "scheduled_backup_config").await?;
    let run_columns = table_columns(pool, "scheduled_backup_runs").await?;
    let run_indexes = table_indexes(pool, "scheduled_backup_runs").await?;
    Ok(config_columns.contains("target_dir")
        && !config_columns.contains("target_kind")
        && run_columns.contains("target_path")
        && !run_columns.contains("target_kind")
        && run_indexes.contains("idx_scheduled_backup_runs_retention")
        && run_indexes.contains("idx_scheduled_backup_runs_status_retry"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema::{SCHEDULED_BACKUP_SCHEMA_SQL, SCHEDULED_BACKUP_TARGETS_SCHEMA_SQL};
    use sqlx::{Executor, SqlitePool};

    #[test]
    fn scheduled_backup_contract_matches_migration_schema() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(SCHEDULED_BACKUP_SCHEMA_SQL).await.unwrap();
            pool.execute(SCHEDULED_BACKUP_TARGETS_SCHEMA_SQL)
                .await
                .unwrap();
            assert!(has_scheduled_backup_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn scheduled_export_contract_matches_migration_schema() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(crate::data::schema::SCHEDULED_EXPORT_SCHEMA_SQL)
                .await
                .unwrap();
            assert!(has_scheduled_export_schema(&pool).await.unwrap());
        });
    }

    #[test]
    fn scheduled_backup_target_migration_preserves_local_configuration_and_runs() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(SCHEDULED_BACKUP_SCHEMA_SQL).await.unwrap();
            pool.execute(
                "INSERT INTO scheduled_backup_config (
                    id, enabled, cadence, weekday, local_time_minutes, target_dir,
                    retention_count, target_generation, schedule_anchor_at_ms, updated_at_ms
                 ) VALUES (1, 1, 'daily', NULL, 120, 'C:\\Backups', 3, 'generation', 1, 1)",
            )
            .await
            .unwrap();
            pool.execute(
                "INSERT INTO scheduled_backup_runs (
                    run_key, target_generation, logical_date, logical_time_minutes, target_path,
                    status, file_state, attempt_count, started_at_ms, updated_at_ms
                 ) VALUES (
                    'scheduled-local-backup:generation:2026-08-09:0200', 'generation',
                    '2026-08-09', 120, 'C:\\Backups\\one.zip', 'running', 'absent', 1, 1, 1
                 )",
            )
            .await
            .unwrap();
            pool.execute(SCHEDULED_BACKUP_TARGETS_SCHEMA_SQL)
                .await
                .unwrap();

            let target_kind: String =
                sqlx::query_scalar("SELECT target_kind FROM scheduled_backup_config WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let run_key: String =
                sqlx::query_scalar("SELECT run_key FROM scheduled_backup_runs LIMIT 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(target_kind, "local");
            assert_eq!(run_key, "scheduled-backup:generation:2026-08-09:0200");
            assert!(has_scheduled_backup_schema(&pool).await.unwrap());
        });
    }
}
