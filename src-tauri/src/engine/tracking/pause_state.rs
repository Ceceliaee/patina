use super::ports::{TrackingDataError, TrackingDataStore};
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrackingPauseRuntimeSnapshot {
    pub tracking_paused: bool,
    pub last_verified_at_ms: Option<i64>,
}

#[derive(Debug)]
pub struct TrackingPauseRuntimeState {
    inner: Mutex<Option<TrackingPauseRuntimeSnapshot>>,
    paused: tokio::sync::watch::Sender<bool>,
}

impl Default for TrackingPauseRuntimeState {
    fn default() -> Self {
        Self {
            inner: Mutex::default(),
            paused: tokio::sync::watch::channel(true).0,
        }
    }
}

impl TrackingPauseRuntimeState {
    pub fn subscribe(&self) -> tokio::sync::watch::Receiver<bool> {
        self.paused.subscribe()
    }

    pub async fn initialize(
        &self,
        data: &dyn TrackingDataStore,
        now_ms: i64,
    ) -> Result<(), TrackingDataError> {
        self.pause_until_verified();
        let paused = data.load_tracking_paused_setting().await?;
        self.set_verified(paused, now_ms);
        Ok(())
    }

    pub fn snapshot(&self) -> Option<TrackingPauseRuntimeSnapshot> {
        match self.inner.lock() {
            Ok(guard) => *guard,
            Err(poisoned) => *poisoned.into_inner(),
        }
    }

    pub fn set_verified(&self, tracking_paused: bool, now_ms: i64) {
        self.replace(tracking_paused, Some(now_ms));
    }

    pub fn set_after_write(&self, tracking_paused: bool, now_ms: i64) {
        self.replace(tracking_paused, Some(now_ms));
    }

    pub fn pause_until_verified(&self) {
        self.replace(true, None);
    }

    pub fn should_verify(&self, now_ms: i64, interval_ms: i64) -> bool {
        match self
            .snapshot()
            .and_then(|snapshot| snapshot.last_verified_at_ms)
        {
            Some(verified_at_ms) => now_ms.saturating_sub(verified_at_ms) >= interval_ms,
            None => true,
        }
    }

    fn replace(&self, tracking_paused: bool, verified_at_ms: Option<i64>) {
        let mut guard = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        *guard = Some(TrackingPauseRuntimeSnapshot {
            tracking_paused,
            last_verified_at_ms: verified_at_ms,
        });
        self.paused.send_if_modified(|old| {
            let changed = *old != tracking_paused;
            *old = tracking_paused;
            changed
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_state_starts_uninitialized_and_verifies_by_interval() {
        let state = TrackingPauseRuntimeState::default();

        assert_eq!(state.snapshot(), None);
        assert!(state.should_verify(1_000, 60_000));

        state.set_verified(true, 1_000);

        assert_eq!(
            state.snapshot(),
            Some(TrackingPauseRuntimeSnapshot {
                tracking_paused: true,
                last_verified_at_ms: Some(1_000),
            })
        );
        assert!(!state.should_verify(30_000, 60_000));
        assert!(state.should_verify(61_000, 60_000));
    }
}
