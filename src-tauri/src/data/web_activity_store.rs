use crate::data::repositories::web_activity;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::web_activity::WebActivitySegmentInput;
use crate::engine::web_activity::{WebActivityStore, WebActivityStoreFuture};
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Runtime};

pub struct SqliteWebActivityStore {
    pool: Pool<Sqlite>,
}

impl SqliteWebActivityStore {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub async fn from_app<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        Ok(Self::new(wait_for_sqlite_pool(app).await?))
    }
}

impl WebActivityStore for SqliteWebActivityStore {
    fn load_domain_recording_enabled<'a>(
        &'a self,
        normalized_domain: &'a str,
    ) -> WebActivityStoreFuture<'a, bool> {
        Box::pin(async move {
            web_activity::load_domain_recording_enabled(&self.pool, normalized_domain)
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn load_domain_title_recording_enabled<'a>(
        &'a self,
        normalized_domain: &'a str,
    ) -> WebActivityStoreFuture<'a, bool> {
        Box::pin(async move {
            web_activity::load_domain_title_recording_enabled(&self.pool, normalized_domain)
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn upsert_active_segment<'a>(
        &'a self,
        input: &'a WebActivitySegmentInput,
        now_ms: i64,
    ) -> WebActivityStoreFuture<'a, bool> {
        Box::pin(async move {
            web_activity::upsert_active_segment(&self.pool, input, now_ms)
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn seal_active_segment(&self, now_ms: i64) -> WebActivityStoreFuture<'_, bool> {
        Box::pin(async move {
            web_activity::end_active_segment(&self.pool, now_ms)
                .await
                .map_err(|error| error.to_string())
        })
    }
}
