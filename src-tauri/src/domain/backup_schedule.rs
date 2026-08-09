use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, Weekday};
use serde::{Deserialize, Serialize};

pub const DEFAULT_LOCAL_TIME_MINUTES: u16 = 2 * 60;
pub(crate) const SCHEDULED_BACKUP_KEEP_COUNT: u8 = 1;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScheduledBackupCadence {
    Daily,
    Weekly,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum ScheduledBackupTargetInput {
    #[serde(rename = "local")]
    Local { target_dir: String },
    #[serde(rename = "webdav")]
    WebDav,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all_fields = "camelCase")]
pub enum ScheduledBackupTarget {
    #[serde(rename = "local")]
    Local { target_dir: String },
    #[serde(rename = "webdav")]
    WebDav { target_identity: String },
}

impl ScheduledBackupTargetInput {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Local { target_dir } if target_dir.trim().is_empty() => {
                Err("scheduled backup directory cannot be empty".to_string())
            }
            _ => Ok(()),
        }
    }
}

impl ScheduledBackupTarget {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Local { target_dir } if target_dir.trim().is_empty() => {
                Err("scheduled backup directory cannot be empty".to_string())
            }
            Self::WebDav { target_identity } if target_identity.trim().is_empty() => {
                Err("scheduled WebDAV backup target identity cannot be empty".to_string())
            }
            _ => Ok(()),
        }
    }

    pub fn kind(&self) -> &'static str {
        match self {
            Self::Local { .. } => "local",
            Self::WebDav { .. } => "webdav",
        }
    }

    pub fn target_identity(&self) -> Option<&str> {
        match self {
            Self::Local { .. } => None,
            Self::WebDav { target_identity } => Some(target_identity),
        }
    }

    pub fn local_target_dir(&self) -> Option<&str> {
        match self {
            Self::Local { target_dir } => Some(target_dir),
            Self::WebDav { .. } => None,
        }
    }
}

impl ScheduledBackupCadence {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Daily => "daily",
            Self::Weekly => "weekly",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "daily" => Ok(Self::Daily),
            "weekly" => Ok(Self::Weekly),
            _ => Err("scheduled backup cadence must be daily or weekly".to_string()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledBackupConfigInput {
    pub enabled: bool,
    pub cadence: ScheduledBackupCadence,
    pub weekday: Option<u8>,
    pub local_time_minutes: u16,
    pub target: ScheduledBackupTargetInput,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledBackupConfig {
    pub enabled: bool,
    pub cadence: ScheduledBackupCadence,
    pub weekday: Option<u8>,
    pub local_time_minutes: u16,
    pub target: ScheduledBackupTarget,
    pub target_generation: String,
    pub schedule_anchor_at_ms: i64,
    pub updated_at_ms: i64,
}

impl ScheduledBackupConfigInput {
    pub fn validate(&self) -> Result<(), String> {
        if self.local_time_minutes >= 24 * 60 {
            return Err("scheduled backup time is outside the valid day".to_string());
        }
        self.target.validate()?;
        if self.cadence == ScheduledBackupCadence::Weekly {
            if !matches!(self.weekday, Some(1..=7)) {
                return Err("weekly scheduled backup requires a weekday from 1 to 7".to_string());
            }
        } else if self.weekday.is_some() {
            return Err("daily scheduled backup must not include a weekday".to_string());
        }
        Ok(())
    }
}

impl ScheduledBackupConfig {
    pub fn validate(&self) -> Result<(), String> {
        ScheduledBackupConfigInput {
            enabled: self.enabled,
            cadence: self.cadence,
            weekday: self.weekday,
            local_time_minutes: self.local_time_minutes,
            target: match &self.target {
                ScheduledBackupTarget::Local { target_dir } => ScheduledBackupTargetInput::Local {
                    target_dir: target_dir.clone(),
                },
                ScheduledBackupTarget::WebDav { .. } => ScheduledBackupTargetInput::WebDav,
            },
        }
        .validate()?;
        self.target.validate()?;
        if self.target_generation.trim().is_empty() {
            return Err("scheduled backup target generation cannot be empty".to_string());
        }
        if self.schedule_anchor_at_ms < 0 || self.updated_at_ms < 0 {
            return Err("scheduled backup timestamps cannot be negative".to_string());
        }
        Ok(())
    }

    pub fn schedule_changed_from(&self, input: &ScheduledBackupConfigInput) -> bool {
        self.cadence != input.cadence
            || self.weekday != input.weekday
            || self.local_time_minutes != input.local_time_minutes
            || (!self.enabled && input.enabled)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledBackupRun {
    pub run_key: String,
    pub target_generation: String,
    pub target_kind: String,
    pub logical_date: String,
    pub logical_time_minutes: u16,
    pub target_path: String,
    pub staging_path: Option<String>,
    pub phase: String,
    pub remote_etag: Option<String>,
    pub status: String,
    pub file_state: String,
    pub attempt_count: u8,
    pub retry_at_ms: Option<i64>,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub archive_sha256: Option<String>,
    pub size_bytes: Option<u64>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub cleanup_warning: Option<String>,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledBackupSnapshot {
    pub config: ScheduledBackupConfig,
    pub next_execution_at_ms: Option<i64>,
    pub recent_success: Option<ScheduledBackupRun>,
    pub recent_failure: Option<ScheduledBackupRun>,
    pub active_run: Option<ScheduledBackupRun>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LogicalBackupSlot {
    pub date: NaiveDate,
    pub local_time_minutes: u16,
}

impl LogicalBackupSlot {
    pub fn local_datetime(self) -> NaiveDateTime {
        self.date.and_time(
            NaiveTime::from_num_seconds_from_midnight_opt(
                u32::from(self.local_time_minutes) * 60,
                0,
            )
            .expect("validated scheduled backup time"),
        )
    }

    pub fn date_key(self) -> String {
        self.date.format("%Y-%m-%d").to_string()
    }

    pub fn run_key(self, generation: &str) -> String {
        let hours = self.local_time_minutes / 60;
        let minutes = self.local_time_minutes % 60;
        format!(
            "scheduled-backup:{generation}:{}:{hours:02}{minutes:02}",
            self.date_key(),
        )
    }
}

pub fn latest_due_slot(
    now_local: NaiveDateTime,
    anchor_local: NaiveDateTime,
    config: &ScheduledBackupConfig,
) -> Option<LogicalBackupSlot> {
    if !config.enabled || now_local < anchor_local {
        return None;
    }
    let time = NaiveTime::from_num_seconds_from_midnight_opt(
        u32::from(config.local_time_minutes) * 60,
        0,
    )?;
    let mut date = now_local.date();
    if now_local.time() < time {
        date = date.pred_opt()?;
    }
    if config.cadence == ScheduledBackupCadence::Weekly {
        let target = weekday_from_number(config.weekday?)?;
        let days_back =
            (date.weekday().num_days_from_monday() + 7 - target.num_days_from_monday()) % 7;
        date = date.checked_sub_signed(Duration::days(i64::from(days_back)))?;
    }
    let slot = LogicalBackupSlot {
        date,
        local_time_minutes: config.local_time_minutes,
    };
    (slot.local_datetime() >= anchor_local).then_some(slot)
}

pub fn next_slot_after(
    now_local: NaiveDateTime,
    config: &ScheduledBackupConfig,
) -> Option<LogicalBackupSlot> {
    if !config.enabled {
        return None;
    }
    let time = NaiveTime::from_num_seconds_from_midnight_opt(
        u32::from(config.local_time_minutes) * 60,
        0,
    )?;
    let mut date = now_local.date();
    if config.cadence == ScheduledBackupCadence::Daily {
        if now_local.time() >= time {
            date = date.succ_opt()?;
        }
    } else {
        let target = weekday_from_number(config.weekday?)?;
        let mut days_forward =
            (target.num_days_from_monday() + 7 - date.weekday().num_days_from_monday()) % 7;
        if days_forward == 0 && now_local.time() >= time {
            days_forward = 7;
        }
        date = date.checked_add_signed(Duration::days(i64::from(days_forward)))?;
    }
    Some(LogicalBackupSlot {
        date,
        local_time_minutes: config.local_time_minutes,
    })
}

fn weekday_from_number(value: u8) -> Option<Weekday> {
    match value {
        1 => Some(Weekday::Mon),
        2 => Some(Weekday::Tue),
        3 => Some(Weekday::Wed),
        4 => Some(Weekday::Thu),
        5 => Some(Weekday::Fri),
        6 => Some(Weekday::Sat),
        7 => Some(Weekday::Sun),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(cadence: ScheduledBackupCadence, weekday: Option<u8>) -> ScheduledBackupConfig {
        ScheduledBackupConfig {
            enabled: true,
            cadence,
            weekday,
            local_time_minutes: 120,
            target: ScheduledBackupTarget::Local {
                target_dir: "C:\\Backups".to_string(),
            },
            target_generation: "generation".to_string(),
            schedule_anchor_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn daily_schedule_returns_only_the_latest_due_slot() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let anchor = NaiveDate::from_ymd_opt(2026, 8, 1)
            .unwrap()
            .and_hms_opt(12, 0, 0)
            .unwrap();
        assert_eq!(
            latest_due_slot(now, anchor, &config(ScheduledBackupCadence::Daily, None))
                .unwrap()
                .date,
            NaiveDate::from_ymd_opt(2026, 8, 9).unwrap()
        );
    }

    #[test]
    fn enabling_after_todays_time_does_not_backfill_before_anchor() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(15, 0, 0)
            .unwrap();
        assert!(latest_due_slot(now, now, &config(ScheduledBackupCadence::Daily, None)).is_none());
    }

    #[test]
    fn weekly_schedule_selects_the_latest_matching_weekday() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(9, 0, 0)
            .unwrap();
        let anchor = NaiveDate::from_ymd_opt(2026, 7, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let slot = latest_due_slot(
            now,
            anchor,
            &config(ScheduledBackupCadence::Weekly, Some(5)),
        )
        .unwrap();
        assert_eq!(slot.date, NaiveDate::from_ymd_opt(2026, 8, 7).unwrap());
    }

    #[test]
    fn validation_accepts_a_complete_daily_schedule() {
        let input = ScheduledBackupConfigInput {
            enabled: true,
            cadence: ScheduledBackupCadence::Daily,
            weekday: None,
            local_time_minutes: 120,
            target: ScheduledBackupTargetInput::Local {
                target_dir: "C:\\Backups".to_string(),
            },
        };
        assert!(input.validate().is_ok());
    }

    #[test]
    fn run_key_uses_local_hour_and_minute_without_an_internal_version() {
        let slot = LogicalBackupSlot {
            date: NaiveDate::from_ymd_opt(2026, 8, 9).unwrap(),
            local_time_minutes: 125,
        };
        assert_eq!(
            slot.run_key("generation"),
            "scheduled-backup:generation:2026-08-09:0205"
        );
    }

    #[test]
    fn target_input_is_explicit_and_mutually_exclusive() {
        assert!(ScheduledBackupTargetInput::WebDav.validate().is_ok());
        assert!(ScheduledBackupTargetInput::Local {
            target_dir: " ".to_string(),
        }
        .validate()
        .is_err());

        let encoded = serde_json::to_value(ScheduledBackupTargetInput::Local {
            target_dir: "C:\\Backups".to_string(),
        })
        .unwrap();
        assert_eq!(encoded["kind"], "local");
        assert_eq!(encoded["targetDir"], "C:\\Backups");
        assert!(encoded.get("targetIdentity").is_none());
    }

    #[test]
    fn persisted_webdav_target_requires_a_non_secret_identity() {
        assert!(ScheduledBackupTarget::WebDav {
            target_identity: String::new(),
        }
        .validate()
        .is_err());
        assert!(ScheduledBackupTarget::WebDav {
            target_identity: "sha256:opaque".to_string(),
        }
        .validate()
        .is_ok());
    }
}
