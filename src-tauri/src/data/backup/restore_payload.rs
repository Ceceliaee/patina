use super::import_data::clear_external_imports_in_tx;
use super::RestoreStats;
use super::RestoreStrategy;
use crate::data::repositories;
use crate::domain::backup::BackupPayload;
use sqlx::{Pool, Sqlite, Transaction};

pub(super) async fn restore_backup_payload(
    pool: &Pool<Sqlite>,
    payload: &BackupPayload,
    strategy: RestoreStrategy,
    session_merge: repositories::sessions::SessionMergePolicy,
) -> Result<RestoreStats, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start restore transaction: {error}"))?;
    restore_backup_payload_in_tx(&mut tx, payload, strategy, session_merge).await?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit restore transaction: {error}"))?;
    Ok(RestoreStats::default())
}

pub(super) async fn restore_backup_payload_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    payload: &BackupPayload,
    strategy: RestoreStrategy,
    session_merge: repositories::sessions::SessionMergePolicy,
) -> Result<RestoreStats, String> {
    let sessions_inserted = match strategy {
        RestoreStrategy::Replace => {
            clear_external_imports_in_tx(tx).await?;
            repositories::session_title_samples::clear_for_restore(tx).await?;
            repositories::sessions::clear_for_restore(tx).await?;
            repositories::settings::clear_for_restore(tx).await?;
            repositories::icon_cache::clear_for_restore(tx).await?;
            repositories::web_activity::clear_for_restore(tx).await?;
            repositories::tools::clear_for_restore(tx).await?;
            repositories::sessions::insert_for_restore(tx, &payload.sessions).await?;
            let session_id_map =
                repositories::sessions::resolve_restore_session_id_map(tx, &payload.sessions)
                    .await?;
            repositories::session_title_samples::insert_for_restore(
                tx,
                &payload.title_samples,
                &session_id_map,
            )
            .await?;
            repositories::settings::insert_for_restore(tx, &payload.settings).await?;
            repositories::icon_cache::insert_for_restore(tx, &payload.icon_cache).await?;
            repositories::web_activity::insert_for_restore(tx, &payload.web_activity_segments)
                .await?;
            repositories::web_activity::insert_favicon_cache_for_restore(
                tx,
                &payload.web_favicon_cache,
            )
            .await?;
            repositories::tools::insert_for_restore(
                tx,
                &payload.tool_reminders,
                &payload.tool_timers,
                &payload.tool_timer_laps,
                &payload.tool_pomodoro_runs,
                &payload.tool_daily_stats,
                &payload.tool_software_reminder_rules,
            )
            .await?;
            payload.sessions.len()
        }
        RestoreStrategy::Merge => {
            let inserted =
                repositories::sessions::merge_for_restore(tx, &payload.sessions, session_merge)
                    .await?;
            let session_id_map =
                repositories::sessions::resolve_restore_session_id_map(tx, &payload.sessions)
                    .await?;
            repositories::session_title_samples::insert_missing_for_restore(
                tx,
                &payload.title_samples,
                &session_id_map,
            )
            .await?;
            repositories::settings::insert_missing_for_restore(tx, &payload.settings).await?;
            repositories::icon_cache::insert_missing_for_restore(tx, &payload.icon_cache).await?;
            repositories::web_activity::insert_missing_for_restore(
                tx,
                &payload.web_activity_segments,
            )
            .await?;
            repositories::web_activity::insert_missing_favicon_cache_for_restore(
                tx,
                &payload.web_favicon_cache,
            )
            .await?;
            repositories::tools::insert_missing_for_restore(
                tx,
                &payload.tool_reminders,
                &payload.tool_timers,
                &payload.tool_timer_laps,
                &payload.tool_pomodoro_runs,
                &payload.tool_daily_stats,
                &payload.tool_software_reminder_rules,
            )
            .await?;
            inserted
        }
    };
    Ok(RestoreStats { sessions_inserted })
}
