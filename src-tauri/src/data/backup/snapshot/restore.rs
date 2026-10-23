use super::ExtractedSnapshot;
use crate::data::backup::import_data::{
    load_external_import_backup_from_pool, merge_external_import_backup_in_tx,
};
use crate::data::backup::merge::merge_backup_records_in_tx;
use crate::data::backup::records::{load_backup_records, RestoreStrategy};
use crate::data::repositories;
use crate::data::sqlite_pool::{
    checkpoint_sqlite_pool, open_single_connection_sqlite_pool, prepare_pool_schema,
    replace_product_db_from_candidate, wait_for_sqlite_pool,
};
use sqlx::{Sqlite, Transaction};
use std::path::Path;
use tauri::AppHandle;

pub(in crate::data::backup) async fn prepare_snapshot_backup(
    backup_path: &Path,
    strategy: RestoreStrategy,
) -> Result<ExtractedSnapshot, String> {
    let extracted = super::extract_snapshot_archive(backup_path, true).await?;
    if !extracted.preview.restore_supported {
        return Err(extracted.preview.restore_message.clone());
    }

    let candidate_pool = open_single_connection_sqlite_pool(&extracted.db_path, false).await?;
    if let Err(error) = prepare_pool_schema(&candidate_pool, &extracted.db_path).await {
        candidate_pool.close().await;
        return Err(error);
    }
    if let Err(error) = super::validate_current_schema(&candidate_pool).await {
        candidate_pool.close().await;
        return Err(error);
    }
    if let Err(error) = super::validate_sqlite(&candidate_pool, true).await {
        candidate_pool.close().await;
        return Err(error);
    }
    if let Err(error) =
        prepare_snapshot_restore(&candidate_pool, extracted.preview.exported_at_ms, strategy).await
    {
        candidate_pool.close().await;
        return Err(error);
    }

    candidate_pool.close().await;
    Ok(extracted)
}

pub(in crate::data::backup) async fn restore_snapshot_backup(
    extracted: ExtractedSnapshot,
    app: &AppHandle,
    strategy: RestoreStrategy,
) -> Result<(), String> {
    match strategy {
        RestoreStrategy::Replace => {
            replace_product_db_from_candidate(app, &extracted.db_path).await
        }
        RestoreStrategy::Merge => {
            let pool = wait_for_sqlite_pool(app).await?;
            let candidate_pool =
                open_single_connection_sqlite_pool(&extracted.db_path, false).await?;
            merge_snapshot_backup(candidate_pool, &pool).await
        }
    }
}

pub(super) async fn prepare_snapshot_restore(
    candidate_pool: &sqlx::SqlitePool,
    exported_at_ms: u64,
    strategy: RestoreStrategy,
) -> Result<(), String> {
    let cutoff = (exported_at_ms.min(i64::MAX as u64) as i64)
        .min(crate::platform::clock::unix_timestamp_millis_i64());
    let sealed = async {
        crate::data::repositories::sessions::seal_interrupted_session(candidate_pool, cutoff)
            .await?;
        crate::data::repositories::web_activity::seal_interrupted_segments(candidate_pool, cutoff)
            .await?;
        crate::data::repositories::anonymous_activity::seal_interrupted(candidate_pool, cutoff)
            .await?;
        Ok::<(), sqlx::Error>(())
    }
    .await;
    sealed.map_err(|error| format!("failed to seal interrupted backup activity: {error}"))?;
    if strategy == RestoreStrategy::Replace {
        let mut tx = candidate_pool
            .begin()
            .await
            .map_err(|error| format!("failed to begin restored schedule reset: {error}"))?;
        reset_scheduled_tasks_for_replace_in_tx(&mut tx).await?;
        tx.commit()
            .await
            .map_err(|error| format!("failed to commit restored schedule reset: {error}"))?;
    }
    checkpoint_sqlite_pool(candidate_pool).await
}

pub(super) async fn merge_snapshot_backup(
    candidate_pool: sqlx::SqlitePool,
    pool: &sqlx::SqlitePool,
) -> Result<(), String> {
    let records_result = load_backup_records(&candidate_pool).await;
    let activity_rules_result =
        crate::data::repositories::tools::fetch_all_activity_reminder_rules(&candidate_pool).await;
    let import_result = load_external_import_backup_from_pool(&candidate_pool).await;
    let anonymous_result = crate::data::repositories::anonymous_activity::read_range(
        &candidate_pool,
        i64::MIN,
        i64::MAX,
    )
    .await;
    candidate_pool.close().await;

    let records = records_result?;
    let activity_rules = activity_rules_result?;
    let import_backup = import_result?;
    let anonymous =
        anonymous_result.map_err(|error| format!("failed to read anonymous backup: {error}"))?;
    let _icon_maintenance =
        crate::data::repositories::icon_cache::acquire_icon_cache_maintenance(pool).await;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start snapshot merge transaction: {error}"))?;
    merge_backup_records_in_tx(&mut tx, &records).await?;
    crate::data::repositories::tools::merge_activity_reminder_rules(&mut tx, &activity_rules)
        .await?;
    merge_external_import_backup_in_tx(&mut tx, &import_backup).await?;
    crate::data::repositories::anonymous_activity::merge_for_restore(&mut tx, &anonymous)
        .await
        .map_err(|error| format!("failed to merge anonymous backup: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit snapshot merge: {error}"))?;
    Ok(())
}

async fn reset_scheduled_tasks_for_replace_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<(), String> {
    repositories::remote_backup_settings::detach_for_restore(tx).await?;
    let now_ms = crate::platform::clock::unix_timestamp_millis_i64();
    repositories::scheduled_backup::reset_after_replace_restore(
        tx,
        &uuid::Uuid::new_v4().simple().to_string(),
        now_ms,
    )
    .await?;
    repositories::scheduled_export::reset_after_replace_restore(
        tx,
        &uuid::Uuid::new_v4().simple().to_string(),
        now_ms,
    )
    .await
}
