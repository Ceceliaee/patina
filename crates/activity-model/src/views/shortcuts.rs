use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum ToolTarget {
    Focus,
    Reminders,
}

impl ToolTarget {
    pub fn id(self) -> &'static str {
        match self {
            Self::Focus => "patina.focus",
            Self::Reminders => "patina.reminders",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Shortcut {
    pub target: ToolTarget,
    pub label: String,
    pub at: i64,
    pub counting_up: bool,
}
