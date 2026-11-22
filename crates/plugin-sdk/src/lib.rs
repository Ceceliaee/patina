#[cfg(not(target_arch = "wasm32"))]
pub mod installation;

pub mod layout;
pub mod notification;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api: u32,
    pub entry: String,
    pub capabilities: Vec<Capability>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presentation: Option<Presentation>,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Presentation {
    pub names: std::collections::BTreeMap<String, String>,
    pub order: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Capability {
    Panel,
    Timer,
    Focus,
    Reminders,
}

pub type Messages = std::collections::BTreeMap<String, String>;

#[derive(Debug, Deserialize, Serialize)]
pub struct Request {
    pub state: Value,
    pub event: Event,
    pub locale: String,
    #[serde(default, skip_serializing_if = "Messages::is_empty")]
    pub messages: Messages,
    pub now_ms: i64,
    #[serde(default)]
    pub data: Value,
}

impl Request {
    pub fn text(&self, key: &str) -> String {
        self.messages
            .get(key)
            .map(String::as_str)
            .unwrap_or(key)
            .into()
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Event {
    Open,
    SelectTab(String),
    Action(String),
    Submit {
        id: String,
        fields: std::collections::BTreeMap<String, String>,
    },
    Due,
    Notification {
        notice: notification::NoticeContext,
        action: Option<String>,
    },
    Uninstall,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Response {
    pub state: Value,
    pub panel: Vec<Control>,
    #[serde(default)]
    pub timer: Option<Timer>,
    #[serde(default)]
    pub command: Option<Value>,
    #[serde(default)]
    pub reload: bool,
}

/// The host persists the next wake-up together with the plugin's state.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Timer {
    pub at_ms: i64,
    pub label: String,
    #[serde(default)]
    pub task: Option<(String, i64)>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum RowClock {
    Duration(i64),
    Until(i64),
    Since(i64),
}

impl RowClock {
    pub fn milliseconds(&self, now: i64) -> i64 {
        match *self {
            Self::Duration(ms) => ms,
            Self::Until(at) => at.saturating_sub(now),
            Self::Since(at) => now.saturating_sub(at),
        }
        .max(0)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum Control {
    Page(Box<layout::Page>),
    Text(String),
    ListRow {
        id: String,
        title: String,
        detail: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        clock: Option<RowClock>,
        actions: Vec<(String, String)>,
    },
    Clock {
        label: String,
        anchor_ms: i64,
        counting_up: bool,
    },
    Button {
        id: String,
        label: String,
    },
    Input {
        id: String,
        label: String,
        value: String,
    },
    Submit {
        id: String,
        label: String,
    },
    Select {
        id: String,
        label: String,
        value: String,
        choices: Vec<(String, String)>,
    },
}

#[cfg(target_arch = "wasm32")]
pub use extism_pdk as pdk;

/// Render page navigation while keeping task IDs and the plugin's other view state intact.
pub fn page_range(
    key: &str,
    count: usize,
    request: &Request,
    state: &mut Value,
    panel: &mut Vec<Control>,
    previous: &str,
    next: &str,
) -> std::ops::Range<usize> {
    const ROWS_PER_PAGE: usize = 10;
    let last = count.saturating_sub(1) / ROWS_PER_PAGE;
    let prev_id = format!("previous-{key}");
    let next_id = format!("next-{key}");
    let mut index = state[key].as_u64().unwrap_or(0).min(last as u64) as usize;
    if let Event::Action(id) = &request.event {
        if id == &prev_id {
            index = index.saturating_sub(1);
            state[key] = index.into();
        }
        if id == &next_id {
            index = index.saturating_add(1).min(last);
            state[key] = index.into();
        }
    }
    if index > 0 {
        panel.push(Control::Button {
            id: prev_id,
            label: previous.into(),
        });
    }
    if index < last {
        panel.push(Control::Button {
            id: next_id,
            label: next.into(),
        });
    }
    let start = index * ROWS_PER_PAGE;
    start..start.saturating_add(ROWS_PER_PAGE).min(count)
}
