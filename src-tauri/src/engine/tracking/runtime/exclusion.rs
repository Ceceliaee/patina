use crate::domain::tracking::TRACKING_REASON_APP_EXCLUDED_SEALED;
use crate::engine::tracking::ports::{TrackingDataError, TrackingDataStore};

pub(super) async fn seal_excluded_app_session(
    data: &dyn TrackingDataStore,
    now_ms: i64,
) -> Result<Option<&'static str>, TrackingDataError> {
    // The excluded foreground has no session of its own; end its predecessor.
    Ok(data
        .end_active_sessions(now_ms)
        .await?
        .then_some(TRACKING_REASON_APP_EXCLUDED_SEALED))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::{repositories::sessions, schema, tracking_runtime::TrackingRuntimeDataStore};
    use sqlx::{Executor, SqlitePool};

    #[test]
    fn entering_excluded_app_ends_previous_app_without_counting_the_gap() {
        tauri::async_runtime::block_on(async {
            for next in ["a.exe", "c.exe"] {
                let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
                pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
                    .await
                    .unwrap();
                let data = TrackingRuntimeDataStore::new(pool.clone());
                sessions::start_session(&pool, "A", "a.exe", "A", 1_000, 1_000)
                    .await
                    .unwrap();
                seal_excluded_app_session(&data, 5_000).await.unwrap();
                sessions::start_session(&pool, next, next, "return", 15_000, 15_000)
                    .await
                    .unwrap();
                sessions::end_active_sessions(&pool, 20_000).await.unwrap();
                let intervals: Vec<(String, i64, i64)> = sqlx::query_as(
                    "SELECT exe_name, start_time, end_time FROM sessions ORDER BY start_time",
                )
                .fetch_all(&pool)
                .await
                .unwrap();
                assert_eq!(
                    intervals,
                    vec![
                        ("a.exe".into(), 1_000, 5_000),
                        (next.into(), 15_000, 20_000)
                    ]
                );
            }
        });
    }
}
