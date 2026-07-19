//! Tai `时段.csv` parsing.
//!
//! Tai exports hourly aggregate facts. This module deliberately preserves that
//! granularity and never reconstructs ordered sessions inside an hour.

use crate::data::import::model::MAX_EXTERNAL_FILE_BYTES;
use chrono::{Local, NaiveDate, TimeZone};
use std::path::Path;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaiCsvSkipReason {
    pub line: usize,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaiHourRow {
    pub source_line: usize,
    pub hour_start_ms: i64,
    pub duration_ms: i64,
    pub exe_name: String,
    pub app_name: Option<String>,
    pub category: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct TaiCsvConversion {
    pub rows_parsed: usize,
    pub rows: Vec<TaiHourRow>,
    pub skipped: Vec<TaiCsvSkipReason>,
}

fn convert_tai_text(csv_text: &str) -> Result<TaiCsvConversion, String> {
    let text = csv_text.strip_prefix('\u{feff}').unwrap_or(csv_text);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(text.as_bytes());
    let headers = reader
        .headers()
        .map_err(|error| format!("failed to read Tai CSV header: {error}"))?
        .to_owned();

    for required in ["时段", "应用", "时长"] {
        if !headers.iter().any(|header| header.trim() == required) {
            return Err(format!(
                "not a valid Tai 时段.csv: missing required column {required:?}"
            ));
        }
    }

    let mut conversion = TaiCsvConversion::default();
    let mut data_line = 1usize;

    for result in reader.records() {
        data_line += 1;
        let record = match result {
            Ok(record) => record,
            Err(_) => {
                conversion.rows_parsed += 1;
                conversion.skipped.push(TaiCsvSkipReason {
                    line: data_line,
                    reason: "csv parse error".to_string(),
                });
                continue;
            }
        };

        if record.is_empty() || record.iter().all(|field| field.trim().is_empty()) {
            continue;
        }
        conversion.rows_parsed += 1;

        let timestamp = cell(&headers, &record, "时段");
        let hour_start_ms = match parse_hour_start_ms(timestamp) {
            Some(value) => value,
            None => {
                conversion.skipped.push(TaiCsvSkipReason {
                    line: data_line,
                    reason: format!("unparseable 时段: {timestamp:?}"),
                });
                continue;
            }
        };

        let raw_app = cell(&headers, &record, "应用");
        let exe_name = normalize_exe_name(raw_app);
        if exe_name.is_empty() {
            conversion.skipped.push(TaiCsvSkipReason {
                line: data_line,
                reason: "empty 应用".to_string(),
            });
            continue;
        }

        let raw_duration = cell(&headers, &record, "时长");
        let duration_seconds = match raw_duration.parse::<i64>() {
            Ok(value) if value > 0 && value <= 3_600 => value,
            _ => {
                conversion.skipped.push(TaiCsvSkipReason {
                    line: data_line,
                    reason: format!("invalid or over-one-hour 时长: {raw_duration:?}"),
                });
                continue;
            }
        };
        let Some(duration_ms) = duration_seconds.checked_mul(1_000) else {
            conversion.skipped.push(TaiCsvSkipReason {
                line: data_line,
                reason: format!("overflowing 时长: {raw_duration:?}"),
            });
            continue;
        };

        conversion.rows.push(TaiHourRow {
            source_line: data_line,
            hour_start_ms,
            duration_ms,
            exe_name,
            app_name: optional_cell(&headers, &record, "描述").or_else(|| optional_text(raw_app)),
            category: optional_cell(&headers, &record, "分类").filter(|value| value != "未知"),
        });
    }

    Ok(conversion)
}

pub(super) fn convert_tai_file(path: &Path) -> Result<TaiCsvConversion, String> {
    let bytes = std::fs::read(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    if bytes.len() as u64 > MAX_EXTERNAL_FILE_BYTES {
        return Err(format!(
            "external data exceeds the {} MB safety limit",
            MAX_EXTERNAL_FILE_BYTES / 1024 / 1024
        ));
    }
    let text =
        std::str::from_utf8(&bytes).map_err(|_| "Tai CSV must be UTF-8 encoded".to_string())?;
    convert_tai_text(text)
}

fn cell<'a>(headers: &csv::StringRecord, record: &'a csv::StringRecord, column: &str) -> &'a str {
    headers
        .iter()
        .position(|header| header.trim() == column)
        .and_then(|index| record.get(index))
        .map(str::trim)
        .unwrap_or("")
}

fn optional_cell(
    headers: &csv::StringRecord,
    record: &csv::StringRecord,
    column: &str,
) -> Option<String> {
    optional_text(cell(headers, record, column))
}

fn optional_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn parse_hour_start_ms(value: &str) -> Option<i64> {
    let mut parts = value.split_whitespace();
    let date = parts.next()?;
    let time = parts.next()?;
    if parts.next().is_some() {
        return None;
    }

    let date_parts = date.split('/').collect::<Vec<_>>();
    let time_parts = time.split(':').collect::<Vec<_>>();
    if date_parts.len() != 3
        || date_parts[2].len() != 4
        || time_parts.len() != 3
        || time_parts[1].len() != 2
        || time_parts[2].len() != 2
    {
        return None;
    }

    let month = date_parts[0].parse::<u32>().ok()?;
    let day = date_parts[1].parse::<u32>().ok()?;
    let year = date_parts[2].parse::<i32>().ok()?;
    let hour = time_parts[0].parse::<u32>().ok()?;
    let minute = time_parts[1].parse::<u32>().ok()?;
    let second = time_parts[2].parse::<u32>().ok()?;
    let naive = NaiveDate::from_ymd_opt(year, month, day)?.and_hms_opt(hour, minute, second)?;
    Local
        .from_local_datetime(&naive)
        .single()
        .map(|timestamp| timestamp.timestamp_millis())
}

fn normalize_exe_name(value: &str) -> String {
    let mut normalized = value.trim().trim_matches('"').to_ascii_lowercase();
    if !normalized.is_empty() && !normalized.ends_with(".exe") {
        normalized.push_str(".exe");
    }
    normalized
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "时段,应用,时长,描述,分类\n";

    #[test]
    fn parses_hourly_fact_without_reconstructing_a_session() {
        let csv = format!("{HEADER}01/15/2026 09:00:00,Chrome.EXE,1800,Chrome,网络");
        let conversion = convert_tai_text(&csv).unwrap();

        assert_eq!(conversion.rows_parsed, 1);
        assert!(conversion.skipped.is_empty());
        assert_eq!(conversion.rows.len(), 1);
        assert_eq!(conversion.rows[0].duration_ms, 1_800_000);
        assert_eq!(conversion.rows[0].exe_name, "chrome.exe");
        assert_eq!(conversion.rows[0].app_name.as_deref(), Some("Chrome"));
        assert_eq!(conversion.rows[0].category.as_deref(), Some("网络"));
    }

    #[test]
    fn rejects_non_tai_csv_missing_required_columns() {
        let error = convert_tai_text("date,name,total\n2026-01-15,Chrome,10").unwrap_err();
        assert!(error.contains("not a valid Tai 时段.csv"));
        assert!(error.contains("时段"));
    }

    #[test]
    fn skips_invalid_rows_and_preserves_valid_rows() {
        let csv = format!(
            "{HEADER}bad,a,10,A,X\n01/15/2026 10:00:00,,10,B,Y\n01/15/2026 11:00:00,b,0,C,Z\n01/15/2026 12:00:00,c,30,D,未知"
        );
        let conversion = convert_tai_text(&csv).unwrap();

        assert_eq!(conversion.rows_parsed, 4);
        assert_eq!(conversion.rows.len(), 1);
        assert_eq!(conversion.skipped.len(), 3);
        assert_eq!(conversion.rows[0].exe_name, "c.exe");
        assert_eq!(conversion.rows[0].category, None);
    }

    #[test]
    fn strips_utf8_bom_and_ignores_blank_rows() {
        let csv =
            format!("\u{feff}{HEADER}\n01/15/2026 09:00:00,Code,60,Visual Studio Code,开发\n");
        let conversion = convert_tai_text(&csv).unwrap();

        assert_eq!(conversion.rows_parsed, 1);
        assert_eq!(conversion.rows.len(), 1);
        assert_eq!(conversion.rows[0].exe_name, "code.exe");
    }

    #[test]
    fn rejects_fractional_negative_and_overflowing_duration() {
        let csv = format!(
            "{HEADER}01/15/2026 09:00:00,a,3.5,A,X\n01/15/2026 10:00:00,b,-5,B,Y\n01/15/2026 11:00:00,c,9223372036854775807,C,Z"
        );
        let conversion = convert_tai_text(&csv).unwrap();

        assert!(conversion.rows.is_empty());
        assert_eq!(conversion.skipped.len(), 3);
    }

    #[test]
    fn keeps_multiple_rows_in_the_same_hour_as_independent_aggregate_facts() {
        let csv = format!("{HEADER}01/15/2026 09:00:00,a,2400,A,X\n01/15/2026 09:00:00,b,2400,B,X");
        let conversion = convert_tai_text(&csv).unwrap();

        assert_eq!(conversion.rows.len(), 2);
        assert_eq!(
            conversion.rows[0].hour_start_ms,
            conversion.rows[1].hour_start_ms
        );
        assert_eq!(conversion.rows[0].duration_ms, 2_400_000);
        assert_eq!(conversion.rows[1].duration_ms, 2_400_000);
    }
}
