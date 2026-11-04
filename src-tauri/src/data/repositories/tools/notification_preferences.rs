use crate::domain::tool_notifications::{Preferences, PreferencesPatch};
use sqlx::{Pool, Sqlite};

const KEY: &str = "tools_notification_preferences";

pub async fn appearance(
    pool: &Pool<Sqlite>,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings WHERE key IN ('theme_mode','language','color_scheme_light','color_scheme_dark','dynamic_effects')")
        .fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().collect())
}

pub async fn load(pool: &Pool<Sqlite>) -> Result<Preferences, String> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
        .bind(KEY)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    match value {
        None => Ok(Preferences::default()),
        Some(value) => serde_json::from_str(&value)
            .map_err(|e| format!("Invalid tool notification preferences: {e}")),
    }
}

pub async fn save(pool: &Pool<Sqlite>, patch: PreferencesPatch) -> Result<Preferences, String> {
    let mut tx = pool
        .begin_with("BEGIN IMMEDIATE")
        .await
        .map_err(|e| e.to_string())?;
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
        .bind(KEY)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let mut preferences = value
        .map(|value| serde_json::from_str::<Preferences>(&value))
        .transpose()
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    preferences.apply(patch);
    let value = serde_json::to_string(&preferences).map_err(|e| e.to_string())?;
    sqlx::query("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(KEY).bind(value).execute(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(preferences)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::tool_notifications::{Delivery, Sound};
    use sqlx::Executor;

    #[tokio::test]
    async fn notification_preferences_patch_restore_and_write_failure() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in crate::data::schema::tracker_migrations() {
            pool.execute(migration.sql).await.unwrap();
        }
        assert_eq!(load(&pool).await.unwrap(), Preferences::default());
        save(
            &pool,
            PreferencesPatch {
                delivery: Some(Delivery::Dialog),
                sound: None,
            },
        )
        .await
        .unwrap();
        let saved = save(
            &pool,
            PreferencesPatch {
                delivery: None,
                sound: Some(Sound::Bell),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            saved,
            Preferences {
                delivery: Delivery::Dialog,
                sound: Sound::Bell
            }
        );
        sqlx::query("INSERT INTO settings VALUES('language','es'),('secret','private')")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            appearance(&pool)
                .await
                .unwrap()
                .into_iter()
                .collect::<Vec<_>>(),
            vec![("language".into(), "es".into())]
        );
        let backup = crate::data::repositories::settings::fetch_all_for_backup(&pool)
            .await
            .unwrap();
        let item = backup.iter().find(|s| s.key == KEY).unwrap();
        assert_eq!(
            serde_json::from_str::<Preferences>(&item.value).unwrap(),
            saved
        );
        sqlx::query("DELETE FROM settings")
            .execute(&pool)
            .await
            .unwrap();
        let mut tx = pool.begin().await.unwrap();
        crate::data::repositories::settings::insert_missing_for_restore(&mut tx, &backup)
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(load(&pool).await.unwrap(), saved);
        sqlx::query("CREATE TRIGGER reject_preferences BEFORE UPDATE ON settings BEGIN SELECT RAISE(ABORT, 'injected'); END").execute(&pool).await.unwrap();
        assert!(save(
            &pool,
            PreferencesPatch {
                delivery: None,
                sound: Some(Sound::None)
            }
        )
        .await
        .is_err());
        assert_eq!(load(&pool).await.unwrap(), saved);
    }
}
