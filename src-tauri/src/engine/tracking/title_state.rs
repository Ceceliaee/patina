use super::ports::{TrackingDataError, TrackingDataStore};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::sync::{Mutex, MutexGuard};

#[derive(Debug)]
pub struct TitleRecordingRuntimeState {
    enabled: AtomicBool,
    override_generation: AtomicU64,
    update_lock: Mutex<()>,
}

impl Default for TitleRecordingRuntimeState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            override_generation: AtomicU64::new(0),
            update_lock: Mutex::new(()),
        }
    }
}

impl TitleRecordingRuntimeState {
    pub async fn initialize(&self, data: &dyn TrackingDataStore) -> Result<(), TrackingDataError> {
        self.set_enabled(data.load_title_recording_enabled().await?);
        Ok(())
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Acquire)
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Release);
    }

    pub fn override_generation(&self) -> u64 {
        self.override_generation.load(Ordering::Acquire)
    }

    pub fn invalidate_app_overrides(&self) {
        self.override_generation.fetch_add(1, Ordering::AcqRel);
    }

    pub async fn lock_update(&self) -> MutexGuard<'_, ()> {
        self.update_lock.lock().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_recording_defaults_on_and_updates_immediately() {
        let state = TitleRecordingRuntimeState::default();
        assert!(state.is_enabled());
        state.set_enabled(false);
        assert!(!state.is_enabled());
    }

    #[test]
    fn title_updates_are_serialized() {
        tauri::async_runtime::block_on(async {
            let state = TitleRecordingRuntimeState::default();
            let guard = state.lock_update().await;
            assert!(
                tokio::time::timeout(std::time::Duration::from_millis(1), state.lock_update(),)
                    .await
                    .is_err()
            );
            drop(guard);
            assert!(tokio::time::timeout(
                std::time::Duration::from_millis(10),
                state.lock_update(),
            )
            .await
            .is_ok());
        });
    }
}
