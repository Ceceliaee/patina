use crate::data::{
    activity_read_model::load_range_in_tx,
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
    pub color: u32,
    pub custom_color: Option<u32>,
    pub favicon: Option<String>,
}
impl Series {
    pub fn source_color(&self, icon: Option<u32>) -> u32 {
        super::color::source_color(
            self.key == ANONYMOUS_ACTIVITY_KEY,
            self.custom_color,
            icon,
            self.color,
        )
    }
}
#[derive(Serialize, Deserialize)]
pub struct Trends {
    pub earliest: Option<i64>,
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
    let earliest = if kind == SeriesKind::Web {
        sqlx::query_scalar::<_, Option<i64>>("SELECT MIN(t) FROM (SELECT MIN(start_time) t FROM web_activity_segments UNION ALL SELECT MIN(start_time) t FROM anonymous_activity WHERE is_web=1)")
            .fetch_one(&pool).await.map_err(|e| e.to_string())?
    } else {
        earliest_activity_start(&pool)
            .await
            .map_err(|e| e.to_string())?
    };
    let (from, to) = match range {
        Some((a, b)) => (local_day_range_at(a)?.0, local_day_range_at(b)?.1.min(now)),
        None => (local_day_range_at(earliest.unwrap_or(now))?.0, now),
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
    let mut appearance = BTreeMap::new();
    let mut add = |key: String, name: String, start: i64, duration: i64| {
        if duration <= 0 || start < from || start >= to {
            return;
        }
        let index = days.partition_point(|d| *d <= start) - 1;
        let series = values.entry(key.clone()).or_insert_with(|| Series {
            key,
            name,
            daily: BTreeMap::new(),
            color: 0x8f98a8,
            custom_color: None,
            favicon: None,
        });
        *series.daily.entry(index).or_default() += duration;
    };
    if kind == SeriesKind::Web {
        let snapshot =
            crate::data::repositories::web_links::recent_snapshot_in_tx(&mut tx, from, to, now)
                .await?;
        tx.commit().await.map_err(|e| e.to_string())?;
        let mut names = BTreeMap::new();
        let mut icons: Vec<_> = snapshot
            .favicons
            .iter()
            .filter(|(domain, _)| mapping.is_web_domain_enabled(domain))
            .collect();
        icons.sort_by(|(a, _), (b, _)| {
            snapshot
                .totals
                .get(*b)
                .cmp(&snapshot.totals.get(*a))
                .then(a.cmp(b))
        });
        for r in snapshot.segments.iter().flatten() {
            if !mapping.is_web_domain_enabled(&r.normalized_domain) {
                continue;
            }
            let key =
                crate::domain::web_links::resolve_owner(&r.normalized_domain, &snapshot.rules);
            let root = crate::domain::web_links::group_domain(&key);
            let rule = root.as_ref().and_then(|root| snapshot.rules.get(root));
            let raw = snapshot.overrides.get(&r.normalized_domain);
            let name = if root.is_some() {
                rule.and_then(|r| r.display_name.as_deref())
            } else {
                raw.and_then(|v| v.get("displayName"))
                    .and_then(|v| v.as_str())
            }
            .filter(|s| !s.trim().is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| root.clone().unwrap_or_else(|| r.normalized_domain.clone()));
            let custom = if root.is_some() {
                rule.and_then(|r| r.color.as_deref())
            } else {
                raw.and_then(|v| v.get("color")).and_then(|v| v.as_str())
            }
            .and_then(super::today::parse_color);
            let category = mapping.resolve_web_category(&r.normalized_domain);
            let fallback = if category.id == "other" {
                super::color::web_color(&key)
            } else {
                super::today::parse_color(&category.color).unwrap_or(0x8f98a8)
            };
            let favicon = icons
                .iter()
                .find(|(domain, _)| {
                    crate::domain::web_links::resolve_owner(domain, &snapshot.rules) == key
                })
                .map(|(_, icon)| (*icon).clone());
            appearance.insert(key.clone(), (fallback, custom, favicon));
            names.insert(key, name);
        }
        let mut bounds = days.clone();
        bounds.push(to);
        for record in
            crate::data::web_range::aggregate_website_snapshot(&snapshot, &mapping, &bounds)
        {
            let name = names
                .get(&record.normalized_domain)
                .cloned()
                .unwrap_or_else(|| crate::text(locale, "common.anonymousActivity"));
            add(
                record.normalized_domain,
                name,
                record.bucket_start_ms,
                record.duration_ms,
            );
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
                appearance.insert(
                    cat.id.clone(),
                    (
                        super::today::parse_color(&cat.color).unwrap_or(0x8f98a8),
                        None,
                        None,
                    ),
                );
                (cat.id, cat.label)
            } else {
                let key = mapping.app_owner(&r.exe_name);
                let (custom, _) = mapping.app_appearance(&key);
                let custom_color = mapping
                    .app_appearance(&key)
                    .1
                    .and_then(super::today::parse_color);
                let fallback = if cat.id == "other" {
                    super::color::app_color(&key)
                } else {
                    super::today::parse_color(&cat.color).unwrap_or(0x8f98a8)
                };
                appearance.insert(key.clone(), (fallback, custom_color, None));
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
    for series in &mut series {
        if let Some((color, custom, favicon)) = appearance.remove(&series.key) {
            series.color = color;
            series.custom_color = custom;
            series.favicon = favicon;
        }
    }
    series.sort_by_key(|s| std::cmp::Reverse(s.daily.values().sum::<i64>()));
    Ok(Trends {
        earliest,
        days,
        series,
    })
}
