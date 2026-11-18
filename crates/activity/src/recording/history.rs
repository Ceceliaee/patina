use crate::data::{
    activity_read_model::load_range_in_tx,
    repositories::{
        classification_settings::load_classification_snapshot_in_tx,
        sessions::read::load_history_range_in_tx,
    },
};
use crate::domain::activity_read_model::{
    resolve_activity_precedence, should_track_activity_fact, ActivityOrigin, OwnedActivityRange,
    ANONYMOUS_ACTIVITY_KEY,
};
use crate::platform::clock::{local_day_range_at, unix_timestamp_millis_i64};
use std::collections::BTreeMap;
#[path = "history/web.rs"]
mod web;

pub use patina_activity_model::views::history::{HistoryDay, HistoryRecord};

pub(super) async fn load(
    pool: sqlx::SqlitePool,
    day: i64,
    app: Option<String>,
    titles: bool,
    last_sample: Option<i64>,
    locale: crate::Locale,
    web: bool,
) -> Result<HistoryDay, String> {
    let now = unix_timestamp_millis_i64();
    let (start, end) = local_day_range_at(day)?;
    if start > now {
        return Err("future history date".into());
    }
    let cutoff = now.min(end);
    let live = last_sample.unwrap_or(now).min(now);
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mapping = load_classification_snapshot_in_tx(&mut tx).await?;
    let minimum_key = if app.is_some() {
        "__gpui_detail_min_secs"
    } else {
        "min_session_secs"
    };
    let minimum_seconds = sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key=?")
        .bind(minimum_key)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(if app.is_some() { 60 } else { 300 })
        .clamp(0, 600);
    let merge_gap = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key='timeline_merge_gap_secs'",
    )
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .and_then(|s| s.parse::<i64>().ok())
    .unwrap_or(180)
    .clamp(60, 300)
        * 1000;
    if web {
        let mut snapshot = crate::data::repositories::web_links::recent_snapshot_in_tx(
            &mut tx, start, cutoff, now,
        )
        .await?;
        for segment in snapshot.segments.iter_mut().flatten() {
            segment.end_time = segment.end_time.min(cutoff);
        }
        for record in snapshot.anonymous_activity.iter_mut().flatten() {
            record.end_time = Some(record.end_time.unwrap_or(record.observed_until).min(cutoff));
        }
        tx.commit().await.map_err(|e| e.to_string())?;
        let mut day = HistoryDay {
            start,
            end,
            apps: Vec::new(),
            records: Vec::new(),
            minimum_seconds,
            timeline_merge_gap_ms: merge_gap,
            colors: BTreeMap::new(),
            custom_colors: BTreeMap::new(),
            favicons: BTreeMap::new(),
            hours: [0; 24],
            category_hours: BTreeMap::new(),
            categories: Vec::new(),
        };
        web::populate(
            &mut day,
            snapshot,
            &mapping,
            app.as_deref(),
            titles,
            merge_gap,
            locale,
        )?;
        return Ok(day);
    }
    let aggregate = load_range_in_tx(&mut tx, start, cutoff, &[], live).await?;
    let rows = load_history_range_in_tx(&mut tx, start, cutoff, live, titles)
        .await
        .map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    let identity = |exe: &str, name: &str| {
        if exe == ANONYMOUS_ACTIVITY_KEY {
            return Some((
                exe.to_owned(),
                crate::text(locale, "common.anonymousActivity"),
            ));
        }
        let canonical = crate::domain::tracking::resolve_app_override_executable(exe)?;
        if !mapping.is_app_enabled(&canonical) {
            return None;
        }
        let key = mapping.app_owner(exe);
        let (custom, _) = mapping.app_appearance(&key);
        let name = custom
            .unwrap_or_else(|| {
                if key.eq_ignore_ascii_case(exe) && !name.trim().is_empty() {
                    name.trim()
                } else {
                    key.trim_end_matches(".exe")
                }
            })
            .to_owned();
        Some((key, name))
    };
    let mut colors = BTreeMap::new();
    let mut custom_colors = BTreeMap::new();
    let mut totals = BTreeMap::new();
    let mut hours = [0i64; 24];
    let mut categories = BTreeMap::new();
    let mut category_hours = BTreeMap::<String, [i64; 24]>::new();
    for r in aggregate.records {
        if let Some((key, name)) = identity(
            if r.anonymous {
                ANONYMOUS_ACTIVITY_KEY
            } else {
                &r.exe_name
            },
            &r.app_name,
        ) {
            use chrono::{Local, TimeZone, Timelike};
            let mut a = r.start_time.max(start);
            let end = r.end_time.min(cutoff);
            let category = if r.anonymous {
                crate::text(locale, "common.anonymousActivity")
            } else {
                mapping.resolve_session_category(&r.exe_name).label
            };
            let resolved = if r.anonymous {
                0x8f98a8
            } else {
                super::today::parse_color(&mapping.resolve_session_category(&r.exe_name).color)
                    .unwrap_or(0x8f98a8)
            };
            let custom_color = mapping
                .app_appearance(&key)
                .1
                .and_then(super::today::parse_color);
            if !r.anonymous {
                if let Some(color) = custom_color {
                    custom_colors.insert(key.clone(), color);
                }
            }
            let color = custom_color.unwrap_or_else(|| {
                if !r.anonymous && mapping.resolve_session_category(&r.exe_name).id == "other" {
                    crate::color::app_color(&key)
                } else {
                    resolved
                }
            });
            colors.insert(key.clone(), color);
            colors.insert(category.clone(), resolved);
            *categories.entry(category.clone()).or_insert(0) += (end - a).max(0);
            while a < end {
                let t = Local
                    .timestamp_millis_opt(a)
                    .single()
                    .ok_or("invalid local hour")?;
                let b = (a + 3_600_000
                    - i64::from(t.minute() * 60 + t.second()) * 1000
                    - i64::from(t.timestamp_subsec_millis()))
                .min(end);
                hours[t.hour() as usize] += b - a;
                category_hours.entry(category.clone()).or_insert([0; 24])[t.hour() as usize] +=
                    b - a;
                a = b;
            }
            let entry = totals.entry(key).or_insert((name, 0));
            entry.1 += (r.end_time.min(cutoff) - r.start_time.max(start)).max(0);
        }
    }
    let mut apps: Vec<_> = totals.into_iter().map(|(k, (n, d))| (k, n, d)).collect();
    apps.sort_by_key(|r| std::cmp::Reverse(r.2));
    let mut samples = BTreeMap::<i64, Vec<_>>::new();
    for t in rows.title_samples {
        samples.entry(t.session_id).or_default().push(t);
    }
    let facts = rows
        .sessions
        .iter()
        .enumerate()
        .filter(|(_, r)| {
            r.exe_name == ANONYMOUS_ACTIVITY_KEY
                || should_track_activity_fact(&r.exe_name, &r.app_name, &r.window_title)
        })
        .map(|(i, r)| OwnedActivityRange {
            origin: if r.origin == "native" {
                ActivityOrigin::Native
            } else {
                ActivityOrigin::ImportExact
            },
            start_ms: r.start_time.max(start),
            end_ms: r.end_time.unwrap_or(live).min(cutoff),
            capacity_end_ms: None,
            value: i,
        })
        .collect::<Vec<_>>();
    let mut records = Vec::new();
    let mut spans = resolve_activity_precedence(&facts);
    spans.sort_by_key(|s| s.start_ms);
    let mut groups = BTreeMap::<String, (usize, i64, i64)>::new();
    let mut durations = Vec::<i64>::new();
    let mut membership = Vec::new();
    for span in spans {
        let r = &rows.sessions[span.value];
        let Some((key, name)) = identity(&r.exe_name, &r.app_name) else {
            continue;
        };
        if app.as_ref().is_some_and(|wanted| *wanted != key) {
            continue;
        }
        let (lo, hi) = (span.start_ms, span.end_ms);
        let mut detail = Vec::new();
        if titles && key != ANONYMOUS_ACTIVITY_KEY {
            if r.origin == "native" {
                if let Some(items) = samples.get(&r.id) {
                    for t in items {
                        let a = t.start_time.max(lo);
                        let b = t.end_time.unwrap_or(hi).min(hi);
                        if b > a && !t.title.trim().is_empty() {
                            detail.push((a, b, t.title.clone(), None));
                        }
                    }
                }
            }
            if detail.is_empty() && !r.window_title.trim().is_empty() {
                detail.push((lo, hi, r.window_title.clone(), None));
            }
        }
        let continuity = r.continuity_group_start_time.unwrap_or(r.start_time);
        let previous = groups.get(&r.exe_name).filter(|(_, end, group)| {
            if key == ANONYMOUS_ACTIVITY_KEY {
                lo == *end
            } else {
                continuity == *group || lo - *end <= merge_gap
            }
        });
        let id = previous.map(|p| p.0).unwrap_or_else(|| {
            durations.push(0);
            durations.len() - 1
        });
        durations[id] += hi - lo;
        groups.insert(r.exe_name.clone(), (id, hi, continuity));
        membership.push(id);
        let category = if key == ANONYMOUS_ACTIVITY_KEY {
            crate::text(locale, "common.anonymousActivity")
        } else {
            mapping.resolve_session_category(&r.exe_name).label
        };
        records.push(HistoryRecord {
            category,
            key,
            name,
            start: lo,
            end: hi,
            group_duration: 0,
            group_id: id,
            current: r.origin == "native" && r.end_time.is_none() && hi == live && end > now,
            titles: detail,
        });
    }
    for (r, id) in records.iter_mut().zip(membership) {
        r.group_duration = durations[id];
    }
    Ok(HistoryDay {
        start,
        end,
        apps,
        records,
        minimum_seconds,
        timeline_merge_gap_ms: merge_gap,
        colors,
        custom_colors,
        favicons: BTreeMap::new(),
        hours,
        category_hours,
        categories: categories.into_iter().collect(),
    })
}
