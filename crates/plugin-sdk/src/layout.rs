use serde::{Deserialize, Serialize};
mod composition;
pub use composition::*;

/// Page layout references the controls returned in the same panel by their stable IDs.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Page {
    pub title: String,
    pub icon: Icon,
    pub tabs: Vec<Tab>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_tab: Option<String>,
    pub dialog: Option<Details>,
}

impl Page {
    /// Opt into plugin-owned tab selection. The plugin's state stores the stable tab ID.
    pub fn remember_tab(&mut self, state: &mut serde_json::Value, event: &crate::Event) {
        if let crate::Event::SelectTab(id) = event
            && self.tabs.iter().any(|tab| tab.id == *id)
        {
            state["selected_tab"] = id.clone().into();
        }
        self.selected_tab = self
            .tabs
            .iter()
            .find(|tab| Some(tab.id.as_str()) == state["selected_tab"].as_str())
            .or_else(|| self.tabs.first())
            .map(|tab| tab.id.clone());
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Icon {
    Bell,
    BellRing,
    AlarmClock,
    Clock,
    ToolCase,
    Play,
    Pause,
    Square,
    Pencil,
    Trash,
    ToggleLeft,
    ToggleRight,
    Check,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Tab {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<Container>,
    pub id: String,
    pub label: String,
    pub form: Option<Form>,
    pub rows: Vec<Row>,
    pub empty: String,
    pub navigation: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Form {
    pub heading: String,
    pub fields: Vec<Field>,
    pub submit: String,
    pub cancel: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u16>,
    pub id: String,
    pub editor: Editor,
    pub grow: bool,
    /// Divide the available row width proportionally with other weighted fields.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<u8>,
    pub visible: Option<Condition>,
}

impl Field {
    pub fn new(id: impl Into<String>, editor: Editor) -> Self {
        Self {
            width: None,
            id: id.into(),
            editor,
            grow: false,
            weight: None,
            visible: None,
        }
    }
    pub fn flexible(mut self) -> Self {
        self.grow = true;
        self
    }
    pub fn weighted(mut self, weight: u8) -> Self {
        self.weight = Some(weight);
        self
    }
    pub fn width(mut self, width: u16) -> Self {
        self.width = Some(width);
        self
    }
    pub fn when(mut self, key: &str, value: &str) -> Self {
        self.visible = Some(Condition {
            field: key.into(),
            equals: value.into(),
        });
        self
    }
    pub fn bindings<'a>(&'a self, out: &mut Vec<&'a str>) {
        if let Editor::Popover { fields, .. } | Editor::Group { fields, .. } = &self.editor {
            for child in fields {
                child.bindings(out);
            }
        } else {
            out.push(&self.id);
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Condition {
    pub field: String,
    pub equals: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum Editor {
    Text {
        placeholder: String,
        unit: String,
        label_from: Option<String>,
    },
    Select {
        #[serde(default)]
        subdued: bool,
        clear_on_change: Option<String>,
    },
    Segments,
    ActivityTarget,
    DateTime,
    Duration {
        max_minutes: u32,
    },
    Group {
        label: String,
        #[serde(flatten)]
        arrangement: Arrangement,
        fields: Vec<Field>,
    },
    Popover {
        label: String,
        summaries: Vec<Summary>,
        #[serde(flatten)]
        arrangement: Arrangement,
        width: u16,
        fields: Vec<Field>,
    },
}

/// The single activity target picked by the user in the host's catalog.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct SelectedActivityTarget {
    pub kind: ActivityTargetKind,
    pub value: String,
    pub label: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivityTargetKind {
    App,
    Category,
    Web,
}

impl Editor {
    pub fn text(placeholder: &str, unit: &str) -> Self {
        Self::Text {
            placeholder: placeholder.into(),
            unit: unit.into(),
            label_from: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Summary {
    pub when: Option<Condition>,
    /// Literal text with {field-id} slots expanded from the current form draft.
    pub template: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Row {
    pub id: String,
    pub icons: Vec<(String, Icon)>,
    /// Clicking the detail opens the plugin's dialog via this action.
    pub detail_action: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Details {
    pub title: String,
    pub icon: Icon,
    pub close: String,
    pub lines: Vec<String>,
    pub actions: Vec<String>,
}
