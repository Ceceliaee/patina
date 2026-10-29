use crate::domain::mini_window::Preferences;
use sqlx::{Pool, Sqlite};

const KEY: &str = "mini_window_preferences";

pub async fn load(pool: &Pool<Sqlite>) -> Result<Preferences, sqlx::Error> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}

pub async fn save(pool: &Pool<Sqlite>, preferences: &Preferences) -> Result<(), sqlx::Error> {
    let value = serde_json::to_string(preferences)
        .map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(KEY).bind(value).execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn preferences_are_independent_and_bad_json_defaults_safely() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO settings VALUES ('language', 'en-US'), ('mini_window_preferences', 'broken')").execute(&pool).await.unwrap();
        assert!(!load(&pool).await.unwrap().held);
        save(
            &pool,
            &Preferences {
                held: true,
                ..Preferences::default()
            },
        )
        .await
        .unwrap();
        assert!(load(&pool).await.unwrap().held);
        let language: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key='language'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(language, "en-US");
    }
}

use std::collections::HashMap;

use serde::Serialize;
use sqlx::Row;

use super::classification_settings::APP_OVERRIDE_KEY_PREFIX;

const TRACKING_PAUSED_KEY: &str = "tracking_paused";
const THEME_MODE_KEY: &str = "theme_mode";
const LANGUAGE_KEY: &str = "language";
const COLOR_SCHEME_LIGHT_KEY: &str = "color_scheme_light";
const COLOR_SCHEME_DARK_KEY: &str = "color_scheme_dark";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct MiniBootstrapSettings {
    pub tracking_paused: Option<String>,
    pub theme_mode: Option<String>,
    pub language: Option<String>,
    pub color_scheme_light: Option<String>,
    pub color_scheme_dark: Option<String>,
    pub hourly_activity_chart_mode: Option<String>,
    pub history_timeline_mode: Option<String>,
    pub refresh_interval_secs: Option<String>,
    pub timeline_merge_gap_secs: Option<String>,
    pub dynamic_effects: Option<String>,
    pub web_activity_available: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MiniAppOverrideRow {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct MiniBootstrapSnapshot {
    pub settings: MiniBootstrapSettings,
    pub app_overrides: Vec<MiniAppOverrideRow>,
    pub app_links: Vec<MiniAppOverrideRow>,
    pub category_settings: Vec<MiniAppOverrideRow>,
}

pub async fn load_mini_bootstrap_snapshot(
    pool: &Pool<Sqlite>,
) -> Result<MiniBootstrapSnapshot, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let result = load_mini_bootstrap_in_tx(&mut transaction).await?;
    transaction.commit().await?;
    Ok(result)
}

pub(crate) async fn load_mini_bootstrap_in_tx(
    transaction: &mut sqlx::Transaction<'_, Sqlite>,
) -> Result<MiniBootstrapSnapshot, sqlx::Error> {
    let setting_rows = sqlx::query(
        "SELECT key, value
         FROM settings
         WHERE key IN (?, ?, ?, ?, ?, 'hourly_activity_chart_mode', 'history_timeline_mode', 'refresh_interval_secs', 'timeline_merge_gap_secs', 'dynamic_effects', 'web_activity_enabled')
         ORDER BY key ASC",
    )
    .bind(TRACKING_PAUSED_KEY)
    .bind(THEME_MODE_KEY)
    .bind(LANGUAGE_KEY)
    .bind(COLOR_SCHEME_LIGHT_KEY)
    .bind(COLOR_SCHEME_DARK_KEY)
    .fetch_all(&mut **transaction)
    .await?;
    let app_override_rows = sqlx::query(
        "SELECT key, value
         FROM settings
         WHERE substr(key, 1, ?) = ?
         ORDER BY key ASC",
    )
    .bind(APP_OVERRIDE_KEY_PREFIX.len() as i64)
    .bind(APP_OVERRIDE_KEY_PREFIX)
    .fetch_all(&mut **transaction)
    .await?;
    let app_links = sqlx::query(
        "SELECT key,value FROM settings WHERE substr(key,1,12)='__app_link::' ORDER BY key",
    )
    .fetch_all(&mut **transaction)
    .await?
    .into_iter()
    .map(|row| MiniAppOverrideRow {
        key: row.get("key"),
        value: row.get("value"),
    })
    .collect();
    let token_available: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM settings WHERE key='web_activity_token' AND trim(value) <> '')")
        .fetch_one(&mut **transaction).await?;
    let category_settings: Vec<(String, String)> = sqlx::query_as(
        "SELECT key,value FROM settings WHERE key GLOB '__category_label_override::*'
         OR key GLOB '__category_color_override::*' OR key GLOB '__category_default_color_assignment::*'
         OR key GLOB '__deleted_category::*' OR key GLOB '__custom_category::*' ORDER BY key",
    ).fetch_all(&mut **transaction).await?;

    let mut settings_by_key = setting_rows
        .into_iter()
        .map(|row| (row.get::<String, _>("key"), row.get::<String, _>("value")))
        .collect::<HashMap<_, _>>();

    Ok(MiniBootstrapSnapshot {
        app_links,
        category_settings: category_settings
            .into_iter()
            .map(|(key, value)| MiniAppOverrideRow { key, value })
            .collect(),
        settings: MiniBootstrapSettings {
            tracking_paused: settings_by_key.remove(TRACKING_PAUSED_KEY),
            theme_mode: settings_by_key.remove(THEME_MODE_KEY),
            language: settings_by_key.remove(LANGUAGE_KEY),
            color_scheme_light: settings_by_key.remove(COLOR_SCHEME_LIGHT_KEY),
            color_scheme_dark: settings_by_key.remove(COLOR_SCHEME_DARK_KEY),
            hourly_activity_chart_mode: settings_by_key.remove("hourly_activity_chart_mode"),
            history_timeline_mode: settings_by_key.remove("history_timeline_mode"),
            refresh_interval_secs: settings_by_key.remove("refresh_interval_secs"),
            timeline_merge_gap_secs: settings_by_key.remove("timeline_merge_gap_secs"),
            dynamic_effects: settings_by_key.remove("dynamic_effects"),
            web_activity_available: token_available
                && settings_by_key
                    .get("web_activity_enabled")
                    .is_some_and(|value| {
                        crate::domain::settings::parse_boolean_setting(value, false)
                    }),
        },
        app_overrides: app_override_rows
            .into_iter()
            .map(|row| MiniAppOverrideRow {
                key: row.get("key"),
                value: row.get("value"),
            })
            .collect(),
    })
}

#[cfg(test)]
mod bootstrap_tests {
    use super::*;
    use crate::data::schema;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn mini_bootstrap_exposes_only_required_settings_and_app_overrides() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            pool.execute(
                "INSERT INTO settings (key, value) VALUES
                 ('tracking_paused', '1'),
                 ('theme_mode', 'dark'),
                 ('language', 'en-US'),
                 ('color_scheme_light', 'notion'),
                 ('color_scheme_dark', 'nord'),
                 ('web_activity_token', 'must-not-leak'),
                 ('remote_status_bridge_token', 'must-not-leak'),
                 ('__app_override::editor.exe', '{\"displayName\":\"Editor\"}'),
                 ('__web_domain_override::example.com', '{\"displayName\":\"Example\"}')",
            )
            .await
            .unwrap();

            let snapshot = load_mini_bootstrap_snapshot(&pool).await.unwrap();

            assert_eq!(snapshot.settings.tracking_paused.as_deref(), Some("1"));
            assert_eq!(snapshot.settings.theme_mode.as_deref(), Some("dark"));
            assert_eq!(snapshot.settings.language.as_deref(), Some("en-US"));
            assert_eq!(
                snapshot.settings.color_scheme_light.as_deref(),
                Some("notion")
            );
            assert_eq!(snapshot.settings.color_scheme_dark.as_deref(), Some("nord"));
            assert_eq!(
                snapshot.app_overrides,
                vec![MiniAppOverrideRow {
                    key: "__app_override::editor.exe".to_string(),
                    value: "{\"displayName\":\"Editor\"}".to_string(),
                }]
            );
        });
    }

    #[test]
    fn mini_bootstrap_defaults_missing_settings_without_failing() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            let snapshot = load_mini_bootstrap_snapshot(&pool).await.unwrap();

            assert_eq!(snapshot.settings, MiniBootstrapSettings::default());
            assert!(snapshot.app_overrides.is_empty());
        });
    }
}
