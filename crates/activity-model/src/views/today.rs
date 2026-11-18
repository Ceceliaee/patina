#[derive(serde::Serialize, serde::Deserialize)]
pub struct AppUsage {
    pub key: String,
    pub name: String,
    pub category: String,
    pub color: u32,
    pub custom_color: Option<u32>,
    pub anonymous: bool,
    pub hours: [i64; 24],
    pub duration: i64,
}

impl AppUsage {
    pub fn source_color(&self, icon_color: Option<u32>) -> u32 {
        crate::color::source_color(self.anonymous, self.custom_color, icon_color, self.color)
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Category {
    pub id: String,
    pub label: String,
    pub color: u32,
    pub hours: [i64; 24],
    pub duration: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct DaySummary {
    pub day_end: i64,
    pub apps: Vec<AppUsage>,
    pub categories: Vec<Category>,
    pub choices: Vec<(String, String)>,
    pub total: i64,
    pub yesterday: i64,
    pub category_mode: bool,
    pub refresh_seconds: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub enum AppEdit {
    Category(String),
    Name(String),
}
