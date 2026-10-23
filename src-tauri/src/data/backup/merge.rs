use crate::data::repositories;
use crate::domain::backup::BackupRecords;
use sqlx::{Sqlite, Transaction};

pub(super) async fn merge_backup_records_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    records: &BackupRecords,
) -> Result<(), String> {
    repositories::sessions::insert_missing_for_restore(tx, &records.sessions).await?;
    let session_id_map =
        repositories::sessions::resolve_restore_session_id_map(tx, &records.sessions).await?;
    repositories::session_title_samples::insert_missing_for_restore(
        tx,
        &records.title_samples,
        &session_id_map,
    )
    .await?;
    repositories::settings::insert_missing_for_restore(tx, &records.settings).await?;
    repositories::icon_cache::insert_missing_for_restore(tx, &records.icon_cache).await?;
    repositories::web_activity::insert_missing_for_restore(
        tx,
        &records.web_activity_segments,
        &session_id_map,
    )
    .await?;
    repositories::web_activity::insert_missing_favicon_cache_for_restore(
        tx,
        &records.web_favicon_cache,
    )
    .await?;
    repositories::tools::insert_missing_for_restore(
        tx,
        &records.tool_reminders,
        &records.tool_timers,
        &records.tool_timer_laps,
        &records.tool_pomodoro_runs,
        &records.tool_daily_stats,
    )
    .await?;
    repositories::web_links::migrate_legacy_web_grouping(tx).await?;
    Ok(())
}
