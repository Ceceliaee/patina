use crate::data::sqlite_error::SqliteOperationError;
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
const LANGUAGE_KEY: &str = "language";
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

pub async fn load_language_setting(pool: &Pool<Sqlite>) -> Result<Option<String>, sqlx::Error> {
    sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(LANGUAGE_KEY)
        .fetch_optional(pool)
        .await?
        .map(|row| row.try_get::<String, _>("value"))
        .transpose()
}

pub async fn commit_app_setting_mutations(
    pool: &Pool<Sqlite>,
    mutations: &[AppSettingMutation],
) -> Result<(), SqliteOperationError> {
    if mutations.is_empty() {
        return Ok(());
    }

    let mut tx = pool.begin().await.map_err(|error| {
        SqliteOperationError::from_sqlx("start app settings transaction", error)
    })?;

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
        .map_err(|error| SqliteOperationError::from_sqlx("save app setting", error))?;
        if mutation.key == "tracking_paused"
            && crate::domain::settings::parse_boolean_setting(&mutation.value, false)
        {
            super::sessions::end_active_sessions_tx(
                &mut tx,
                crate::platform::clock::unix_timestamp_millis_i64(),
            )
            .await
            .map_err(|error| SqliteOperationError::from_sqlx("seal paused tracking", error))?;
        }
        if (mutation.key == WEB_ACTIVITY_ENABLED_KEY
            && !crate::domain::settings::parse_boolean_setting(&mutation.value, false))
            || (mutation.key == WEB_ACTIVITY_TOKEN_KEY && mutation.value.trim().is_empty())
        {
            super::web_activity::end_active_segment_tx(
                &mut tx,
                crate::platform::clock::unix_timestamp_millis_i64(),
            )
            .await
            .map_err(|error| {
                SqliteOperationError::from_sqlx("seal disabled web tracking", error)
            })?;
        }
    }

    tx.commit().await.map_err(|error| {
        SqliteOperationError::from_sqlx("commit app settings transaction", error)
    })?;

    Ok(())
}

fn validate_app_setting_mutation(
    mutation: &AppSettingMutation,
) -> Result<(), SqliteOperationError> {
    if !is_allowed_app_setting_key(&mutation.key) {
        return Err(SqliteOperationError::invalid_input(
            "validate app setting",
            format!("invalid key `{}`", mutation.key),
        ));
    }

    if mutation.value.len() > MAX_APP_SETTING_VALUE_LEN {
        return Err(SqliteOperationError::invalid_input(
            "validate app setting",
            format!("value is too large for key `{}`", mutation.key),
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
            | "title_recording_enabled"
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
    fn desktop_behavior_settings_defaults_on_and_preserves_saved_background_optimization() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            let settings = load_desktop_behavior_settings(&pool).await.unwrap();
            assert!(settings.should_optimize_background_resources());

            commit_app_setting_mutations(
                &pool,
                &[AppSettingMutation {
                    key: "background_optimization".to_string(),
                    value: "0".to_string(),
                }],
            )
            .await
            .unwrap();

            let settings = load_desktop_behavior_settings(&pool).await.unwrap();
            assert!(!settings.should_optimize_background_resources());

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
    fn language_setting_loads_raw_saved_value_and_preserves_missing_state() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            assert_eq!(load_language_setting(&pool).await.unwrap(), None);

            for raw_value in ["zh-CN", "en-US", "future-language"] {
                commit_app_setting_mutations(
                    &pool,
                    &[AppSettingMutation {
                        key: "language".to_string(),
                        value: raw_value.to_string(),
                    }],
                )
                .await
                .unwrap();

                assert_eq!(
                    load_language_setting(&pool).await.unwrap(),
                    Some(raw_value.to_string())
                );
            }
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
    #[test]
    fn disabling_web_recording_seals_only_web_and_rolls_back_on_failure() {
        tauri::async_runtime::block_on(async {
            for (key, value) in [("web_activity_enabled", "0"), ("web_activity_token", "")] {
                let pool = setup_test_db().await;
                for migration in crate::data::schema::tracker_migrations() {
                    pool.execute(migration.sql).await.unwrap();
                }
                let start = crate::platform::clock::unix_timestamp_millis_i64() - 5_000;
                pool.execute("INSERT INTO settings(key,value) VALUES('web_activity_enabled','1'),('web_activity_token','test')").await.unwrap();
                super::super::sessions::start_session(
                    &pool,
                    "Chrome",
                    "chrome.exe",
                    "",
                    start,
                    start,
                )
                .await
                .unwrap();
                sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,source,created_at,updated_at) VALUES('test','chrome','chrome.exe','example.com','example.com',?,'browser-extension',?,?)")
                    .bind(start).bind(start).bind(start).execute(&pool).await.unwrap();
                pool.execute("CREATE TRIGGER reject_web_stop BEFORE UPDATE OF end_time ON web_activity_segments BEGIN SELECT RAISE(ABORT,'failure'); END").await.unwrap();
                let mutation = AppSettingMutation {
                    key: key.into(),
                    value: value.into(),
                };
                assert!(commit_app_setting_mutations(&pool, &[mutation.clone()])
                    .await
                    .is_err());
                let saved: String = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
                    .bind(key)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
                assert_eq!(
                    saved,
                    if key == "web_activity_enabled" {
                        "1"
                    } else {
                        "test"
                    }
                );
                pool.execute("DROP TRIGGER reject_web_stop").await.unwrap();
                let before = crate::platform::clock::unix_timestamp_millis_i64();
                commit_app_setting_mutations(&pool, &[mutation])
                    .await
                    .unwrap();
                let after = crate::platform::clock::unix_timestamp_millis_i64();
                let end: Option<i64> =
                    sqlx::query_scalar("SELECT end_time FROM web_activity_segments")
                        .fetch_one(&pool)
                        .await
                        .unwrap();
                assert!(end.is_some_and(|end| end >= before && end <= after));
                assert!(super::super::sessions::load_active_session(&pool)
                    .await
                    .unwrap()
                    .is_some());
                commit_app_setting_mutations(
                    &pool,
                    &[AppSettingMutation {
                        key: key.into(),
                        value: saved,
                    }],
                )
                .await
                .unwrap();
                let restored_end: Option<i64> =
                    sqlx::query_scalar("SELECT end_time FROM web_activity_segments")
                        .fetch_one(&pool)
                        .await
                        .unwrap();
                assert_eq!(restored_end, end);
            }
        });
    }

    #[test]
    fn pause_commits_with_native_boundary_and_failure_rolls_both_back() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            super::super::sessions::start_session(&pool, "A", "a.exe", "A", 1_000, 1_000)
                .await
                .unwrap();
            sqlx::query("CREATE TRIGGER reject_pause_end BEFORE UPDATE OF end_time ON sessions BEGIN SELECT RAISE(ABORT, 'failure'); END").execute(&pool).await.unwrap();
            let pause = AppSettingMutation {
                key: "tracking_paused".into(),
                value: "1".into(),
            };
            assert!(commit_app_setting_mutations(&pool, &[pause.clone()])
                .await
                .is_err());
            let setting: Option<String> =
                sqlx::query_scalar("SELECT value FROM settings WHERE key='tracking_paused'")
                    .fetch_optional(&pool)
                    .await
                    .unwrap();
            assert!(setting.is_none());
            assert!(super::super::sessions::load_active_session(&pool)
                .await
                .unwrap()
                .is_some());
            sqlx::query("DROP TRIGGER reject_pause_end")
                .execute(&pool)
                .await
                .unwrap();
            commit_app_setting_mutations(&pool, &[pause]).await.unwrap();
            let end: i64 = sqlx::query_scalar("SELECT end_time FROM sessions WHERE id=1")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert!(end >= 1_000);
            commit_app_setting_mutations(
                &pool,
                &[AppSettingMutation {
                    key: "tracking_paused".into(),
                    value: "0".into(),
                }],
            )
            .await
            .unwrap();
            assert!(super::super::sessions::load_active_session(&pool)
                .await
                .unwrap()
                .is_none());
            super::super::sessions::start_session(
                &pool,
                "A",
                "a.exe",
                "A",
                end + 1_000,
                end + 1_000,
            )
            .await
            .unwrap();
            let times: Vec<(i64, Option<i64>)> =
                sqlx::query_as("SELECT start_time,end_time FROM sessions ORDER BY id")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
            assert_eq!(times, vec![(1_000, Some(end)), (end + 1_000, None)]);
        });
    }
}
