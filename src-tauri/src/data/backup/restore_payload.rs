use super::import_data::clear_external_imports_in_tx;
use super::RestoreStrategy;
use crate::data::repositories;
use crate::domain::backup::BackupPayload;
use sqlx::{Pool, Sqlite, Transaction};

// An archive supplies its own observation evidence. The destination's heartbeat
// must never extend an imported open session through the time since export.
pub(super) fn seal_interrupted_payload_activity(payload: &mut BackupPayload) {
    let upper_bound = (payload.meta.exported_at_ms.min(i64::MAX as u64) as i64)
        .min(crate::platform::clock::unix_timestamp_millis_i64());
    let sample = payload
        .settings
        .iter()
        .find(|setting| {
            setting.key == crate::engine::tracking::ports::TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY
        })
        .and_then(|setting| setting.value.parse::<i64>().ok());
    let mut sealed = std::collections::HashMap::new();
    for session in &mut payload.sessions {
        if session.end_time.is_none() {
            let end = crate::domain::tracking::resolve_interrupted_session_end(
                session.start_time,
                sample,
                upper_bound,
            );
            session.end_time = Some(end);
            session.duration = Some(end - session.start_time);
            sealed.insert(session.id, end);
        }
    }
    for title in &mut payload.title_samples {
        if let Some(end) = sealed.get(&title.session_id) {
            title.end_time = Some(
                title
                    .end_time
                    .unwrap_or(*end)
                    .min(*end)
                    .max(title.start_time),
            );
        }
    }
    for web in &mut payload.web_activity_segments {
        let parent_end = web
            .native_session_id
            .and_then(|id| sealed.get(&id).copied());
        if web.end_time.is_none() || parent_end.is_some() {
            let observed_end = crate::domain::tracking::resolve_interrupted_session_end(
                web.start_time,
                Some(web.updated_at),
                upper_bound,
            );
            let end = web
                .end_time
                .unwrap_or(observed_end)
                .min(parent_end.unwrap_or(i64::MAX))
                .max(web.start_time);
            web.end_time = Some(end);
            web.duration = Some(end - web.start_time);
        }
    }
}

pub(super) async fn restore_backup_payload(
    pool: &Pool<Sqlite>,
    payload: &BackupPayload,
    strategy: RestoreStrategy,
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start restore transaction: {error}"))?;
    restore_backup_payload_in_tx(&mut tx, payload, strategy).await?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit restore transaction: {error}"))?;
    Ok(())
}

pub(super) async fn restore_backup_payload_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    payload: &BackupPayload,
    strategy: RestoreStrategy,
) -> Result<(), String> {
    match strategy {
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
            repositories::web_activity::insert_for_restore(
                tx,
                &payload.web_activity_segments,
                &session_id_map,
            )
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
        }
        RestoreStrategy::Merge => {
            repositories::sessions::insert_missing_for_restore(tx, &payload.sessions).await?;
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
                &session_id_map,
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
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Executor;

    #[test]
    fn restore_uses_archive_observation_evidence_and_remaps_closed_children() {
        tauri::async_runtime::block_on(async {
            for strategy in [RestoreStrategy::Replace, RestoreStrategy::Merge] {
                let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
                for migration in crate::data::schema::tracker_migrations() {
                    pool.execute(migration.sql).await.unwrap();
                }
                pool.execute("INSERT INTO sessions(id,app_name,exe_name,start_time,end_time,duration) VALUES(1,'Local','local.exe',100,200,100);
                    INSERT INTO settings(key,value) VALUES('__tracker_last_successful_sample_ms','900000')").await.unwrap();
                let mut payload: BackupPayload = serde_json::from_value(serde_json::json!({
                    "version":1, "meta":{"exported_at_ms":10000,"schema_version":8,"app_version":"synthetic"},
                    "sessions":[{"id":1,"app_name":"Edge","exe_name":"msedge.exe","window_title":"Page","start_time":1000,"end_time":null,"duration":null}],
                    "title_samples":[{"id":1,"session_id":1,"title":"Page","start_time":1000,"end_time":null}],
                    "settings":[{"key":"__tracker_last_successful_sample_ms","value":"8000"}], "icon_cache":[],
                    "web_activity_segments":[{"id":1,"native_session_id":1,"browser_client_id":"client","browser_kind":"edge","browser_exe_name":"msedge.exe","domain":"example.com","normalized_domain":"example.com","start_time":2000,"end_time":null,"duration":null,"source":"browser-extension","created_at":2000,"updated_at":9000}]
                })).unwrap();
                seal_interrupted_payload_activity(&mut payload);
                restore_backup_payload(&pool, &payload, strategy)
                    .await
                    .unwrap();
                let native: (i64, i64, i64) = sqlx::query_as(
                    "SELECT id,end_time,duration FROM sessions WHERE exe_name='msedge.exe'",
                )
                .fetch_one(&pool)
                .await
                .unwrap();
                assert_eq!((native.1, native.2), (8000, 7000));
                let web: (i64,i64,i64) = sqlx::query_as("SELECT r.session_id,w.end_time,w.duration FROM web_activity_segments w JOIN web_activity_native_sessions r ON r.segment_id=w.id").fetch_one(&pool).await.unwrap();
                assert_eq!(web, (native.0, 8000, 6000));
                let title_end: i64 = sqlx::query_scalar(
                    "SELECT end_time FROM session_title_samples WHERE session_id=?",
                )
                .bind(native.0)
                .fetch_one(&pool)
                .await
                .unwrap();
                assert_eq!(title_end, 8000);
            }
        });
    }
}
