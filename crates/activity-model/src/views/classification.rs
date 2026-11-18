use super::draft::WebDraft;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppRule {
    pub exe: String,
    pub name: String,
    pub category: String,
    pub color: String,
    pub track: bool,
    pub titles: bool,
    pub original: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct AppLinkEdit {
    pub member: String,
    pub parent: Option<String>,
    pub original: Option<String>,
}
#[derive(Serialize, Deserialize)]
pub struct Rules {
    pub web_enabled: bool,
    pub web_mode: bool,
    pub websites: WebDraft,
    pub titles_enabled: bool,
    pub category_default_colors: BTreeMap<String, String>,
    pub category_color_overrides: BTreeMap<String, String>,
    pub apps: Vec<AppRule>,
    pub app_links: BTreeMap<String, String>,
    pub categories: Vec<(String, String)>,
    pub category_colors: BTreeMap<String, String>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CategoryEdit {
    pub id: String,
    pub previous: Option<String>,
    pub previous_color: Option<String>,
    pub label: String,
    /// None retains the override; an empty value restores the default.
    pub color: Option<String>,
    /// Removing a category moves its assignments to this category.
    pub replacement: Option<String>,
}
