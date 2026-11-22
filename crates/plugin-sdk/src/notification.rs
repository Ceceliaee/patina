use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum NoticeTarget {
    Timer,
    Reminder(i64),
    Usage(i64),
    Focus {
        kind: String,
        id: i64,
        revision: i64,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NoticeContext {
    pub target: NoticeTarget,
    pub label: String,
    pub at_ms: i64,
    pub local_time: String,
}

/// Direct actions occupy the footer. A choice group opens a second step before dispatch.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NoticeContent {
    pub title: String,
    pub detail: String,
    pub actions: Vec<(String, String)>,
    pub choices: Option<NoticeChoices>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct NoticeChoices {
    pub label: String,
    pub options: Vec<(String, String)>,
}

impl NoticeContent {
    pub fn offers(&self, action: &str) -> bool {
        self.actions
            .iter()
            .chain(self.choices.iter().flat_map(|c| &c.options))
            .any(|(id, _)| id == action)
    }
}
