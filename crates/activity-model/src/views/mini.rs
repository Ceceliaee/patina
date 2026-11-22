use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MonitorAffinity {
    pub name: Option<String>,
    pub work_area: Rect,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Edge {
    #[default]
    Top,
    Left,
    Right,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Placement {
    pub monitor: Option<MonitorAffinity>,
    pub edge: Option<Edge>,
    pub last_edge: Edge,
    pub anchor: f64,
    pub floating: Option<Rect>,
}

impl Default for Placement {
    fn default() -> Self {
        Self {
            monitor: None,
            edge: Some(Edge::Top),
            last_edge: Edge::Top,
            anchor: 0.5,
            floating: None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct MiniPreferences {
    pub placement: Placement,
    pub held: bool,
}
