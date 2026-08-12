use super::tracker_settings::load_setting_value;
use crate::domain::widget::{WidgetExpansionPreference, WidgetPlacement};
use sqlx::{Pool, Sqlite};

const WIDGET_PLACEMENT_KEY: &str = "widget_placement";
const WIDGET_EXPANSION_PREFERENCE_KEY: &str = "widget_expansion_preference";
const LEGACY_WIDGET_SIDE_KEY: &str = "widget_side";
const LEGACY_WIDGET_ANCHOR_Y_KEY: &str = "widget_anchor_y";

pub async fn load_widget_placement(pool: &Pool<Sqlite>) -> Result<WidgetPlacement, sqlx::Error> {
    let Some(raw_placement) = load_setting_value(pool, WIDGET_PLACEMENT_KEY).await? else {
        return Ok(WidgetPlacement::default());
    };

    Ok(serde_json::from_str::<WidgetPlacement>(&raw_placement)
        .map(WidgetPlacement::normalized)
        .unwrap_or_default())
}

pub async fn save_widget_placement(
    pool: &Pool<Sqlite>,
    placement: WidgetPlacement,
) -> Result<(), sqlx::Error> {
    let serialized = serde_json::to_string(&placement.normalized())
        .map_err(|error| sqlx::Error::Encode(Box::new(error)))?;
    let mut transaction = pool.begin().await?;

    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(WIDGET_PLACEMENT_KEY)
    .bind(serialized)
    .execute(&mut *transaction)
    .await?;
    sqlx::query("DELETE FROM settings WHERE key IN (?, ?)")
        .bind(LEGACY_WIDGET_SIDE_KEY)
        .bind(LEGACY_WIDGET_ANCHOR_Y_KEY)
        .execute(&mut *transaction)
        .await?;

    transaction.commit().await?;
    Ok(())
}

pub async fn load_widget_expansion_preference(
    pool: &Pool<Sqlite>,
) -> Result<WidgetExpansionPreference, sqlx::Error> {
    Ok(load_setting_value(pool, WIDGET_EXPANSION_PREFERENCE_KEY)
        .await?
        .as_deref()
        .map(WidgetExpansionPreference::from_storage_value)
        .unwrap_or_default())
}

pub async fn save_widget_expansion_preference(
    pool: &Pool<Sqlite>,
    preference: WidgetExpansionPreference,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(WIDGET_EXPANSION_PREFERENCE_KEY)
    .bind(preference.as_storage_value())
    .execute(pool)
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        load_widget_expansion_preference, load_widget_placement, save_widget_expansion_preference,
        save_widget_placement, LEGACY_WIDGET_ANCHOR_Y_KEY, LEGACY_WIDGET_SIDE_KEY,
        WIDGET_PLACEMENT_KEY,
    };
    use crate::data::repositories::tracker_settings::{load_setting_value, save_setting_value};
    use crate::data::schema as db_schema;
    use crate::domain::widget::{
        WidgetExpansionPreference, WidgetMonitorAffinity, WidgetPhysicalRect, WidgetPlacement,
        WidgetSide, DEFAULT_WIDGET_ANCHOR_Y,
    };
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    fn monitor_placement() -> WidgetPlacement {
        WidgetPlacement::with_monitor(
            WidgetMonitorAffinity::new(
                Some(r"\\.\DISPLAY2".to_string()),
                WidgetPhysicalRect::new(-2560, 0, 2560, 1392),
            ),
            WidgetSide::Left,
            0.66,
        )
    }

    #[test]
    fn widget_placement_repo_round_trips_one_json_value() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let saved = monitor_placement();

            save_widget_placement(&pool, saved.clone()).await.unwrap();

            assert_eq!(load_widget_placement(&pool).await.unwrap(), saved);
            let raw = load_setting_value(&pool, WIDGET_PLACEMENT_KEY)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                serde_json::from_str::<WidgetPlacement>(&raw).unwrap(),
                saved
            );
        });
    }

    #[test]
    fn widget_placement_repo_defaults_without_the_new_key() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            let defaults = load_widget_placement(&pool).await.unwrap();

            assert_eq!(defaults.monitor, None);
            assert_eq!(defaults.side, WidgetSide::Right);
            assert_eq!(defaults.anchor_y, DEFAULT_WIDGET_ANCHOR_Y);
        });
    }

    #[test]
    fn widget_placement_repo_does_not_read_legacy_keys() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            save_setting_value(&pool, LEGACY_WIDGET_SIDE_KEY, "left")
                .await
                .unwrap();
            save_setting_value(&pool, LEGACY_WIDGET_ANCHOR_Y_KEY, "0.9")
                .await
                .unwrap();

            assert_eq!(
                load_widget_placement(&pool).await.unwrap(),
                WidgetPlacement::default()
            );
        });
    }

    #[test]
    fn widget_placement_repo_defaults_malformed_json() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            save_setting_value(&pool, WIDGET_PLACEMENT_KEY, "{not-json")
                .await
                .unwrap();

            assert_eq!(
                load_widget_placement(&pool).await.unwrap(),
                WidgetPlacement::default()
            );
        });
    }

    #[test]
    fn widget_placement_repo_removes_legacy_keys_on_first_new_save() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            save_setting_value(&pool, LEGACY_WIDGET_SIDE_KEY, "left")
                .await
                .unwrap();
            save_setting_value(&pool, LEGACY_WIDGET_ANCHOR_Y_KEY, "0.9")
                .await
                .unwrap();

            save_widget_placement(&pool, monitor_placement())
                .await
                .unwrap();

            assert_eq!(
                load_setting_value(&pool, LEGACY_WIDGET_SIDE_KEY)
                    .await
                    .unwrap(),
                None
            );
            assert_eq!(
                load_setting_value(&pool, LEGACY_WIDGET_ANCHOR_Y_KEY)
                    .await
                    .unwrap(),
                None
            );
        });
    }

    #[test]
    fn widget_expansion_preference_defaults_and_round_trips() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            assert_eq!(
                load_widget_expansion_preference(&pool).await.unwrap(),
                WidgetExpansionPreference::AutoCollapse
            );

            save_widget_expansion_preference(&pool, WidgetExpansionPreference::Pinned)
                .await
                .unwrap();
            assert_eq!(
                load_widget_expansion_preference(&pool).await.unwrap(),
                WidgetExpansionPreference::Pinned
            );
        });
    }
}
