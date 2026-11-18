use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

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
    pub category: Option<String>,
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

pub use patina_activity_model::views::imports::*;

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
