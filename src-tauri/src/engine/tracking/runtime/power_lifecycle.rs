use crate::data::repositories::sessions;
use sqlx::{Pool, Sqlite};

pub(super) async fn apply_power_lifecycle_event(
    pool: &Pool<Sqlite>,
    state: &str,
    timestamp_ms: i64,
) -> Result<Option<&'static str>, sqlx::Error> {
    let should_end_active_session = matches!(state, "lock" | "suspend");

    if !should_end_active_session {
        return Ok(None);
    }

    if sessions::end_active_sessions(pool, timestamp_ms).await? {
        return Ok(Some(match state {
            "lock" => "session-ended-lock",
            "suspend" => "session-ended-suspend",
            _ => "session-ended-system",
        }));
    }

    Ok(None)
}
