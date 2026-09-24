use super::ports::{TrackingDataError, TrackingDataStore};
use crate::domain::browser_title_privacy::{matches_observed_page_title, ConfirmedBrowserTitle};
use crate::platform::windows::foreground::WindowInfo;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::sync::{Mutex, MutexGuard};

#[derive(Debug)]
pub struct TitleRecordingRuntimeState {
    enabled: AtomicBool,
    override_generation: AtomicU64,
    update_lock: Mutex<()>,
    browser_title: std::sync::Mutex<Option<ConfirmedBrowserTitle>>,
    anonymous_web: std::sync::Mutex<Option<ConfirmedBrowserTitle>>,
}

impl Default for TitleRecordingRuntimeState {
    fn default() -> Self {
        Self {
            enabled: AtomicBool::new(true),
            override_generation: AtomicU64::new(0),
            update_lock: Mutex::new(()),
            browser_title: std::sync::Mutex::new(None),
            anonymous_web: std::sync::Mutex::new(None),
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
        if !enabled {
            self.clear_browser_title();
        }
    }

    pub fn override_generation(&self) -> u64 {
        self.override_generation.load(Ordering::Acquire)
    }

    pub fn invalidate_app_overrides(&self) {
        self.override_generation.fetch_add(1, Ordering::AcqRel);
        self.clear_browser_title();
        self.clear_anonymous_web();
    }

    pub fn clear_browser_title(&self) {
        *self
            .browser_title
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
    }

    pub fn clear_anonymous_web(&self) {
        *self
            .anonymous_web
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = None;
    }

    pub fn confirm_anonymous_web(&self, window: &WindowInfo, now_ms: i64) {
        self.clear_browser_title();
        *self
            .anonymous_web
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = Some(ConfirmedBrowserTitle {
            exe_name: window.exe_name.clone(),
            hwnd: window.hwnd.clone(),
            process_id: window.process_id,
            native_title: window.title.clone(),
            observed_at_ms: now_ms,
            policy_generation: self.override_generation(),
        });
    }

    pub fn is_anonymous_web(&self, window: &WindowInfo, now_ms: i64) -> bool {
        self.anonymous_web
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .is_some_and(|grant| {
                grant.permits(
                    &window.exe_name,
                    &window.hwnd,
                    window.process_id,
                    &window.title,
                    now_ms,
                    self.override_generation(),
                )
            })
    }

    pub fn take_invalid_anonymous_web_cutoff(
        &self,
        window: &WindowInfo,
        now_ms: i64,
    ) -> Option<i64> {
        let mut guard = self
            .anonymous_web
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let grant = guard.as_ref()?;
        if grant.permits(
            &window.exe_name,
            &window.hwnd,
            window.process_id,
            &window.title,
            now_ms,
            self.override_generation(),
        ) {
            return None;
        }
        let cutoff = now_ms.min(
            grant
                .observed_at_ms
                .saturating_add(crate::domain::web_activity::WEB_ACTIVITY_OBSERVATION_TTL_MS),
        );
        *guard = None;
        Some(cutoff)
    }

    pub fn confirm_browser_title(&self, window: &WindowInfo, page_title: &str, now_ms: i64) {
        self.clear_anonymous_web();
        let grant =
            matches_observed_page_title(&window.title, page_title).then(|| ConfirmedBrowserTitle {
                exe_name: window.exe_name.clone(),
                hwnd: window.hwnd.clone(),
                process_id: window.process_id,
                native_title: window.title.clone(),
                observed_at_ms: now_ms,
                policy_generation: self.override_generation(),
            });
        *self
            .browser_title
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = grant;
    }

    pub fn permits_browser_title(&self, window: &WindowInfo, now_ms: i64) -> bool {
        self.browser_title
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .is_some_and(|grant| {
                grant.permits(
                    &window.exe_name,
                    &window.hwnd,
                    window.process_id,
                    &window.title,
                    now_ms,
                    self.override_generation(),
                )
            })
    }

    pub async fn lock_update(&self) -> MutexGuard<'_, ()> {
        self.update_lock.lock().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn anonymous_page_confirmation_expires_and_rule_changes_revoke_title_grants() {
        let state = TitleRecordingRuntimeState::default();
        let window: WindowInfo = serde_json::from_value(serde_json::json!({
            "hwnd":"1", "root_owner_hwnd":"1", "process_id":1, "window_class":"Browser",
            "title":"Private - Google Chrome", "exe_name":"chrome.exe", "process_path":"",
            "is_afk":false, "idle_time_ms":0
        }))
        .unwrap();
        state.confirm_anonymous_web(&window, 1000);
        assert!(state.is_anonymous_web(&window, 45_999));
        assert_eq!(
            state.take_invalid_anonymous_web_cutoff(&window, 50_000),
            Some(46_000)
        );
        assert!(!state.is_anonymous_web(&window, 1001));
        state.confirm_browser_title(&window, "Private", 1000);
        assert!(state.permits_browser_title(&window, 1001));
        state.invalidate_app_overrides();
        assert!(!state.permits_browser_title(&window, 1001));
        state.confirm_anonymous_web(&window, 1000);
        let mut changed = window.clone();
        changed.hwnd = "2".into();
        assert_eq!(
            state.take_invalid_anonymous_web_cutoff(&changed, 2000),
            Some(2000)
        );
        assert!(!state.is_anonymous_web(&window, 2001));
    }

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
