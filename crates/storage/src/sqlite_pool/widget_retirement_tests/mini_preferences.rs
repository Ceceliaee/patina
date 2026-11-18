use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
struct MonitorAffinity {
    name: Option<String>,
    work_area: Rect,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Page {
    #[default]
    Activity,
    Tools,
}

fn read_saved_page<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Page, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Edge {
    #[default]
    Top,
    Left,
    Right,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
struct Placement {
    monitor: Option<MonitorAffinity>,
    edge: Option<Edge>,
    last_edge: Edge,
    anchor: f64,
    floating: Option<Rect>,
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

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub(super) struct Preferences {
    placement: Placement,
    held: bool,
    #[serde(default, deserialize_with = "read_saved_page")]
    page: Page,
}

const KEY: &str = "mini_window_preferences";

pub(super) async fn load(pool: &Pool<Sqlite>) -> Result<Preferences, sqlx::Error> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(KEY)
        .fetch_optional(pool)
        .await?;
    Ok(value
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}
