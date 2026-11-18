use crate::activity_read_model::ANONYMOUS_ACTIVITY_KEY;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Serialize, Deserialize)]
pub struct HistoryRecord {
    pub key: String,
    pub name: String,
    pub category: String,
    pub start: i64,
    pub end: i64,
    pub group_duration: i64,
    pub group_id: usize,
    #[serde(default)]
    pub current: bool,
    pub titles: Vec<(i64, i64, String, Option<String>)>,
}
#[derive(Serialize, Deserialize)]
pub struct HistoryDay {
    pub start: i64,
    pub end: i64,
    pub apps: Vec<(String, String, i64)>,
    pub records: Vec<HistoryRecord>,
    pub minimum_seconds: i64,
    #[serde(default)]
    pub timeline_merge_gap_ms: i64,
    pub colors: BTreeMap<String, u32>,
    pub custom_colors: BTreeMap<String, u32>,
    pub favicons: BTreeMap<String, String>,
    pub hours: [i64; 24],
    pub category_hours: BTreeMap<String, [i64; 24]>,
    pub categories: Vec<(String, i64)>,
}
impl HistoryDay {
    pub fn app_source_color(&self, key: &str, icon_color: Option<u32>) -> u32 {
        crate::color::source_color(
            key == ANONYMOUS_ACTIVITY_KEY,
            self.custom_colors.get(key).copied(),
            icon_color,
            self.colors.get(key).copied().unwrap_or(0x8f98a8),
        )
    }
}
