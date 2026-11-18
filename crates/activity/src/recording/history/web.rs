use super::{HistoryDay, HistoryRecord, ANONYMOUS_ACTIVITY_KEY};
use crate::data::repositories::web_links::WebLinksSnapshot;
use crate::domain::{
    classification::ClassificationSnapshot,
    web_links::{group_domain, resolve_owner},
};
use chrono::{Local, TimeZone, Timelike};
use std::collections::BTreeMap;

pub(super) fn populate(
    day: &mut HistoryDay,
    snapshot: WebLinksSnapshot,
    mapping: &ClassificationSnapshot,
    target: Option<&str>,
    titles: bool,
    merge_gap: i64,
    locale: crate::Locale,
) -> Result<(), String> {
    // The representative icon follows the same lifetime-duration ordering as the website catalog.
    let mut candidates: Vec<_> = snapshot
        .favicons
        .iter()
        .filter(|(domain, _)| {
            mapping.is_web_domain_enabled(domain) && snapshot.totals.contains_key(*domain)
        })
        .collect();
    candidates
        .sort_by(|(a, _), (b, _)| snapshot.totals[*b].cmp(&snapshot.totals[*a]).then(a.cmp(b)));
    for (domain, icon) in candidates {
        day.favicons
            .entry(resolve_owner(domain, &snapshot.rules))
            .or_insert_with(|| icon.clone());
    }

    let mut segments = snapshot.segments.unwrap_or_default();
    segments.sort_by_key(|s| (s.start_time, s.end_time));
    let mut ends = BTreeMap::new();
    let mut groups = BTreeMap::<_, (usize, i64)>::new();
    let mut durations = Vec::<i64>::new();
    let mut membership = Vec::new();
    for segment in segments {
        let Some(category) = mapping.resolve_tracked_web_category(&segment.normalized_domain)
        else {
            continue;
        };
        let key = resolve_owner(&segment.normalized_domain, &snapshot.rules);
        let source = (
            segment.browser_client_id,
            segment.browser_kind,
            segment.browser_exe_name,
            key.clone(),
        );
        let lo = segment
            .start_time
            .max(day.start)
            .max(*ends.get(&source).unwrap_or(&day.start));
        let hi = segment.end_time.min(day.end);
        if hi <= lo {
            continue;
        }
        ends.insert(source.clone(), hi);
        let root = group_domain(&key);
        let rule = root.as_ref().and_then(|root| snapshot.rules.get(root));
        let raw = snapshot.overrides.get(&segment.normalized_domain);
        let name = if root.is_some() {
            rule.and_then(|r| r.display_name.as_deref())
        } else {
            raw.and_then(|r| r.get("displayName"))
                .and_then(|v| v.as_str())
        }
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| root.clone().unwrap_or(segment.domain));
        let custom = if root.is_some() {
            rule.and_then(|r| r.color.as_deref())
        } else {
            raw.and_then(|r| r.get("color")).and_then(|v| v.as_str())
        }
        .and_then(super::super::today::parse_color);
        let category_color = super::super::today::parse_color(&category.color).unwrap_or(0x8f98a8);
        let fallback = if category.id == "other" {
            crate::color::web_color(&key)
        } else {
            category_color
        };
        day.colors.insert(key.clone(), custom.unwrap_or(fallback));
        day.colors.insert(category.label.clone(), category_color);
        if let Some(color) = custom {
            day.custom_colors.insert(key.clone(), color);
        }
        let mut detail = Vec::new();
        if titles
            && raw
                .and_then(|r| r.get("captureTitle"))
                .and_then(|v| v.as_bool())
                != Some(false)
        {
            if let Some(title) = segment
                .title
                .filter(|t| !t.trim().is_empty())
                .or_else(|| segment.url.clone())
            {
                detail.push((lo, hi, title, segment.url.clone()));
            }
        }
        let previous = groups
            .get(&source)
            .filter(|(_, end)| lo - *end <= merge_gap);
        let group = previous.map(|g| g.0).unwrap_or_else(|| {
            durations.push(0);
            durations.len() - 1
        });
        durations[group] += hi - lo;
        groups.insert(source, (group, hi));
        membership.push(group);
        day.records.push(HistoryRecord {
            key,
            name,
            category: category.label,
            start: lo,
            end: hi,
            group_duration: 0,
            group_id: group,
            current: false,
            titles: detail,
        });
    }
    for (record, group) in day.records.iter_mut().zip(membership) {
        record.group_duration = durations[group];
    }
    for record in snapshot.anonymous_activity.unwrap_or_default() {
        let lo = record.start_time.max(day.start);
        let hi = record
            .end_time
            .unwrap_or(record.observed_until)
            .min(day.end);
        if hi <= lo {
            continue;
        }
        let name = crate::text(locale, "common.anonymousActivity");
        day.colors.insert(ANONYMOUS_ACTIVITY_KEY.into(), 0x8f98a8);
        day.colors.insert(name.clone(), 0x8f98a8);
        day.records.push(HistoryRecord {
            key: ANONYMOUS_ACTIVITY_KEY.into(),
            name: name.clone(),
            category: name,
            start: lo,
            end: hi,
            group_duration: hi - lo,
            group_id: durations.len() + day.records.len(),
            current: false,
            titles: Vec::new(),
        });
    }
    day.records.sort_by_key(|r| r.start);
    let mut totals = BTreeMap::<String, (String, i64)>::new();
    let mut categories = BTreeMap::<String, i64>::new();
    for record in &day.records {
        totals
            .entry(record.key.clone())
            .or_insert((record.name.clone(), 0))
            .1 += record.end - record.start;
        *categories.entry(record.category.clone()).or_default() += record.end - record.start;
        let mut at = record.start;
        while at < record.end {
            let time = Local
                .timestamp_millis_opt(at)
                .single()
                .ok_or("invalid local hour")?;
            let until = (at + 3_600_000
                - i64::from(time.minute() * 60 + time.second()) * 1000
                - i64::from(time.timestamp_subsec_millis()))
            .min(record.end);
            day.hours[time.hour() as usize] += until - at;
            day.category_hours
                .entry(record.category.clone())
                .or_insert([0; 24])[time.hour() as usize] += until - at;
            at = until;
        }
    }
    day.apps = totals.into_iter().map(|(k, (n, t))| (k, n, t)).collect();
    day.apps.sort_by_key(|r| std::cmp::Reverse(r.2));
    day.categories = categories.into_iter().collect();
    day.favicons
        .retain(|key, _| day.apps.iter().any(|a| &a.0 == key));
    if let Some(target) = target {
        day.records.retain(|r| r.key == target);
    }
    Ok(())
}
