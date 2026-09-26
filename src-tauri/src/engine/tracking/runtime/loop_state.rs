use super::super::sustained_participation::{
    apply_tracking_mode_window_state, load_sustained_participation_signals,
    resolve_tracking_status_with_runtime, SustainedParticipationRuntimeState,
    SustainedParticipationStatusInput,
};
use super::support::log_tracker_error;
use crate::domain::tracking::{
    is_trackable_window, resolve_app_override_executable, TrackingStatusSnapshot,
    WindowTrackingCandidate,
};
use crate::engine::tracking::pause_state::TrackingPauseRuntimeState;
use crate::engine::tracking::ports::{
    TrackingDataStore, TRACKER_LAST_HEARTBEAT_KEY, TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY,
};
use crate::engine::tracking::title_state::TitleRecordingRuntimeState;
use crate::platform::windows::foreground as tracker;
use std::collections::HashMap;

const TRACKER_TIMESTAMP_PERSIST_INTERVAL_MS: i64 = 3_000;

/// A stale or reversed clock cannot extend the last committed activity interval.
pub(super) async fn seal_stale_sample<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    data: &dyn TrackingDataStore,
    health: &super::super::watchdog::RuntimeHealthState,
    now_ms: i64,
) -> Result<Option<bool>, String> {
    let Some(last_sample) = health.snapshot().last_successful_sample_ms else {
        return Ok(None);
    };
    if now_ms >= last_sample && now_ms.saturating_sub(last_sample) <= 8_000 {
        return Ok(None);
    }
    let ended = data
        .end_active_sessions(last_sample)
        .await
        .map_err(|error| error.to_string())?;
    super::snapshot_projection::clear_active_session_snapshot(app);
    if ended {
        let _ = super::emit_tracking_data_changed(
            app,
            "session-ended-stale-sample",
            last_sample as u64,
        );
    }
    Ok(Some(now_ms < last_sample))
}
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
    pub anonymous_web: bool,
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
    app_tracking: Option<(String, CachedPolicy)>,
    anonymous_web_rules: Option<CachedPolicy>,
}

#[derive(Clone, Copy, Debug)]
struct CachedPolicy {
    loaded_at_ms: i64,
    value: bool,
}

impl CachedPolicy {
    fn is_fresh(self, now_ms: i64) -> bool {
        now_ms >= self.loaded_at_ms
            && now_ms.saturating_sub(self.loaded_at_ms) < TRACKING_SETTINGS_CACHE_TTL_MS
    }
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
    settings_cache.sync_policy_generation(title_state.override_generation());
    let cached_settings = settings_cache.load_tracking_settings(data, now_ms).await;
    let continuity_window_secs = cached_settings.continuity_window_secs;
    let sustained_participation_secs = cached_settings.sustained_participation_secs;
    let tracking_paused = load_tracking_paused(data, pause_state, now_ms).await;
    let anonymous_web = title_state.is_anonymous_web(window_info, now_ms);
    let app_tracking_enabled = settings_cache
        .load_app_tracking(data, &window_info.exe_name, now_ms)
        .await
        && !anonymous_web;
    let mut capture_window_title = app_tracking_enabled
        && title_state.is_enabled()
        && settings_cache
            .load_capture_window_title_setting(
                data,
                &window_info.exe_name,
                now_ms,
                title_state.override_generation(),
            )
            .await;

    if crate::domain::web_activity::resolve_web_activity_browser_family(&window_info.exe_name)
        .is_some()
        && settings_cache.load_anonymous_web_rules(data, now_ms).await
        && !title_state.permits_browser_title(window_info, now_ms)
    {
        capture_window_title = false;
    }

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

    if !window_identity_is_trackable {
        tracking_status = TrackingStatusSnapshot::default();
        next_sustained_participation_state = SustainedParticipationRuntimeState::default();
    }

    (
        TrackingLoopState {
            continuity_window_secs,
            sustained_participation_secs,
            tracking_paused,
            app_tracking_enabled,
            anonymous_web,
            capture_window_title,
            tracked_window,
            tracking_status,
        },
        next_sustained_participation_state,
    )
}

impl TrackingSettingsCache {
    // Policy commits and backup restore invalidate this generation while holding
    // the same tracking transition lock as the sampling loop.
    fn sync_policy_generation(&mut self, generation: u64) {
        if self.title_override_generation != generation {
            self.capture_window_title_by_exe.clear();
            self.app_tracking = None;
            self.anonymous_web_rules = None;
            self.title_override_generation = generation;
        }
    }

    async fn load_app_tracking(
        &mut self,
        data: &dyn TrackingDataStore,
        exe_name: &str,
        now_ms: i64,
    ) -> bool {
        let key = resolve_app_override_executable(exe_name).unwrap_or_default();
        if let Some((cached_key, cached)) = &self.app_tracking {
            if *cached_key == key && cached.is_fresh(now_ms) {
                return cached.value;
            }
        }
        self.app_tracking = None;
        match data.load_tracking_enabled_setting_for_app(exe_name).await {
            Ok(value) => {
                self.app_tracking = Some((
                    key,
                    CachedPolicy {
                        loaded_at_ms: now_ms,
                        value,
                    },
                ));
                value
            }
            Err(error) => {
                log_tracker_error(format!("failed to load app tracking policy: {error}"));
                false
            }
        }
    }

    async fn load_anonymous_web_rules(
        &mut self,
        data: &dyn TrackingDataStore,
        now_ms: i64,
    ) -> bool {
        if let Some(cached) = self.anonymous_web_rules {
            if cached.is_fresh(now_ms) {
                return cached.value;
            }
        }
        self.anonymous_web_rules = None;
        match data.has_anonymous_web_rules().await {
            Ok(value) => {
                self.anonymous_web_rules = Some(CachedPolicy {
                    loaded_at_ms: now_ms,
                    value,
                });
                value
            }
            Err(error) => {
                log_tracker_error(format!("failed to load anonymous web policy: {error}"));
                true
            }
        }
    }

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
        self.sync_policy_generation(override_generation);
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

    #[tokio::test]
    async fn restored_pause_read_failure_is_safe_and_retries_without_waiting() {
        use futures_util::FutureExt;
        use std::panic::AssertUnwindSafe;

        let pool = setup_test_db().await;
        let outcome = AssertUnwindSafe(async {
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let pause_state = TrackingPauseRuntimeState::default();
            pause_state.initialize(&data, 1_000).await.unwrap();
            assert!(!pause_state.snapshot().unwrap().tracking_paused);
            pool.execute("INSERT INTO settings(key,value) VALUES('tracking_paused','true')")
                .await
                .unwrap();
            pool.execute("ALTER TABLE settings RENAME TO unavailable_settings")
                .await
                .unwrap();

            let error = pause_state.initialize(&data, 2_000).await.unwrap_err();
            assert!(error.to_string().contains("no such table: settings"));
            assert!(
                pause_state.snapshot().unwrap().tracking_paused,
                "a failed restored pause read must not retain the old unpaused state"
            );
            assert!(pause_state.should_verify(2_001, TRACKING_PAUSE_VERIFY_INTERVAL_MS));
            assert!(
                load_tracking_paused(&data, &pause_state, 2_001).await,
                "another failed read must retain safe pause without marking it verified"
            );

            pool.execute("ALTER TABLE unavailable_settings RENAME TO settings")
                .await
                .unwrap();
            assert!(pause_state.should_verify(2_002, TRACKING_PAUSE_VERIFY_INTERVAL_MS));
            assert!(load_tracking_paused(&data, &pause_state, 2_002).await);
            assert!(!pause_state.should_verify(2_003, TRACKING_PAUSE_VERIFY_INTERVAL_MS));
        })
        .catch_unwind()
        .await;
        pool.close().await;
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }

    #[tokio::test]
    async fn restored_unpaused_setting_is_available_after_a_successful_refresh() {
        use futures_util::FutureExt;
        use std::panic::AssertUnwindSafe;

        let pool = setup_test_db().await;
        let outcome = AssertUnwindSafe(async {
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let pause_state = TrackingPauseRuntimeState::default();
            pause_state.set_verified(true, 1_000);
            pool.execute("INSERT INTO settings(key,value) VALUES('tracking_paused','false')")
                .await
                .unwrap();
            pause_state.initialize(&data, 2_000).await.unwrap();
            assert!(!pause_state.snapshot().unwrap().tracking_paused);
            assert!(!pause_state.should_verify(2_001, TRACKING_PAUSE_VERIFY_INTERVAL_MS));
            assert!(!load_tracking_paused(&data, &pause_state, 2_001).await);
        })
        .catch_unwind()
        .await;
        pool.close().await;
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
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
    #[ignore = "run with pnpm run perf:tracking-policy"]
    fn recording_policy_cache_capacity_report() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = TrackingRuntimeDataStore::new(pool.clone());
            for rule_count in [100, 1_000, 10_000] {
                pool.execute("DELETE FROM settings").await.unwrap();
                sqlx::query("WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i+1<?) INSERT INTO settings(key,value) SELECT '__web_domain_override::site'||i||'.test','{\"enabled\":true}' FROM n")
                    .bind(rule_count).execute(&pool).await.unwrap();
                for pair in 0..5 {
                    // Alternate order, with an independent cache for each arm.
                    for cached in if pair % 2 == 0 {
                        [false, true]
                    } else {
                        [true, false]
                    } {
                        let mut cache = TrackingSettingsCache::default();
                        let start = std::time::Instant::now();
                        let mut allowed = 0;
                        for sample in 0..600 {
                            let (tracking, anonymous) = if cached {
                                (
                                    cache
                                        .load_app_tracking(&data, "chrome.exe", sample * 1_000)
                                        .await,
                                    cache.load_anonymous_web_rules(&data, sample * 1_000).await,
                                )
                            } else {
                                (
                                    data.load_tracking_enabled_setting_for_app("chrome.exe")
                                        .await
                                        .unwrap(),
                                    data.has_anonymous_web_rules().await.unwrap(),
                                )
                            };
                            allowed += usize::from(tracking && !anonymous);
                        }
                        assert_eq!(allowed, 600);
                        println!(
                            "POLICY_CACHE_PERF {}",
                            serde_json::json!({
                                "rules":rule_count,"pair":pair,"cached":cached,"samples":600,
                                "elapsed_ms":start.elapsed().as_secs_f64()*1000.0,
                                "build":"test-debug","storage":"sqlite-in-memory"
                            })
                        );
                    }
                }
            }
        });
    }

    #[test]
    fn recording_policy_cache_reuses_reads_and_fails_closed_after_invalidation() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let mut cache = TrackingSettingsCache::default();
            assert!(cache.load_app_tracking(&data, "Code.exe", 1_000).await);
            assert!(!cache.load_anonymous_web_rules(&data, 1_000).await);
            pool.execute("ALTER TABLE settings RENAME TO unavailable_settings")
                .await
                .unwrap();
            // A successful hit must not access SQLite, even if it is unavailable.
            assert!(cache.load_app_tracking(&data, "CODE.EXE", 1_001).await);
            assert!(cache.load_app_tracking(&data, "\"Code\"", 1_001).await);
            assert!(!cache.load_anonymous_web_rules(&data, 1_001).await);
            cache.sync_policy_generation(1);
            assert!(!cache.load_app_tracking(&data, "Code.exe", 1_002).await);
            assert!(cache.load_anonymous_web_rules(&data, 1_002).await);
            assert!(cache.app_tracking.is_none());
            assert!(cache.anonymous_web_rules.is_none());
            pool.execute("ALTER TABLE unavailable_settings RENAME TO settings")
                .await
                .unwrap();
            // Failed reads are not cached: recovery is visible on the next sample.
            assert!(cache.load_app_tracking(&data, "Code.exe", 1_003).await);
            assert!(!cache.load_anonymous_web_rules(&data, 1_003).await);
        });
    }

    #[test]
    fn recording_policy_cache_expires_on_deadline_clock_reversal_and_app_switch() {
        tauri::async_runtime::block_on(async {
            for (next_exe, next_ms) in
                [("Code.exe", 6_000), ("Code.exe", 999), ("Other.exe", 1_001)]
            {
                let pool = setup_test_db().await;
                let data = TrackingRuntimeDataStore::new(pool.clone());
                let mut cache = TrackingSettingsCache::default();
                assert!(cache.load_app_tracking(&data, "Code.exe", 1_000).await);
                assert!(!cache.load_anonymous_web_rules(&data, 1_000).await);
                pool.execute("ALTER TABLE settings RENAME TO unavailable_settings")
                    .await
                    .unwrap();
                assert!(!cache.load_app_tracking(&data, next_exe, next_ms).await);
                if next_ms != 1_001 {
                    assert!(cache.load_anonymous_web_rules(&data, next_ms).await);
                }
            }
        });
    }

    #[test]
    fn recording_policy_generation_applies_exclusion_and_reenable_without_ttl_delay() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let mut cache = TrackingSettingsCache::default();
            for (generation, enabled) in [(0, true), (1, false), (2, true), (3, false)] {
                tracker_settings::save_setting_value(
                    &pool,
                    "__app_override::code.exe",
                    &format!(r#"{{"track":{enabled}}}"#),
                )
                .await
                .unwrap();
                tracker_settings::save_setting_value(
                    &pool,
                    "__web_domain_override::private.test",
                    &format!(r#"{{"enabled":{enabled}}}"#),
                )
                .await
                .unwrap();
                cache.sync_policy_generation(generation);
                assert_eq!(
                    cache
                        .load_app_tracking(&data, "Code.exe", 1_000 + generation as i64)
                        .await,
                    enabled
                );
                assert_eq!(
                    cache
                        .load_anonymous_web_rules(&data, 1_000 + generation as i64)
                        .await,
                    !enabled
                );
            }
            pool.execute("DELETE FROM settings WHERE key IN ('__app_override::code.exe', '__web_domain_override::private.test')").await.unwrap();
            cache.sync_policy_generation(4);
            assert!(cache.load_app_tracking(&data, "Code.exe", 1_004).await);
            assert!(!cache.load_anonymous_web_rules(&data, 1_004).await);
        });
    }

    #[test]
    fn anonymous_identity_expiry_respects_earlier_native_idle_boundaries() {
        tauri::async_runtime::block_on(async {
            use crate::domain::tracking::SustainedParticipationState;
            let previous: tracker::WindowInfo = serde_json::from_value(serde_json::json!({
                "hwnd":"1", "root_owner_hwnd":"1", "process_id":123,
                "window_class":"Browser", "title":"Private", "exe_name":"chrome.exe",
                "process_path":"", "is_afk":false, "idle_time_ms":0
            }))
            .unwrap();
            for (afk, expired, paused, idle, now, deadline, expected) in [
                (true, false, false, 200_000, 400_000, 390_000, 200_000),
                (false, false, false, 200_000, 400_000, 390_000, 380_000),
                (true, true, false, 950_000, 1_000_000, 960_000, 950_000),
                (true, true, false, 950_000, 1_000_000, 940_000, 940_000),
                (false, false, true, 0, 400_000, 390_000, 390_000),
            ] {
                let pool = setup_test_db().await;
                for schema in [
                    db_schema::IMPORT_DATA_SCHEMA_SQL,
                    db_schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL,
                    db_schema::ACTIVITY_READ_MODELS_SCHEMA_SQL,
                    crate::data::repositories::anonymous_activity::SCHEMA_SQL,
                ] {
                    pool.execute(schema).await.unwrap();
                }
                let data = TrackingRuntimeDataStore::new(pool.clone());
                let mut current = previous.clone();
                current.is_afk = afk;
                current.idle_time_ms = idle;
                let previous_status = TrackingStatusSnapshot {
                    sustained_participation_active: expired,
                    ..Default::default()
                };
                let state = TrackingLoopState {
                    continuity_window_secs: 180,
                    sustained_participation_secs: 900,
                    tracking_paused: paused,
                    app_tracking_enabled: true,
                    anonymous_web: false,
                    capture_window_title: false,
                    tracked_window: current,
                    tracking_status: TrackingStatusSnapshot {
                        sustained_participation_state: if expired {
                            SustainedParticipationState::Expired
                        } else {
                            SustainedParticipationState::Inactive
                        },
                        ..Default::default()
                    },
                };
                data.observe_anonymous_activity(0, true).await.unwrap();
                data.observe_anonymous_activity(now - 1, true)
                    .await
                    .unwrap();
                let cutoff = state.resolve_anonymous_cutoff(
                    Some(&previous),
                    Some(&previous_status),
                    deadline,
                    now,
                );
                assert_eq!(cutoff, expected);
                data.seal_anonymous_activity(cutoff).await.unwrap();
                state
                    .seal_stop(&data, Some(&previous), Some(&previous_status), now, true)
                    .await
                    .unwrap();
                let row =
                    crate::data::repositories::anonymous_activity::read_range(&pool, 0, now + 1)
                        .await
                        .unwrap();
                assert_eq!(row.len(), 1);
                assert_eq!(row[0].end_time, Some(expected));
            }
        });
    }

    #[test]
    fn unknown_browser_titles_are_suppressed_only_with_anonymous_web_rules() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let data = TrackingRuntimeDataStore::new(pool.clone());
            let pause = TrackingPauseRuntimeState::default();
            let titles = TitleRecordingRuntimeState::default();
            let mut cache = TrackingSettingsCache::default();
            let mut window = tracker::WindowInfo {
                hwnd: "1".into(),
                root_owner_hwnd: "1".into(),
                process_id: 123,
                window_class: "Chrome_WidgetWin_1".into(),
                title: "Normal - Google Chrome".into(),
                exe_name: "chrome.exe".into(),
                process_path: String::new(),
                app_user_model_id: String::new(),
                is_afk: false,
                idle_time_ms: 0,
            };
            for (step, expected_title) in [
                (0, true),
                (1, false),
                (2, true),
                (3, false),
                (4, true),
                (5, true),
            ] {
                match step {
                    1 => tracker_settings::save_setting_value(
                        &pool,
                        "__web_domain_override::private.test",
                        r#"{"enabled":false}"#,
                    )
                    .await
                    .unwrap(),
                    2 => titles.confirm_browser_title(&window, "Normal", 1002),
                    3 => window.title = "Unknown - Google Chrome".into(),
                    4 => window.exe_name = "editor.exe".into(),
                    5 => {
                        window.exe_name = "chrome.exe".into();
                        tracker_settings::save_setting_value(
                            &pool,
                            "__web_domain_override::private.test",
                            r#"{"enabled":true}"#,
                        )
                        .await
                        .unwrap();
                    }
                    _ => {}
                }
                if step == 1 || step == 5 {
                    titles.invalidate_app_overrides();
                }
                let (state, _) = load_tracking_loop_state(
                    &data,
                    &pause,
                    &titles,
                    &window,
                    1000 + step,
                    &SustainedParticipationRuntimeState::default(),
                    &mut cache,
                )
                .await;
                assert_eq!(state.capture_window_title, expected_title, "step {step}");
                assert!(state.tracking_status.is_tracking_active, "step {step}");
                assert!(
                    state.app_tracking_enabled,
                    "unknown identity must still count normal browser time"
                );
                data.end_active_sessions(1000 + step).await.unwrap();
                crate::engine::tracking::transition::apply_window_transition_with_title_policy(
                    &data,
                    None,
                    &state.tracked_window,
                    1000 + step,
                    1000 + step,
                    state.capture_window_title,
                    crate::engine::tracking::active_session::start_session_for_transition,
                )
                .await
                .unwrap();
                let persisted: String =
                    sqlx::query_scalar("SELECT window_title FROM sessions WHERE end_time IS NULL")
                        .fetch_one(&pool)
                        .await
                        .unwrap();
                assert_eq!(
                    persisted,
                    if expected_title {
                        window.title.as_str()
                    } else {
                        ""
                    },
                    "persisted step {step}"
                );
                let samples: Vec<String> = sqlx::query_scalar("SELECT title FROM session_title_samples WHERE session_id = (SELECT id FROM sessions WHERE end_time IS NULL)")
                    .fetch_all(&pool).await.unwrap();
                assert_eq!(
                    samples,
                    if expected_title {
                        vec![window.title.clone()]
                    } else {
                        vec![]
                    },
                    "title samples step {step}"
                );
            }
        });
    }

    #[test]
    fn anonymous_app_preserves_timing_eligibility_without_title_capture() {
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
            assert!(!state.capture_window_title);
            assert!(state.tracking_status.is_tracking_active);
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
            assert!(state.tracking_status.is_tracking_active);
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
    pub(super) fn resolve_anonymous_cutoff(
        &self,
        previous_window: Option<&tracker::WindowInfo>,
        previous_status: Option<&TrackingStatusSnapshot>,
        cutoff: i64,
        now_ms: i64,
    ) -> i64 {
        use super::super::session_timeout::*;
        let native_cutoff = if self.tracking_paused {
            now_ms
        } else if should_seal_sustained_participation(
            previous_window,
            previous_status,
            &self.tracked_window,
            &self.tracking_status,
        ) {
            resolve_sustained_participation_end_time(
                now_ms,
                self.tracked_window.idle_time_ms,
                self.sustained_participation_secs,
            )
        } else if should_suspend_active_tracking(
            previous_window,
            &self.tracked_window,
            self.continuity_window_secs,
            &self.tracking_status,
        ) {
            resolve_continuity_window_end_time(
                now_ms,
                self.tracked_window.idle_time_ms,
                self.continuity_window_secs,
            )
        } else {
            super::super::transition::plan_window_transition(
                previous_window,
                &self.tracked_window,
                now_ms,
            )
            .resolved_end_time(now_ms)
        };
        cutoff.min(native_cutoff)
    }

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
