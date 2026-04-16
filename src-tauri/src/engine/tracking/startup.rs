use crate::data::repositories::{sessions, tracker_settings};
use crate::domain::tracking::TrackingDataChangedPayload;
use crate::platform::windows::foreground as tracker;
use sqlx::{Pool, Sqlite};
use tauri::{AppHandle, Emitter, Runtime};

const DEFAULT_IDLE_TIMEOUT_SECS: u64 = 300;

pub async fn initialize_tracker<R: Runtime>(
    app: &AppHandle<R>,
    pool: &Pool<Sqlite>,
) -> Result<(), sqlx::Error> {
    let idle_timeout_secs =
        tracker_settings::load_idle_timeout_secs(pool, DEFAULT_IDLE_TIMEOUT_SECS).await?;
    tracker::cmd_set_idle_timeout(idle_timeout_secs);

    let mut repair_notes: Vec<String> = Vec::new();

    record_normalized_closed_duration(pool, &mut repair_notes).await?;
    seal_startup_active_session_if_needed(app, pool, &mut repair_notes).await?;
    persist_startup_self_heal_if_needed(pool, &repair_notes).await?;

    Ok(())
}

async fn record_normalized_closed_duration(
    pool: &Pool<Sqlite>,
    repair_notes: &mut Vec<String>,
) -> Result<(), sqlx::Error> {
    let normalized_rows = sessions::normalize_closed_session_durations(pool).await?;
    if normalized_rows > 0 {
        repair_notes.push(format!("normalized_closed_duration={normalized_rows}"));
    }

    Ok(())
}

async fn seal_startup_active_session_if_needed<R: Runtime>(
    app: &AppHandle<R>,
    pool: &Pool<Sqlite>,
    repair_notes: &mut Vec<String>,
) -> Result<(), sqlx::Error> {
    let Some(existing_session) = sessions::load_active_session(pool).await? else {
        return Ok(());
    };

    let last_heartbeat_ms = tracker_settings::load_tracker_timestamp(
        pool,
        tracker_settings::TRACKER_LAST_HEARTBEAT_KEY,
    )
    .await?;
    let end_time =
        resolve_startup_seal_time(existing_session.start_time, last_heartbeat_ms, now_ms());

    if sessions::end_active_sessions(pool, end_time).await? {
        repair_notes.push("sealed_active_session".to_string());
        let _ = emit_tracking_data_changed(app, "startup-sealed", end_time as u64);
    }

    Ok(())
}

async fn persist_startup_self_heal_if_needed(
    pool: &Pool<Sqlite>,
    repair_notes: &[String],
) -> Result<(), sqlx::Error> {
    if repair_notes.is_empty() {
        return Ok(());
    }

    let summary = repair_notes.join(",");
    let now = now_ms();
    tracker_settings::save_setting_value(
        pool,
        tracker_settings::TRACKER_LAST_STARTUP_SELF_HEAL_AT_KEY,
        &now.to_string(),
    )
    .await?;
    tracker_settings::save_setting_value(
        pool,
        tracker_settings::TRACKER_LAST_STARTUP_SELF_HEAL_SUMMARY_KEY,
        &summary,
    )
    .await?;
    log_startup_error(format!("startup self-heal applied: {summary}"));

    Ok(())
}

pub(crate) fn resolve_startup_seal_time(
    session_start_time: i64,
    last_heartbeat_ms: Option<i64>,
    now_ms: i64,
) -> i64 {
    let Some(last_heartbeat_ms) = last_heartbeat_ms else {
        return now_ms;
    };

    now_ms.min(session_start_time.max(last_heartbeat_ms))
}

fn emit_tracking_data_changed<R: Runtime>(
    app: &AppHandle<R>,
    reason: &str,
    changed_at_ms: u64,
) -> tauri::Result<()> {
    app.emit(
        "tracking-data-changed",
        TrackingDataChangedPayload::new(reason, changed_at_ms),
    )
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

fn log_startup_error(message: impl AsRef<str>) {
    eprintln!("[tracker] {}", message.as_ref());
}

#[cfg(test)]
mod tests {
    use super::resolve_startup_seal_time;

    #[test]
    fn startup_seal_time_prefers_valid_heartbeat() {
        assert_eq!(resolve_startup_seal_time(1_000, Some(8_000), 20_000), 8_000);
        assert_eq!(
            resolve_startup_seal_time(1_000, Some(30_000), 20_000),
            20_000
        );
        assert_eq!(resolve_startup_seal_time(5_000, None, 20_000), 20_000);
    }
}
