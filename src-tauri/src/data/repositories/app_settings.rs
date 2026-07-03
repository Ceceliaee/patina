use crate::domain::settings::{
    DesktopBehaviorSettings, RemoteStatusBridgeSettings, WebActivityBridgeSettings,
    WebActivitySettings,
};
use sqlx::{Pool, Row, Sqlite};

const CLOSE_BEHAVIOR_KEY: &str = "close_behavior";
const MINIMIZE_BEHAVIOR_KEY: &str = "minimize_behavior";
const LAUNCH_AT_LOGIN_KEY: &str = "launch_at_login";
const START_MINIMIZED_KEY: &str = "start_minimized";
const BACKGROUND_OPTIMIZATION_KEY: &str = "background_optimization";
const WEB_ACTIVITY_ENABLED_KEY: &str = "web_activity_enabled";
const WEB_ACTIVITY_PORT_KEY: &str = "web_activity_port";
const WEB_ACTIVITY_TOKEN_KEY: &str = "web_activity_token";
const REMOTE_STATUS_BRIDGE_ENABLED_KEY: &str = "remote_status_bridge_enabled";
const REMOTE_STATUS_BRIDGE_URL_KEY: &str = "remote_status_bridge_url";
const REMOTE_STATUS_BRIDGE_TOKEN_KEY: &str = "remote_status_bridge_token";
const REMOTE_STATUS_BRIDGE_MACHINE_ID_KEY: &str = "remote_status_bridge_machine_id";
const MAX_APP_SETTING_VALUE_LEN: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppSettingMutation {
    pub key: String,
    pub value: String,
}

pub async fn load_desktop_behavior_settings(
    pool: &Pool<Sqlite>,
) -> Result<DesktopBehaviorSettings, sqlx::Error> {
    let rows = sqlx::query("SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?, ?)")
        .bind(CLOSE_BEHAVIOR_KEY)
        .bind(MINIMIZE_BEHAVIOR_KEY)
        .bind(LAUNCH_AT_LOGIN_KEY)
        .bind(START_MINIMIZED_KEY)
        .bind(BACKGROUND_OPTIMIZATION_KEY)
        .fetch_all(pool)
        .await?;

    let mut close_behavior_raw: Option<String> = None;
    let mut minimize_behavior_raw: Option<String> = None;
    let mut launch_at_login_raw: Option<String> = None;
    let mut start_minimized_raw: Option<String> = None;
    let mut background_optimization_raw: Option<String> = None;

    for row in rows {
        let key: String = row.get("key");
        let value: String = row.get("value");

        match key.as_str() {
            CLOSE_BEHAVIOR_KEY => close_behavior_raw = Some(value),
            MINIMIZE_BEHAVIOR_KEY => {
                minimize_behavior_raw = Some(value);
            }
            LAUNCH_AT_LOGIN_KEY => {
                launch_at_login_raw = Some(value);
            }
            START_MINIMIZED_KEY => {
                start_minimized_raw = Some(value);
            }
            BACKGROUND_OPTIMIZATION_KEY => {
                background_optimization_raw = Some(value);
            }
            _ => {}
        }
    }

    Ok(DesktopBehaviorSettings::from_storage_values(
        close_behavior_raw.as_deref(),
        minimize_behavior_raw.as_deref(),
        launch_at_login_raw.as_deref(),
        start_minimized_raw.as_deref(),
        background_optimization_raw.as_deref(),
    ))
}

pub async fn commit_app_setting_mutations(
    pool: &Pool<Sqlite>,
    mutations: &[AppSettingMutation],
) -> Result<(), String> {
    if mutations.is_empty() {
        return Ok(());
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start app settings transaction: {error}"))?;

    for mutation in mutations {
        validate_app_setting_mutation(mutation)?;
        sqlx::query(
            "INSERT INTO settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(&mutation.key)
        .bind(&mutation.value)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to save app setting: {error}"))?;
    }

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit app settings transaction: {error}"))?;

    Ok(())
}

fn validate_app_setting_mutation(mutation: &AppSettingMutation) -> Result<(), String> {
    if !is_allowed_app_setting_key(&mutation.key) {
        return Err(format!("invalid app setting key `{}`", mutation.key));
    }

    if mutation.value.len() > MAX_APP_SETTING_VALUE_LEN {
        return Err(format!(
            "app setting value is too large for key `{}`",
            mutation.key
        ));
    }

    Ok(())
}

fn is_allowed_app_setting_key(key: &str) -> bool {
    matches!(
        key,
        "idle_timeout_secs"
            | "timeline_merge_gap_secs"
            | "refresh_interval_secs"
            | "min_session_secs"
            | "tracking_paused"
            | "close_behavior"
            | "minimize_behavior"
            | "theme_mode"
            | "language"
            | "hourly_activity_chart_mode"
            | "dynamic_effects"
            | "color_scheme_light"
            | "color_scheme_dark"
            | "launch_at_login"
            | "start_minimized"
            | "background_optimization"
            | "onboarding_completed"
            | "web_activity_enabled"
            | "web_activity_port"
            | "web_activity_token"
            | "remote_status_bridge_enabled"
            | "remote_status_bridge_url"
            | "remote_status_bridge_token"
            | "remote_status_bridge_machine_id"
    )
}

pub async fn load_web_activity_bridge_settings(
    pool: &Pool<Sqlite>,
) -> Result<WebActivityBridgeSettings, sqlx::Error> {
    let rows = sqlx::query("SELECT key, value FROM settings WHERE key IN (?, ?, ?)")
        .bind(WEB_ACTIVITY_PORT_KEY)
        .bind(WEB_ACTIVITY_ENABLED_KEY)
        .bind(WEB_ACTIVITY_TOKEN_KEY)
        .fetch_all(pool)
        .await?;

    let mut port: Option<String> = None;
    let mut web_activity_enabled: Option<String> = None;
    let mut web_activity_token: Option<String> = None;

    for row in rows {
        let key: String = row.get("key");
        let value: String = row.get("value");

        match key.as_str() {
            WEB_ACTIVITY_PORT_KEY => port = Some(value),
            WEB_ACTIVITY_ENABLED_KEY => web_activity_enabled = Some(value),
            WEB_ACTIVITY_TOKEN_KEY => web_activity_token = Some(value),
            _ => {}
        }
    }

    Ok(WebActivityBridgeSettings::from_storage_values(
        port.as_deref(),
        web_activity_enabled.as_deref(),
        web_activity_token.as_deref(),
    ))
}

pub async fn load_web_activity_settings(
    pool: &Pool<Sqlite>,
) -> Result<WebActivitySettings, sqlx::Error> {
    let rows = sqlx::query("SELECT key, value FROM settings WHERE key IN (?, ?)")
        .bind(WEB_ACTIVITY_ENABLED_KEY)
        .bind(WEB_ACTIVITY_TOKEN_KEY)
        .fetch_all(pool)
        .await?;

    let mut enabled: Option<String> = None;
    let mut token: Option<String> = None;

    for row in rows {
        let key: String = row.get("key");
        let value: String = row.get("value");

        match key.as_str() {
            WEB_ACTIVITY_ENABLED_KEY => enabled = Some(value),
            WEB_ACTIVITY_TOKEN_KEY => token = Some(value),
            _ => {}
        }
    }

    Ok(WebActivitySettings::from_storage_values(
        enabled.as_deref(),
        token.as_deref(),
    ))
}

pub async fn load_remote_status_bridge_settings(
    pool: &Pool<Sqlite>,
) -> Result<RemoteStatusBridgeSettings, sqlx::Error> {
    let rows = sqlx::query("SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)")
        .bind(REMOTE_STATUS_BRIDGE_ENABLED_KEY)
        .bind(REMOTE_STATUS_BRIDGE_URL_KEY)
        .bind(REMOTE_STATUS_BRIDGE_TOKEN_KEY)
        .bind(REMOTE_STATUS_BRIDGE_MACHINE_ID_KEY)
        .fetch_all(pool)
        .await?;

    let mut enabled: Option<String> = None;
    let mut url: Option<String> = None;
    let mut token: Option<String> = None;
    let mut machine_id: Option<String> = None;

    for row in rows {
        let key: String = row.get("key");
        let value: String = row.get("value");

        match key.as_str() {
            REMOTE_STATUS_BRIDGE_ENABLED_KEY => enabled = Some(value),
            REMOTE_STATUS_BRIDGE_URL_KEY => url = Some(value),
            REMOTE_STATUS_BRIDGE_TOKEN_KEY => token = Some(value),
            REMOTE_STATUS_BRIDGE_MACHINE_ID_KEY => machine_id = Some(value),
            _ => {}
        }
    }

    Ok(RemoteStatusBridgeSettings::from_storage_values(
        enabled.as_deref(),
        url.as_deref(),
        token.as_deref(),
        machine_id.as_deref(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema as db_schema;
    use sqlx::{Executor, Row, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    async fn load_setting(pool: &SqlitePool, key: &str) -> Option<String> {
        sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
            .bind(key)
            .fetch_optional(pool)
            .await
            .unwrap()
            .and_then(|row| row.try_get::<String, _>("value").ok())
    }

    #[test]
    fn commit_app_setting_mutations_upserts_in_one_transaction() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            commit_app_setting_mutations(
                &pool,
                &[
                    AppSettingMutation {
                        key: "theme_mode".to_string(),
                        value: "dark".to_string(),
                    },
                    AppSettingMutation {
                        key: "language".to_string(),
                        value: "en-US".to_string(),
                    },
                    AppSettingMutation {
                        key: "hourly_activity_chart_mode".to_string(),
                        value: "category".to_string(),
                    },
                    AppSettingMutation {
                        key: "dynamic_effects".to_string(),
                        value: "0".to_string(),
                    },
                ],
            )
            .await
            .unwrap();

            assert_eq!(
                load_setting(&pool, "theme_mode").await,
                Some("dark".to_string())
            );
            assert_eq!(
                load_setting(&pool, "language").await,
                Some("en-US".to_string())
            );
            assert_eq!(
                load_setting(&pool, "hourly_activity_chart_mode").await,
                Some("category".to_string())
            );
            assert_eq!(
                load_setting(&pool, "dynamic_effects").await,
                Some("0".to_string())
            );
        });
    }

    #[test]
    fn desktop_behavior_settings_loads_background_optimization() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            commit_app_setting_mutations(
                &pool,
                &[AppSettingMutation {
                    key: "background_optimization".to_string(),
                    value: "1".to_string(),
                }],
            )
            .await
            .unwrap();

            let settings = load_desktop_behavior_settings(&pool).await.unwrap();
            assert!(settings.should_optimize_background_resources());
        });
    }

    #[test]
    fn commit_app_setting_mutations_rolls_back_invalid_batches() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            let result = commit_app_setting_mutations(
                &pool,
                &[
                    AppSettingMutation {
                        key: "theme_mode".to_string(),
                        value: "dark".to_string(),
                    },
                    AppSettingMutation {
                        key: "__tracker_last_heartbeat_ms".to_string(),
                        value: "123".to_string(),
                    },
                ],
            )
            .await;

            assert!(result.is_err());
            assert_eq!(load_setting(&pool, "theme_mode").await, None);
            assert_eq!(
                load_setting(&pool, "__tracker_last_heartbeat_ms").await,
                None
            );
        });
    }

    #[test]
    fn remote_status_bridge_settings_loads_new_keys() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            commit_app_setting_mutations(
                &pool,
                &[
                    AppSettingMutation {
                        key: "remote_status_bridge_enabled".to_string(),
                        value: "1".to_string(),
                    },
                    AppSettingMutation {
                        key: "remote_status_bridge_url".to_string(),
                        value: "wss://worker.example/ws".to_string(),
                    },
                    AppSettingMutation {
                        key: "remote_status_bridge_token".to_string(),
                        value: "secret".to_string(),
                    },
                    AppSettingMutation {
                        key: "remote_status_bridge_machine_id".to_string(),
                        value: "machine-1".to_string(),
                    },
                ],
            )
            .await
            .unwrap();

            let settings = load_remote_status_bridge_settings(&pool).await.unwrap();
            assert!(settings.enabled);
            assert_eq!(settings.url, "wss://worker.example/ws");
            assert_eq!(settings.token, "secret");
            assert_eq!(settings.machine_id, "machine-1");
        });
    }
}
