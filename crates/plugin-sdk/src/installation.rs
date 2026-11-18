use super::Manifest;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Installed {
    pub manifest: Manifest,
    pub generation: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Preview {
    pub manifest: Manifest,
    pub digest: String,
    pub replaces: Option<String>,
    pub publisher: String,
}

pub fn now_ms() -> i64 {
    std::time::UNIX_EPOCH
        .elapsed()
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
