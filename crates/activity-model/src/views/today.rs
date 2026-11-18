#[derive(serde::Serialize, serde::Deserialize)]
pub struct AppUsage {
    pub key: String,
    pub name: String,
    pub category: String,
    pub color: u32,
    pub custom_color: Option<u32>,
    pub anonymous: bool,
    #[serde(rename = "hours")]
    pub hourly_duration_ms: [i64; 24],
    #[serde(rename = "duration")]
    pub duration_ms: i64,
}

impl AppUsage {
    pub fn source_color(&self, icon_color: Option<u32>) -> u32 {
        crate::color::source_color(self.anonymous, self.custom_color, icon_color, self.color)
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct CategoryUsage {
    pub id: String,
    pub label: String,
    pub color: u32,
    #[serde(rename = "hours")]
    pub hourly_duration_ms: [i64; 24],
    #[serde(rename = "duration")]
    pub duration_ms: i64,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct DaySummary {
    #[serde(rename = "day_end")]
    pub day_end_ms: i64,
    pub apps: Vec<AppUsage>,
    pub categories: Vec<CategoryUsage>,
    #[serde(rename = "choices")]
    pub category_choices: Vec<(String, String)>,
    #[serde(rename = "total")]
    pub total_duration_ms: i64,
    #[serde(rename = "yesterday")]
    pub yesterday_duration_ms: i64,
    #[serde(rename = "category_mode")]
    pub chart_by_category: bool,
    pub refresh_seconds: u64,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub enum AppEdit {
    Category(String),
    Name(String),
}

#[cfg(test)]
mod tests {
    use super::DaySummary;
    use serde_json::json;

    #[test]
    fn day_summary_preserves_the_desktop_wire_keys_and_millisecond_values() {
        let mut hours = [0; 24];
        hours[14] = 61_500;
        let payload = json!({
            "day_end": 86_400_000,
            "apps": [{"key":"editor.exe","name":"Editor","category":"work","color":42,
                "custom_color":null,"anonymous":false,"hours":hours,"duration":61_500}],
            "categories": [{"id":"work","label":"Work","color":42,"hours":hours,"duration":61_500}],
            "choices":[["work","Work"]],"total":61_500,"yesterday":90_000,
            "category_mode":true,"refresh_seconds":2
        });
        let summary: DaySummary = serde_json::from_value(payload.clone()).unwrap();
        assert_eq!(summary.day_end_ms, 86_400_000);
        assert_eq!(summary.apps[0].hourly_duration_ms[14], 61_500);
        assert_eq!(summary.categories[0].duration_ms, summary.total_duration_ms);
        assert_eq!(summary.yesterday_duration_ms, 90_000);
        assert_eq!(serde_json::to_value(summary).unwrap(), payload);
    }
}
