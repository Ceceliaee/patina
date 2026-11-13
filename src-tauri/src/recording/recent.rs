use crate::data::repositories::sessions::read::load_history_range;
use chrono::{Local, TimeZone};
use sqlx::SqlitePool;
use std::collections::BTreeMap;

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Span {
    pub left: f32,
    pub width: f32,
    pub color: u32,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Leader {
    pub name: String,
    pub duration_ms: i64,
    pub color: u32,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Recent {
    pub spans: Vec<Span>,
    pub leaders: Vec<Leader>,
    pub hour_labels: (String, String),
    pub day_range: String,
    pub day_total_ms: i64,
}

fn clock(ms: i64) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|t| t.format("%H:%M").to_string())
        .unwrap_or_else(|| "—".into())
}

use super::color::app_color;

pub(crate) async fn load(
    pool: SqlitePool,
    now: i64,
    last_sample: Option<i64>,
    locale: super::Locale,
) -> Result<Recent, String> {
    const HOUR: i64 = 3_600_000;
    let hour_start = now - HOUR;
    let (day_start, _) = crate::platform::clock::local_day_range_at(now)?;
    let rows = load_history_range(&pool, day_start.min(hour_start), now, now, false)
        .await
        .map_err(|e| e.to_string())?;
    let mut day_total_ms = 0;
    let mut first = None;
    let mut last = day_start;
    let mut spans = Vec::new();
    let mut leaders = BTreeMap::new();
    let mut taken_until = hour_start.min(day_start);
    for row in rows.sessions {
        let end = row
            .end_time
            .or(last_sample)
            .unwrap_or(row.start_time)
            .min(now);
        let start = row.start_time.max(taken_until);
        if end <= start {
            continue;
        }
        taken_until = end;
        if end > day_start {
            let today = start.max(day_start);
            first.get_or_insert(today);
            last = end;
            day_total_ms += end - today;
        }
        let lo = start.max(hour_start);
        if end <= lo {
            continue;
        }
        let key = crate::domain::classification::canonical_exe(&row.exe_name);
        let color = app_color(&key);
        spans.push(Span {
            left: (lo - hour_start) as f32 / HOUR as f32,
            width: (end - lo) as f32 / HOUR as f32,
            color,
        });
        let leader = leaders.entry(key).or_insert_with(|| Leader {
            name: if row.exe_name == "activity:anonymous" {
                super::text(locale, "native.export.anonymousActivity")
            } else if row.app_name.is_empty() {
                row.exe_name
            } else {
                row.app_name
            },
            duration_ms: 0,
            color,
        });
        leader.duration_ms += end - lo;
    }
    let mut leaders: Vec<_> = leaders.into_values().collect();
    leaders.sort_by_key(|v| std::cmp::Reverse(v.duration_ms));
    leaders.truncate(3);
    Ok(Recent {
        spans,
        leaders,
        day_total_ms,
        hour_labels: (clock(hour_start), clock(now)),
        day_range: first
            .map(|t| format!("{}–{}", clock(t), clock(last)))
            .unwrap_or_else(|| "—".into()),
    })
}
