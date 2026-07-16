use super::ports::{TrackingDataError, TrackingDataStore};
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

    let last_heartbeat_ms = data.load_tracker_heartbeat_timestamp().await?;
    let end_time =
        resolve_startup_seal_time(existing_session.start_time, last_heartbeat_ms, now_ms);

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

pub(crate) fn resolve_startup_seal_time(
    session_start_time: i64,
    last_heartbeat_ms: Option<i64>,
    now_ms: i64,
) -> i64 {
    let Some(last_heartbeat_ms) = last_heartbeat_ms else {
        return now_ms;
    };

    now_ms.min(session_start_time.max(last_heartbeat_ms))
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
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn log_startup_error(message: impl AsRef<str>) {
    eprintln!("[tracker] {}", message.as_ref());
}

#[cfg(test)]
mod tests {
    use super::{resolve_startup_seal_time, seal_startup_active_session};
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
    fn startup_seal_time_prefers_valid_heartbeat() {
        assert_eq!(resolve_startup_seal_time(1_000, Some(8_000), 20_000), 8_000);
        assert_eq!(
            resolve_startup_seal_time(1_000, Some(30_000), 20_000),
            20_000
        );
        assert_eq!(resolve_startup_seal_time(5_000, None, 20_000), 20_000);
    }

    #[test]
    fn startup_seal_closes_active_session_from_last_heartbeat() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            sessions::start_session(&pool, "QQ", "QQ.exe", "Chat", 1_000, 1_000)
                .await
                .unwrap();
            tracker_settings::save_tracker_timestamp(
                &pool,
                tracker_settings::TRACKER_LAST_HEARTBEAT_KEY,
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
    fn startup_seal_is_a_noop_after_session_was_already_closed() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            sessions::start_session(&pool, "QQ", "QQ.exe", "Chat", 1_000, 1_000)
                .await
                .unwrap();
            sessions::end_active_sessions(&pool, 5_000).await.unwrap();
            tracker_settings::save_tracker_timestamp(
                &pool,
                tracker_settings::TRACKER_LAST_HEARTBEAT_KEY,
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
