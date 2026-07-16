use crate::domain::tracking::ActiveSessionSnapshot;
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub const TRACKER_LAST_HEARTBEAT_KEY: &str = "__tracker_last_heartbeat_ms";
pub const TRACKER_LAST_SUCCESSFUL_SAMPLE_KEY: &str = "__tracker_last_successful_sample_ms";

pub type TrackingDataFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, TrackingDataError>> + Send + 'a>>;
pub type SharedTrackingDataStore = Arc<dyn TrackingDataStore>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TrackingDataError {
    message: String,
}

impl TrackingDataError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for TrackingDataError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for TrackingDataError {}

pub trait TrackingDataStore: Send + Sync {
    fn clone_store(&self) -> SharedTrackingDataStore;
    fn save_tracker_timestamp<'a>(
        &'a self,
        key: &'a str,
        timestamp_ms: i64,
    ) -> TrackingDataFuture<'a, ()>;
    fn load_tracking_paused_setting(&self) -> TrackingDataFuture<'_, bool>;
    fn load_title_recording_enabled(&self) -> TrackingDataFuture<'_, bool>;
    fn load_timeline_merge_gap_secs(&self, default_value: u64) -> TrackingDataFuture<'_, u64>;
    fn load_idle_timeout_secs(&self, default_value: u64) -> TrackingDataFuture<'_, u64>;
    fn load_capture_window_title_setting_for_app<'a>(
        &'a self,
        exe_name: &'a str,
    ) -> TrackingDataFuture<'a, bool>;
    fn load_tracking_enabled_setting_for_app<'a>(
        &'a self,
        exe_name: &'a str,
    ) -> TrackingDataFuture<'a, bool>;
    fn end_active_session_for_exe<'a>(
        &'a self,
        exe_name: &'a str,
        end_time: i64,
    ) -> TrackingDataFuture<'a, bool>;
    fn load_tracker_heartbeat_timestamp(&self) -> TrackingDataFuture<'_, Option<i64>>;
    fn save_startup_self_heal<'a>(
        &'a self,
        timestamp_ms: i64,
        summary: &'a str,
    ) -> TrackingDataFuture<'a, ()>;
    fn load_active_session(&self) -> TrackingDataFuture<'_, Option<ActiveSessionSnapshot>>;
    fn normalize_closed_session_durations(&self) -> TrackingDataFuture<'_, u64>;
    fn end_active_sessions(&self, raw_end_time: i64) -> TrackingDataFuture<'_, bool>;
    fn refresh_active_session_metadata<'a>(
        &'a self,
        exe_name: &'a str,
        window_title: &'a str,
        timestamp_ms: i64,
    ) -> TrackingDataFuture<'a, bool>;
    fn start_session<'a>(
        &'a self,
        app_name: &'a str,
        exe_name: &'a str,
        window_title: &'a str,
        start_time: i64,
        continuity_group_start_time: i64,
    ) -> TrackingDataFuture<'a, bool>;
    fn is_icon_cached<'a>(&'a self, exe_name: &'a str) -> TrackingDataFuture<'a, bool>;
    fn upsert_icon<'a>(
        &'a self,
        exe_name: &'a str,
        icon_base64: &'a str,
        last_updated: i64,
    ) -> TrackingDataFuture<'a, ()>;
}
