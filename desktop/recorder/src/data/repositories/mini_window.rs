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
