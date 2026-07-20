use crate::domain::settings::parse_boolean_setting;
use crate::domain::tracking::resolve_app_override_executable;
use sqlx::{Pool, Row, Sqlite};

pub const TRACKER_LAST_HEARTBEAT_KEY: &str = "__tracker_last_heartbeat_ms";
pub const TRACKER_LAST_STARTUP_SELF_HEAL_AT_KEY: &str = "__tracker_last_startup_self_heal_at_ms";
pub const TRACKER_LAST_STARTUP_SELF_HEAL_SUMMARY_KEY: &str =
    "__tracker_last_startup_self_heal_summary";

const TRACKING_PAUSED_KEY: &str = "tracking_paused";
pub const TITLE_RECORDING_ENABLED_KEY: &str = "title_recording_enabled";
const TIMELINE_MERGE_GAP_KEY: &str = "timeline_merge_gap_secs";
const IDLE_TIMEOUT_KEY: &str = "idle_timeout_secs";
pub const APP_OVERRIDE_KEY_PREFIX: &str = "__app_override::";

#[derive(Clone, Debug, serde::Deserialize, Default)]
struct StoredAppOverride {
    track: Option<bool>,
    #[serde(rename = "captureTitle")]
    capture_title: Option<bool>,
}

pub async fn load_tracking_paused_setting(pool: &Pool<Sqlite>) -> Result<bool, sqlx::Error> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(TRACKING_PAUSED_KEY)
        .fetch_optional(pool)
        .await?;

    Ok(row
        .and_then(|row| row.try_get::<String, _>("value").ok())
        .map(|value| parse_boolean_setting(&value, false))
        .unwrap_or(false))
}

pub async fn load_title_recording_enabled(pool: &Pool<Sqlite>) -> Result<bool, sqlx::Error> {
    let value = load_setting_value(pool, TITLE_RECORDING_ENABLED_KEY).await?;
    Ok(value
        .as_deref()
        .map(|raw| parse_boolean_setting(raw, true))
        .unwrap_or(true))
}

pub async fn save_tracking_paused_setting(
    pool: &Pool<Sqlite>,
    tracking_paused: bool,
) -> Result<(), sqlx::Error> {
    let value = if tracking_paused { "1" } else { "0" };
    save_setting_value(pool, TRACKING_PAUSED_KEY, value).await
}

pub async fn load_capture_window_title_setting_for_app(
    pool: &Pool<Sqlite>,
    exe_name: &str,
) -> Result<bool, sqlx::Error> {
    let Some(canonical_exe_name) = resolve_app_override_executable(exe_name) else {
        return Ok(true);
    };

    let setting_key = format!("{APP_OVERRIDE_KEY_PREFIX}{canonical_exe_name}");
    let row = sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(setting_key)
        .fetch_optional(pool)
        .await?;

    let Some(raw_value) = row.and_then(|row| row.try_get::<String, _>("value").ok()) else {
        return Ok(true);
    };

    let parsed_override = serde_json::from_str::<StoredAppOverride>(&raw_value).ok();
    Ok(parsed_override
        .and_then(|override_value| override_value.capture_title)
        .unwrap_or(true))
}

pub async fn load_tracking_enabled_setting_for_app(
    pool: &Pool<Sqlite>,
    exe_name: &str,
) -> Result<bool, sqlx::Error> {
    let Some(canonical_exe_name) = resolve_app_override_executable(exe_name) else {
        return Ok(true);
    };

    let setting_key = format!("{APP_OVERRIDE_KEY_PREFIX}{canonical_exe_name}");
    let row = sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(setting_key)
        .fetch_optional(pool)
        .await?;

    let Some(raw_value) = row.and_then(|row| row.try_get::<String, _>("value").ok()) else {
        return Ok(true);
    };

    Ok(serde_json::from_str::<StoredAppOverride>(&raw_value)
        .ok()
        .and_then(|override_value| override_value.track)
        .unwrap_or(true))
}

pub async fn load_idle_timeout_secs(
    pool: &Pool<Sqlite>,
    default_idle_timeout_secs: u64,
) -> Result<u64, sqlx::Error> {
    load_u64_setting_or_default(pool, IDLE_TIMEOUT_KEY, default_idle_timeout_secs).await
}

pub async fn load_timeline_merge_gap_secs(
    pool: &Pool<Sqlite>,
    default_timeline_merge_gap_secs: u64,
) -> Result<u64, sqlx::Error> {
    load_u64_setting_or_default(
        pool,
        TIMELINE_MERGE_GAP_KEY,
        default_timeline_merge_gap_secs,
    )
    .await
}

pub async fn load_tracker_timestamp(
    pool: &Pool<Sqlite>,
    key: &str,
) -> Result<Option<i64>, sqlx::Error> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(key)
        .fetch_optional(pool)
        .await?;

    Ok(row
        .and_then(|row| row.try_get::<String, _>("value").ok())
        .and_then(|value| value.parse::<i64>().ok()))
}

pub async fn save_tracker_timestamp(
    pool: &Pool<Sqlite>,
    key: &str,
    timestamp_ms: i64,
) -> Result<(), sqlx::Error> {
    save_setting_value(pool, key, &timestamp_ms.to_string()).await
}

pub async fn save_setting_value(
    pool: &Pool<Sqlite>,
    key: &str,
    value: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;

    Ok(())
}

pub async fn load_setting_value(
    pool: &Pool<Sqlite>,
    key: &str,
) -> Result<Option<String>, sqlx::Error> {
    let row = sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(key)
        .fetch_optional(pool)
        .await?;

    Ok(row.and_then(|row| row.try_get::<String, _>("value").ok()))
}

async fn load_u64_setting_or_default(
    pool: &Pool<Sqlite>,
    key: &str,
    default_value: u64,
) -> Result<u64, sqlx::Error> {
    Ok(load_setting_value(pool, key)
        .await?
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(default_value))
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
    fn idle_timeout_setting_does_not_fallback_to_legacy_afk_key() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            save_setting_value(&pool, "afk_timeout_secs", "999")
                .await
                .unwrap();

            let fallback = load_idle_timeout_secs(&pool, 180).await.unwrap();
            assert_eq!(fallback, 180);

            save_setting_value(&pool, "idle_timeout_secs", "240")
                .await
                .unwrap();

            let configured = load_idle_timeout_secs(&pool, 180).await.unwrap();
            assert_eq!(configured, 240);
        });
    }

    #[test]
    fn timeline_merge_gap_setting_uses_current_setting_key_only() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            let fallback = load_timeline_merge_gap_secs(&pool, 180).await.unwrap();
            assert_eq!(fallback, 180);

            save_setting_value(&pool, TIMELINE_MERGE_GAP_KEY, "240")
                .await
                .unwrap();

            let configured = load_timeline_merge_gap_secs(&pool, 180).await.unwrap();
            assert_eq!(configured, 240);
        });
    }

    #[test]
    fn app_tracking_setting_defaults_to_enabled_and_reads_explicit_exclusion() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            assert!(load_tracking_enabled_setting_for_app(&pool, "QQ.exe")
                .await
                .unwrap());

            save_setting_value(
                &pool,
                "__app_override::qq.exe",
                r#"{"track":false,"captureTitle":true}"#,
            )
            .await
            .unwrap();

            assert!(!load_tracking_enabled_setting_for_app(&pool, "qq")
                .await
                .unwrap());
        });
    }

    #[test]
    fn canonical_app_override_applies_to_verified_alias_tracking_and_title_capture() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            save_setting_value(
                &pool,
                "__app_override::steam.exe",
                r#"{"track":false,"captureTitle":false}"#,
            )
            .await
            .unwrap();

            assert!(
                !load_tracking_enabled_setting_for_app(&pool, "SteamWebHelper.exe")
                    .await
                    .unwrap()
            );
            assert!(
                !load_capture_window_title_setting_for_app(&pool, "steamwebhelper.exe")
                    .await
                    .unwrap()
            );
            assert!(
                load_tracking_enabled_setting_for_app(&pool, "unknownhelper.exe")
                    .await
                    .unwrap()
            );

            save_setting_value(
                &pool,
                "__app_override::alma.exe",
                r#"{"track":false,"captureTitle":false}"#,
            )
            .await
            .unwrap();
            assert!(
                !load_tracking_enabled_setting_for_app(&pool, "alma-0.0.750-win-x64.exe")
                    .await
                    .unwrap()
            );
            assert!(
                !load_capture_window_title_setting_for_app(&pool, "alma-0.0.750-win-x64.exe")
                    .await
                    .unwrap()
            );
        });
    }

    #[test]
    fn global_title_recording_defaults_on_and_reads_explicit_value() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            assert!(load_title_recording_enabled(&pool).await.unwrap());

            save_setting_value(&pool, TITLE_RECORDING_ENABLED_KEY, "0")
                .await
                .unwrap();
            assert!(!load_title_recording_enabled(&pool).await.unwrap());
        });
    }
}
