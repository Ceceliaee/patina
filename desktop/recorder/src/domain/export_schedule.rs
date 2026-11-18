use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime, NaiveTime, Weekday};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const DEFAULT_EXPORT_LOCAL_TIME_MINUTES: u16 = 21 * 60;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScheduledExportCadence {
    Daily,
    Weekly,
}

impl ScheduledExportCadence {
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
            _ => Err("scheduled export cadence must be daily or weekly".to_string()),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ScheduledExportFormat {
    Csv,
    Markdown,
    Parquet,
    Sqlite,
}

impl ScheduledExportFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Markdown => "markdown",
            Self::Parquet => "parquet",
            Self::Sqlite => "sqlite",
        }
    }

    pub fn extension(self) -> &'static str {
        match self {
            Self::Csv => "csv",
            Self::Markdown => "md",
            Self::Parquet => "parquet",
            Self::Sqlite => "sqlite",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "csv" => Ok(Self::Csv),
            "markdown" => Ok(Self::Markdown),
            "parquet" => Ok(Self::Parquet),
            "sqlite" => Ok(Self::Sqlite),
            _ => Err("scheduled export format is unsupported".to_string()),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledExportConfigInput {
    pub enabled: bool,
    pub cadence: ScheduledExportCadence,
    pub weekday: Option<u8>,
    pub local_time_minutes: u16,
    pub target_dir: String,
    pub format: ScheduledExportFormat,
    pub selected_fields: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledExportConfig {
    pub enabled: bool,
    pub cadence: ScheduledExportCadence,
    pub weekday: Option<u8>,
    pub local_time_minutes: u16,
    pub target_dir: String,
    pub format: ScheduledExportFormat,
    pub selected_fields: Vec<String>,
    pub plan_generation: String,
    pub schedule_anchor_at_ms: i64,
    pub updated_at_ms: i64,
}

impl ScheduledExportConfigInput {
    pub fn validate_shape(&self) -> Result<(), String> {
        if self.local_time_minutes >= 24 * 60 {
            return Err("scheduled export time is outside the valid day".to_string());
        }
        if self.target_dir.trim().is_empty() {
            return Err("scheduled export directory cannot be empty".to_string());
        }
        match self.cadence {
            ScheduledExportCadence::Daily if self.weekday.is_some() => {
                return Err("daily scheduled export must not include a weekday".to_string());
            }
            ScheduledExportCadence::Weekly if !matches!(self.weekday, Some(1..=7)) => {
                return Err("weekly scheduled export requires a weekday from 1 to 7".to_string());
            }
            _ => {}
        }
        if self.selected_fields.is_empty() {
            return Err("scheduled export requires at least one field".to_string());
        }
        let mut seen = HashSet::new();
        if self
            .selected_fields
            .iter()
            .any(|field| field.trim().is_empty() || !seen.insert(field.as_str()))
        {
            return Err("scheduled export fields must be non-empty and unique".to_string());
        }
        Ok(())
    }
}

impl ScheduledExportConfig {
    pub fn validate_shape(&self) -> Result<(), String> {
        ScheduledExportConfigInput {
            enabled: self.enabled,
            cadence: self.cadence,
            weekday: self.weekday,
            local_time_minutes: self.local_time_minutes,
            target_dir: self.target_dir.clone(),
            format: self.format,
            selected_fields: self.selected_fields.clone(),
        }
        .validate_shape()?;
        if self.plan_generation.trim().is_empty() {
            return Err("scheduled export generation cannot be empty".to_string());
        }
        if self.schedule_anchor_at_ms < 0 || self.updated_at_ms < 0 {
            return Err("scheduled export timestamps cannot be negative".to_string());
        }
        Ok(())
    }

    pub fn materially_differs_from(&self, input: &ScheduledExportConfigInput) -> bool {
        self.cadence != input.cadence
            || self.weekday != input.weekday
            || self.local_time_minutes != input.local_time_minutes
            || self.target_dir != input.target_dir
            || self.format != input.format
            || self.selected_fields != input.selected_fields
            || (!self.enabled && input.enabled)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LogicalExportSlot {
    pub date: NaiveDate,
    pub local_time_minutes: u16,
}

impl LogicalExportSlot {
    pub fn local_datetime(self) -> NaiveDateTime {
        self.date.and_time(
            NaiveTime::from_num_seconds_from_midnight_opt(
                u32::from(self.local_time_minutes) * 60,
                0,
            )
            .expect("validated scheduled export time"),
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct LogicalExportPeriod {
    pub start_date: NaiveDate,
    pub end_date_exclusive: NaiveDate,
}

impl LogicalExportPeriod {
    pub fn start_key(self) -> String {
        self.start_date.format("%Y-%m-%d").to_string()
    }

    pub fn end_inclusive(self) -> NaiveDate {
        self.end_date_exclusive
            .pred_opt()
            .expect("scheduled export period is non-empty")
    }

    pub fn end_key(self) -> String {
        self.end_inclusive().format("%Y-%m-%d").to_string()
    }

    pub fn compact_file_stem(self) -> String {
        let start = self.start_date.format("%Y%m%d");
        if self.end_date_exclusive == self.start_date.succ_opt().expect("valid next date") {
            format!("Patina-scheduled-export-{start}")
        } else {
            format!(
                "Patina-scheduled-export-{start}-{}",
                self.end_inclusive().format("%Y%m%d")
            )
        }
    }

    pub fn run_key(self, generation: &str, cadence: ScheduledExportCadence) -> String {
        format!(
            "scheduled-export:{generation}:{}:{}:{}",
            cadence.as_str(),
            self.start_key(),
            self.end_key(),
        )
    }
}

pub fn period_for_slot(
    slot: LogicalExportSlot,
    cadence: ScheduledExportCadence,
) -> Option<LogicalExportPeriod> {
    match cadence {
        ScheduledExportCadence::Daily => {
            let start_date = slot.date.pred_opt()?;
            Some(LogicalExportPeriod {
                start_date,
                end_date_exclusive: slot.date,
            })
        }
        ScheduledExportCadence::Weekly => {
            let current_week_monday = slot.date.checked_sub_signed(Duration::days(i64::from(
                slot.date.weekday().num_days_from_monday(),
            )))?;
            let start_date = current_week_monday.checked_sub_signed(Duration::days(7))?;
            Some(LogicalExportPeriod {
                start_date,
                end_date_exclusive: current_week_monday,
            })
        }
    }
}

pub fn latest_due_slot(
    now_local: NaiveDateTime,
    anchor_local: NaiveDateTime,
    config: &ScheduledExportConfig,
) -> Option<LogicalExportSlot> {
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
    if config.cadence == ScheduledExportCadence::Weekly {
        let target = weekday_from_number(config.weekday?)?;
        let days_back =
            (date.weekday().num_days_from_monday() + 7 - target.num_days_from_monday()) % 7;
        date = date.checked_sub_signed(Duration::days(i64::from(days_back)))?;
    }
    let slot = LogicalExportSlot {
        date,
        local_time_minutes: config.local_time_minutes,
    };
    (slot.local_datetime() >= anchor_local).then_some(slot)
}

pub fn next_slot_after(
    now_local: NaiveDateTime,
    config: &ScheduledExportConfig,
) -> Option<LogicalExportSlot> {
    if !config.enabled {
        return None;
    }
    let time = NaiveTime::from_num_seconds_from_midnight_opt(
        u32::from(config.local_time_minutes) * 60,
        0,
    )?;
    let mut date = now_local.date();
    match config.cadence {
        ScheduledExportCadence::Daily => {
            if now_local.time() >= time {
                date = date.succ_opt()?;
            }
        }
        ScheduledExportCadence::Weekly => {
            let target = weekday_from_number(config.weekday?)?;
            let mut days_forward =
                (target.num_days_from_monday() + 7 - date.weekday().num_days_from_monday()) % 7;
            if days_forward == 0 && now_local.time() >= time {
                days_forward = 7;
            }
            date = date.checked_add_signed(Duration::days(i64::from(days_forward)))?;
        }
    }
    Some(LogicalExportSlot {
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledExportRun {
    pub run_key: String,
    pub plan_generation: String,
    pub cadence: ScheduledExportCadence,
    pub logical_start_date: String,
    pub logical_end_date: String,
    pub period_start_ms: i64,
    pub period_end_ms: i64,
    pub format: ScheduledExportFormat,
    pub selected_fields: Vec<String>,
    pub target_path: String,
    pub staging_path: Option<String>,
    pub phase: String,
    pub status: String,
    pub file_state: String,
    pub attempt_count: u8,
    pub retry_at_ms: Option<i64>,
    pub row_count: Option<u64>,
    pub size_bytes: Option<u64>,
    pub sha256: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub started_at_ms: i64,
    pub completed_at_ms: Option<i64>,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledExportSnapshot {
    pub config: ScheduledExportConfig,
    pub next_execution_at_ms: Option<i64>,
    pub recent_success: Option<ScheduledExportRun>,
    pub recent_failure: Option<ScheduledExportRun>,
    pub active_run: Option<ScheduledExportRun>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(cadence: ScheduledExportCadence, weekday: Option<u8>) -> ScheduledExportConfig {
        ScheduledExportConfig {
            enabled: true,
            cadence,
            weekday,
            local_time_minutes: 120,
            target_dir: "C:\\Exports".to_string(),
            format: ScheduledExportFormat::Csv,
            selected_fields: vec!["record_type".to_string()],
            plan_generation: "generation".to_string(),
            schedule_anchor_at_ms: 0,
            updated_at_ms: 0,
        }
    }

    #[test]
    fn daily_slot_exports_the_previous_complete_calendar_day() {
        let slot = LogicalExportSlot {
            date: NaiveDate::from_ymd_opt(2026, 8, 9).unwrap(),
            local_time_minutes: 120,
        };
        let period = period_for_slot(slot, ScheduledExportCadence::Daily).unwrap();
        assert_eq!(period.start_key(), "2026-08-08");
        assert_eq!(period.end_key(), "2026-08-08");
        assert_eq!(
            period.compact_file_stem(),
            "Patina-scheduled-export-20260808"
        );
    }

    #[test]
    fn weekly_slot_exports_the_previous_complete_iso_week() {
        let slot = LogicalExportSlot {
            date: NaiveDate::from_ymd_opt(2026, 8, 9).unwrap(),
            local_time_minutes: 120,
        };
        let period = period_for_slot(slot, ScheduledExportCadence::Weekly).unwrap();
        assert_eq!(period.start_key(), "2026-07-27");
        assert_eq!(period.end_key(), "2026-08-02");
        assert_eq!(
            period.compact_file_stem(),
            "Patina-scheduled-export-20260727-20260802"
        );
    }

    #[test]
    fn weekly_period_is_independent_of_the_selected_execution_weekday() {
        let monday = period_for_slot(
            LogicalExportSlot {
                date: NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
                local_time_minutes: 120,
            },
            ScheduledExportCadence::Weekly,
        )
        .unwrap();
        let friday = period_for_slot(
            LogicalExportSlot {
                date: NaiveDate::from_ymd_opt(2026, 8, 14).unwrap(),
                local_time_minutes: 120,
            },
            ScheduledExportCadence::Weekly,
        )
        .unwrap();
        assert_eq!(monday, friday);
        assert_eq!(monday.start_key(), "2026-08-03");
        assert_eq!(monday.end_key(), "2026-08-09");
    }

    #[test]
    fn latest_due_slot_never_backfills_before_the_anchor() {
        let now = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(15, 0, 0)
            .unwrap();
        assert!(latest_due_slot(now, now, &config(ScheduledExportCadence::Daily, None)).is_none());
    }

    #[test]
    fn weekly_schedule_selects_the_latest_requested_weekday() {
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
            &config(ScheduledExportCadence::Weekly, Some(5)),
        )
        .unwrap();
        assert_eq!(slot.date, NaiveDate::from_ymd_opt(2026, 8, 7).unwrap());
    }

    #[test]
    fn configuration_rejects_duplicates_and_invalid_weekdays() {
        let mut input = ScheduledExportConfigInput {
            enabled: true,
            cadence: ScheduledExportCadence::Weekly,
            weekday: Some(8),
            local_time_minutes: 120,
            target_dir: "C:\\Exports".to_string(),
            format: ScheduledExportFormat::Csv,
            selected_fields: vec!["record_type".to_string()],
        };
        assert!(input.validate_shape().is_err());
        input.weekday = Some(1);
        input.selected_fields.push("record_type".to_string());
        assert!(input.validate_shape().is_err());
    }

    #[test]
    fn run_key_has_no_internal_version_marker() {
        let period = LogicalExportPeriod {
            start_date: NaiveDate::from_ymd_opt(2026, 8, 3).unwrap(),
            end_date_exclusive: NaiveDate::from_ymd_opt(2026, 8, 10).unwrap(),
        };
        assert_eq!(
            period.run_key("generation", ScheduledExportCadence::Weekly),
            "scheduled-export:generation:weekly:2026-08-03:2026-08-09"
        );
    }

    #[test]
    fn calendar_periods_cross_leap_day_and_iso_year_without_losing_dates() {
        let leap_day = period_for_slot(
            LogicalExportSlot {
                date: NaiveDate::from_ymd_opt(2024, 3, 1).unwrap(),
                local_time_minutes: 120,
            },
            ScheduledExportCadence::Daily,
        )
        .unwrap();
        assert_eq!(leap_day.start_key(), "2024-02-29");
        assert_eq!(leap_day.end_key(), "2024-02-29");

        let cross_year_week = period_for_slot(
            LogicalExportSlot {
                date: NaiveDate::from_ymd_opt(2027, 1, 4).unwrap(),
                local_time_minutes: 120,
            },
            ScheduledExportCadence::Weekly,
        )
        .unwrap();
        assert_eq!(cross_year_week.start_key(), "2026-12-28");
        assert_eq!(cross_year_week.end_key(), "2027-01-03");
    }

    #[test]
    fn due_and_next_slots_are_stable_immediately_around_the_execution_minute() {
        let config = config(ScheduledExportCadence::Daily, None);
        let anchor = NaiveDate::from_ymd_opt(2026, 8, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap();
        let before = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(1, 59, 59)
            .unwrap();
        let exact = NaiveDate::from_ymd_opt(2026, 8, 9)
            .unwrap()
            .and_hms_opt(2, 0, 0)
            .unwrap();
        assert_eq!(
            latest_due_slot(before, anchor, &config).unwrap().date,
            NaiveDate::from_ymd_opt(2026, 8, 8).unwrap()
        );
        assert_eq!(
            latest_due_slot(exact, anchor, &config).unwrap().date,
            NaiveDate::from_ymd_opt(2026, 8, 9).unwrap()
        );
        assert_eq!(
            next_slot_after(before, &config).unwrap().date,
            NaiveDate::from_ymd_opt(2026, 8, 9).unwrap()
        );
        assert_eq!(
            next_slot_after(exact, &config).unwrap().date,
            NaiveDate::from_ymd_opt(2026, 8, 10).unwrap()
        );
    }
}
