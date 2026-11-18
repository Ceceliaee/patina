use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreviewErrorDto {
    pub line: usize,
    pub message: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCategoryCandidateDto {
    pub exe_name: String,
    pub categories: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ImportClassificationMutation {
    pub key: String,
    pub value: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
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
    pub category_candidates: Vec<ImportCategoryCandidateDto>,
    pub errors: Vec<ImportPreviewErrorDto>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCommitReportDto {
    pub batch_id: Option<String>,
    pub imported_records: usize,
    pub duplicate_records: usize,
    pub error_records: usize,
    pub exact_sessions: usize,
    pub hour_buckets: usize,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
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

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportDeleteReportDto {
    pub deleted_exact_sessions: i64,
    pub deleted_hour_buckets: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
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
