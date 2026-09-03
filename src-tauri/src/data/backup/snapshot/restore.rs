use super::ExtractedSnapshot;
use crate::data::backup::import_data::{
    load_external_import_backup_from_pool, merge_external_import_backup_in_tx,
};
use crate::data::backup::payload::{load_backup_payload_from_pool, RestoreStrategy};
use crate::data::backup::restore_payload::restore_backup_payload_in_tx;
use crate::data::sqlite_pool::{
    checkpoint_sqlite_pool, open_single_connection_sqlite_pool, prepare_pool_schema,
    replace_product_db_from_candidate, wait_for_sqlite_pool,
};
use std::path::Path;
use tauri::AppHandle;

pub(in crate::data::backup) async fn restore_snapshot_backup(
    backup_path: &Path,
    app: &AppHandle,
    strategy: RestoreStrategy,
) -> Result<(), String> {
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
    let cutoff = (extracted.preview.exported_at_ms.min(i64::MAX as u64) as i64)
        .min(crate::platform::clock::unix_timestamp_millis_i64());
    let sealed = async {
        crate::data::repositories::sessions::seal_interrupted_session(&candidate_pool, cutoff)
            .await?;
        crate::data::repositories::web_activity::seal_interrupted_segments(&candidate_pool, cutoff)
            .await?;
        Ok::<(), sqlx::Error>(())
    }
    .await;
    if let Err(error) = sealed {
        candidate_pool.close().await;
        return Err(format!(
            "failed to seal interrupted backup activity: {error}"
        ));
    }
    if let Err(error) = checkpoint_sqlite_pool(&candidate_pool).await {
        candidate_pool.close().await;
        return Err(error);
    }

    match strategy {
        RestoreStrategy::Replace => {
            candidate_pool.close().await;
            replace_product_db_from_candidate(app, &extracted.db_path).await
        }
        RestoreStrategy::Merge => merge_snapshot_backup(candidate_pool, &extracted, app).await,
    }
}

async fn merge_snapshot_backup(
    candidate_pool: sqlx::SqlitePool,
    extracted: &ExtractedSnapshot,
    app: &AppHandle,
) -> Result<(), String> {
    let payload_result =
        load_backup_payload_from_pool(&candidate_pool, &extracted.preview.app_version).await;
    let activity_rules_result =
        crate::data::repositories::tools::fetch_all_activity_reminder_rules(&candidate_pool).await;
    let import_result = load_external_import_backup_from_pool(&candidate_pool).await;
    candidate_pool.close().await;

    let mut payload = payload_result?;
    // Snapshot merges preserve the canonical tagged rules below. The legacy app-only
    // payload remains exclusively for old structured archives.
    payload.tool_software_reminder_rules.clear();
    let activity_rules = activity_rules_result?;
    let import_backup = import_result?;
    let pool = wait_for_sqlite_pool(app).await?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start snapshot merge transaction: {error}"))?;
    restore_backup_payload_in_tx(&mut tx, &payload, RestoreStrategy::Merge).await?;
    crate::data::repositories::tools::merge_activity_reminder_rules(&mut tx, &activity_rules)
        .await?;
    merge_external_import_backup_in_tx(&mut tx, &import_backup).await?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit snapshot merge: {error}"))?;
    Ok(())
}
