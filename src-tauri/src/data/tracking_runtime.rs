use crate::data::repositories::{icon_cache, sessions, tracker_settings};
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::tracking::ActiveSessionSnapshot;
use crate::engine::tracking::ports::{
    SharedTrackingDataStore, TrackingDataError, TrackingDataFuture, TrackingDataStore,
};
use sqlx::{Pool, Sqlite};
use std::sync::Arc;
use tauri::{AppHandle, Runtime};

pub type TrackingRuntimeDataError = sqlx::Error;

#[derive(Clone)]
pub struct TrackingRuntimeDataStore {
    pool: Pool<Sqlite>,
}

impl TrackingRuntimeDataStore {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub async fn save_tracker_timestamp(
        &self,
        key: &str,
        timestamp_ms: i64,
    ) -> Result<(), TrackingRuntimeDataError> {
        tracker_settings::save_tracker_timestamp(&self.pool, key, timestamp_ms).await
    }

    pub async fn load_tracking_paused_setting(&self) -> Result<bool, TrackingRuntimeDataError> {
        tracker_settings::load_tracking_paused_setting(&self.pool).await
    }

    pub async fn load_title_recording_enabled(&self) -> Result<bool, TrackingRuntimeDataError> {
        tracker_settings::load_title_recording_enabled(&self.pool).await
    }

    pub async fn load_timeline_merge_gap_secs(
        &self,
        default_timeline_merge_gap_secs: u64,
    ) -> Result<u64, TrackingRuntimeDataError> {
        tracker_settings::load_timeline_merge_gap_secs(&self.pool, default_timeline_merge_gap_secs)
            .await
    }

    pub async fn load_idle_timeout_secs(
        &self,
        default_idle_timeout_secs: u64,
    ) -> Result<u64, TrackingRuntimeDataError> {
        tracker_settings::load_idle_timeout_secs(&self.pool, default_idle_timeout_secs).await
    }

    pub async fn load_capture_window_title_setting_for_app(
        &self,
        exe_name: &str,
    ) -> Result<bool, TrackingRuntimeDataError> {
        tracker_settings::load_capture_window_title_setting_for_app(&self.pool, exe_name).await
    }

    pub async fn load_tracking_enabled_setting_for_app(
        &self,
        exe_name: &str,
    ) -> Result<bool, TrackingRuntimeDataError> {
        tracker_settings::load_tracking_enabled_setting_for_app(&self.pool, exe_name).await
    }

    pub async fn end_active_session_for_exe(
        &self,
        exe_name: &str,
        end_time: i64,
    ) -> Result<bool, TrackingRuntimeDataError> {
        sessions::end_active_session_for_exe(&self.pool, exe_name, end_time).await
    }

    pub async fn load_tracker_timestamp(
        &self,
        key: &str,
    ) -> Result<Option<i64>, TrackingRuntimeDataError> {
        tracker_settings::load_tracker_timestamp(&self.pool, key).await
    }

    pub async fn load_tracker_heartbeat_timestamp(
        &self,
    ) -> Result<Option<i64>, TrackingRuntimeDataError> {
        self.load_tracker_timestamp(tracker_settings::TRACKER_LAST_HEARTBEAT_KEY)
            .await
    }

    pub async fn save_startup_self_heal(
        &self,
        timestamp_ms: i64,
        summary: &str,
    ) -> Result<(), TrackingRuntimeDataError> {
        tracker_settings::save_setting_value(
            &self.pool,
            tracker_settings::TRACKER_LAST_STARTUP_SELF_HEAL_AT_KEY,
            &timestamp_ms.to_string(),
        )
        .await?;
        tracker_settings::save_setting_value(
            &self.pool,
            tracker_settings::TRACKER_LAST_STARTUP_SELF_HEAL_SUMMARY_KEY,
            summary,
        )
        .await
    }

    pub async fn load_active_session(
        &self,
    ) -> Result<Option<ActiveSessionSnapshot>, TrackingRuntimeDataError> {
        sessions::load_active_session(&self.pool).await
    }

    pub async fn normalize_closed_session_durations(
        &self,
    ) -> Result<u64, TrackingRuntimeDataError> {
        sessions::normalize_closed_session_durations(&self.pool).await
    }

    pub async fn end_active_sessions(
        &self,
        raw_end_time: i64,
    ) -> Result<bool, TrackingRuntimeDataError> {
        sessions::end_active_sessions(&self.pool, raw_end_time).await
    }

    pub async fn refresh_active_session_metadata(
        &self,
        exe_name: &str,
        window_title: &str,
        timestamp_ms: i64,
    ) -> Result<bool, TrackingRuntimeDataError> {
        sessions::refresh_active_session_metadata(&self.pool, exe_name, window_title, timestamp_ms)
            .await
    }

    pub async fn start_session(
        &self,
        app_name: &str,
        exe_name: &str,
        window_title: &str,
        start_time: i64,
        continuity_group_start_time: i64,
    ) -> Result<bool, TrackingRuntimeDataError> {
        sessions::start_session(
            &self.pool,
            app_name,
            exe_name,
            window_title,
            start_time,
            continuity_group_start_time,
        )
        .await
    }

    pub async fn is_icon_cached(&self, exe_name: &str) -> Result<bool, TrackingRuntimeDataError> {
        icon_cache::is_icon_cached(&self.pool, exe_name).await
    }

    pub async fn upsert_icon(
        &self,
        exe_name: &str,
        icon_base64: &str,
        last_updated: i64,
    ) -> Result<(), TrackingRuntimeDataError> {
        icon_cache::upsert_icon(&self.pool, exe_name, icon_base64, last_updated).await
    }
}

pub async fn shared_from_app<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<SharedTrackingDataStore, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    Ok(Arc::new(TrackingRuntimeDataStore::new(pool)))
}

fn tracking_data_error(error: impl std::fmt::Display) -> TrackingDataError {
    TrackingDataError::new(error.to_string())
}

impl TrackingDataStore for TrackingRuntimeDataStore {
    fn clone_store(&self) -> SharedTrackingDataStore {
        Arc::new(self.clone())
    }

    fn save_tracker_timestamp<'a>(
        &'a self,
        key: &'a str,
        timestamp_ms: i64,
    ) -> TrackingDataFuture<'a, ()> {
        Box::pin(async move {
            TrackingRuntimeDataStore::save_tracker_timestamp(self, key, timestamp_ms)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn load_tracking_paused_setting(&self) -> TrackingDataFuture<'_, bool> {
        Box::pin(async move {
            TrackingRuntimeDataStore::load_tracking_paused_setting(self)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn load_title_recording_enabled(&self) -> TrackingDataFuture<'_, bool> {
        Box::pin(async move {
            TrackingRuntimeDataStore::load_title_recording_enabled(self)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn load_timeline_merge_gap_secs(&self, default_value: u64) -> TrackingDataFuture<'_, u64> {
        Box::pin(async move {
            TrackingRuntimeDataStore::load_timeline_merge_gap_secs(self, default_value)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn load_idle_timeout_secs(&self, default_value: u64) -> TrackingDataFuture<'_, u64> {
        Box::pin(async move {
            TrackingRuntimeDataStore::load_idle_timeout_secs(self, default_value)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn load_capture_window_title_setting_for_app<'a>(
        &'a self,
        exe_name: &'a str,
    ) -> TrackingDataFuture<'a, bool> {
        Box::pin(async move {
            TrackingRuntimeDataStore::load_capture_window_title_setting_for_app(self, exe_name)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn load_tracking_enabled_setting_for_app<'a>(
        &'a self,
        exe_name: &'a str,
    ) -> TrackingDataFuture<'a, bool> {
        Box::pin(async move {
            TrackingRuntimeDataStore::load_tracking_enabled_setting_for_app(self, exe_name)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn end_active_session_for_exe<'a>(
        &'a self,
        exe_name: &'a str,
        end_time: i64,
    ) -> TrackingDataFuture<'a, bool> {
        Box::pin(async move {
            TrackingRuntimeDataStore::end_active_session_for_exe(self, exe_name, end_time)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn load_tracker_heartbeat_timestamp(&self) -> TrackingDataFuture<'_, Option<i64>> {
        Box::pin(async move {
            TrackingRuntimeDataStore::load_tracker_heartbeat_timestamp(self)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn save_startup_self_heal<'a>(
        &'a self,
        timestamp_ms: i64,
        summary: &'a str,
    ) -> TrackingDataFuture<'a, ()> {
        Box::pin(async move {
            TrackingRuntimeDataStore::save_startup_self_heal(self, timestamp_ms, summary)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn load_active_session(&self) -> TrackingDataFuture<'_, Option<ActiveSessionSnapshot>> {
        Box::pin(async move {
            TrackingRuntimeDataStore::load_active_session(self)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn normalize_closed_session_durations(&self) -> TrackingDataFuture<'_, u64> {
        Box::pin(async move {
            TrackingRuntimeDataStore::normalize_closed_session_durations(self)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn end_active_sessions(&self, raw_end_time: i64) -> TrackingDataFuture<'_, bool> {
        Box::pin(async move {
            TrackingRuntimeDataStore::end_active_sessions(self, raw_end_time)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn refresh_active_session_metadata<'a>(
        &'a self,
        exe_name: &'a str,
        window_title: &'a str,
        timestamp_ms: i64,
    ) -> TrackingDataFuture<'a, bool> {
        Box::pin(async move {
            TrackingRuntimeDataStore::refresh_active_session_metadata(
                self,
                exe_name,
                window_title,
                timestamp_ms,
            )
            .await
            .map_err(tracking_data_error)
        })
    }

    fn start_session<'a>(
        &'a self,
        app_name: &'a str,
        exe_name: &'a str,
        window_title: &'a str,
        start_time: i64,
        continuity_group_start_time: i64,
    ) -> TrackingDataFuture<'a, bool> {
        Box::pin(async move {
            TrackingRuntimeDataStore::start_session(
                self,
                app_name,
                exe_name,
                window_title,
                start_time,
                continuity_group_start_time,
            )
            .await
            .map_err(tracking_data_error)
        })
    }

    fn is_icon_cached<'a>(&'a self, exe_name: &'a str) -> TrackingDataFuture<'a, bool> {
        Box::pin(async move {
            TrackingRuntimeDataStore::is_icon_cached(self, exe_name)
                .await
                .map_err(tracking_data_error)
        })
    }

    fn upsert_icon<'a>(
        &'a self,
        exe_name: &'a str,
        icon_base64: &'a str,
        last_updated: i64,
    ) -> TrackingDataFuture<'a, ()> {
        Box::pin(async move {
            TrackingRuntimeDataStore::upsert_icon(self, exe_name, icon_base64, last_updated)
                .await
                .map_err(tracking_data_error)
        })
    }
}
