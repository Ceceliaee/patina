use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const CANONICAL_CSV_VERSION: u32 = 1;
pub const MAX_IMPORT_FILE_BYTES: u64 = 128 * 1024 * 1024;
pub const MAX_EXTERNAL_FILE_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_IMPORT_RECORDS: usize = 250_000;
pub const MAX_PREVIEW_ERRORS: usize = 12;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportRecordType {
    ExactSession,
    HourBucket,
}

impl ImportRecordType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ExactSession => "exact_session",
            Self::HourBucket => "hour_bucket",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CanonicalImportRecord {
    pub source_line: usize,
    pub record_type: ImportRecordType,
    pub start_time_ms: i64,
    pub end_time_ms: Option<i64>,
    pub duration_ms: i64,
    pub exe_name: String,
    pub app_name: Option<String>,
    pub title: Option<String>,
    pub path: Option<String>,
    pub category: Option<String>,
    pub source: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportRowError {
    pub line: usize,
    pub message: String,
}

#[derive(Clone, Debug, Default)]
pub struct ParsedCanonicalCsv {
    pub records: Vec<CanonicalImportRecord>,
    pub errors: Vec<ImportRowError>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewErrorDto {
    pub line: usize,
    pub message: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewDto {
    pub file_path: String,
    pub file_name: String,
    pub file_fingerprint: String,
    pub valid_records: usize,
    pub duplicate_records: usize,
    pub error_records: usize,
    pub exact_sessions: usize,
    pub hour_buckets: usize,
    pub errors: Vec<ImportPreviewErrorDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitReportDto {
    pub batch_id: Option<String>,
    pub imported_records: usize,
    pub duplicate_records: usize,
    pub error_records: usize,
    pub exact_sessions: usize,
    pub hour_buckets: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportBatchDto {
    pub id: String,
    pub imported_at: i64,
    pub source_name: String,
    pub source_kind: String,
    pub exact_sessions: i64,
    pub hour_buckets: i64,
    pub total_records: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDeleteReportDto {
    pub deleted_exact_sessions: i64,
    pub deleted_hour_buckets: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DestructureReportDto {
    pub source_kind: String,
    pub output_path: String,
    pub records_written: usize,
    pub skipped_records: usize,
    pub exact_sessions: usize,
    pub hour_buckets: usize,
    pub warnings: Vec<ImportPreviewErrorDto>,
}

pub(crate) fn record_fingerprint(record: &CanonicalImportRecord) -> String {
    let mut digest = Sha256::new();
    for value in [
        record.record_type.as_str().to_string(),
        record.start_time_ms.to_string(),
        record
            .end_time_ms
            .map(|value| value.to_string())
            .unwrap_or_default(),
        record.duration_ms.to_string(),
        record.exe_name.trim().to_ascii_lowercase(),
        record.title.as_deref().unwrap_or("").trim().to_string(),
    ] {
        digest.update((value.len() as u64).to_le_bytes());
        digest.update(value.as_bytes());
    }
    format!("{:x}", digest.finalize())
}
