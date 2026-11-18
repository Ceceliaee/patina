use crate::activity_read_model::ANONYMOUS_ACTIVITY_KEY;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SeriesKind {
    App,
    Category,
    Web,
}
#[derive(Serialize, Deserialize)]
pub struct Series {
    pub key: String,
    pub name: String,
    pub daily: BTreeMap<usize, i64>,
    pub color: u32,
    pub custom_color: Option<u32>,
    pub favicon: Option<String>,
}
impl Series {
    pub fn source_color(&self, icon: Option<u32>) -> u32 {
        crate::color::source_color(
            self.key == ANONYMOUS_ACTIVITY_KEY,
            self.custom_color,
            icon,
            self.color,
        )
    }
}
#[derive(Serialize, Deserialize)]
pub struct Trends {
    pub earliest: Option<i64>,
    pub days: Vec<i64>,
    pub series: Vec<Series>,
}
