use crate::Release;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    Idle,
    Checking,
    Current,
    Available,
    Downloading,
    Ready,
    Installing,
    Failed,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum Request {
    Status,
    Check,
    Download,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snapshot {
    pub installed_version: String,
    pub phase: Phase,
    pub release: Option<Release>,
    #[serde(rename = "received")]
    pub received_bytes: u64,
    pub error: Option<String>,
}

impl Snapshot {
    pub fn idle(installed_version: &str) -> Self {
        Self {
            installed_version: installed_version.to_owned(),
            phase: Phase::Idle,
            release: None,
            received_bytes: 0,
            error: None,
        }
    }
}
