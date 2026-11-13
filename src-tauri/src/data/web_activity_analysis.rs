use crate::data::sqlite_pool::wait_for_sqlite_pool;
use tauri::{AppHandle, Runtime};
#[cfg(test)]
pub(super) mod capacity;
mod range;
pub use range::*;
pub async fn load_web_activity_aggregate_range<R: Runtime>(
    app: &AppHandle<R>,
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: Vec<i64>,
    normalized_domain: Option<String>,
    normalized_domains: Option<Vec<String>>,
    snapshot_now_ms: Option<i64>,
) -> Result<WebActivityAggregateRangeDto, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let snapshot_now_ms = snapshot_now_ms.unwrap_or_else(now_ms);
    if snapshot_now_ms < 0 {
        return Err("web activity aggregate snapshot time is invalid".to_string());
    }
    load_web_activity_aggregate_range_from_pool(
        &pool,
        start_ms,
        end_ms,
        &bucket_boundaries_ms,
        normalized_domain.as_deref(),
        normalized_domains.as_deref(),
        snapshot_now_ms,
    )
    .await
}

fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}
