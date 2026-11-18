use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase", tag = "kind", content = "key")]
pub enum Target {
    App(String),
    Web(String),
    Group(String),
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub id: i64,
    pub label: String,
    pub target: String,
    pub shared: bool,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq, Debug)]
pub struct Impact {
    pub target: Target,
    pub members: BTreeSet<String>,
    pub links: BTreeSet<(String, String)>,
    pub reminders: Vec<Reminder>,
}
