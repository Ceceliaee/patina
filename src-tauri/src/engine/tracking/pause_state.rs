use super::ports::{TrackingDataError, TrackingDataStore};
use std::sync::Mutex;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrackingPauseRuntimeSnapshot {
    pub tracking_paused: bool,
    pub last_verified_at_ms: i64,
}

#[derive(Debug, Default)]
pub struct TrackingPauseRuntimeState {
    inner: Mutex<Option<TrackingPauseRuntimeSnapshot>>,
}

impl TrackingPauseRuntimeState {
    pub async fn initialize(
        &self,
        data: &dyn TrackingDataStore,
        now_ms: i64,
    ) -> Result<(), TrackingDataError> {
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
        self.replace(tracking_paused, now_ms);
    }

    pub fn set_after_write(&self, tracking_paused: bool, now_ms: i64) {
        self.replace(tracking_paused, now_ms);
    }

    pub fn should_verify(&self, now_ms: i64, interval_ms: i64) -> bool {
        match self.snapshot() {
            Some(snapshot) => now_ms.saturating_sub(snapshot.last_verified_at_ms) >= interval_ms,
            None => true,
        }
    }

    fn replace(&self, tracking_paused: bool, now_ms: i64) {
        match self.inner.lock() {
            Ok(mut guard) => {
                *guard = Some(TrackingPauseRuntimeSnapshot {
                    tracking_paused,
                    last_verified_at_ms: now_ms,
                });
            }
            Err(poisoned) => {
                let mut guard = poisoned.into_inner();
                *guard = Some(TrackingPauseRuntimeSnapshot {
                    tracking_paused,
                    last_verified_at_ms: now_ms,
                });
            }
        }
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
                last_verified_at_ms: 1_000,
            })
        );
        assert!(!state.should_verify(30_000, 60_000));
        assert!(state.should_verify(61_000, 60_000));
    }
}
