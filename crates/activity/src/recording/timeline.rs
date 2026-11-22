use crate::data::repositories::sessions::read::HistorySessionRow;
use crate::domain::{
    activity_read_model::{
        resolve_activity_precedence, should_track_activity_fact, ActivityOrigin,
        OwnedActivityRange, ANONYMOUS_ACTIVITY_KEY,
    },
    classification::ClassificationSnapshot,
};
use sqlx::{Sqlite, Transaction};

pub(super) async fn merge_gap_ms(tx: &mut Transaction<'_, Sqlite>) -> Result<i64, String> {
    Ok(sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key='timeline_merge_gap_secs'",
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())?
    .and_then(|s| s.parse::<i64>().ok())
    .unwrap_or(180)
    .clamp(60, 300)
        * 1000)
}

pub(super) struct TimelineApp {
    pub key: String,
    pub name: String,
    pub category: String,
    pub category_color: u32,
    pub custom_color: Option<u32>,
    pub fallback_color: u32,
}

impl TimelineApp {
    pub fn resolve(
        mapping: &ClassificationSnapshot,
        exe: &str,
        name: &str,
        locale: crate::Locale,
    ) -> Option<Self> {
        if exe == ANONYMOUS_ACTIVITY_KEY {
            let name = crate::text(locale, "common.anonymousActivity");
            return Some(Self {
                key: exe.into(),
                category: name.clone(),
                name,
                category_color: 0x8f98a8,
                fallback_color: 0x8f98a8,
                custom_color: None,
            });
        }
        let canonical = crate::domain::tracking::resolve_app_override_executable(exe)?;
        if !mapping.is_app_enabled(&canonical) {
            return None;
        }
        let key = mapping.app_owner(exe);
        let (custom_name, color) = mapping.app_appearance(&key);
        let name = custom_name
            .unwrap_or_else(|| {
                if key.eq_ignore_ascii_case(exe) && !name.trim().is_empty() {
                    name.trim()
                } else {
                    key.trim_end_matches(".exe")
                }
            })
            .to_owned();
        let category = mapping.resolve_session_category(exe);
        let category_color = super::today::parse_color(&category.color).unwrap_or(0x8f98a8);
        let fallback_color = if category.id == "other" {
            crate::color::app_color(&key)
        } else {
            category_color
        };
        Some(Self {
            key,
            name,
            category: category.label,
            category_color,
            custom_color: color.and_then(super::today::parse_color),
            fallback_color,
        })
    }
}

pub(super) fn session_spans(
    sessions: &[HistorySessionRow],
    start: i64,
    cutoff: i64,
    live: i64,
) -> Vec<OwnedActivityRange<usize>> {
    let facts = sessions
        .iter()
        .enumerate()
        .filter(|(_, r)| r.end_time.unwrap_or(live) > start && r.start_time < cutoff)
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
    let mut spans = resolve_activity_precedence(&facts);
    spans.sort_by_key(|s| s.start_ms);
    spans
}
