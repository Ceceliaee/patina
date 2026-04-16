use crate::data::repositories::tracker_settings;
use chrono::Local;
use sqlx::{Pool, Sqlite};

const UPDATE_LAST_AUTO_CHECK_DAY_KEY: &str = "__update_last_auto_check_day";

pub async fn load_last_auto_check_day(pool: &Pool<Sqlite>) -> Result<Option<String>, sqlx::Error> {
    tracker_settings::load_setting_value(pool, UPDATE_LAST_AUTO_CHECK_DAY_KEY).await
}

pub async fn save_last_auto_check_day(pool: &Pool<Sqlite>, day: &str) -> Result<(), sqlx::Error> {
    tracker_settings::save_setting_value(pool, UPDATE_LAST_AUTO_CHECK_DAY_KEY, day).await
}

pub fn current_local_day() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::migrations as db_schema;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::MIGRATION_1_SQL).await.unwrap();
        pool.execute(db_schema::MIGRATION_2_SQL).await.unwrap();
        pool.execute(db_schema::MIGRATION_3_SQL).await.unwrap();
        pool
    }

    #[test]
    fn auto_check_day_roundtrip() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            assert_eq!(load_last_auto_check_day(&pool).await.unwrap(), None);

            save_last_auto_check_day(&pool, "2026-04-13").await.unwrap();
            assert_eq!(
                load_last_auto_check_day(&pool).await.unwrap(),
                Some("2026-04-13".to_string())
            );
        });
    }
}
