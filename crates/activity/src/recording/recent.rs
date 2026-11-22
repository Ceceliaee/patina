use super::timeline::{merge_gap_ms, session_spans, TimelineApp};
use crate::data::repositories::{
    classification_settings::load_classification_snapshot_in_tx,
    sessions::read::load_history_range_in_tx,
};
use chrono::{Local, TimeZone};
use patina_activity_model::{
    activity_read_model::{ANONYMOUS_ACTIVITY_KEY, HOUR_MS},
    views::history::{dominant_records, HistoryRecord},
};
use sqlx::SqlitePool;
use std::collections::BTreeMap;

pub use patina_activity_model::views::recent::{Leader, Recent, Span};

#[cfg(test)]
mod tests;

fn clock(ms: i64) -> String {
    Local
        .timestamp_millis_opt(ms)
        .single()
        .map(|t| t.format("%H:%M").to_string())
        .unwrap_or_else(|| "—".into())
}

pub(crate) async fn load(
    pool: SqlitePool,
    now: i64,
    last_sample: Option<i64>,
    locale: crate::Locale,
) -> Result<Recent, String> {
    let hour_start = now - HOUR_MS;
    let (day_start, _) = crate::platform::clock::local_day_range_at(now)?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mapping = load_classification_snapshot_in_tx(&mut tx).await?;
    let merge_gap = merge_gap_ms(&mut tx).await?;
    let rows = load_history_range_in_tx(&mut tx, day_start.min(hour_start), now, now, false)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;

    let mut day_total_ms = 0;
    let mut first = None;
    let mut last = day_start;
    for row in &rows.sessions {
        let start = row.start_time.max(last);
        let end = row
            .end_time
            .or(last_sample)
            .unwrap_or(row.start_time)
            .min(now);
        if end > start {
            first.get_or_insert(start);
            last = end;
            day_total_ms += end - start;
        }
    }

    let mut records: Vec<HistoryRecord> = Vec::new();
    let mut leaders = BTreeMap::new();
    let mut icon_keys = Vec::new();
    let mut taken_until = hour_start;
    for span in session_spans(
        &rows.sessions,
        hour_start,
        now,
        last_sample.unwrap_or(hour_start),
    ) {
        let row = &rows.sessions[span.value];
        let start = span.start_ms.max(taken_until);
        if span.end_ms <= start {
            continue;
        }
        let Some(app) = TimelineApp::resolve(&mapping, &row.exe_name, &row.app_name, locale) else {
            continue;
        };
        taken_until = span.end_ms;
        let active_ms = span.end_ms - start;
        let leader = leaders.entry(app.key.clone()).or_insert_with(|| {
            if app.custom_color.is_none() && app.key != ANONYMOUS_ACTIVITY_KEY {
                icon_keys.push(app.key.clone());
            }
            Leader {
                name: app.name.clone(),
                duration_ms: 0,
                color: app.custom_color.unwrap_or(app.fallback_color),
            }
        });
        leader.duration_ms += active_ms;
        let group_id = records
            .last()
            .filter(|prev| {
                app.key == ANONYMOUS_ACTIVITY_KEY && prev.key == app.key && prev.end == start
            })
            .map_or(records.len(), |prev| prev.group_id);
        records.push(HistoryRecord {
            key: app.key,
            name: app.name,
            category: app.category,
            start,
            end: span.end_ms,
            group_duration: active_ms,
            group_id,
            current: false,
            titles: Vec::new(),
        });
    }
    if !icon_keys.is_empty() {
        match super::today::icons(pool, icon_keys).await {
            Ok(icons) => {
                for (key, bytes) in icons {
                    if let (Some(leader), Some(color)) =
                        (leaders.get_mut(&key), crate::icon_color(&bytes))
                    {
                        leader.color = color;
                    }
                }
            }
            Err(error) => eprintln!("read Mini activity icons: {error}"),
        }
    }
    let spans = dominant_records(&records, hour_start..now, false, merge_gap)
        .into_iter()
        .map(|record| Span {
            left: (record.start - hour_start) as f32 / HOUR_MS as f32,
            width: (record.end - record.start) as f32 / HOUR_MS as f32,
            color: leaders[&record.key].color,
        })
        .collect();
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
