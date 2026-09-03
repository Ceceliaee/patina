use super::super::sustained_participation::{
    apply_tracking_mode_window_state, load_sustained_participation_signals,
    resolve_tracking_status_with_runtime, SustainedParticipationRuntimeState,
    SustainedParticipationStatusInput,
};
use super::support::log_tracker_error;
use crate::domain::tracking::{
    is_trackable_window, TrackingStatusSnapshot, WindowTrackingCandidate,
};
use crate::engine::tracking::pause_state::TrackingPauseRuntimeState;
use crate::engine::tracking::ports::{
    TrackingDataStore, TRACKER_LAST_HEARTBEAT_KEY, TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY,
};
use crate::engine::tracking::title_state::TitleRecordingRuntimeState;
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
    pub app_tracking_enabled: bool,
    pub capture_window_title: bool,
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
    title_override_generation: u64,
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
    data: &dyn TrackingDataStore,
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
        } else {
            state.last_heartbeat_persisted_at_ms = Some(now_ms);
        }
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
        } else {
            state.last_successful_sample_persisted_at_ms = Some(now_ms);
        }
    }
}

pub(super) async fn load_tracking_loop_state(
    data: &dyn TrackingDataStore,
    pause_state: &TrackingPauseRuntimeState,
    title_state: &TitleRecordingRuntimeState,
    window_info: &tracker::WindowInfo,
    now_ms: i64,
    previous_state: &SustainedParticipationRuntimeState,
    settings_cache: &mut TrackingSettingsCache,
) -> (TrackingLoopState, SustainedParticipationRuntimeState) {
    let cached_settings = settings_cache.load_tracking_settings(data, now_ms).await;
    let continuity_window_secs = cached_settings.continuity_window_secs;
    let sustained_participation_secs = cached_settings.sustained_participation_secs;
    let tracking_paused = load_tracking_paused(data, pause_state, now_ms).await;
    let app_tracking_enabled = match data
        .load_tracking_enabled_setting_for_app(&window_info.exe_name)
        .await
    {
        Ok(value) => value,
        Err(error) => {
            log_tracker_error(format!(
                "failed to load app tracking setting for {}: {error}",
                window_info.exe_name
            ));
            false
        }
    };
    let capture_window_title = title_state.is_enabled()
        && settings_cache
            .load_capture_window_title_setting(
                data,
                &window_info.exe_name,
                now_ms,
                title_state.override_generation(),
            )
            .await;

    let (system_media_signal, audio_signal) =
        load_sustained_participation_signals(window_info, tracking_paused).await;
    let (mut tracking_status, mut next_sustained_participation_state) =
        resolve_tracking_status_with_runtime(SustainedParticipationStatusInput {
            exe_name: &window_info.exe_name,
            process_path: &window_info.process_path,
            idle_time_ms: window_info.idle_time_ms,
            is_afk: window_info.is_afk,
            continuity_window_secs,
            sustained_participation_secs,
            tracking_paused,
            now_ms,
            previous_state,
            system_media_signal: &system_media_signal,
            audio_signal: &audio_signal,
        });
    let tracked_window = apply_tracking_mode_window_state(window_info.clone(), &tracking_status);
    // AFK is handled by the timing policy and seal_stop. Keep its terminal
    // sustained state so the session closes at the sustained deadline.
    let window_identity_is_trackable =
        is_trackable_window(Some(WindowTrackingCandidate::from_window_fields(
            &tracked_window.exe_name,
            &tracked_window.title,
            &tracked_window.window_class,
            false,
        )));

    if !app_tracking_enabled || !window_identity_is_trackable {
        tracking_status = TrackingStatusSnapshot::default();
        next_sustained_participation_state = SustainedParticipationRuntimeState::default();
    }

    (
        TrackingLoopState {
            continuity_window_secs,
            sustained_participation_secs,
            tracking_paused,
            app_tracking_enabled,
            capture_window_title,
            tracked_window,
            tracking_status,
        },
        next_sustained_participation_state,
    )
}

impl TrackingSettingsCache {
    async fn load_tracking_settings(
        &mut self,
        data: &dyn TrackingDataStore,
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
        data: &dyn TrackingDataStore,
        exe_name: &str,
        now_ms: i64,
        override_generation: u64,
    ) -> bool {
        if self.title_override_generation != override_generation {
            self.capture_window_title_by_exe.clear();
            self.title_override_generation = override_generation;
        }
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
    data: &dyn TrackingDataStore,
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
    use crate::data::tracking_runtime::TrackingRuntimeDataStore;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn afk_window_preserves_expired_sustained_state_until_sealing() {
        tauri::async_runtime::block_on(async {
            use crate::domain::tracking::{
                resolve_sustained_participation_identity_key, SustainedParticipationKind,
                SustainedParticipationState,
            };
            let data = TrackingRuntimeDataStore::new(setup_test_db().await);
            let window = tracker::WindowInfo {
                hwnd: "0x100".into(),
                root_owner_hwnd: "0x100".into(),
                process_id: 123,
                window_class: "Chrome_WidgetWin_1".into(),
                title: "Media".into(),
                exe_name: "chrome.exe".into(),
                process_path: r"C:\Program Files\Google\Chrome\Application\chrome.exe".into(),
                app_user_model_id: String::new(),
                is_afk: true,
                idle_time_ms: 901_000,
            };
            let previous = SustainedParticipationRuntimeState {
                identity_key: resolve_sustained_participation_identity_key(
                    &window.exe_name,
                    &window.process_path,
                ),
                last_match_at_ms: Some(999_000),
                last_kind: Some(SustainedParticipationKind::Audio),
                ..Default::default()
            };
            let (state, next) = load_tracking_loop_state(
                &data,
                &TrackingPauseRuntimeState::default(),
                &TitleRecordingRuntimeState::default(),
                &window,
                1_000_000,
                &previous,
                &mut TrackingSettingsCache::default(),
            )
            .await;

            assert!(state.tracked_window.is_afk);
            assert!(!state.tracking_status.is_tracking_active);
            assert_eq!(
                state.tracking_status.sustained_participation_state,
                SustainedParticipationState::Expired
            );
            assert_eq!(next.identity_key, previous.identity_key);
        });
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

            crate::data::repositories::app_settings::commit_app_setting_mutations(
                &pool,
                &[
                    crate::data::repositories::app_settings::AppSettingMutation {
                        key: "tracking_paused".into(),
                        value: "1".into(),
                    },
                ],
            )
            .await
            .unwrap();
            assert!(!load_tracking_paused(&data, &pause_state, 2_000).await);
            assert!(load_tracking_paused(&data, &pause_state, 61_000).await);

            crate::data::repositories::app_settings::commit_app_setting_mutations(
                &pool,
                &[
                    crate::data::repositories::app_settings::AppSettingMutation {
                        key: "tracking_paused".into(),
                        value: "0".into(),
                    },
                ],
            )
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
                    .load_capture_window_title_setting(&data, "Code.exe", 1_000, 0)
                    .await
            );
            assert_eq!(cache.capture_window_title_by_exe.len(), 1);

            assert!(
                cache
                    .load_capture_window_title_setting(&data, "Code.exe", 7_000, 0)
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
                        0,
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

    #[test]
    fn capture_window_title_cache_invalidates_on_override_generation() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let mut cache = TrackingSettingsCache::default();
            assert!(
                cache
                    .load_capture_window_title_setting(&data, "Code.exe", 1_000, 0)
                    .await
            );

            tracker_settings::save_setting_value(
                &pool,
                "__app_override::code.exe",
                r#"{"captureTitle":false}"#,
            )
            .await
            .unwrap();

            assert!(
                !cache
                    .load_capture_window_title_setting(&data, "Code.exe", 1_001, 1)
                    .await
            );
        });
    }

    #[test]
    fn excluded_app_disables_runtime_tracking_before_transition_work() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            crate::data::repositories::tracker_settings::save_setting_value(
                &pool,
                "__app_override::code.exe",
                r#"{"track":false,"captureTitle":true}"#,
            )
            .await
            .unwrap();
            let data = TrackingRuntimeDataStore::new(pool);
            let pause_state = TrackingPauseRuntimeState::default();
            let title_state = TitleRecordingRuntimeState::default();
            let mut cache = TrackingSettingsCache::default();
            let window = tracker::WindowInfo {
                hwnd: "0x100".into(),
                root_owner_hwnd: "0x100".into(),
                process_id: 123,
                window_class: "Chrome_WidgetWin_1".into(),
                title: "Editor".into(),
                exe_name: "Code.exe".into(),
                process_path: r"C:\Program Files\Code\Code.exe".into(),
                app_user_model_id: String::new(),
                is_afk: false,
                idle_time_ms: 0,
            };

            let (state, _) = load_tracking_loop_state(
                &data,
                &pause_state,
                &title_state,
                &window,
                1_000,
                &SustainedParticipationRuntimeState::default(),
                &mut cache,
            )
            .await;

            assert!(!state.app_tracking_enabled);
            assert!(!state.tracking_status.is_tracking_active);
            assert_eq!(state.tracked_window.exe_name, "Code.exe");
        });
    }

    #[test]
    fn canonical_alias_override_disables_native_tracking_and_title_capture() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            crate::data::repositories::tracker_settings::save_setting_value(
                &pool,
                "__app_override::alma.exe",
                r#"{"track":false,"captureTitle":false}"#,
            )
            .await
            .unwrap();
            let data = TrackingRuntimeDataStore::new(pool);
            let pause_state = TrackingPauseRuntimeState::default();
            let title_state = TitleRecordingRuntimeState::default();
            let mut cache = TrackingSettingsCache::default();
            let window = tracker::WindowInfo {
                hwnd: "0x100".into(),
                root_owner_hwnd: "0x100".into(),
                process_id: 123,
                window_class: "Chrome_WidgetWin_1".into(),
                title: "Alma".into(),
                exe_name: "alma-0.0.750-win-x64.exe".into(),
                process_path: r"C:\Program Files\Alma\alma-0.0.750-win-x64.exe".into(),
                app_user_model_id: String::new(),
                is_afk: false,
                idle_time_ms: 0,
            };

            let (state, _) = load_tracking_loop_state(
                &data,
                &pause_state,
                &title_state,
                &window,
                1_000,
                &SustainedParticipationRuntimeState::default(),
                &mut cache,
            )
            .await;

            assert!(!state.app_tracking_enabled);
            assert!(!state.capture_window_title);
            assert!(!state.tracking_status.is_tracking_active);
        });
    }

    #[test]
    fn patina_widget_is_inactive_without_disabling_patina_app_tracking() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = TrackingRuntimeDataStore::new(pool);
            let pause_state = TrackingPauseRuntimeState::default();
            let title_state = TitleRecordingRuntimeState::default();
            let mut cache = TrackingSettingsCache::default();
            let window = tracker::WindowInfo {
                hwnd: "0x200".into(),
                root_owner_hwnd: "0x200".into(),
                process_id: 456,
                window_class: "Chrome_WidgetWin_1".into(),
                title: crate::domain::widget::WIDGET_WINDOW_TITLE.into(),
                exe_name: "Patina.exe".into(),
                process_path: r"C:\Program Files\Patina\Patina.exe".into(),
                app_user_model_id: String::new(),
                is_afk: false,
                idle_time_ms: 0,
            };

            let (state, _) = load_tracking_loop_state(
                &data,
                &pause_state,
                &title_state,
                &window,
                1_000,
                &SustainedParticipationRuntimeState::default(),
                &mut cache,
            )
            .await;

            assert!(state.app_tracking_enabled);
            assert!(!state.tracking_status.is_tracking_active);
            assert_eq!(
                state.tracked_window.title,
                crate::domain::widget::WIDGET_WINDOW_TITLE
            );
        });
    }
}

pub(super) async fn record_committed_sample(
    data: &dyn TrackingDataStore,
    health: &crate::engine::tracking::watchdog::RuntimeHealthState,
    now_ms: i64,
    successful: bool,
    persisted: &mut TrackerTimestampPersistState,
) {
    if successful {
        health.note_successful_sample(now_ms);
        persist_tracker_runtime_timestamps(data, now_ms, true, persisted).await;
    }
}

pub(super) struct TrackingStop {
    pub change_reason: Option<&'static str>,
}

impl TrackingLoopState {
    pub(super) async fn seal_stop(
        &self,
        data: &dyn TrackingDataStore,
        previous_window: Option<&tracker::WindowInfo>,
        previous_status: Option<&TrackingStatusSnapshot>,
        now_ms: i64,
        successful_sample: bool,
    ) -> Result<Option<TrackingStop>, crate::engine::tracking::ports::TrackingDataError> {
        use super::super::session_timeout::*;
        let reason = if self.tracking_paused {
            seal_active_sessions_for_tracking_pause(data, now_ms).await?
        } else if !self.app_tracking_enabled {
            super::exclusion::seal_excluded_app_session(data, now_ms).await?
        } else if !successful_sample {
            return Ok(None);
        } else if should_seal_sustained_participation(
            previous_window,
            previous_status,
            &self.tracked_window,
            &self.tracking_status,
        ) {
            seal_active_sessions_for_passive_participation_timeout(
                data,
                &self.tracked_window,
                now_ms,
                self.sustained_participation_secs,
            )
            .await?
        } else if should_suspend_active_tracking(
            previous_window,
            &self.tracked_window,
            self.continuity_window_secs,
            &self.tracking_status,
        ) {
            seal_active_sessions_for_continuity_timeout(
                data,
                &self.tracked_window,
                now_ms,
                self.continuity_window_secs,
            )
            .await?
        } else {
            return Ok(None);
        };
        Ok(Some(TrackingStop {
            change_reason: reason,
        }))
    }
}
