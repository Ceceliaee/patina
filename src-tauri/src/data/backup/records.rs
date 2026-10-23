use crate::data::repositories;
use crate::domain::backup::BackupRecords;
use serde::Deserialize;
use sqlx::{Pool, Sqlite};

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RestoreStrategy {
    #[default]
    Merge,
    Replace,
}

pub(super) async fn load_backup_records(pool: &Pool<Sqlite>) -> Result<BackupRecords, String> {
    let sessions = repositories::sessions::fetch_all_for_backup(pool).await?;
    let title_samples = repositories::session_title_samples::fetch_all_for_backup(pool).await?;
    let settings = repositories::settings::fetch_all_for_backup(pool).await?;
    let icon_cache = repositories::icon_cache::fetch_all_for_backup(pool).await?;
    let web_activity_segments = repositories::web_activity::fetch_all_for_backup(pool).await?;
    let web_favicon_cache =
        repositories::web_activity::fetch_all_favicon_cache_for_backup(pool).await?;
    let tool_reminders = repositories::tools::fetch_all_reminders_for_backup(pool).await?;
    let tool_timers = repositories::tools::fetch_all_timers_for_backup(pool).await?;
    let tool_timer_laps = repositories::tools::fetch_all_timer_laps_for_backup(pool).await?;
    let tool_pomodoro_runs = repositories::tools::fetch_all_pomodoro_runs_for_backup(pool).await?;
    let tool_daily_stats = repositories::tools::fetch_all_daily_stats_for_backup(pool).await?;

    Ok(BackupRecords {
        sessions,
        title_samples,
        settings,
        icon_cache,
        web_activity_segments,
        web_favicon_cache,
        tool_reminders,
        tool_timers,
        tool_timer_laps,
        tool_pomodoro_runs,
        tool_daily_stats,
    })
}
