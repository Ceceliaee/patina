use crate::activity_read_model::ANONYMOUS_ACTIVITY_KEY;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Serialize, Deserialize)]
pub struct HistoryRecord {
    pub key: String,
    pub name: String,
    pub category: String,
    pub start: i64,
    pub end: i64,
    pub group_duration: i64,
    pub group_id: usize,
    #[serde(default)]
    pub current: bool,
    pub titles: Vec<(i64, i64, String, Option<String>)>,
}
#[derive(Serialize, Deserialize)]
pub struct HistoryDay {
    pub start: i64,
    pub end: i64,
    pub apps: Vec<(String, String, i64)>,
    pub records: Vec<HistoryRecord>,
    pub minimum_seconds: i64,
    #[serde(default)]
    pub timeline_merge_gap_ms: i64,
    pub colors: BTreeMap<String, u32>,
    pub custom_colors: BTreeMap<String, u32>,
    pub favicons: BTreeMap<String, String>,
    pub hours: [i64; 24],
    pub category_hours: BTreeMap<String, [i64; 24]>,
    pub categories: Vec<(String, i64)>,
}
impl HistoryDay {
    pub fn dominant_records(&self, categories: bool) -> Vec<HistoryRecord> {
        dominant_records(
            &self.records,
            self.start..self.end,
            categories,
            self.timeline_merge_gap_ms,
        )
    }
    pub fn app_source_color(&self, key: &str, icon_color: Option<u32>) -> u32 {
        crate::color::source_color(
            key == ANONYMOUS_ACTIVITY_KEY,
            self.custom_colors.get(key).copied(),
            icon_color,
            self.colors.get(key).copied().unwrap_or(0x8f98a8),
        )
    }
}

impl HistoryRecord {
    pub fn timeline_segment(&self, start: i64, end: i64, duration: i64) -> Self {
        Self {
            key: self.key.clone(),
            name: self.name.clone(),
            category: self.category.clone(),
            start,
            end,
            group_duration: duration,
            group_id: self.group_id,
            current: self.current,
            titles: Vec::new(),
        }
    }
}

pub fn dominant_records(
    records: &[HistoryRecord],
    range: std::ops::Range<i64>,
    categories: bool,
    merge_gap_ms: i64,
) -> Vec<HistoryRecord> {
    let mut buckets = BTreeMap::<i64, BTreeMap<&str, (i64, &HistoryRecord)>>::new();
    let mut bounds = BTreeMap::<i64, (i64, i64)>::new();
    for record in records {
        let visible_start = record.start.max(range.start);
        let visible_end = record.end.min(range.end);
        if visible_end <= visible_start {
            continue;
        }
        let mut minute = visible_start.div_euclid(60_000) * 60_000;
        while minute < visible_end {
            let start = visible_start.max(minute);
            let end = visible_end.min(minute + 60_000);
            let active = bounds.entry(minute).or_insert((start, end));
            active.0 = active.0.min(start);
            active.1 = active.1.max(end);
            let key = if categories {
                &record.category
            } else {
                &record.key
            };
            let item = buckets
                .entry(minute)
                .or_default()
                .entry(key.as_str())
                .or_insert((0, record));
            item.0 += (end - start).max(0);
            if record.start < item.1.start {
                item.1 = record;
            }
            minute += 60_000;
        }
    }
    let mut result: Vec<HistoryRecord> = Vec::new();
    for (minute, items) in buckets {
        let Some((_, (duration, source))) = items.into_iter().min_by(|(ka, a), (kb, b)| {
            b.0.cmp(&a.0)
                .then(a.1.start.cmp(&b.1.start))
                .then(ka.cmp(kb))
        }) else {
            continue;
        };
        let (start, end) = bounds[&minute];
        let start = if start - minute <= 1000 {
            minute.max(range.start)
        } else {
            start
        };
        let boundary = (minute + 60_000).min(range.end);
        let end = if boundary - end <= 1000 {
            boundary
        } else {
            end
        };
        if let Some(previous) = result.last_mut().filter(|previous| {
            (if categories {
                previous.category == source.category
            } else {
                previous.key == source.key
            }) && (source.key != ANONYMOUS_ACTIVITY_KEY || source.group_id == previous.group_id)
                && start - previous.end <= merge_gap_ms.max(0)
        }) {
            previous.end = end;
            previous.group_duration += duration;
        } else {
            result.push(source.timeline_segment(start, end, duration));
        }
    }
    result
}
