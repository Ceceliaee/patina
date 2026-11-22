pub use patina_plugin_sdk::{Capability, Control, Manifest, RowClock, layout};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub use patina_plugin_sdk::installation::{Installed, Preview};
pub use patina_plugin_sdk::notification::{
    NoticeChoices, NoticeContent, NoticeContext, NoticeTarget,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Notice {
    pub id: String,
    pub generation: String,
    pub at_ms: i64,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<NoticeContent>,
    #[serde(default)]
    pub source: Option<i64>,
    #[serde(default)]
    pub usage: bool,
    #[serde(default)]
    pub focus_task: Option<(String, i64, i64)>,
}

pub use patina_plugin_sdk::installation::now_ms;

#[derive(Serialize, Deserialize)]
pub enum ToolRequest {
    List,
    OpenHome,
    DisplayFailed,
    RetryDisplay,
    Shortcuts,
    Stopping(String, String),
    Restore(String),
    Notices(bool),
    Submit {
        id: String,
        generation: String,
        button: String,
        fields: std::collections::BTreeMap<String, String>,
    },
    Acknowledge(Notice, String),
    Presented(Notice),
    Preferences,
    SavePreferences(patina_activity_model::NoticePreferencesPatch),
    Inspect(PathBuf),
    Install(PathBuf, Preview),
    SelectTab {
        id: String,
        generation: String,
        tab: String,
    },
    Panel {
        id: String,
        generation: String,
        action: Option<String>,
        remember: bool,
    },
    Uninstall {
        id: String,
        generation: String,
    },
}

/// A tool call pairs the host command with its response before it enters the wire.
pub struct ToolCall<T> {
    request: ToolRequest,
    result: std::marker::PhantomData<fn() -> T>,
}
impl<T> ToolCall<T> {
    pub fn into_request(self) -> ToolRequest {
        self.request
    }
    fn new(request: ToolRequest) -> Self {
        Self {
            request,
            result: std::marker::PhantomData,
        }
    }
}
pub mod call {
    use super::*;
    pub fn list() -> ToolCall<crate::ToolList> {
        ToolCall::new(ToolRequest::List)
    }
    pub fn open_home() -> ToolCall<crate::ToolList> {
        ToolCall::new(ToolRequest::OpenHome)
    }
    pub fn display_failed() -> ToolCall<()> {
        ToolCall::new(ToolRequest::DisplayFailed)
    }
    pub fn retry_display() -> ToolCall<()> {
        ToolCall::new(ToolRequest::RetryDisplay)
    }
    pub fn shortcuts() -> ToolCall<Vec<patina_activity_model::Shortcut>> {
        ToolCall::new(ToolRequest::Shortcuts)
    }
    pub fn stopping(id: String, generation: String) -> ToolCall<Vec<String>> {
        ToolCall::new(ToolRequest::Stopping(id, generation))
    }
    pub fn restore(id: String) -> ToolCall<Installed> {
        ToolCall::new(ToolRequest::Restore(id))
    }
    pub fn notices(dialog: bool) -> ToolCall<Vec<Notice>> {
        ToolCall::new(ToolRequest::Notices(dialog))
    }
    pub fn submit(
        id: String,
        generation: String,
        button: String,
        fields: std::collections::BTreeMap<String, String>,
    ) -> ToolCall<Vec<Control>> {
        ToolCall::new(ToolRequest::Submit {
            id,
            generation,
            button,
            fields,
        })
    }
    pub fn acknowledge(notice: Notice, choice: String) -> ToolCall<()> {
        ToolCall::new(ToolRequest::Acknowledge(notice, choice))
    }
    pub fn presented(notice: Notice) -> ToolCall<()> {
        ToolCall::new(ToolRequest::Presented(notice))
    }
    pub fn preferences() -> ToolCall<patina_activity_model::NoticePreferences> {
        ToolCall::new(ToolRequest::Preferences)
    }
    pub fn save_preferences(
        patch: patina_activity_model::NoticePreferencesPatch,
    ) -> ToolCall<patina_activity_model::NoticePreferences> {
        ToolCall::new(ToolRequest::SavePreferences(patch))
    }
    pub fn inspect(path: PathBuf) -> ToolCall<Preview> {
        ToolCall::new(ToolRequest::Inspect(path))
    }
    pub fn install(path: PathBuf, preview: Preview) -> ToolCall<Installed> {
        ToolCall::new(ToolRequest::Install(path, preview))
    }
    pub fn select_tab(id: String, generation: String, tab: String) -> ToolCall<Vec<Control>> {
        ToolCall::new(ToolRequest::SelectTab {
            id,
            generation,
            tab,
        })
    }
    pub fn panel(
        id: String,
        generation: String,
        action: Option<String>,
        remember: bool,
    ) -> ToolCall<Vec<Control>> {
        ToolCall::new(ToolRequest::Panel {
            id,
            generation,
            action,
            remember,
        })
    }
    pub fn uninstall(id: String, generation: String) -> ToolCall<()> {
        ToolCall::new(ToolRequest::Uninstall { id, generation })
    }
}
