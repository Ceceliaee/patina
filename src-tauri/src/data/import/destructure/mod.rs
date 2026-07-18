mod sqlite_source;
pub mod tai_csv;

use crate::data::import::canonical_csv::write_canonical_csv_atomic;
use crate::data::import::model::{
    CanonicalImportRecord, DestructureReportDto, ImportPreviewErrorDto, ImportRecordType,
    MAX_EXTERNAL_FILE_BYTES, MAX_PREVIEW_ERRORS,
};
use std::path::{Path, PathBuf};

pub async fn destructure_external_file(file_path: String) -> Result<DestructureReportDto, String> {
    let path = validate_external_path(&file_path)?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let conversion = match extension.as_str() {
        "csv" => convert_tai_csv(&path)?,
        "db" | "sqlite" => sqlite_source::convert_sqlite_source(&path).await?,
        _ => return Err("external data must be a CSV or SQLite database".to_string()),
    };
    if conversion.records.is_empty() {
        return Err("external data contains no importable records".to_string());
    }
    let output_path = write_canonical_csv_atomic(&path, &conversion.records)?;
    let exact_sessions = conversion
        .records
        .iter()
        .filter(|record| record.record_type == ImportRecordType::ExactSession)
        .count();
    let hour_buckets = conversion.records.len() - exact_sessions;
    Ok(DestructureReportDto {
        source_kind: conversion.source_kind,
        output_path: output_path.to_string_lossy().to_string(),
        records_written: conversion.records.len(),
        skipped_records: conversion.warnings.len(),
        exact_sessions,
        hour_buckets,
        warnings: conversion
            .warnings
            .into_iter()
            .take(MAX_PREVIEW_ERRORS)
            .map(|warning| ImportPreviewErrorDto {
                line: warning.line,
                message: warning.message,
            })
            .collect(),
    })
}

#[derive(Debug)]
pub(super) struct ExternalConversion {
    source_kind: String,
    records: Vec<CanonicalImportRecord>,
    warnings: Vec<ExternalWarning>,
}

#[derive(Debug)]
pub(super) struct ExternalWarning {
    line: usize,
    message: String,
}

fn convert_tai_csv(path: &Path) -> Result<ExternalConversion, String> {
    let conversion = tai_csv::convert_file(path)?;
    let records = conversion
        .rows
        .into_iter()
        .map(|row| CanonicalImportRecord {
            source_line: row.source_line,
            record_type: ImportRecordType::HourBucket,
            start_time_ms: row.hour_start_ms,
            end_time_ms: None,
            duration_ms: row.duration_ms,
            exe_name: row.exe_name,
            app_name: row.app_name,
            title: None,
            category: row.category,
        })
        .collect();
    Ok(ExternalConversion {
        source_kind: "tai-csv".to_string(),
        records,
        warnings: conversion
            .skipped
            .into_iter()
            .map(|skipped| ExternalWarning {
                line: skipped.line,
                message: skipped.reason,
            })
            .collect(),
    })
}

fn validate_external_path(file_path: &str) -> Result<PathBuf, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("external data path cannot be empty".to_string());
    }
    let path = PathBuf::from(trimmed);
    if !path.is_file() {
        return Err("external data path must be a regular file".to_string());
    }
    let file_size = path
        .metadata()
        .map_err(|error| format!("failed to inspect external data: {error}"))?
        .len();
    if file_size > MAX_EXTERNAL_FILE_BYTES {
        return Err(format!(
            "external data exceeds the {} MB safety limit",
            MAX_EXTERNAL_FILE_BYTES / 1024 / 1024
        ));
    }
    Ok(path)
}
