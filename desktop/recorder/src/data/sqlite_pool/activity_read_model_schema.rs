use super::{table_exists, table_has_columns, table_has_index};
use sqlx::{Pool, Sqlite};

async fn trigger_exists(pool: &Pool<Sqlite>, trigger_name: &str) -> Result<bool, String> {
    sqlx::query("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ? LIMIT 1")
        .bind(trigger_name)
        .fetch_optional(pool)
        .await
        .map(|row| row.is_some())
        .map_err(|error| format!("failed to inspect sqlite trigger `{trigger_name}`: {error}"))
}

async fn trigger_uses_euclidean_hour_boundaries(
    pool: &Pool<Sqlite>,
    trigger_name: &str,
) -> Result<bool, String> {
    sqlx::query_scalar::<_, Option<String>>(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ? LIMIT 1",
    )
    .bind(trigger_name)
    .fetch_one(pool)
    .await
    .map(|sql| sql.is_some_and(|sql| sql.contains("+ 3600000) % 3600000")))
    .map_err(|error| format!("failed to inspect sqlite trigger SQL `{trigger_name}`: {error}"))
}

pub(in crate::data) async fn has_activity_read_models_schema(
    pool: &Pool<Sqlite>,
) -> Result<bool, String> {
    for table_name in [
        "read_model_revision",
        "read_model_state",
        "activity_summary_dirty_ranges",
        "app_catalog_dirty_keys",
        "recorded_app_catalog",
        "activity_hourly_effective",
    ] {
        if !table_exists(pool, table_name).await? {
            return Ok(false);
        }
    }

    let revision_ready = table_has_columns(
        pool,
        "read_model_revision",
        &["id", "source_revision", "updated_at_ms"],
    )
    .await?;
    let state_ready = table_has_columns(
        pool,
        "read_model_state",
        &[
            "model_name",
            "schema_version",
            "algorithm_version",
            "timezone_fingerprint",
            "state",
            "coverage_start_ms",
            "coverage_end_ms",
            "backfill_cursor_ms",
            "backfill_target_revision",
            "last_success_revision",
            "last_error_code",
            "updated_at_ms",
        ],
    )
    .await?;
    let dirty_ranges_ready = table_has_columns(
        pool,
        "activity_summary_dirty_ranges",
        &[
            "id",
            "start_ms",
            "end_ms",
            "generation",
            "reason",
            "created_at_ms",
        ],
    )
    .await?;
    let dirty_keys_ready = table_has_columns(
        pool,
        "app_catalog_dirty_keys",
        &["app_key", "generation", "reason", "created_at_ms"],
    )
    .await?;
    let catalog_ready = table_has_columns(
        pool,
        "recorded_app_catalog",
        &[
            "app_key",
            "raw_exe_name",
            "display_app_name",
            "last_seen_ms",
            "has_native_records",
            "has_import_exact_records",
            "has_import_bucket_records",
            "computed_revision",
            "updated_at_ms",
        ],
    )
    .await?;
    let hourly_ready = table_has_columns(
        pool,
        "activity_hourly_effective",
        &[
            "bucket_start_ms",
            "bucket_end_ms",
            "app_key",
            "raw_exe_name",
            "display_app_name",
            "origin",
            "source_id",
            "effective_duration_ms",
            "computed_revision",
            "updated_at_ms",
        ],
    )
    .await?;
    let indexes_ready = table_has_index(
        pool,
        "activity_summary_dirty_ranges",
        "idx_activity_dirty_ranges_window",
    )
    .await?
        && table_has_index(
            pool,
            "app_catalog_dirty_keys",
            "idx_app_catalog_dirty_generation",
        )
        .await?
        && table_has_index(
            pool,
            "recorded_app_catalog",
            "idx_recorded_app_catalog_page",
        )
        .await?
        && table_has_index(
            pool,
            "recorded_app_catalog",
            "idx_recorded_app_catalog_search",
        )
        .await?
        && table_has_index(
            pool,
            "activity_hourly_effective",
            "idx_activity_hourly_range",
        )
        .await?
        && table_has_index(
            pool,
            "activity_hourly_effective",
            "idx_activity_hourly_app_range",
        )
        .await?;

    let mut triggers_ready = true;
    for trigger_name in [
        "trg_read_model_sessions_insert",
        "trg_read_model_sessions_update",
        "trg_read_model_sessions_delete",
        "trg_read_model_exact_insert",
        "trg_read_model_exact_update",
        "trg_read_model_exact_delete",
        "trg_read_model_bucket_insert",
        "trg_read_model_bucket_update",
        "trg_read_model_bucket_delete",
    ] {
        triggers_ready = trigger_exists(pool, trigger_name).await?
            && trigger_uses_euclidean_hour_boundaries(pool, trigger_name).await?
            && triggers_ready;
    }

    let revision_row_ready =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM read_model_revision WHERE id = 1")
            .fetch_one(pool)
            .await
            .map_err(|error| format!("failed to inspect read model revision seed: {error}"))?
            == 1;
    let state_rows_ready = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM read_model_state
         WHERE model_name IN ('app_catalog', 'activity_hourly')",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to inspect read model state seeds: {error}"))?
        == 2;

    Ok(revision_ready
        && state_ready
        && dirty_ranges_ready
        && dirty_keys_ready
        && catalog_ready
        && hourly_ready
        && indexes_ready
        && triggers_ready
        && revision_row_ready
        && state_rows_ready)
}
