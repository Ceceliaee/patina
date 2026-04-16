use crate::data::repositories::sessions;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use sqlx::{Pool, Sqlite};
use std::sync::{
    atomic::{AtomicI64, Ordering},
    Arc,
};
use tauri::{AppHandle, Runtime};
use tokio::time::{sleep, Duration};

use super::runtime;

const TRACKER_WATCHDOG_POLL_MS: u64 = 1_000;
const TRACKER_STALL_SEAL_AFTER_MS: i64 = 8_000;

#[derive(Debug, Default)]
pub struct RuntimeHealthState {
    last_successful_sample_ms: AtomicI64,
    last_watchdog_seal_sample_ms: AtomicI64,
}

impl RuntimeHealthState {
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
}

pub async fn watch<R: Runtime>(
    app: AppHandle<R>,
    health_state: Arc<RuntimeHealthState>,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(&app).await?;

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
                &pool,
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
    pool: &Pool<Sqlite>,
    health_state: &RuntimeHealthState,
    sample_time_ms: i64,
) {
    match sessions::end_active_sessions(pool, sample_time_ms).await {
        Ok(did_seal) => {
            health_state.note_watchdog_seal(sample_time_ms);

            if did_seal {
                log_watchdog_error(format!(
                    "watchdog sealed stale active session at {} after tracker stall",
                    sample_time_ms
                ));
                let _ = runtime::emit_tracking_data_changed(
                    app,
                    "watchdog-sealed",
                    sample_time_ms as u64,
                );
            }
        }
        Err(error) => {
            log_watchdog_error(format!("watchdog failed to seal stale session: {error}"));
        }
    }
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
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn log_watchdog_error(message: impl AsRef<str>) {
    eprintln!("[tracker] {}", message.as_ref());
}
