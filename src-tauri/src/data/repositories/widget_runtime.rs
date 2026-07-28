use std::collections::HashMap;

use serde::Serialize;
use sqlx::{Pool, Row, Sqlite};

use super::classification_settings::APP_OVERRIDE_KEY_PREFIX;

const TRACKING_PAUSED_KEY: &str = "tracking_paused";
const THEME_MODE_KEY: &str = "theme_mode";
const LANGUAGE_KEY: &str = "language";
const COLOR_SCHEME_LIGHT_KEY: &str = "color_scheme_light";
const COLOR_SCHEME_DARK_KEY: &str = "color_scheme_dark";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct WidgetBootstrapSettings {
    pub tracking_paused: Option<String>,
    pub theme_mode: Option<String>,
    pub language: Option<String>,
    pub color_scheme_light: Option<String>,
    pub color_scheme_dark: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WidgetAppOverrideRow {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct WidgetBootstrapSnapshot {
    pub settings: WidgetBootstrapSettings,
    pub app_overrides: Vec<WidgetAppOverrideRow>,
}

pub async fn load_widget_bootstrap_snapshot(
    pool: &Pool<Sqlite>,
) -> Result<WidgetBootstrapSnapshot, sqlx::Error> {
    let mut transaction = pool.begin().await?;
    let setting_rows = sqlx::query(
        "SELECT key, value
         FROM settings
         WHERE key IN (?, ?, ?, ?, ?)
         ORDER BY key ASC",
    )
    .bind(TRACKING_PAUSED_KEY)
    .bind(THEME_MODE_KEY)
    .bind(LANGUAGE_KEY)
    .bind(COLOR_SCHEME_LIGHT_KEY)
    .bind(COLOR_SCHEME_DARK_KEY)
    .fetch_all(&mut *transaction)
    .await?;
    let app_override_rows = sqlx::query(
        "SELECT key, value
         FROM settings
         WHERE substr(key, 1, ?) = ?
         ORDER BY key ASC",
    )
    .bind(APP_OVERRIDE_KEY_PREFIX.len() as i64)
    .bind(APP_OVERRIDE_KEY_PREFIX)
    .fetch_all(&mut *transaction)
    .await?;
    transaction.commit().await?;

    let mut settings_by_key = setting_rows
        .into_iter()
        .map(|row| (row.get::<String, _>("key"), row.get::<String, _>("value")))
        .collect::<HashMap<_, _>>();

    Ok(WidgetBootstrapSnapshot {
        settings: WidgetBootstrapSettings {
            tracking_paused: settings_by_key.remove(TRACKING_PAUSED_KEY),
            theme_mode: settings_by_key.remove(THEME_MODE_KEY),
            language: settings_by_key.remove(LANGUAGE_KEY),
            color_scheme_light: settings_by_key.remove(COLOR_SCHEME_LIGHT_KEY),
            color_scheme_dark: settings_by_key.remove(COLOR_SCHEME_DARK_KEY),
        },
        app_overrides: app_override_rows
            .into_iter()
            .map(|row| WidgetAppOverrideRow {
                key: row.get("key"),
                value: row.get("value"),
            })
            .collect(),
    })
}

#[cfg(test)]
mod tests {
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
    fn widget_bootstrap_exposes_only_required_settings_and_app_overrides() {
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

            let snapshot = load_widget_bootstrap_snapshot(&pool).await.unwrap();

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
                vec![WidgetAppOverrideRow {
                    key: "__app_override::editor.exe".to_string(),
                    value: "{\"displayName\":\"Editor\"}".to_string(),
                }]
            );
        });
    }

    #[test]
    fn widget_bootstrap_defaults_missing_settings_without_failing() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            let snapshot = load_widget_bootstrap_snapshot(&pool).await.unwrap();

            assert_eq!(snapshot.settings, WidgetBootstrapSettings::default());
            assert!(snapshot.app_overrides.is_empty());
        });
    }
}
