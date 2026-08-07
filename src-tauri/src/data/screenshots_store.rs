use crate::data::repositories::tracker_settings;
use crate::data::repositories::web_activity;
use crate::data::sqlite_pool;
use crate::domain::screenshot::{ScreenshotEntry, ScreenshotSettings};
use crate::domain::web_activity::is_supported_browser_exe;
use crate::engine::screenshots::ports::{
    ScreenshotDataError, ScreenshotDataFuture, ScreenshotDataStore, SharedScreenshotDataStore,
};
use sqlx::{Pool, Sqlite};
use std::sync::Arc;
use tauri::{AppHandle, Runtime};

const DEFAULT_INTERVAL_SECS: u64 = 60;
const DEFAULT_RETENTION_DAYS: u64 = 7;
const MIN_INTERVAL_SECS: u64 = 10;
const MAX_INTERVAL_SECS: u64 = 3600;
const MIN_RETENTION_DAYS: u64 = 1;
const MAX_RETENTION_DAYS: u64 = 365;

const SETTINGS_ENABLED_KEY: &str = "screenshots_enabled";
const SETTINGS_INTERVAL_KEY: &str = "screenshots_interval_secs";
const SETTINGS_RETENTION_KEY: &str = "screenshots_retention_days";

#[derive(Clone)]
pub struct ScreenshotDataStoreImpl {
    pool: Pool<Sqlite>,
}

impl ScreenshotDataStoreImpl {
    fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub async fn load_settings(&self) -> ScreenshotSettings {
        let enabled = read_setting(&self.pool, SETTINGS_ENABLED_KEY)
            .await
            .and_then(|raw| parse_bool_setting(&raw))
            .unwrap_or(false);
        let interval_secs = read_setting(&self.pool, SETTINGS_INTERVAL_KEY)
            .await
            .and_then(|raw| raw.parse::<u64>().ok())
            .map(|v| v.clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS))
            .unwrap_or(DEFAULT_INTERVAL_SECS);
        let retention_days = read_setting(&self.pool, SETTINGS_RETENTION_KEY)
            .await
            .and_then(|raw| raw.parse::<u64>().ok())
            .map(|v| v.clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS))
            .unwrap_or(DEFAULT_RETENTION_DAYS);
        ScreenshotSettings {
            enabled,
            interval_secs,
            retention_days,
        }
    }

    pub async fn save_settings(&self, settings: &ScreenshotSettings) {
        let interval_secs = settings
            .interval_secs
            .clamp(MIN_INTERVAL_SECS, MAX_INTERVAL_SECS);
        let retention_days = settings
            .retention_days
            .clamp(MIN_RETENTION_DAYS, MAX_RETENTION_DAYS);
        write_setting(
            &self.pool,
            SETTINGS_ENABLED_KEY,
            if settings.enabled { "true" } else { "false" },
        )
        .await;
        write_setting(
            &self.pool,
            SETTINGS_INTERVAL_KEY,
            &interval_secs.to_string(),
        )
        .await;
        write_setting(
            &self.pool,
            SETTINGS_RETENTION_KEY,
            &retention_days.to_string(),
        )
        .await;
    }

    pub async fn load_tracking_paused(&self) -> Result<bool, sqlx::Error> {
        tracker_settings::load_tracking_paused_setting(&self.pool).await
    }

    pub async fn find_active_session_id(&self, now_ms: i64) -> Result<Option<i64>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT id FROM sessions
             WHERE start_time <= ?1
               AND (end_time IS NULL OR end_time > ?1)
             ORDER BY start_time DESC, id DESC
             LIMIT 1",
        )
        .bind(now_ms)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn get_session_exe_name(
        &self,
        session_id: i64,
    ) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar("SELECT exe_name FROM sessions WHERE id = ?")
            .bind(session_id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn find_active_web_info_at(
        &self,
        timestamp_ms: i64,
        session_id: Option<i64>,
    ) -> Result<(Option<String>, Option<String>), sqlx::Error> {
        // Double filter: first verify the active session is a supported browser
        if let Some(sid) = session_id {
            if let Some(exe_name) = self.get_session_exe_name(sid).await? {
                if !is_supported_browser_exe(&exe_name) {
                    // Not a browser process - mark as processed with empty domain
                    return Ok((None, Some(String::new())));
                }
            } else {
                // Session not found - return None to retry later
                return Ok((None, None));
            }
        } else {
            // No active session - mark as processed
            return Ok((None, Some(String::new())));
        }

        // Second filter: find active web tab at this timestamp
        let row = sqlx::query_as::<_, (Option<String>, Option<String>)>(
            "SELECT url, normalized_domain
             FROM web_activity_segments
             WHERE start_time <= ?1
               AND (end_time IS NULL OR end_time > ?1)
             ORDER BY start_time DESC, id DESC
             LIMIT 1",
        )
        .bind(timestamp_ms)
        .fetch_optional(&self.pool)
        .await?;

        match row {
            Some((url, Some(domain))) if !domain.is_empty() => Ok((url, Some(domain))),
            _ => Ok((None, Some(String::new()))),
        }
    }

    pub async fn query(
        &self,
        start_time: i64,
        end_time: i64,
        limit: Option<i64>,
    ) -> Result<Vec<ScreenshotEntry>, sqlx::Error> {
        let limit = limit.unwrap_or(500).clamp(1, 1000);
        let rows = sqlx::query_as::<_, (i64, i64, i64, i64, String, Option<i64>, Option<String>, Option<String>)>(
            "SELECT id, captured_at, width, height, thumbnail_base64, session_id, active_url, active_normalized_domain
             FROM screenshots
             WHERE captured_at >= ?1 AND captured_at <= ?2
             ORDER BY captured_at ASC
             LIMIT ?3",
        )
        .bind(start_time)
        .bind(end_time)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(
                |(
                    id,
                    captured_at,
                    width,
                    height,
                    thumb,
                    session_id,
                    active_url,
                    active_normalized_domain,
                )| ScreenshotEntry {
                    id,
                    captured_at,
                    width: width as u32,
                    height: height as u32,
                    thumbnail_base64: thumb,
                    session_id,
                    active_url,
                    active_normalized_domain,
                },
            )
            .collect())
    }

    pub async fn query_metadata(
        &self,
        start_time: i64,
        end_time: i64,
        limit: Option<i64>,
    ) -> Result<Vec<ScreenshotEntry>, sqlx::Error> {
        let limit = limit.unwrap_or(1000).clamp(1, 2000);
        let rows = sqlx::query_as::<_, (i64, i64, i64, i64, Option<i64>, Option<String>, Option<String>)>(
            "SELECT id, captured_at, width, height, session_id, active_url, active_normalized_domain
             FROM screenshots
             WHERE captured_at >= ?1 AND captured_at <= ?2
             ORDER BY captured_at ASC
             LIMIT ?3",
        )
        .bind(start_time)
        .bind(end_time)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(
                |(
                    id,
                    captured_at,
                    width,
                    height,
                    session_id,
                    active_url,
                    active_normalized_domain,
                )| ScreenshotEntry {
                    id,
                    captured_at,
                    width: width as u32,
                    height: height as u32,
                    thumbnail_base64: String::new(),
                    session_id,
                    active_url,
                    active_normalized_domain,
                },
            )
            .collect())
    }

    pub async fn get_thumbnail(&self, id: i64) -> Result<String, ScreenshotDataError> {
        sqlx::query_scalar("SELECT thumbnail_base64 FROM screenshots WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| ScreenshotDataError::new(format!("query: {error}")))?
            .ok_or_else(|| ScreenshotDataError::new(format!("screenshot {id} not found")))
    }

    pub async fn get_file_path(&self, id: i64) -> Result<String, ScreenshotDataError> {
        sqlx::query_scalar("SELECT file_path FROM screenshots WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|error| ScreenshotDataError::new(format!("query: {error}")))?
            .ok_or_else(|| ScreenshotDataError::new(format!("screenshot {id} not found")))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn insert_screenshot(
        &self,
        file_path: &str,
        captured_at: i64,
        width: u32,
        height: u32,
        thumbnail_base64: &str,
        session_id: Option<i64>,
        active_url: Option<&str>,
        active_normalized_domain: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "INSERT INTO screenshots (file_path, captured_at, width, height, thumbnail_base64, session_id, active_url, active_normalized_domain)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(file_path)
        .bind(captured_at)
        .bind(width as i64)
        .bind(height as i64)
        .bind(thumbnail_base64)
        .bind(session_id)
        .bind(active_url)
        .bind(active_normalized_domain)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn list_stale_screenshots(
        &self,
        before: i64,
    ) -> Result<Vec<(i64, String)>, sqlx::Error> {
        sqlx::query_as("SELECT id, file_path FROM screenshots WHERE captured_at < ?")
            .bind(before)
            .fetch_all(&self.pool)
            .await
    }

    pub async fn delete_screenshot(&self, id: i64) -> Result<(), sqlx::Error> {
        sqlx::query("DELETE FROM screenshots WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn backfill_missing_web_info(&self) -> Result<(usize, usize), sqlx::Error> {
        use crate::domain::web_activity::is_supported_browser_exe;

        // Query all screenshots that don't have active_normalized_domain set
        let rows = sqlx::query_as::<_, (i64, i64, Option<i64>)>(
            "SELECT id, captured_at, session_id
             FROM screenshots
             WHERE active_normalized_domain IS NULL
             ORDER BY captured_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let total = rows.len();
        let mut updated = 0usize;

        for (screenshot_id, captured_at, session_id) in rows {
            let (url, domain) = if let Some(sid) = session_id {
                if let Some(exe_name) = self.get_session_exe_name(sid).await? {
                    if is_supported_browser_exe(&exe_name) {
                        // Browser process: look up URL at capture time
                        let row = sqlx::query_as::<_, (Option<String>, Option<String>)>(
                            "SELECT url, normalized_domain
                             FROM web_activity_segments
                             WHERE start_time <= ?1
                               AND (end_time IS NULL OR end_time > ?1)
                             ORDER BY start_time DESC, id DESC
                             LIMIT 1",
                        )
                        .bind(captured_at)
                        .fetch_optional(&self.pool)
                        .await?;
                        match row {
                            Some((u, Some(d))) if !d.is_empty() => (u, Some(d)),
                            _ => (None, Some(String::new())),
                        }
                    } else {
                        // Not a browser: mark as processed
                        (None, Some(String::new()))
                    }
                } else {
                    // Session not found, skip and retry later
                    continue;
                }
            } else {
                // No session: mark as processed
                (None, Some(String::new()))
            };

            sqlx::query(
                "UPDATE screenshots
                 SET active_url = ?1, active_normalized_domain = ?2
                 WHERE id = ?3",
            )
            .bind(url.as_deref())
            .bind(domain.as_deref())
            .bind(screenshot_id)
            .execute(&self.pool)
            .await?;

            updated += 1;
        }

        Ok((total, updated))
    }
}

pub async fn shared_from_app<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<SharedScreenshotDataStore, String> {
    let pool = sqlite_pool::wait_for_sqlite_pool(app).await?;
    Ok(Arc::new(ScreenshotDataStoreImpl::new(pool)))
}

fn screenshot_error(error: impl std::fmt::Display) -> ScreenshotDataError {
    ScreenshotDataError::new(error.to_string())
}

impl ScreenshotDataStore for ScreenshotDataStoreImpl {
    fn load_settings(&self) -> ScreenshotDataFuture<'_, ScreenshotSettings> {
        Box::pin(async move { Ok(ScreenshotDataStoreImpl::load_settings(self).await) })
    }

    fn save_settings(&self, settings: ScreenshotSettings) -> ScreenshotDataFuture<'_, ()> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::save_settings(self, &settings).await;
            Ok(())
        })
    }

    fn load_tracking_paused(&self) -> ScreenshotDataFuture<'_, bool> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::load_tracking_paused(self)
                .await
                .map_err(screenshot_error)
        })
    }

    fn query<'a>(
        &'a self,
        start_time: i64,
        end_time: i64,
        limit: Option<i64>,
    ) -> ScreenshotDataFuture<'a, Vec<ScreenshotEntry>> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::query(self, start_time, end_time, limit)
                .await
                .map_err(screenshot_error)
        })
    }

    fn query_metadata<'a>(
        &'a self,
        start_time: i64,
        end_time: i64,
        limit: Option<i64>,
    ) -> ScreenshotDataFuture<'a, Vec<ScreenshotEntry>> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::query_metadata(self, start_time, end_time, limit)
                .await
                .map_err(screenshot_error)
        })
    }

    fn get_thumbnail(&self, id: i64) -> ScreenshotDataFuture<'_, String> {
        Box::pin(async move { ScreenshotDataStoreImpl::get_thumbnail(self, id).await })
    }

    fn get_file_path(&self, id: i64) -> ScreenshotDataFuture<'_, String> {
        Box::pin(async move { ScreenshotDataStoreImpl::get_file_path(self, id).await })
    }

    fn find_active_session_id(&self, now_ms: i64) -> ScreenshotDataFuture<'_, Option<i64>> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::find_active_session_id(self, now_ms)
                .await
                .map_err(screenshot_error)
        })
    }

    fn get_session_exe_name(&self, session_id: i64) -> ScreenshotDataFuture<'_, Option<String>> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::get_session_exe_name(self, session_id)
                .await
                .map_err(screenshot_error)
        })
    }

    fn is_app_excluded(&self, exe_name: &str) -> ScreenshotDataFuture<'_, bool> {
        let exe_name = exe_name.to_string();
        Box::pin(async move {
            Ok(
                !tracker_settings::load_tracking_enabled_setting_for_app(&self.pool, &exe_name)
                    .await
                    .unwrap_or(true),
            )
        })
    }

    fn is_domain_excluded(&self, normalized_domain: &str) -> ScreenshotDataFuture<'_, bool> {
        let domain = normalized_domain.to_string();
        Box::pin(async move {
            Ok(
                !web_activity::load_domain_recording_enabled(&self.pool, &domain)
                    .await
                    .unwrap_or(true),
            )
        })
    }

    fn find_active_web_info_at(
        &self,
        timestamp_ms: i64,
        session_id: Option<i64>,
    ) -> ScreenshotDataFuture<'_, (Option<String>, Option<String>)> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::find_active_web_info_at(self, timestamp_ms, session_id)
                .await
                .map_err(screenshot_error)
        })
    }

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
    ) -> ScreenshotDataFuture<'a, ()> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::insert_screenshot(
                self,
                file_path,
                captured_at,
                width,
                height,
                thumbnail_base64,
                session_id,
                active_url,
                active_normalized_domain,
            )
            .await
            .map_err(screenshot_error)
        })
    }

    fn list_stale_screenshots(&self, before: i64) -> ScreenshotDataFuture<'_, Vec<(i64, String)>> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::list_stale_screenshots(self, before)
                .await
                .map_err(screenshot_error)
        })
    }

    fn delete_screenshot(&self, id: i64) -> ScreenshotDataFuture<'_, ()> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::delete_screenshot(self, id)
                .await
                .map_err(screenshot_error)
        })
    }

    fn backfill_missing_web_info(&self) -> ScreenshotDataFuture<'_, (usize, usize)> {
        Box::pin(async move {
            ScreenshotDataStoreImpl::backfill_missing_web_info(self)
                .await
                .map_err(screenshot_error)
        })
    }
}

async fn read_setting(pool: &Pool<Sqlite>, key: &str) -> Option<String> {
    sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

async fn write_setting(pool: &Pool<Sqlite>, key: &str, value: &str) {
    let _ = sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await;
}

fn parse_bool_setting(value: &str) -> Option<bool> {
    let normalized = value.trim().to_lowercase();
    if matches!(normalized.as_str(), "1" | "true" | "yes" | "on") {
        Some(true)
    } else if matches!(normalized.as_str(), "0" | "false" | "no" | "off") {
        Some(false)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn test_pool() -> Pool<Sqlite> {
        let pool = Pool::connect("sqlite::memory:").await.expect("connect memory pool");
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_name TEXT NOT NULL,
                exe_name TEXT NOT NULL,
                window_title TEXT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                duration INTEGER
             );
             CREATE TABLE IF NOT EXISTS screenshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                captured_at INTEGER NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                thumbnail_base64 TEXT NOT NULL,
                session_id INTEGER REFERENCES sessions(id),
                active_url TEXT,
                active_normalized_domain TEXT
             );
             CREATE INDEX IF NOT EXISTS idx_screenshots_captured_at
                ON screenshots(captured_at);
             CREATE INDEX IF NOT EXISTS idx_screenshots_session_id
                ON screenshots(session_id);
             CREATE TABLE IF NOT EXISTS app_exclusions (
                exe_name TEXT PRIMARY KEY,
                tracking_enabled INTEGER NOT NULL DEFAULT 1
             );
             CREATE TABLE IF NOT EXISTS web_activity_segments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                url TEXT,
                normalized_domain TEXT
             );",
        )
        .execute(&pool)
        .await
        .expect("create screenshot test schema");
        pool
    }

    #[test]
    fn settings_persist_and_clamp_with_defaults() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let store = ScreenshotDataStoreImpl::new(pool.clone());

            let defaults = store.load_settings().await;
            assert!(!defaults.enabled);
            assert_eq!(defaults.interval_secs, DEFAULT_INTERVAL_SECS);
            assert_eq!(defaults.retention_days, DEFAULT_RETENTION_DAYS);

            let settings = ScreenshotSettings {
                enabled: true,
                interval_secs: 999_999,
                retention_days: 999_999,
            };
            store.save_settings(&settings).await;
            let loaded = store.load_settings().await;
            assert!(loaded.enabled);
            assert_eq!(loaded.interval_secs, MAX_INTERVAL_SECS);
            assert_eq!(loaded.retention_days, MAX_RETENTION_DAYS);
        });
    }

    #[test]
    fn insert_query_and_metadata_round_trip() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let store = ScreenshotDataStoreImpl::new(pool.clone());

            store
                .insert_screenshot(
                    "/shots/a.png",
                    1000,
                    800,
                    600,
                    "thumb-a",
                    None,
                    Some("https://example.com"),
                    Some("example.com"),
                )
                .await
                .unwrap();
            store
                .insert_screenshot("/shots/b.png", 2000, 1024, 768, "thumb-b", None, None, None)
                .await
                .unwrap();

            let rows = store.query(0, 3000, None).await.unwrap();
            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0].captured_at, 1000);
            assert_eq!(rows[1].active_url.as_deref(), None);

            let limited = store.query(0, 3000, Some(1)).await.unwrap();
            assert_eq!(limited.len(), 1);
            assert_eq!(limited[0].captured_at, 1000);

            let meta = store.query_metadata(0, 3000, None).await.unwrap();
            assert_eq!(meta.len(), 2);
            assert!(meta.iter().all(|row| row.thumbnail_base64.is_empty()));
        });
    }

    #[test]
    fn stale_list_and_delete_respect_retention() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let store = ScreenshotDataStoreImpl::new(pool.clone());

            store
                .insert_screenshot("/shots/old.png", 1000, 640, 480, "t", None, None, None)
                .await
                .unwrap();
            store
                .insert_screenshot("/shots/new.png", 10_000, 640, 480, "t", None, None, None)
                .await
                .unwrap();

            let stale = store.list_stale_screenshots(5000).await.unwrap();
            assert_eq!(stale.len(), 1);
            assert_eq!(stale[0].1, "/shots/old.png");

            let id = stale[0].0;
            store.delete_screenshot(id).await.unwrap();
            let remaining = store.list_stale_screenshots(1_000_000).await.unwrap();
            assert!(remaining.iter().all(|(existing_id, _)| *existing_id != id));
        });
    }

    #[test]
    fn backfill_marks_unattached_screenshot_as_processed() {
        tauri::async_runtime::block_on(async {
            let pool = test_pool().await;
            let store = ScreenshotDataStoreImpl::new(pool.clone());

            store
                .insert_screenshot("/shots/a.png", 10, 640, 480, "t", None, None, None)
                .await
                .unwrap();

            let (total, updated) = store.backfill_missing_web_info().await.unwrap();
            assert_eq!(total, 1);
            assert_eq!(updated, 1);
            let rows = store.query(0, 100, None).await.unwrap();
            assert_eq!(rows[0].active_normalized_domain.as_deref(), Some(""));
        });
    }

    #[test]
    fn parse_bool_handles_common_spellings() {
        assert!(parse_bool_setting("true").unwrap());
        assert!(parse_bool_setting("1").unwrap());
        assert!(parse_bool_setting("on").unwrap());
        assert!(!parse_bool_setting("false").unwrap());
        assert!(!parse_bool_setting("0").unwrap());
        assert!(parse_bool_setting("garbage").is_none());
    }
}
