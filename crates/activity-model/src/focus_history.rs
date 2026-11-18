use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FocusKind {
    Pomodoro,
    Free,
}

impl FocusKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pomodoro => "pomodoro",
            Self::Free => "free",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusSpan {
    pub phase: String,
    pub cycle: i64,
    pub rounds: i64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub phase_finished_at: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusGroup {
    pub key: String,
    pub started_at: i64,
    pub outcome: String,
    pub spans: Vec<FocusSpan>,
}
