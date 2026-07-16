use crate::engine::tracking::ports::{TrackingDataError, TrackingDataStore};

pub(super) async fn apply_power_lifecycle_event(
    data: &dyn TrackingDataStore,
    state: &str,
    timestamp_ms: i64,
) -> Result<Option<&'static str>, TrackingDataError> {
    let should_end_active_session = matches!(state, "lock" | "suspend");

    if !should_end_active_session {
        return Ok(None);
    }

    if data.end_active_sessions(timestamp_ms).await? {
        return Ok(Some(match state {
            "lock" => "session-ended-lock",
            "suspend" => "session-ended-suspend",
            _ => "session-ended-system",
        }));
    }

    Ok(None)
}
