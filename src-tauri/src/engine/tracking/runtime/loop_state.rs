use super::super::sustained_participation::{
    apply_tracking_mode_window_state, load_sustained_participation_signals,
    resolve_tracking_status_with_runtime, SustainedParticipationRuntimeState,
    SustainedParticipationStatusInput,
};
use super::support::log_tracker_error;
use crate::data::repositories::tracker_settings::{
    TRACKER_LAST_HEARTBEAT_KEY, TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY,
};
use crate::data::tracking_runtime::TrackingRuntimeDataStore;
use crate::domain::tracking::TrackingStatusSnapshot;
use crate::engine::tracking::pause_state::TrackingPauseRuntimeState;
use crate::platform::windows::foreground as tracker;
use std::collections::HashMap;

const TRACKER_TIMESTAMP_PERSIST_INTERVAL_MS: i64 = 3_000;
const TRACKING_SETTINGS_CACHE_TTL_MS: i64 = 5_000;
const CAPTURE_WINDOW_TITLE_CACHE_LIMIT: usize = 256;
const TRACKING_PAUSE_VERIFY_INTERVAL_MS: i64 = 60_000;
const DEFAULT_CONTINUITY_WINDOW_SECS: u64 = 180;
const DEFAULT_SUSTAINED_PARTICIPATION_SECS: u64 = 900;

pub(super) struct TrackingLoopState {
    pub continuity_window_secs: u64,
    pub sustained_participation_secs: u64,
    pub tracking_paused: bool,
    pub tracked_window: tracker::WindowInfo,
    pub tracking_status: TrackingStatusSnapshot,
}

#[derive(Debug, Default)]
pub(super) struct TrackerTimestampPersistState {
    last_heartbeat_persisted_at_ms: Option<i64>,
    last_successful_sample_persisted_at_ms: Option<i64>,
}

#[derive(Debug, Default)]
pub(super) struct TrackingSettingsCache {
    settings: Option<CachedTrackingSettings>,
    capture_window_title_by_exe: HashMap<String, CachedCaptureWindowTitleSetting>,
}

#[derive(Clone, Copy, Debug)]
struct CachedTrackingSettings {
    loaded_at_ms: i64,
    continuity_window_secs: u64,
    sustained_participation_secs: u64,
}

#[derive(Clone, Copy, Debug)]
struct CachedCaptureWindowTitleSetting {
    loaded_at_ms: i64,
    last_accessed_at_ms: i64,
    capture_window_title: bool,
}

pub(super) async fn persist_tracker_runtime_timestamps(
    data: &TrackingRuntimeDataStore,
    now_ms: i64,
    did_successfully_sample_window: bool,
    state: &mut TrackerTimestampPersistState,
) {
    if !state
        .last_heartbeat_persisted_at_ms
        .map(|last| now_ms.saturating_sub(last) < TRACKER_TIMESTAMP_PERSIST_INTERVAL_MS)
        .unwrap_or(false)
    {
        if let Err(error) = data
            .save_tracker_timestamp(TRACKER_LAST_HEARTBEAT_KEY, now_ms)
            .await
        {
            log_tracker_error(format!("failed to save tracker heartbeat: {error}"));
        }
        state.last_heartbeat_persisted_at_ms = Some(now_ms);
    }

    if did_successfully_sample_window
        && !state
            .last_successful_sample_persisted_at_ms
            .map(|last| now_ms.saturating_sub(last) < TRACKER_TIMESTAMP_PERSIST_INTERVAL_MS)
            .unwrap_or(false)
    {
        if let Err(error) = data
            .save_tracker_timestamp(TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY, now_ms)
            .await
        {
            log_tracker_error(format!("failed to save tracker sample timestamp: {error}"));
        }
        state.last_successful_sample_persisted_at_ms = Some(now_ms);
    }
}

pub(super) async fn load_tracking_loop_state(
    data: &TrackingRuntimeDataStore,
    pause_state: &TrackingPauseRuntimeState,
    window_info: &tracker::WindowInfo,
    now_ms: i64,
    previous_state: &SustainedParticipationRuntimeState,
    settings_cache: &mut TrackingSettingsCache,
) -> (TrackingLoopState, SustainedParticipationRuntimeState) {
    let cached_settings = settings_cache.load_tracking_settings(data, now_ms).await;
    let continuity_window_secs = cached_settings.continuity_window_secs;
    let sustained_participation_secs = cached_settings.sustained_participation_secs;
    let tracking_paused = load_tracking_paused(data, pause_state, now_ms).await;
    let capture_window_title = settings_cache
        .load_capture_window_title_setting(data, &window_info.exe_name, now_ms)
        .await;

    let mut tracked_window = window_info.clone();
    if !capture_window_title {
        tracked_window.title.clear();
    }

    let (system_media_signal, audio_signal) =
        load_sustained_participation_signals(&tracked_window, tracking_paused).await;
    let (tracking_status, next_sustained_participation_state) =
        resolve_tracking_status_with_runtime(SustainedParticipationStatusInput {
            exe_name: &tracked_window.exe_name,
            process_path: &tracked_window.process_path,
            idle_time_ms: tracked_window.idle_time_ms,
            is_afk: tracked_window.is_afk,
            continuity_window_secs,
            sustained_participation_secs,
            tracking_paused,
            now_ms,
            previous_state,
            system_media_signal: &system_media_signal,
            audio_signal: &audio_signal,
        });
    let tracked_window = apply_tracking_mode_window_state(tracked_window, &tracking_status);

    (
        TrackingLoopState {
            continuity_window_secs,
            sustained_participation_secs,
            tracking_paused,
            tracked_window,
            tracking_status,
        },
        next_sustained_participation_state,
    )
}

impl TrackingSettingsCache {
    async fn load_tracking_settings(
        &mut self,
        data: &TrackingRuntimeDataStore,
        now_ms: i64,
    ) -> CachedTrackingSettings {
        if let Some(settings) = self.settings {
            if now_ms.saturating_sub(settings.loaded_at_ms) < TRACKING_SETTINGS_CACHE_TTL_MS {
                return settings;
            }
        }

        let continuity_window_secs = match data
            .load_timeline_merge_gap_secs(DEFAULT_CONTINUITY_WINDOW_SECS)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                log_tracker_error(format!("failed to load continuity window setting: {error}"));
                self.settings
                    .map(|settings| settings.continuity_window_secs)
                    .unwrap_or(DEFAULT_CONTINUITY_WINDOW_SECS)
            }
        };

        let sustained_participation_secs = match data
            .load_idle_timeout_secs(DEFAULT_SUSTAINED_PARTICIPATION_SECS)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                log_tracker_error(format!(
                    "failed to load sustained participation setting: {error}"
                ));
                self.settings
                    .map(|settings| settings.sustained_participation_secs)
                    .unwrap_or(DEFAULT_SUSTAINED_PARTICIPATION_SECS)
            }
        };

        let settings = CachedTrackingSettings {
            loaded_at_ms: now_ms,
            continuity_window_secs,
            sustained_participation_secs,
        };
        self.settings = Some(settings);
        settings
    }

    async fn load_capture_window_title_setting(
        &mut self,
        data: &TrackingRuntimeDataStore,
        exe_name: &str,
        now_ms: i64,
    ) -> bool {
        let exe_key = exe_name.trim().to_ascii_lowercase();
        self.cleanup_capture_window_title_cache(now_ms);
        if let Some(cached) = self.capture_window_title_by_exe.get_mut(&exe_key) {
            if now_ms.saturating_sub(cached.loaded_at_ms) < TRACKING_SETTINGS_CACHE_TTL_MS {
                cached.last_accessed_at_ms = now_ms;
                return cached.capture_window_title;
            }
        }

        let capture_window_title = match data
            .load_capture_window_title_setting_for_app(exe_name)
            .await
        {
            Ok(value) => value,
            Err(error) => {
                log_tracker_error(format!(
                    "failed to load app capture title setting for {exe_name}: {error}"
                ));
                self.capture_window_title_by_exe
                    .get(&exe_key)
                    .map(|cached| cached.capture_window_title)
                    .unwrap_or(true)
            }
        };

        self.capture_window_title_by_exe.insert(
            exe_key,
            CachedCaptureWindowTitleSetting {
                loaded_at_ms: now_ms,
                last_accessed_at_ms: now_ms,
                capture_window_title,
            },
        );
        self.cleanup_capture_window_title_cache(now_ms);
        capture_window_title
    }

    fn cleanup_capture_window_title_cache(&mut self, now_ms: i64) {
        self.capture_window_title_by_exe.retain(|_, cached| {
            now_ms.saturating_sub(cached.loaded_at_ms) < TRACKING_SETTINGS_CACHE_TTL_MS
        });

        while self.capture_window_title_by_exe.len() > CAPTURE_WINDOW_TITLE_CACHE_LIMIT {
            let Some(oldest_key) = self
                .capture_window_title_by_exe
                .iter()
                .min_by_key(|(_, cached)| cached.last_accessed_at_ms)
                .map(|(key, _)| key.clone())
            else {
                break;
            };
            self.capture_window_title_by_exe.remove(&oldest_key);
        }
    }
}

async fn load_tracking_paused(
    data: &TrackingRuntimeDataStore,
    pause_state: &TrackingPauseRuntimeState,
    now_ms: i64,
) -> bool {
    if !pause_state.should_verify(now_ms, TRACKING_PAUSE_VERIFY_INTERVAL_MS) {
        return pause_state
            .snapshot()
            .map(|snapshot| snapshot.tracking_paused)
            .unwrap_or(false);
    }

    match data.load_tracking_paused_setting().await {
        Ok(value) => {
            pause_state.set_verified(value, now_ms);
            value
        }
        Err(error) => {
            log_tracker_error(format!("failed to load tracking pause setting: {error}"));
            pause_state
                .snapshot()
                .map(|snapshot| snapshot.tracking_paused)
                .unwrap_or(false)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::repositories::tracker_settings;
    use crate::data::schema as db_schema;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn tracking_settings_default_sustained_participation_matches_release_profile() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = TrackingRuntimeDataStore::new(pool);
            let mut cache = TrackingSettingsCache::default();

            let settings = cache.load_tracking_settings(&data, 1_000).await;

            assert_eq!(settings.continuity_window_secs, 180);
            assert_eq!(settings.sustained_participation_secs, 900);
        });
    }

    #[test]
    fn tracking_pause_setting_uses_memory_until_slow_verification() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let pause_state = TrackingPauseRuntimeState::default();

            assert!(!load_tracking_paused(&data, &pause_state, 1_000).await);

            tracker_settings::save_tracking_paused_setting(&pool, true)
                .await
                .unwrap();
            assert!(!load_tracking_paused(&data, &pause_state, 2_000).await);
            assert!(load_tracking_paused(&data, &pause_state, 61_000).await);

            tracker_settings::save_tracking_paused_setting(&pool, false)
                .await
                .unwrap();
            assert!(load_tracking_paused(&data, &pause_state, 62_000).await);
            assert!(!load_tracking_paused(&data, &pause_state, 122_000).await);
        });
    }

    #[test]
    fn capture_window_title_cache_expires_entries() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = TrackingRuntimeDataStore::new(pool);
            let mut cache = TrackingSettingsCache::default();

            assert!(
                cache
                    .load_capture_window_title_setting(&data, "Code.exe", 1_000)
                    .await
            );
            assert_eq!(cache.capture_window_title_by_exe.len(), 1);

            assert!(
                cache
                    .load_capture_window_title_setting(&data, "Code.exe", 7_000)
                    .await
            );

            assert_eq!(cache.capture_window_title_by_exe.len(), 1);
            assert_eq!(
                cache
                    .capture_window_title_by_exe
                    .get("code.exe")
                    .map(|cached| cached.loaded_at_ms),
                Some(7_000)
            );
        });
    }

    #[test]
    fn capture_window_title_cache_keeps_a_hard_entry_limit() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = TrackingRuntimeDataStore::new(pool);
            let mut cache = TrackingSettingsCache::default();

            for index in 0..(CAPTURE_WINDOW_TITLE_CACHE_LIMIT + 1) {
                cache
                    .load_capture_window_title_setting(
                        &data,
                        &format!("App{index}.exe"),
                        1_000 + index as i64,
                    )
                    .await;
            }

            assert_eq!(
                cache.capture_window_title_by_exe.len(),
                CAPTURE_WINDOW_TITLE_CACHE_LIMIT
            );
            assert!(!cache.capture_window_title_by_exe.contains_key("app0.exe"));
        });
    }
}
