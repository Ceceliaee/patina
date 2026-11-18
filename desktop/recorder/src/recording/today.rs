use crate::data::{
    activity_read_model::load_range_in_tx,
    repositories::{
        classification_settings::{
            apply_classification_setting_mutations_in_tx, load_classification_snapshot_in_tx,
            ClassificationSettingMutation,
        },
        icon_cache::load_executable_icons,
    },
};
use crate::domain::{
    activity_read_model::ANONYMOUS_ACTIVITY_KEY,
    classification::{ResolvedCategory, APP_OVERRIDE_KEY_PREFIX},
};
use crate::platform::clock::local_day_range_at;
use base64::Engine;
use chrono::{Local, TimeZone, Timelike};
use sqlx::SqlitePool;
use std::collections::BTreeMap;

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
        super::color::source_color(self.anonymous, self.custom_color, icon_color, self.color)
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

pub(super) fn parse_color(raw: &str) -> Option<u32> {
    u32::from_str_radix(raw.trim_start_matches('#'), 16).ok()
}

impl DaySummary {
    pub async fn load(
        pool: SqlitePool,
        now: i64,
        locale: super::Locale,
    ) -> Result<DaySummary, String> {
        let (day_start, day_end) = local_day_range_at(now)?;
        let (yesterday_start, _) = local_day_range_at(day_start - 1)?;
        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
        let mapping = load_classification_snapshot_in_tx(&mut tx).await?;
        let prefs: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings WHERE key IN ('hourly_activity_chart_mode','refresh_interval_secs') OR key GLOB '__category_default_color_assignment::*'")
        .fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
        let prefs: BTreeMap<_, _> = prefs.into_iter().collect();
        let ranges = load_range_in_tx(&mut tx, yesterday_start, now, &[day_start], now).await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        let mut apps = BTreeMap::new();
        let mut categories = BTreeMap::new();
        let mut total = 0;
        let mut yesterday = 0;
        for record in ranges.records {
            let key = if record.anonymous {
                ANONYMOUS_ACTIVITY_KEY.to_owned()
            } else {
                mapping.app_owner(&record.exe_name)
            };
            if !record.anonymous
                && !mapping.is_app_enabled(
                    &crate::domain::tracking::resolve_app_override_executable(&record.exe_name)
                        .unwrap_or_default(),
                )
            {
                continue;
            }
            yesterday +=
                (record.end_time.min(day_start) - record.start_time.max(yesterday_start)).max(0);
            let mut start = record.start_time.max(day_start);
            let end = record.end_time.min(now);
            if end <= start {
                continue;
            }
            let resolved = if record.anonymous {
                ResolvedCategory {
                    id: "anonymous".into(),
                    label: super::text(locale, "common.anonymousActivity"),
                    color: "#8F98A8".into(),
                }
            } else {
                mapping.display_category(&key, &prefs)
            };
            let cat = categories
                .entry(resolved.id.clone())
                .or_insert_with(|| Category {
                    color: parse_color(&resolved.color).unwrap_or(0x8f98a8),
                    id: resolved.id.clone(),
                    label: resolved.label.clone(),
                    hours: [0; 24],
                    duration: 0,
                });
            let (custom_name, color) = mapping.app_appearance(&key);
            let app = apps.entry(key.clone()).or_insert_with(|| AppUsage {
                name: if record.anonymous {
                    cat.label.clone()
                } else {
                    custom_name
                        .unwrap_or_else(|| {
                            if key.eq_ignore_ascii_case(&record.exe_name)
                                && !record.app_name.trim().is_empty()
                            {
                                record.app_name.trim()
                            } else {
                                key.trim_end_matches(".exe")
                            }
                        })
                        .into()
                },
                color: color.and_then(parse_color).unwrap_or_else(|| {
                    if cat.id == "other" {
                        super::color::app_color(&key)
                    } else {
                        cat.color
                    }
                }),
                custom_color: color.and_then(parse_color),
                key,
                category: cat.id.clone(),
                anonymous: record.anonymous,
                hours: [0; 24],
                duration: 0,
            });
            let duration = end - start;
            cat.duration += duration;
            app.duration += duration;
            total += duration;
            while start < end {
                let local = Local
                    .timestamp_millis_opt(start)
                    .single()
                    .ok_or("invalid activity timestamp")?;
                let hour = local.hour() as usize;
                let within_hour = i64::from(local.minute() * 60 + local.second()) * 1000
                    + i64::from(local.timestamp_subsec_millis());
                let next = (start + 3_600_000 - within_hour).min(end);
                app.hours[hour] += next - start;
                cat.hours[hour] += next - start;
                start = next;
            }
        }
        let mut apps: Vec<_> = apps.into_values().collect();
        apps.sort_by_key(|app| std::cmp::Reverse(app.duration));
        let mut categories: Vec<_> = categories.into_values().collect();
        categories.sort_by_key(|cat| std::cmp::Reverse(cat.duration));
        Ok(DaySummary {
            day_end,
            apps,
            categories,
            total,
            yesterday,
            choices: mapping
                .available_categories()
                .into_iter()
                .map(|c| (c.id, c.label))
                .collect(),
            category_mode: prefs
                .get("hourly_activity_chart_mode")
                .is_some_and(|m| m == "category"),
            refresh_seconds: prefs
                .get("refresh_interval_secs")
                .and_then(|s| s.parse::<u64>().ok())
                .unwrap_or(2)
                .clamp(1, 60),
        })
    }
}

pub(super) async fn icons(
    pool: SqlitePool,
    keys: Vec<String>,
) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut icons = Vec::new();
    for chunk in keys.chunks(900) {
        for row in load_executable_icons(&pool, chunk)
            .await
            .map_err(|e| e.to_string())?
        {
            let data = row.icon_base64.trim();
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD
                .decode(data.strip_prefix("data:image/png;base64,").unwrap_or(data))
            {
                icons.push((row.exe_name.to_lowercase(), bytes));
            }
        }
    }
    Ok(icons)
}

#[derive(serde::Serialize, serde::Deserialize)]
pub enum AppEdit {
    Category(String),
    Name(String),
}

pub(super) async fn edit_app(pool: SqlitePool, exe: String, edit: AppEdit) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let snapshot = load_classification_snapshot_in_tx(&mut tx).await?;
    if exe == ANONYMOUS_ACTIVITY_KEY || snapshot.app_owner(&exe) != exe {
        return Err("application or category is unavailable".into());
    }
    let key = format!("{APP_OVERRIDE_KEY_PREFIX}{exe}");
    let previous: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
        .bind(&key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let mut value: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(previous.as_deref().unwrap_or("{}")).map_err(|e| e.to_string())?;
    match edit {
        AppEdit::Category(category) => {
            if !snapshot.category_is_available(&category) {
                return Err("category unavailable".into());
            }
            if category == "other" {
                value.remove("category");
            } else {
                value.insert("category".into(), category.into());
            }
        }
        AppEdit::Name(name) => {
            let name = name.trim();
            if name.encode_utf16().count() > 80 {
                return Err("display name too long".into());
            }
            if name.is_empty() {
                value.remove("displayName");
            } else {
                value.insert("displayName".into(), name.into());
            }
        }
    }
    value.remove("updatedAt");
    let value = if value.keys().all(|k| k == "enabled")
        && value.get("enabled").and_then(|v| v.as_bool()) != Some(false)
    {
        None
    } else {
        value.insert(
            "updatedAt".into(),
            crate::platform::clock::unix_timestamp_millis_i64().into(),
        );
        Some(serde_json::Value::Object(value).to_string())
    };
    apply_classification_setting_mutations_in_tx(
        &mut tx,
        &[ClassificationSettingMutation { key, value }],
    )
    .await
    .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())
}
