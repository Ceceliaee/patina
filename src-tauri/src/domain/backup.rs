use serde::Serialize;

pub const CURRENT_BACKUP_VERSION: u32 = 1;

#[derive(Clone, Debug)]
pub struct BackupSession {
    pub id: i64,
    pub app_name: String,
    pub exe_name: String,
    pub window_title: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub duration: Option<i64>,
    pub continuity_group_start_time: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct BackupTitleSample {
    pub session_id: i64,
    pub title: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct BackupSetting {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug)]
pub struct BackupIconCache {
    pub exe_name: String,
    pub icon_base64: String,
    pub last_updated: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct BackupWebActivitySegment {
    pub native_session_id: Option<i64>,

    pub browser_client_id: String,
    pub browser_kind: String,
    pub browser_exe_name: String,
    pub domain: String,
    pub normalized_domain: String,
    pub url: Option<String>,
    pub title: Option<String>,
    pub favicon_url: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub duration: Option<i64>,
    pub source: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
pub struct BackupWebFaviconCache {
    pub normalized_domain: String,
    pub favicon_url: String,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
pub struct BackupToolReminder {
    pub label: String,
    pub scheduled_at: i64,
    pub created_at: i64,
    pub status: String,
    pub fired_at: Option<i64>,
    pub cancelled_at: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct BackupToolTimer {
    pub id: i64,
    pub mode: String,
    pub label: Option<String>,
    pub duration_ms: Option<i64>,
    pub accumulated_ms: i64,
    pub started_at: Option<i64>,
    pub paused_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
pub struct BackupToolTimerLap {
    pub id: i64,
    pub timer_id: i64,
    pub lap_index: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
}

#[derive(Clone, Debug)]
pub struct BackupToolPomodoroRun {
    pub phase: String,
    pub status: String,
    pub cycle_index: i64,
    pub focus_ms: i64,
    pub short_break_ms: i64,
    pub long_break_ms: i64,
    pub long_break_every: i64,
    pub phase_started_at: Option<i64>,
    pub phase_paused_at: Option<i64>,
    pub phase_remaining_ms: Option<i64>,
    pub completed_focus_count: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug)]
pub struct BackupToolDailyStats {
    pub date_key: String,
    pub completed_pomodoros: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Default)]
pub struct BackupRecords {
    pub sessions: Vec<BackupSession>,
    pub title_samples: Vec<BackupTitleSample>,
    pub settings: Vec<BackupSetting>,
    pub icon_cache: Vec<BackupIconCache>,
    pub web_activity_segments: Vec<BackupWebActivitySegment>,
    pub web_favicon_cache: Vec<BackupWebFaviconCache>,
    pub tool_reminders: Vec<BackupToolReminder>,
    pub tool_timers: Vec<BackupToolTimer>,
    pub tool_timer_laps: Vec<BackupToolTimerLap>,
    pub tool_pomodoro_runs: Vec<BackupToolPomodoroRun>,
    pub tool_daily_stats: Vec<BackupToolDailyStats>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BackupPreview {
    pub hash: String,
    pub format_kind: String,
    pub version: u32,
    pub exported_at_ms: u64,
    pub schema_version: u32,
    pub app_version: String,
    pub restore_supported: bool,
    pub restore_message_key: String,
    pub restore_message_args: Vec<String>,
    pub restore_message: String,
    pub session_count: usize,
    pub title_sample_count: usize,
    pub import_batch_count: usize,
    pub import_exact_session_count: usize,
    pub import_time_bucket_count: usize,
    pub setting_count: usize,
    pub icon_cache_count: usize,
    pub web_activity_segment_count: usize,
    pub tool_reminder_count: usize,
    pub tool_timer_count: usize,
    pub tool_timer_lap_count: usize,
    pub tool_pomodoro_run_count: usize,
    pub tool_daily_stats_count: usize,
    pub tool_activity_reminder_rule_count: usize,
}

#[derive(Debug)]
pub enum BackupError {
    UnsupportedFormat,
    Invalid(String),
}

impl From<String> for BackupError {
    fn from(message: String) -> Self {
        Self::Invalid(message)
    }
}

impl std::fmt::Display for BackupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedFormat => f.write_str("Only SQLite snapshot backups are supported."),
            Self::Invalid(message) => f.write_str(message),
        }
    }
}
