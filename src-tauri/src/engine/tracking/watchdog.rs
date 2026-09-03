use crate::domain::tracking::TRACKING_REASON_WATCHDOG_SEALED;
use crate::engine::tracking::ports::{SharedTrackingDataStore, TrackingDataStore};
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Arc,
};
use tauri::{AppHandle, Manager, Runtime};
use tokio::time::{sleep, Duration};

use super::runtime;

const TRACKER_WATCHDOG_POLL_MS: u64 = 1_000;
const TRACKER_STALL_SEAL_AFTER_MS: i64 = 8_000;

#[derive(Debug, Default)]
pub struct RuntimeHealthState {
    last_heartbeat_ms: AtomicI64,
    last_successful_sample_ms: AtomicI64,
    last_watchdog_seal_sample_ms: AtomicI64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RuntimeHealthSnapshot {
    pub last_heartbeat_ms: Option<i64>,
    pub last_successful_sample_ms: Option<i64>,
    pub last_watchdog_seal_sample_ms: Option<i64>,
}

impl RuntimeHealthState {
    pub fn note_heartbeat(&self, timestamp_ms: i64) {
        self.last_heartbeat_ms
            .store(timestamp_ms, Ordering::Relaxed);
    }

    pub fn note_successful_sample(&self, timestamp_ms: i64) {
        self.last_successful_sample_ms
            .store(timestamp_ms, Ordering::Relaxed);
    }

    fn last_successful_sample_ms(&self) -> Option<i64> {
        let timestamp_ms = self.last_successful_sample_ms.load(Ordering::Relaxed);
        (timestamp_ms > 0).then_some(timestamp_ms)
    }

    fn note_watchdog_seal(&self, timestamp_ms: i64) {
        self.last_watchdog_seal_sample_ms
            .store(timestamp_ms, Ordering::Relaxed);
    }

    fn last_watchdog_seal_sample_ms(&self) -> Option<i64> {
        let timestamp_ms = self.last_watchdog_seal_sample_ms.load(Ordering::Relaxed);
        (timestamp_ms > 0).then_some(timestamp_ms)
    }

    pub fn snapshot(&self) -> RuntimeHealthSnapshot {
        RuntimeHealthSnapshot {
            last_heartbeat_ms: self.last_heartbeat_ms(),
            last_successful_sample_ms: self.last_successful_sample_ms(),
            last_watchdog_seal_sample_ms: self.last_watchdog_seal_sample_ms(),
        }
    }

    fn last_heartbeat_ms(&self) -> Option<i64> {
        let timestamp_ms = self.last_heartbeat_ms.load(Ordering::Relaxed);
        (timestamp_ms > 0).then_some(timestamp_ms)
    }
}

pub async fn watch<R: Runtime>(
    app: AppHandle<R>,
    health_state: Arc<RuntimeHealthState>,
    data: SharedTrackingDataStore,
) -> Result<(), String> {
    loop {
        let now_ms = now_ms();
        let last_successful_sample_ms = health_state.last_successful_sample_ms();
        let last_watchdog_seal_sample_ms = health_state.last_watchdog_seal_sample_ms();

        if should_watchdog_seal(
            last_successful_sample_ms,
            last_watchdog_seal_sample_ms,
            now_ms,
        ) {
            seal_stale_session(
                &app,
                data.as_ref(),
                &health_state,
                last_successful_sample_ms.unwrap_or_default(),
            )
            .await;
        }

        sleep(Duration::from_millis(TRACKER_WATCHDOG_POLL_MS)).await;
    }
}

async fn seal_stale_session<R: Runtime>(
    app: &AppHandle<R>,
    data: &dyn TrackingDataStore,
    health_state: &RuntimeHealthState,
    sample_time_ms: i64,
) {
    let state = app.state::<super::runtime_snapshot::TrackingRuntimeSnapshotState>();
    match reconcile_stale_session(data, health_state, &state, sample_time_ms).await {
        Ok(Some(true)) => {
            log_watchdog_error(format!(
                "watchdog sealed stale active session at {sample_time_ms} after tracker stall"
            ));
            let _ = runtime::emit_tracking_data_changed(
                app,
                TRACKING_REASON_WATCHDOG_SEALED,
                sample_time_ms as u64,
            );
        }
        Ok(_) => {}
        Err(error) => log_watchdog_error(format!("watchdog failed to seal stale session: {error}")),
    }
}

async fn reconcile_stale_session(
    data: &dyn TrackingDataStore,
    health_state: &RuntimeHealthState,
    state: &super::runtime_snapshot::TrackingRuntimeSnapshotState,
    sample_time_ms: i64,
) -> Result<Option<bool>, super::ports::TrackingDataError> {
    let _guard = state.transition.lock().await;
    if health_state.last_successful_sample_ms() != Some(sample_time_ms) {
        return Ok(None);
    }
    state.invalidate_activity();
    let did_seal = data.end_active_sessions(sample_time_ms).await?;
    health_state.note_watchdog_seal(sample_time_ms);
    Ok(Some(did_seal))
}

pub(crate) fn should_watchdog_seal(
    last_successful_sample_ms: Option<i64>,
    last_watchdog_seal_sample_ms: Option<i64>,
    now_ms: i64,
) -> bool {
    let Some(last_successful_sample_ms) = last_successful_sample_ms else {
        return false;
    };

    if last_watchdog_seal_sample_ms == Some(last_successful_sample_ms) {
        return false;
    }

    now_ms.saturating_sub(last_successful_sample_ms) > TRACKER_STALL_SEAL_AFTER_MS
}

fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}

fn log_watchdog_error(message: impl AsRef<str>) {
    eprintln!("[tracker] {}", message.as_ref());
}

#[cfg(test)]
mod tests {
    use super::{reconcile_stale_session, RuntimeHealthState};
    use std::sync::Arc;

    #[test]
    fn runtime_health_snapshot_starts_empty() {
        let state = RuntimeHealthState::default();

        assert_eq!(state.snapshot().last_heartbeat_ms, None);
        assert_eq!(state.snapshot().last_successful_sample_ms, None);
        assert_eq!(state.snapshot().last_watchdog_seal_sample_ms, None);
    }

    #[test]
    fn runtime_health_snapshot_tracks_heartbeat() {
        let state = RuntimeHealthState::default();

        state.note_heartbeat(12_000);

        assert_eq!(state.snapshot().last_heartbeat_ms, Some(12_000));
        assert_eq!(state.snapshot().last_successful_sample_ms, None);
    }

    #[test]
    fn runtime_health_snapshot_tracks_successful_sample() {
        let state = RuntimeHealthState::default();

        state.note_successful_sample(13_000);

        assert_eq!(state.snapshot().last_heartbeat_ms, None);
        assert_eq!(state.snapshot().last_successful_sample_ms, Some(13_000));
    }

    #[test]
    fn runtime_health_snapshot_tracks_watchdog_seal_separately() {
        let state = RuntimeHealthState::default();

        state.note_successful_sample(14_000);
        state.note_watchdog_seal(14_000);

        let snapshot = state.snapshot();
        assert_eq!(snapshot.last_successful_sample_ms, Some(14_000));
        assert_eq!(snapshot.last_watchdog_seal_sample_ms, Some(14_000));
    }

    #[test]
    fn queued_watchdog_cannot_seal_a_new_sample_and_failed_seals_remain_retryable() {
        tauri::async_runtime::block_on(async {
            use crate::data::{
                repositories::sessions, schema, tracking_runtime::TrackingRuntimeDataStore,
            };
            use sqlx::Executor;
            let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let state =
                Arc::new(super::super::runtime_snapshot::TrackingRuntimeSnapshotState::default());
            let health = Arc::new(RuntimeHealthState::default());
            health.note_successful_sample(5_000);
            let guard = state.transition.lock().await;
            let queued = {
                let state = state.clone();
                let health = health.clone();
                let data = data.clone();
                tokio::spawn(
                    async move { reconcile_stale_session(&data, &health, &state, 5_000).await },
                )
            };
            sessions::start_session(&pool, "New", "new.exe", "", 10_000, 10_000)
                .await
                .unwrap();
            health.note_successful_sample(10_000);
            drop(guard);
            assert_eq!(queued.await.unwrap().unwrap(), None);
            assert_eq!(
                data.load_active_session()
                    .await
                    .unwrap()
                    .unwrap()
                    .start_time,
                10_000
            );
            pool.execute("CREATE TRIGGER reject_stale_end BEFORE UPDATE OF end_time ON sessions BEGIN SELECT RAISE(ABORT,'failure'); END").await.unwrap();
            assert!(reconcile_stale_session(&data, &health, &state, 10_000)
                .await
                .is_err());
            assert_eq!(health.snapshot().last_watchdog_seal_sample_ms, None);
            pool.execute("DROP TRIGGER reject_stale_end").await.unwrap();
            assert_eq!(
                reconcile_stale_session(&data, &health, &state, 10_000)
                    .await
                    .unwrap(),
                Some(true)
            );
            let end: i64 = sqlx::query_scalar("SELECT end_time FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(end, 10_000);
        });
    }
}
