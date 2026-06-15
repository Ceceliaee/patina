use serde::{Deserialize, Serialize};

pub const CURRENT_BACKUP_VERSION: u32 = 1;
pub const CURRENT_BACKUP_SCHEMA_VERSION: u32 = 8;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupMeta {
    pub exported_at_ms: u64,
    pub schema_version: u32,
    pub app_version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupSession {
    pub id: i64,
    pub app_name: String,
    pub exe_name: String,
    pub window_title: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub duration: Option<i64>,
    #[serde(default)]
    pub continuity_group_start_time: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupTitleSample {
    pub id: i64,
    pub session_id: i64,
    pub title: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupSetting {
    pub key: String,
    pub value: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupIconCache {
    pub exe_name: String,
    pub icon_base64: String,
    pub last_updated: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupWebActivitySegment {
    pub id: i64,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupToolReminder {
    pub id: i64,
    pub label: String,
    pub scheduled_at: i64,
    pub created_at: i64,
    pub status: String,
    pub fired_at: Option<i64>,
    pub cancelled_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupToolTimerLap {
    pub id: i64,
    pub timer_id: i64,
    pub lap_index: i64,
    pub started_at: i64,
    pub ended_at: i64,
    pub duration_ms: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupToolPomodoroRun {
    pub id: i64,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupToolDailyStats {
    pub date_key: String,
    pub completed_pomodoros: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BackupPayload {
    pub version: u32,
    pub meta: BackupMeta,
    pub sessions: Vec<BackupSession>,
    #[serde(default)]
    pub title_samples: Vec<BackupTitleSample>,
    pub settings: Vec<BackupSetting>,
    pub icon_cache: Vec<BackupIconCache>,
    #[serde(default)]
    pub web_activity_segments: Vec<BackupWebActivitySegment>,
    #[serde(default)]
    pub tool_reminders: Vec<BackupToolReminder>,
    #[serde(default)]
    pub tool_timers: Vec<BackupToolTimer>,
    #[serde(default)]
    pub tool_timer_laps: Vec<BackupToolTimerLap>,
    #[serde(default)]
    pub tool_pomodoro_runs: Vec<BackupToolPomodoroRun>,
    #[serde(default)]
    pub tool_daily_stats: Vec<BackupToolDailyStats>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BackupPreview {
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
    pub setting_count: usize,
    pub icon_cache_count: usize,
    pub web_activity_segment_count: usize,
    pub tool_reminder_count: usize,
    pub tool_timer_count: usize,
    pub tool_timer_lap_count: usize,
    pub tool_pomodoro_run_count: usize,
    pub tool_daily_stats_count: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BackupRestoreSafety {
    pub message_key: &'static str,
    pub message_args: Vec<String>,
    pub message: String,
    pub supported: bool,
}

impl BackupPayload {
    pub fn restore_safety(&self) -> BackupRestoreSafety {
        if self.version > CURRENT_BACKUP_VERSION {
            return BackupRestoreSafety {
                message_key: "backup.restore.versionTooNew",
                message_args: vec![self.version.to_string(), CURRENT_BACKUP_VERSION.to_string()],
                message: format!(
                    "Backup format version {} is newer than the supported version {}. Upgrade the app before restoring.",
                    self.version, CURRENT_BACKUP_VERSION
                ),
                supported: false,
            };
        }

        if self.version < CURRENT_BACKUP_VERSION {
            return BackupRestoreSafety {
                message_key: "backup.restore.versionTooOld",
                message_args: vec![self.version.to_string(), CURRENT_BACKUP_VERSION.to_string()],
                message: format!(
                    "Backup format version {} is older than the supported version {}. Restore it with 0.6.6 first, then export a current zip backup.",
                    self.version, CURRENT_BACKUP_VERSION
                ),
                supported: false,
            };
        }

        if self.meta.schema_version > CURRENT_BACKUP_SCHEMA_VERSION {
            return BackupRestoreSafety {
                message_key: "backup.restore.schemaTooNew",
                message_args: vec![
                    self.meta.schema_version.to_string(),
                    CURRENT_BACKUP_SCHEMA_VERSION.to_string(),
                ],
                message: format!(
                    "Backup schema version {} is newer than the supported version {}. Upgrade the app before restoring.",
                    self.meta.schema_version, CURRENT_BACKUP_SCHEMA_VERSION
                ),
                supported: false,
            };
        }

        BackupRestoreSafety {
            message_key: "backup.restore.supported",
            message_args: Vec::new(),
            message: "This backup can be restored by the current version.".to_string(),
            supported: true,
        }
    }

    pub fn preview(&self) -> BackupPreview {
        let restore_safety = self.restore_safety();

        BackupPreview {
            version: self.version,
            exported_at_ms: self.meta.exported_at_ms,
            schema_version: self.meta.schema_version,
            app_version: self.meta.app_version.clone(),
            restore_supported: restore_safety.supported,
            restore_message_key: restore_safety.message_key.to_string(),
            restore_message_args: restore_safety.message_args,
            restore_message: restore_safety.message,
            session_count: self.sessions.len(),
            title_sample_count: self.title_samples.len(),
            setting_count: self.settings.len(),
            icon_cache_count: self.icon_cache.len(),
            web_activity_segment_count: self.web_activity_segments.len(),
            tool_reminder_count: self.tool_reminders.len(),
            tool_timer_count: self.tool_timers.len(),
            tool_timer_lap_count: self.tool_timer_laps.len(),
            tool_pomodoro_run_count: self.tool_pomodoro_runs.len(),
            tool_daily_stats_count: self.tool_daily_stats.len(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BackupIconCache, BackupMeta, BackupPayload, BackupSession, BackupSetting,
        BackupTitleSample, CURRENT_BACKUP_SCHEMA_VERSION, CURRENT_BACKUP_VERSION,
    };

    fn sample_payload(version: u32, schema_version: u32) -> BackupPayload {
        BackupPayload {
            version,
            meta: BackupMeta {
                exported_at_ms: 1_717_171_717_000,
                schema_version,
                app_version: "0.3.0".to_string(),
            },
            sessions: vec![BackupSession {
                id: 1,
                app_name: "App".to_string(),
                exe_name: "app.exe".to_string(),
                window_title: Some("Window".to_string()),
                start_time: 10,
                end_time: Some(20),
                duration: Some(10),
                continuity_group_start_time: Some(10),
            }],
            title_samples: vec![BackupTitleSample {
                id: 1,
                session_id: 1,
                title: "Window".to_string(),
                start_time: 10,
                end_time: Some(20),
            }],
            settings: vec![BackupSetting {
                key: "k".to_string(),
                value: "v".to_string(),
            }],
            icon_cache: vec![BackupIconCache {
                exe_name: "app.exe".to_string(),
                icon_base64: "aWNvbg==".to_string(),
                last_updated: Some(30),
            }],
            web_activity_segments: Vec::new(),
            tool_reminders: Vec::new(),
            tool_timers: Vec::new(),
            tool_timer_laps: Vec::new(),
            tool_pomodoro_runs: Vec::new(),
            tool_daily_stats: Vec::new(),
        }
    }

    #[test]
    fn restore_safety_is_unsupported_when_backup_version_is_newer() {
        let payload = sample_payload(CURRENT_BACKUP_VERSION + 1, CURRENT_BACKUP_SCHEMA_VERSION);
        let restore_safety = payload.restore_safety();

        assert!(!restore_safety.supported);
        assert_eq!(restore_safety.message_key, "backup.restore.versionTooNew");
    }

    #[test]
    fn restore_safety_is_unsupported_when_backup_version_is_older() {
        let payload = sample_payload(CURRENT_BACKUP_VERSION.saturating_sub(1), 1);
        let restore_safety = payload.restore_safety();

        assert!(!restore_safety.supported);
        assert_eq!(restore_safety.message_key, "backup.restore.versionTooOld");
    }

    #[test]
    fn restore_safety_is_unsupported_when_schema_is_newer() {
        let payload = sample_payload(CURRENT_BACKUP_VERSION, CURRENT_BACKUP_SCHEMA_VERSION + 1);
        let restore_safety = payload.restore_safety();

        assert!(!restore_safety.supported);
        assert_eq!(restore_safety.message_key, "backup.restore.schemaTooNew");
    }

    #[test]
    fn preview_exposes_contract_counts_and_restore_fields() {
        let mut payload = sample_payload(CURRENT_BACKUP_VERSION, CURRENT_BACKUP_SCHEMA_VERSION);
        payload.sessions.push(BackupSession {
            id: 2,
            app_name: "App 2".to_string(),
            exe_name: "app2.exe".to_string(),
            window_title: None,
            start_time: 11,
            end_time: None,
            duration: None,
            continuity_group_start_time: Some(11),
        });

        let preview = payload.preview();
        assert!(preview.restore_supported);
        assert_eq!(preview.restore_message_key, "backup.restore.supported");
        assert_eq!(preview.session_count, 2);
        assert_eq!(preview.title_sample_count, 1);
        assert_eq!(preview.setting_count, 1);
        assert_eq!(preview.icon_cache_count, 1);
        assert_eq!(preview.tool_reminder_count, 0);
        assert_eq!(preview.tool_timer_count, 0);
    }
}
