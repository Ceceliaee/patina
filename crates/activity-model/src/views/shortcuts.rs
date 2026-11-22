use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum ToolTarget {
    Focus,
    Reminders,
    Plugin { focus: bool, generation: [u8; 16] },
}

impl ToolTarget {
    pub fn for_installation(self, generation: &str) -> Self {
        uuid::Uuid::parse_str(generation).map_or(self, |id| Self::Plugin {
            focus: self.is_focus(),
            generation: *id.as_bytes(),
        })
    }

    pub fn is_focus(self) -> bool {
        matches!(self, Self::Focus | Self::Plugin { focus: true, .. })
    }

    pub fn generation(self) -> Option<String> {
        match self {
            Self::Plugin { generation, .. } => Some(uuid::Uuid::from_bytes(generation).to_string()),
            _ => None,
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
