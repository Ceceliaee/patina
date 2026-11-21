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

pub use patina_activity_model::views::today::{AppUsage, CategoryUsage, DaySummary};

pub(super) fn parse_color(raw: &str) -> Option<u32> {
    u32::from_str_radix(raw.trim_start_matches('#'), 16).ok()
}

pub async fn load_day_summary_at(
    pool: SqlitePool,
    as_of_ms: i64,
    locale: crate::Locale,
) -> Result<DaySummary, String> {
    let (day_start_ms, day_end_ms) = local_day_range_at(as_of_ms)?;
    let (yesterday_start_ms, _) = local_day_range_at(day_start_ms - 1)?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mapping = load_classification_snapshot_in_tx(&mut tx).await?;
    let prefs: Vec<(String, String)> = sqlx::query_as("SELECT key,value FROM settings WHERE key='refresh_interval_secs' OR key GLOB '__category_default_color_assignment::*'")
        .fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
    let prefs: BTreeMap<_, _> = prefs.into_iter().collect();
    let ranges = load_range_in_tx(
        &mut tx,
        yesterday_start_ms,
        as_of_ms,
        &[day_start_ms],
        as_of_ms,
    )
    .await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    let mut apps = BTreeMap::new();
    let mut categories = BTreeMap::new();
    let mut total_duration_ms = 0;
    let mut yesterday_duration_ms = 0;
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
        yesterday_duration_ms +=
            (record.end_time.min(day_start_ms) - record.start_time.max(yesterday_start_ms)).max(0);
        let mut start = record.start_time.max(day_start_ms);
        let end = record.end_time.min(as_of_ms);
        if end <= start {
            continue;
        }
        let resolved = if record.anonymous {
            ResolvedCategory {
                id: "anonymous".into(),
                label: crate::text(locale, "common.anonymousActivity"),
                color: "#8F98A8".into(),
            }
        } else {
            mapping.display_category(&key, &prefs)
        };
        let category = categories
            .entry(resolved.id.clone())
            .or_insert_with(|| CategoryUsage {
                color: parse_color(&resolved.color).unwrap_or(0x8f98a8),
                id: resolved.id.clone(),
                label: resolved.label.clone(),
                hourly_duration_ms: [0; 24],
                duration_ms: 0,
            });
        let (custom_name, color) = mapping.app_appearance(&key);
        let app = apps.entry(key.clone()).or_insert_with(|| AppUsage {
            name: if record.anonymous {
                category.label.clone()
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
                if category.id == "other" {
                    crate::color::app_color(&key)
                } else {
                    category.color
                }
            }),
            custom_color: color.and_then(parse_color),
            key,
            category: category.id.clone(),
            anonymous: record.anonymous,
            hourly_duration_ms: [0; 24],
            duration_ms: 0,
        });
        let duration_ms = end - start;
        category.duration_ms += duration_ms;
        app.duration_ms += duration_ms;
        total_duration_ms += duration_ms;
        while start < end {
            let local = Local
                .timestamp_millis_opt(start)
                .single()
                .ok_or("invalid activity timestamp")?;
            let hour = local.hour() as usize;
            let within_hour_ms = i64::from(local.minute() * 60 + local.second()) * 1000
                + i64::from(local.timestamp_subsec_millis());
            let next_hour_or_end_ms = (start + 3_600_000 - within_hour_ms).min(end);
            app.hourly_duration_ms[hour] += next_hour_or_end_ms - start;
            category.hourly_duration_ms[hour] += next_hour_or_end_ms - start;
            start = next_hour_or_end_ms;
        }
    }
    let mut apps: Vec<_> = apps.into_values().collect();
    apps.sort_by_key(|app| std::cmp::Reverse(app.duration_ms));
    let mut categories: Vec<_> = categories.into_values().collect();
    categories.sort_by_key(|category| std::cmp::Reverse(category.duration_ms));
    Ok(DaySummary {
        day_end_ms,
        apps,
        categories,
        total_duration_ms,
        yesterday_duration_ms,
        category_choices: mapping
            .available_categories()
            .into_iter()
            .map(|c| (c.id, c.label))
            .collect(),
        refresh_seconds: prefs
            .get("refresh_interval_secs")
            .and_then(|s| s.parse::<u64>().ok())
            .unwrap_or(2)
            .clamp(1, 60),
    })
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

pub use patina_activity_model::views::today::AppEdit;

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
