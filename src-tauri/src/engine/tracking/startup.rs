use super::ports::{TrackingDataError, TrackingDataStore};
use crate::domain::tracking::resolve_interrupted_session_end;
use crate::domain::tracking::{TrackingDataChangedPayload, TRACKING_REASON_STARTUP_SEALED};
use crate::platform::windows::foreground as tracker;
use tauri::{AppHandle, Emitter, Runtime};

const DEFAULT_AFK_THRESHOLD_SECS: u64 = 180;

pub async fn initialize_tracker<R: Runtime>(
    app: &AppHandle<R>,
    data: &dyn TrackingDataStore,
) -> Result<(), TrackingDataError> {
    let afk_threshold_secs = data
        .load_timeline_merge_gap_secs(DEFAULT_AFK_THRESHOLD_SECS)
        .await?;
    tracker::cmd_set_afk_threshold(afk_threshold_secs);

    let mut repair_notes: Vec<String> = Vec::new();

    record_normalized_closed_duration(data, &mut repair_notes).await?;
    seal_startup_active_session_if_needed(app, data, &mut repair_notes).await?;
    if data.seal_interrupted_web_activity(now_ms()).await? {
        repair_notes.push("sealed_interrupted_web_activity".into());
    }
    persist_startup_self_heal_if_needed(data, &repair_notes).await?;

    Ok(())
}

async fn record_normalized_closed_duration(
    data: &dyn TrackingDataStore,
    repair_notes: &mut Vec<String>,
) -> Result<(), TrackingDataError> {
    let normalized_rows = data.normalize_closed_session_durations().await?;
    if normalized_rows > 0 {
        repair_notes.push(format!("normalized_closed_duration={normalized_rows}"));
    }

    Ok(())
}

async fn seal_startup_active_session_if_needed<R: Runtime>(
    app: &AppHandle<R>,
    data: &dyn TrackingDataStore,
    repair_notes: &mut Vec<String>,
) -> Result<(), TrackingDataError> {
    if let Some(end_time) = seal_startup_active_session(data, now_ms()).await? {
        repair_notes.push("sealed_active_session".to_string());
        let _ = emit_tracking_data_changed(app, TRACKING_REASON_STARTUP_SEALED, end_time as u64);
    }

    Ok(())
}

pub(crate) async fn seal_startup_active_session(
    data: &dyn TrackingDataStore,
    now_ms: i64,
) -> Result<Option<i64>, TrackingDataError> {
    let Some(existing_session) = data.load_active_session().await? else {
        return Ok(None);
    };

    let last_sample_ms = data.load_tracker_successful_sample_timestamp().await?;
    let end_time =
        resolve_interrupted_session_end(existing_session.start_time, last_sample_ms, now_ms);

    if data.end_active_sessions(end_time).await? {
        return Ok(Some(end_time));
    }

    Ok(None)
}

async fn persist_startup_self_heal_if_needed(
    data: &dyn TrackingDataStore,
    repair_notes: &[String],
) -> Result<(), TrackingDataError> {
    if repair_notes.is_empty() {
        return Ok(());
    }

    let summary = repair_notes.join(",");
    let now = now_ms();
    data.save_startup_self_heal(now, &summary).await?;
    log_startup_error(format!("startup self-heal applied: {summary}"));

    Ok(())
}

fn emit_tracking_data_changed<R: Runtime>(
    app: &AppHandle<R>,
    reason: &str,
    changed_at_ms: u64,
) -> tauri::Result<()> {
    app.emit(
        "tracking-data-changed",
        TrackingDataChangedPayload::new(reason, changed_at_ms),
    )
}

fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}

fn log_startup_error(message: impl AsRef<str>) {
    eprintln!("[tracker] {}", message.as_ref());
}

#[cfg(test)]
mod tests {
    use super::{resolve_interrupted_session_end, seal_startup_active_session};
    use crate::data::repositories::{sessions, tracker_settings};
    use crate::data::schema as db_schema;
    use crate::data::tracking_runtime::TrackingRuntimeDataStore;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    fn data_store(pool: &SqlitePool) -> TrackingRuntimeDataStore {
        TrackingRuntimeDataStore::new(pool.clone())
    }

    #[test]
    fn startup_seal_time_requires_a_valid_successful_sample() {
        assert_eq!(
            resolve_interrupted_session_end(1_000, Some(8_000), 20_000),
            8_000
        );
        assert_eq!(
            resolve_interrupted_session_end(1_000, Some(30_000), 20_000),
            1_000
        );
        assert_eq!(resolve_interrupted_session_end(5_000, None, 20_000), 5_000);
        assert_eq!(
            resolve_interrupted_session_end(5_000, Some(4_000), 20_000),
            5_000
        );
        assert_eq!(
            resolve_interrupted_session_end(5_000, Some(8_000), 4_000),
            5_000
        );
    }

    #[test]
    fn startup_seal_closes_active_session_from_last_successful_sample() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            sessions::start_session(&pool, "QQ", "QQ.exe", "Chat", 1_000, 1_000)
                .await
                .unwrap();
            tracker_settings::save_tracker_timestamp(
                &pool,
                crate::engine::tracking::ports::TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY,
                8_000,
            )
            .await
            .unwrap();

            let data = data_store(&pool);
            let end_time = seal_startup_active_session(&data, 20_000).await.unwrap();
            let ended: Option<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL LIMIT 1",
            )
            .fetch_optional(&pool)
            .await
            .unwrap();

            assert_eq!(end_time, Some(8_000));
            assert_eq!(ended, Some((8_000, 7_000)));
        });
    }

    #[test]
    fn heartbeat_without_successful_sample_does_not_count_downtime() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sessions::start_session(&pool, "A", "a.exe", "A", 1_000, 1_000)
                .await
                .unwrap();
            tracker_settings::save_tracker_timestamp(
                &pool,
                crate::engine::tracking::ports::TRACKER_LAST_HEARTBEAT_KEY,
                19_000,
            )
            .await
            .unwrap();
            assert_eq!(
                seal_startup_active_session(&data_store(&pool), 20_000)
                    .await
                    .unwrap(),
                Some(1_000)
            );
            let duration: i64 = sqlx::query_scalar("SELECT duration FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(duration, 0);
        });
    }

    #[test]
    fn startup_seal_is_a_noop_after_session_was_already_closed() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            sessions::start_session(&pool, "QQ", "QQ.exe", "Chat", 1_000, 1_000)
                .await
                .unwrap();
            sessions::end_active_sessions(&pool, 5_000).await.unwrap();
            tracker_settings::save_tracker_timestamp(
                &pool,
                crate::engine::tracking::ports::TRACKER_LAST_HEARTBEAT_KEY,
                8_000,
            )
            .await
            .unwrap();

            let data = data_store(&pool);
            let end_time = seal_startup_active_session(&data, 20_000).await.unwrap();
            let ended_sessions: Vec<(i64, i64)> = sqlx::query_as(
                "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(end_time, None);
            assert_eq!(ended_sessions, vec![(5_000, 4_000)]);
        });
    }
}
