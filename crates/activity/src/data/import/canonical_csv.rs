use crate::data::import::model::{
    CanonicalImportRecord, ImportRecordType, ImportRowError, ParsedCanonicalCsv, MAX_IMPORT_RECORDS,
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;

const UTF8_BOM: &[u8] = b"\xEF\xBB\xBF";
const REQUIRED_HEADERS: &[&str] = &[
    "record_type",
    "start_time",
    "end_time",
    "duration_ms",
    "exe_name",
    "app_name",
    "title",
    "category",
];

#[derive(Debug, Deserialize, Serialize)]
struct CanonicalCsvRow {
    record_type: ImportRecordType,
    start_time: String,
    end_time: String,
    duration_ms: String,
    exe_name: String,
    app_name: String,
    title: String,
    category: String,
}

pub fn parse_canonical_csv(bytes: &[u8]) -> Result<ParsedCanonicalCsv, String> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| "Patina CSV must be UTF-8 encoded".to_string())?;
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(false)
        .from_reader(text.as_bytes());
    let headers = reader
        .headers()
        .map_err(|error| format!("failed to read Patina CSV header: {error}"))?
        .clone();
    validate_headers(&headers)?;

    let mut parsed = ParsedCanonicalCsv::default();
    for (index, result) in reader.deserialize::<CanonicalCsvRow>().enumerate() {
        let line = index + 2;
        if parsed.records.len() + parsed.errors.len() >= MAX_IMPORT_RECORDS {
            return Err(format!(
                "Patina CSV exceeds the {MAX_IMPORT_RECORDS} record safety limit"
            ));
        }
        match result {
            Ok(row) => match validate_row(line, row) {
                Ok(record) => parsed.records.push(record),
                Err(message) => parsed.errors.push(ImportRowError { line, message }),
            },
            Err(error) => parsed.errors.push(ImportRowError {
                line,
                message: format!("CSV row could not be parsed: {error}"),
            }),
        }
    }
    Ok(parsed)
}

pub fn encode_canonical_csv(records: &[CanonicalImportRecord]) -> Result<Vec<u8>, String> {
    let mut writer = csv::WriterBuilder::new()
        .has_headers(true)
        .from_writer(Vec::new());
    for record in records {
        writer
            .serialize(to_csv_row(record)?)
            .map_err(|error| format!("failed to encode Patina CSV row: {error}"))?;
    }
    let csv_bytes = writer
        .into_inner()
        .map_err(|error| format!("failed to finish Patina CSV: {error}"))?;
    let mut bytes = Vec::with_capacity(UTF8_BOM.len() + csv_bytes.len());
    bytes.extend_from_slice(UTF8_BOM);
    bytes.extend_from_slice(&csv_bytes);
    Ok(bytes)
}

pub fn write_canonical_csv_atomic(
    source_path: &Path,
    records: &[CanonicalImportRecord],
) -> Result<std::path::PathBuf, String> {
    let output_path = sibling_output_path(source_path)?;
    if output_path.exists() {
        return Err(format!(
            "output file already exists: {}",
            output_path.display()
        ));
    }
    let bytes = encode_canonical_csv(records)?;
    let parent = output_path
        .parent()
        .ok_or_else(|| "source file has no parent directory".to_string())?;
    let file_name = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "output file name is not valid UTF-8".to_string())?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let temp_path = parent.join(format!(".{file_name}.{nonce}.tmp"));

    let result = (|| -> Result<(), String> {
        use std::io::Write;
        let mut file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp_path)
            .map_err(|error| format!("failed to create temporary output: {error}"))?;
        file.write_all(&bytes)
            .map_err(|error| format!("failed to write temporary output: {error}"))?;
        file.sync_all()
            .map_err(|error| format!("failed to flush temporary output: {error}"))?;
        drop(file);
        std::fs::rename(&temp_path, &output_path)
            .map_err(|error| format!("failed to publish Patina CSV: {error}"))?;
        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    result.map(|_| output_path)
}

fn validate_headers(headers: &csv::StringRecord) -> Result<(), String> {
    let actual = headers.iter().map(str::trim).collect::<Vec<_>>();
    if actual == REQUIRED_HEADERS {
        return Ok(());
    }
    Err(format!(
        "invalid Patina CSV columns; expected {}",
        REQUIRED_HEADERS.join(",")
    ))
}

fn validate_row(line: usize, row: CanonicalCsvRow) -> Result<CanonicalImportRecord, String> {
    let start_time_ms = parse_rfc3339(&row.start_time, "start_time")?;
    let duration_ms = row
        .duration_ms
        .trim()
        .parse::<i64>()
        .map_err(|_| "duration_ms must be an integer".to_string())?;
    if duration_ms <= 0 {
        return Err("duration_ms must be positive".to_string());
    }
    let end_time_ms = optional_text(&row.end_time)
        .map(|value| parse_rfc3339(&value, "end_time"))
        .transpose()?;

    match row.record_type {
        ImportRecordType::ExactSession => {
            let end = end_time_ms.ok_or_else(|| "exact_session requires end_time".to_string())?;
            if end <= start_time_ms {
                return Err("exact_session end_time must be after start_time".to_string());
            }
            let elapsed = end - start_time_ms;
            if elapsed.abs_diff(duration_ms) > 1_000 {
                return Err("exact_session duration_ms must match start_time/end_time".to_string());
            }
        }
        ImportRecordType::HourBucket => {
            if end_time_ms.is_some() {
                return Err("hour_bucket end_time must be empty".to_string());
            }
            if duration_ms > 3_600_000 {
                return Err("hour_bucket duration_ms cannot exceed one hour".to_string());
            }
            if optional_unprotected_text(&row.title).is_some() {
                return Err("hour_bucket title must be empty".to_string());
            }
        }
    }

    let exe_name = unprotect_spreadsheet_text(&row.exe_name)
        .trim()
        .to_ascii_lowercase();
    if exe_name.is_empty() || !exe_name.ends_with(".exe") {
        return Err("exe_name is required and must end with .exe".to_string());
    }

    Ok(CanonicalImportRecord {
        source_line: line,
        record_type: row.record_type,
        start_time_ms,
        end_time_ms,
        duration_ms,
        exe_name,
        app_name: optional_unprotected_text(&row.app_name),
        title: optional_unprotected_text(&row.title),
        category: optional_unprotected_text(&row.category),
    })
}

fn to_csv_row(record: &CanonicalImportRecord) -> Result<CanonicalCsvRow, String> {
    validate_record_for_output(record)?;
    Ok(CanonicalCsvRow {
        record_type: record.record_type,
        start_time: format_rfc3339(record.start_time_ms)?,
        end_time: record
            .end_time_ms
            .map(format_rfc3339)
            .transpose()?
            .unwrap_or_default(),
        duration_ms: record.duration_ms.to_string(),
        exe_name: protect_spreadsheet_text(&record.exe_name),
        app_name: protect_optional_text(record.app_name.as_deref()),
        title: protect_optional_text(record.title.as_deref()),
        category: protect_optional_text(record.category.as_deref()),
    })
}

fn validate_record_for_output(record: &CanonicalImportRecord) -> Result<(), String> {
    if record.duration_ms <= 0 {
        return Err("duration_ms must be positive".to_string());
    }
    if record.exe_name.trim().is_empty()
        || !record
            .exe_name
            .trim()
            .to_ascii_lowercase()
            .ends_with(".exe")
    {
        return Err("exe_name is required and must end with .exe".to_string());
    }
    match record.record_type {
        ImportRecordType::ExactSession => {
            let end = record
                .end_time_ms
                .ok_or_else(|| "exact_session requires end_time".to_string())?;
            if end <= record.start_time_ms
                || (end - record.start_time_ms).abs_diff(record.duration_ms) > 1_000
            {
                return Err("exact_session duration must match its time range".to_string());
            }
        }
        ImportRecordType::HourBucket => {
            if record.end_time_ms.is_some() || record.duration_ms > 3_600_000 {
                return Err(
                    "hour_bucket must have no end_time and cannot exceed one hour".to_string(),
                );
            }
            if record
                .title
                .as_deref()
                .is_some_and(|title| !title.trim().is_empty())
            {
                return Err("hour_bucket title must be empty".to_string());
            }
        }
    }
    Ok(())
}

fn parse_rfc3339(value: &str, field: &str) -> Result<i64, String> {
    DateTime::parse_from_rfc3339(value.trim())
        .map(|timestamp| timestamp.timestamp_millis())
        .map_err(|_| format!("{field} must be an RFC 3339 timestamp with an offset"))
}

fn format_rfc3339(timestamp_ms: i64) -> Result<String, String> {
    DateTime::<Utc>::from_timestamp_millis(timestamp_ms)
        .map(|timestamp| timestamp.to_rfc3339_opts(SecondsFormat::Millis, true))
        .ok_or_else(|| "timestamp is outside the supported range".to_string())
}

fn optional_text(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn optional_unprotected_text(value: &str) -> Option<String> {
    optional_text(&unprotect_spreadsheet_text(value))
}

fn protect_optional_text(value: Option<&str>) -> String {
    value.map(protect_spreadsheet_text).unwrap_or_default()
}

fn protect_spreadsheet_text(value: &str) -> String {
    if has_spreadsheet_formula_prefix(value) {
        format!("'{value}")
    } else {
        value.to_string()
    }
}

fn unprotect_spreadsheet_text(value: &str) -> String {
    if value.starts_with('\'') && has_spreadsheet_formula_prefix(&value[1..]) {
        value[1..].to_string()
    } else {
        value.to_string()
    }
}

fn has_spreadsheet_formula_prefix(value: &str) -> bool {
    matches!(
        value
            .trim_start_matches([' ', '\t', '\r', '\n'])
            .as_bytes()
            .first(),
        Some(b'=' | b'+' | b'-' | b'@')
    )
}

fn sibling_output_path(source_path: &Path) -> Result<std::path::PathBuf, String> {
    if !source_path.is_file() {
        return Err("source path must be a regular file".to_string());
    }
    let parent = source_path
        .parent()
        .ok_or_else(|| "source file has no parent directory".to_string())?;
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "source file name is not valid UTF-8".to_string())?;
    Ok(parent.join(format!("{stem}.patina.csv")))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exact_record() -> CanonicalImportRecord {
        CanonicalImportRecord {
            source_line: 2,
            record_type: ImportRecordType::ExactSession,
            start_time_ms: 1_767_268_800_000,
            end_time_ms: Some(1_767_268_860_000),
            duration_ms: 60_000,
            exe_name: "code.exe".to_string(),
            app_name: Some("Visual Studio Code".to_string()),
            title: Some("  =SUM(A1:A2)".to_string()),
            category: Some("开发".to_string()),
        }
    }

    #[test]
    fn canonical_csv_round_trips_exact_and_hour_records() {
        let mut bucket = exact_record();
        bucket.record_type = ImportRecordType::HourBucket;
        bucket.end_time_ms = None;
        bucket.title = None;
        let bytes = encode_canonical_csv(&[exact_record(), bucket.clone()]).unwrap();
        assert!(bytes.starts_with(UTF8_BOM));
        let text = String::from_utf8(bytes.clone()).unwrap();
        let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
        assert_eq!(
            text.lines().next(),
            Some("record_type,start_time,end_time,duration_ms,exe_name,app_name,title,category")
        );
        assert!(!text.contains("patina_version"));
        assert!(!text.lines().next().unwrap().contains("path"));
        assert!(!text.lines().next().unwrap().contains("source"));
        assert!(text.contains("'  =SUM(A1:A2)"));

        let parsed = parse_canonical_csv(&bytes).unwrap();
        assert!(parsed.errors.is_empty());
        assert_eq!(parsed.records.len(), 2);
        assert_eq!(parsed.records[0].title.as_deref(), Some("=SUM(A1:A2)"));
        assert_eq!(parsed.records[1].record_type, ImportRecordType::HourBucket);
        assert_eq!(parsed.records[1].end_time_ms, None);
    }

    #[test]
    fn rejects_missing_exact_end_and_hour_bucket_end() {
        let text = "record_type,start_time,end_time,duration_ms,exe_name,app_name,title,category\nexact_session,2026-01-01T00:00:00Z,,60000,a.exe,,,\nhour_bucket,2026-01-01T01:00:00Z,2026-01-01T01:01:00Z,60000,b.exe,,,";
        let parsed = parse_canonical_csv(text.as_bytes()).unwrap();
        assert!(parsed.records.is_empty());
        assert_eq!(parsed.errors.len(), 2);
    }

    #[test]
    fn rejects_non_executable_identity() {
        let text = "record_type,start_time,end_time,duration_ms,exe_name,app_name,title,category\nhour_bucket,2026-01-01T00:00:00Z,,60000,Chrome,,,";
        let parsed = parse_canonical_csv(text.as_bytes()).unwrap();
        assert!(parsed.records.is_empty());
        assert!(parsed.errors[0].message.contains("must end with .exe"));
    }

    #[test]
    fn rejects_the_removed_per_row_version_column() {
        let text = "patina_version,record_type,start_time,end_time,duration_ms,exe_name,app_name,title,category\n1,hour_bucket,2026-01-01T00:00:00Z,,60000,code.exe,,,";
        let error = parse_canonical_csv(text.as_bytes()).unwrap_err();
        assert!(error.contains("invalid Patina CSV columns"));
        assert!(!error.contains("patina_version"));
    }

    #[test]
    fn rejects_the_removed_path_and_source_columns() {
        let text = "record_type,start_time,end_time,duration_ms,exe_name,app_name,title,path,category,source\nhour_bucket,2026-01-01T00:00:00Z,,60000,code.exe,,,,,";
        let error = parse_canonical_csv(text.as_bytes()).unwrap_err();
        assert!(error.contains("invalid Patina CSV columns"));
        assert!(error.contains("title,category"));
    }

    #[test]
    fn rejects_hour_bucket_title_when_parsing_and_encoding() {
        let text = "record_type,start_time,end_time,duration_ms,exe_name,app_name,title,category\nhour_bucket,2026-01-01T00:00:00Z,,60000,code.exe,Code,Project,Development";
        let parsed = parse_canonical_csv(text.as_bytes()).unwrap();
        assert!(parsed.records.is_empty());
        assert_eq!(parsed.errors.len(), 1);
        assert!(parsed.errors[0]
            .message
            .contains("hour_bucket title must be empty"));

        let mut bucket = exact_record();
        bucket.record_type = ImportRecordType::HourBucket;
        bucket.end_time_ms = None;
        let error = encode_canonical_csv(&[bucket]).unwrap_err();
        assert!(error.contains("hour_bucket title must be empty"));
    }

    #[test]
    fn atomic_writer_preserves_source_and_refuses_existing_output() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory = std::env::temp_dir().join(format!("patina-import-writer-{nonce}"));
        std::fs::create_dir(&directory).unwrap();
        let source_path = directory.join("tai.csv");
        let source_bytes = b"source data stays unchanged";
        std::fs::write(&source_path, source_bytes).unwrap();

        let output_path = write_canonical_csv_atomic(&source_path, &[exact_record()]).unwrap();
        assert_eq!(std::fs::read(&source_path).unwrap(), source_bytes);
        assert!(output_path.is_file());
        assert!(std::fs::read(&output_path).unwrap().starts_with(UTF8_BOM));
        let error = write_canonical_csv_atomic(&source_path, &[exact_record()]).unwrap_err();
        assert!(error.contains("already exists"));
        assert_eq!(std::fs::read(&source_path).unwrap(), source_bytes);

        std::fs::remove_file(output_path).unwrap();
        std::fs::remove_file(source_path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
