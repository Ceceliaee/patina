use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigView {
    pub url: String,
    pub username: String,
    pub remote_dir: String,
    pub last_backup_at_ms: Option<i64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSnapshot {
    pub config: Option<ConfigView>,
    pub has_secret: bool,
    pub operation_id: Option<String>,
    pub cleanup_pending: bool,
    pub runtime_refresh_pending: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackupEntry {
    pub id: String,
    pub file_name: String,
    pub remote_path: String,
    pub created_at_ms: u64,
    pub size_bytes: u64,
    pub app_version: String,
    pub format_kind: String,
    pub backup_version: u32,
    pub schema_version: u32,
    pub session_count: usize,
    pub title_sample_count: usize,
    #[serde(default)]
    pub import_batch_count: usize,
    #[serde(default)]
    pub import_exact_session_count: usize,
    #[serde(default)]
    pub import_time_bucket_count: usize,
    pub setting_count: usize,
    pub icon_cache_count: usize,
    #[serde(default = "manual_origin")]
    pub origin: String,
    #[serde(default)]
    pub target_generation: Option<String>,
    #[serde(default)]
    pub run_key: Option<String>,
    #[serde(default)]
    pub archive_sha256: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, serde_json::Value>,
}

pub fn manual_origin() -> String {
    "manual".to_string()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBackupUploadResult {
    pub entry: RemoteBackupEntry,
    pub index_updated: bool,
    pub index_message: Option<String>,
}
