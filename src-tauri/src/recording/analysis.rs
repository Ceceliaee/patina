use crate::data::{
    hourly::load_range_in_tx,
    repositories::{
        classification_settings::load_classification_snapshot_in_tx,
        sessions::read::earliest_activity_start,
    },
};
use crate::domain::activity_read_model::ANONYMOUS_ACTIVITY_KEY;
use crate::platform::clock::{local_day_range_at, unix_timestamp_millis_i64};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum SeriesKind {
    App,
    Category,
    Web,
}
#[derive(Serialize, Deserialize)]
pub struct Series {
    pub key: String,
    pub name: String,
    pub daily: BTreeMap<usize, i64>,
}
#[derive(Serialize, Deserialize)]
pub struct Trends {
    pub days: Vec<i64>,
    pub series: Vec<Series>,
}
pub(super) async fn load(
    pool: sqlx::SqlitePool,
    range: Option<(i64, i64)>,
    kind: SeriesKind,
    locale: crate::Locale,
) -> Result<Trends, String> {
    let now = unix_timestamp_millis_i64();
    let (from, to) = match range {
        Some((a, b)) => (local_day_range_at(a)?.0, local_day_range_at(b)?.1.min(now)),
        None => {
            let start = if kind == SeriesKind::Web {
                sqlx::query_scalar::<_,Option<i64>>("SELECT MIN(t) FROM (SELECT MIN(start_time) t FROM web_activity_segments UNION ALL SELECT MIN(start_time) t FROM anonymous_activity WHERE is_web=1)").fetch_one(&pool).await.map_err(|e|e.to_string())?
            } else {
                earliest_activity_start(&pool)
                    .await
                    .map_err(|e| e.to_string())?
            };
            (local_day_range_at(start.unwrap_or(now))?.0, now)
        }
    };
    if from < 0 || to < from {
        return Err("invalid trend dates".into());
    }
    let mut days = Vec::new();
    let mut day = from;
    while day < to {
        days.push(day);
        day = local_day_range_at(day)?.1;
    }
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mapping = load_classification_snapshot_in_tx(&mut tx).await?;
    let mut values = BTreeMap::<String, Series>::new();
    let mut add = |key: String, name: String, start: i64, duration: i64| {
        if duration <= 0 || start < from || start >= to {
            return;
        }
        let index = days.partition_point(|d| *d <= start) - 1;
        let series = values.entry(key.clone()).or_insert_with(|| Series {
            key,
            name,
            daily: BTreeMap::new(),
        });
        *series.daily.entry(index).or_default() += duration;
    };
    if kind == SeriesKind::Web {
        tx.commit().await.map_err(|e| e.to_string())?;
        for chunk in days.chunks(399) {
            let first = chunk[0];
            let last = local_day_range_at(*chunk.last().unwrap())?.1.min(to);
            let mut bounds = chunk.to_vec();
            bounds.push(last);
            let range = crate::data::web_range::load_web_activity_aggregate_range_from_pool(
                &pool, first, last, &bounds, None, None, now,
            )
            .await?;
            for r in range.records {
                if !mapping.is_web_domain_enabled(&r.normalized_domain) {
                    continue;
                }
                let key = crate::domain::web_links::resolve_owner(
                    &r.normalized_domain,
                    &range.web_links.rules,
                );
                let name = range
                    .web_links
                    .overrides
                    .get(&key)
                    .and_then(|v| v.get("displayName"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(&key)
                    .to_string();
                add(key, name, r.bucket_start_ms, r.duration_ms);
            }
            for r in range.anonymous_records {
                add(
                    ANONYMOUS_ACTIVITY_KEY.into(),
                    crate::text(locale, "common.anonymousActivity"),
                    r.bucket_start_ms,
                    r.duration_ms,
                );
            }
        }
    } else {
        let records = load_range_in_tx(&mut tx, from, to, &days, now)
            .await?
            .records;
        tx.commit().await.map_err(|e| e.to_string())?;
        let mut add_span = |key: String, name: String, start: i64, end: i64| {
            let mut a = start.max(from);
            let end = end.min(to);
            while a < end {
                let i = days.partition_point(|d| *d <= a);
                let b = days.get(i).copied().unwrap_or(to).min(end);
                add(key.clone(), name.clone(), a, b - a);
                a = b;
            }
        };
        for r in records {
            if r.anonymous {
                add_span(
                    ANONYMOUS_ACTIVITY_KEY.into(),
                    crate::text(locale, "common.anonymousActivity"),
                    r.start_time,
                    r.end_time,
                );
                continue;
            }
            let Some(cat) = mapping.resolve_tracked_session_category(&r.exe_name) else {
                continue;
            };
            let (key, name) = if kind == SeriesKind::Category {
                (cat.id, cat.label)
            } else {
                let key = mapping.app_owner(&r.exe_name);
                let (custom, _) = mapping.app_appearance(&key);
                let name = custom
                    .unwrap_or_else(|| {
                        if key.eq_ignore_ascii_case(&r.exe_name) && !r.app_name.is_empty() {
                            &r.app_name
                        } else {
                            key.trim_end_matches(".exe")
                        }
                    })
                    .to_owned();
                (key, name)
            };
            add_span(key, name, r.start_time.max(from), r.end_time);
        }
    }
    let mut series: Vec<_> = values.into_values().collect();
    series.sort_by_key(|s| std::cmp::Reverse(s.daily.values().sum::<i64>()));
    Ok(Trends { days, series })
}
