#![allow(dead_code)]

use crate::domain::screenshot::{ScreenshotEntry, ScreenshotSettings};
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub type ScreenshotDataFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, ScreenshotDataError>> + Send + 'a>>;
pub type SharedScreenshotDataStore = Arc<dyn ScreenshotDataStore>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScreenshotDataError {
    message: String,
}

impl ScreenshotDataError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

impl fmt::Display for ScreenshotDataError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for ScreenshotDataError {}

pub trait ScreenshotDataStore: Send + Sync {
    fn load_settings(&self) -> ScreenshotDataFuture<'_, ScreenshotSettings>;
    fn save_settings(&self, settings: ScreenshotSettings) -> ScreenshotDataFuture<'_, ()>;
    fn load_tracking_paused(&self) -> ScreenshotDataFuture<'_, bool>;
    fn query<'a>(
        &'a self,
        start_time: i64,
        end_time: i64,
        limit: Option<i64>,
    ) -> ScreenshotDataFuture<'a, Vec<ScreenshotEntry>>;
    fn query_metadata<'a>(
        &'a self,
        start_time: i64,
        end_time: i64,
        limit: Option<i64>,
    ) -> ScreenshotDataFuture<'a, Vec<ScreenshotEntry>>;
    fn get_thumbnail(&self, id: i64) -> ScreenshotDataFuture<'_, String>;
    fn get_file_path(&self, id: i64) -> ScreenshotDataFuture<'_, String>;
    fn find_active_session_id(&self, now_ms: i64) -> ScreenshotDataFuture<'_, Option<i64>>;
    #[allow(dead_code)]
    fn get_session_exe_name(&self, session_id: i64) -> ScreenshotDataFuture<'_, Option<String>>;
    fn is_app_excluded(&self, exe_name: &str) -> ScreenshotDataFuture<'_, bool>;
    fn is_domain_excluded(&self, normalized_domain: &str) -> ScreenshotDataFuture<'_, bool>;
    fn find_active_web_info_at(
        &self,
        timestamp_ms: i64,
        session_id: Option<i64>,
    ) -> ScreenshotDataFuture<'_, (Option<String>, Option<String>)>;
    #[allow(clippy::too_many_arguments)]
    fn insert_screenshot<'a>(
        &'a self,
        file_path: &'a str,
        captured_at: i64,
        width: u32,
        height: u32,
        thumbnail_base64: &'a str,
        session_id: Option<i64>,
        active_url: Option<&'a str>,
        active_normalized_domain: Option<&'a str>,
    ) -> ScreenshotDataFuture<'a, ()>;
    fn list_stale_screenshots(&self, before: i64) -> ScreenshotDataFuture<'_, Vec<(i64, String)>>;
    fn delete_screenshot(&self, id: i64) -> ScreenshotDataFuture<'_, ()>;
    fn backfill_missing_web_info(&self) -> ScreenshotDataFuture<'_, (usize, usize)>;
}
