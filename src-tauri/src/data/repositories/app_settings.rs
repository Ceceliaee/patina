use crate::domain::settings::DesktopBehaviorSettings;
use sqlx::{Pool, Row, Sqlite};

const CLOSE_BEHAVIOR_KEY: &str = "close_behavior";
const MINIMIZE_BEHAVIOR_KEY: &str = "minimize_behavior";
const LAUNCH_AT_LOGIN_KEY: &str = "launch_at_login";
const START_MINIMIZED_KEY: &str = "start_minimized";

pub async fn load_desktop_behavior_settings(
    pool: &Pool<Sqlite>,
) -> Result<DesktopBehaviorSettings, sqlx::Error> {
    let rows = sqlx::query("SELECT key, value FROM settings WHERE key IN (?, ?, ?, ?)")
        .bind(CLOSE_BEHAVIOR_KEY)
        .bind(MINIMIZE_BEHAVIOR_KEY)
        .bind(LAUNCH_AT_LOGIN_KEY)
        .bind(START_MINIMIZED_KEY)
        .fetch_all(pool)
        .await?;

    let mut close_behavior_raw: Option<String> = None;
    let mut minimize_behavior_raw: Option<String> = None;
    let mut launch_at_login_raw: Option<String> = None;
    let mut start_minimized_raw: Option<String> = None;

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
            _ => {}
        }
    }

    Ok(DesktopBehaviorSettings::from_storage_values(
        close_behavior_raw.as_deref(),
        minimize_behavior_raw.as_deref(),
        launch_at_login_raw.as_deref(),
        start_minimized_raw.as_deref(),
    ))
}
