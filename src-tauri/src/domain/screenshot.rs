use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotSettings {
    pub enabled: bool,
    pub interval_secs: u64,
    pub retention_days: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotEntry {
    pub id: i64,
    pub captured_at: i64,
    pub width: u32,
    pub height: u32,
    pub thumbnail_base64: String,
    pub session_id: Option<i64>,
    pub active_url: Option<String>,
    pub active_normalized_domain: Option<String>,
}
