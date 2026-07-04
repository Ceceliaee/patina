use crate::data::repositories::tracker_settings;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Runtime};

pub struct TrackingPauseSettingChange {
    pub tracking_paused: bool,
    pub reason: &'static str,
}

pub async fn load_tracking_pause_setting<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    tracker_settings::load_tracking_paused_setting(&pool)
        .await
        .map_err(|error| format!("failed to load tracking pause setting: {error}"))
}

pub async fn toggle_tracking_pause_setting<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<TrackingPauseSettingChange, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    toggle_tracking_pause_setting_in_pool(&pool)
        .await
        .map_err(|error| format!("failed to toggle tracking pause setting: {error}"))
}

pub fn tracking_pause_event_reason(tracking_paused: bool) -> &'static str {
    if tracking_paused {
        "tracking-paused"
    } else {
        "tracking-resumed"
    }
}

async fn toggle_tracking_pause_setting_in_pool(
    pool: &Pool<Sqlite>,
) -> Result<TrackingPauseSettingChange, sqlx::Error> {
    let current = tracker_settings::load_tracking_paused_setting(pool).await?;
    let next = !current;

    tracker_settings::save_tracking_paused_setting(pool, next).await?;

    Ok(TrackingPauseSettingChange {
        tracking_paused: next,
        reason: tracking_pause_event_reason(next),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn toggle_tracking_pause_setting_in_pool_flips_setting_and_reason() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            let first = toggle_tracking_pause_setting_in_pool(&pool).await.unwrap();
            let first_value = tracker_settings::load_tracking_paused_setting(&pool)
                .await
                .unwrap();
            let second = toggle_tracking_pause_setting_in_pool(&pool).await.unwrap();
            let second_value = tracker_settings::load_tracking_paused_setting(&pool)
                .await
                .unwrap();

            assert_eq!(first.reason, "tracking-paused");
            assert!(first.tracking_paused);
            assert!(first_value);
            assert_eq!(second.reason, "tracking-resumed");
            assert!(!second.tracking_paused);
            assert!(!second_value);
            assert_eq!(tracking_pause_event_reason(true), "tracking-paused");
            assert_eq!(tracking_pause_event_reason(false), "tracking-resumed");
        });
    }
}
