use crate::engine::tracking::ports::{TrackingDataError, TrackingDataStore};
use crate::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState;
use tauri::{AppHandle, Runtime};

// Caller owns the tracking transition gate. A late handler drains pending facts,
// rather than replaying its original event against whichever session is now active.
pub(super) async fn flush_pending_power_stop(
    data: &dyn TrackingDataStore,
    state: &TrackingRuntimeSnapshotState,
) -> Result<Option<(&'static str, i64)>, TrackingDataError> {
    let Some(stop) = state.pending_stop() else {
        return Ok(None);
    };
    let reason = apply_power_lifecycle_event(data, stop.2, stop.1).await?;
    state.acknowledge_stop(stop);
    state.invalidate_activity();
    Ok(reason.map(|reason| (reason, stop.1)))
}

pub(super) async fn apply_power_lifecycle_event(
    data: &dyn TrackingDataStore,
    state: &str,
    timestamp_ms: i64,
) -> Result<Option<&'static str>, TrackingDataError> {
    let should_end_active_session = matches!(state, "lock" | "suspend");

    if !should_end_active_session {
        return Ok(None);
    }

    if data.end_active_sessions(timestamp_ms).await? {
        return Ok(Some(match state {
            "lock" => "session-ended-lock",
            "suspend" => "session-ended-suspend",
            _ => "session-ended-system",
        }));
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::{repositories::sessions, schema, tracking_runtime::TrackingRuntimeDataStore};
    use sqlx::{Executor, SqlitePool};

    #[test]
    fn resumed_tracking_drains_the_old_stop_before_start_and_late_handlers_are_noops() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let state = std::sync::Arc::new(TrackingRuntimeSnapshotState::default());
            sessions::start_session(&pool, "A", "a.exe", "", 1_000, 1_000)
                .await
                .unwrap();
            let old_generation = state.lifecycle_generation();
            state.note_power_event("lock", 5_000);
            state.note_power_event("unlock", 15_000);
            let (release_late, wait_late) = tokio::sync::oneshot::channel();
            let late = {
                let state = state.clone();
                let data = data.clone();
                tokio::spawn(async move {
                    wait_late.await.unwrap();
                    let _guard = state.transition.lock().await;
                    flush_pending_power_stop(&data, &state).await
                })
            };
            assert!(!state.accepts_sample(old_generation));
            assert!(!state.accepts_sample(state.lifecycle_generation()));
            {
                let _guard = state.transition.lock().await;
                assert_eq!(
                    flush_pending_power_stop(&data, &state).await.unwrap(),
                    Some(("session-ended-lock", 5_000))
                );
                assert!(state.accepts_sample(state.lifecycle_generation()));
                sessions::start_session(&pool, "A", "a.exe", "", 16_000, 16_000)
                    .await
                    .unwrap();
            }
            release_late.send(()).unwrap();
            assert_eq!(late.await.unwrap().unwrap(), None);
            assert_eq!(
                data.load_active_session()
                    .await
                    .unwrap()
                    .unwrap()
                    .start_time,
                16_000
            );
            let old_end: i64 = sqlx::query_scalar("SELECT end_time FROM sessions WHERE id=1")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(old_end, 5_000);
        });
    }

    #[test]
    fn failed_power_seal_keeps_pending_boundary_and_cannot_enable_tracking() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let state = TrackingRuntimeSnapshotState::default();
            sessions::start_session(&pool, "A", "a.exe", "", 1_000, 1_000)
                .await
                .unwrap();
            state.note_power_event("suspend", 5_000);
            state.note_power_event("resume", 15_000);
            pool.execute("CREATE TRIGGER fail_seal BEFORE UPDATE OF end_time ON sessions BEGIN SELECT RAISE(ABORT,'failure'); END").await.unwrap();
            let _guard = state.transition.lock().await;
            assert!(flush_pending_power_stop(&data, &state).await.is_err());
            assert!(!state.accepts_sample(state.lifecycle_generation()));
            assert!(data.load_active_session().await.unwrap().is_some());
            pool.execute("DROP TRIGGER fail_seal").await.unwrap();
            assert_eq!(
                flush_pending_power_stop(&data, &state).await.unwrap(),
                Some(("session-ended-suspend", 5_000))
            );
            assert!(state.accepts_sample(state.lifecycle_generation()));
        });
    }
}

pub(super) async fn flush_pending_power_stop_and_publish<R: Runtime>(
    app: &AppHandle<R>,
    data: &dyn TrackingDataStore,
    state: &TrackingRuntimeSnapshotState,
) -> Result<(), String> {
    let ended = flush_pending_power_stop(data, state)
        .await
        .map_err(|error| format!("power lifecycle transition failed: {error}"))?;
    if let Some((reason, ended_at)) = ended {
        let _ = super::emit_tracking_data_changed(app, reason, ended_at as u64);
    }
    Ok(())
}
