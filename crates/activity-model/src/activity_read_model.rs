use std::collections::{BTreeMap, BTreeSet};

pub const HOUR_MS: i64 = 60 * 60 * 1000;
pub const ANONYMOUS_ACTIVITY_KEY: &str = "activity:anonymous";

#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ActivityOrigin {
    Native,
    ImportExact,
    ImportBucket,
}

impl ActivityOrigin {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Native => "native",
            Self::ImportExact => "import_exact",
            Self::ImportBucket => "import_bucket",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct OwnedActivityRange<T> {
    pub origin: ActivityOrigin,
    pub start_ms: i64,
    pub end_ms: i64,
    pub capacity_end_ms: Option<i64>,
    pub value: T,
}

#[derive(Clone)]
struct IndexedRange<T> {
    index: usize,
    range: OwnedActivityRange<T>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct Interval {
    start_ms: i64,
    end_ms: i64,
}

pub fn normalize_app_key(exe_name: &str) -> Option<String> {
    let normalized = exe_name
        .trim()
        .trim_matches('"')
        .trim()
        .to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    if normalized.ends_with(".exe") {
        Some(normalized)
    } else {
        Some(format!("{normalized}.exe"))
    }
}

const LIFECYCLE_MARKERS: &[&str] = &[
    "setup",
    "install",
    "installer",
    "uninstall",
    "uninstaller",
    "unins",
    "unins000",
    "update",
    "updater",
    "upgrade",
    "remove",
    "maintenance",
    "maintenancetool",
];

const LIFECYCLE_TITLE_MARKERS: &[&str] = &[
    "setup",
    "install",
    "installer",
    "installation",
    "installing",
    "uninstall",
    "uninstaller",
    "uninstallation",
    "uninstalling",
    "unins",
    "unins000",
    "update",
    "updater",
    "updating",
    "upgrade",
    "remove",
    "maintenance",
    "maintenancetool",
];

const LIFECYCLE_BUILD_TOKENS: &[&str] = &[
    "win", "windows", "x64", "x86", "amd64", "arm64", "ia32", "portable", "release", "latest",
    "beta", "alpha", "nightly", "stable", "desktop", "app",
];

const NON_TRACKABLE_EXES: &[&str] = &[
    "",
    "msiexec",
    "uninstall",
    "unins000",
    "unins",
    "un_a",
    "hrupdate",
    "control",
    "consent",
    "csrss",
    "dwm",
    "fontdrvhost",
    "gameinputsvc",
    "logonui",
    "lsass",
    "mmc",
    "regedit",
    "runtimebroker",
    "services",
    "sihost",
    "smss",
    "system",
    "svchost",
    "usoclient",
    "wininit",
    "winlogon",
    "wuauclt",
    "applicationframehost",
    "lockapp",
    "openwith",
    "pickerhost",
    "searchhost",
    "shellhost",
    "shellexperiencehost",
    "startmenuexperiencehost",
    "taskhostw",
    "taskmgr",
    "textinputhost",
];

fn normalized_executable(exe_name: &str) -> String {
    exe_name
        .trim()
        .trim_matches('"')
        .trim()
        .to_ascii_lowercase()
}

fn executable_stem(normalized_exe: &str) -> &str {
    normalized_exe
        .strip_suffix(".exe")
        .unwrap_or(normalized_exe)
}

fn lifecycle_tokens(stem: &str) -> Vec<&str> {
    stem.split(|ch: char| ch == '-' || ch == '_' || ch == '.' || ch.is_whitespace())
        .filter(|token| !token.is_empty())
        .collect()
}

fn normalized_identity(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect()
}

fn is_standalone_uninstaller(stem: &str) -> bool {
    matches!(
        normalized_identity(stem).as_str(),
        "geek"
            | "geekuninstaller"
            | "revouninstaller"
            | "revouninstallerpro"
            | "iobituninstaller"
            | "hibituninstaller"
            | "bcuninstaller"
            | "bulkcrapuninstaller"
            | "uninstalr"
    )
}

fn compact_lifecycle_parts(stem: &str) -> Option<(&str, &'static str)> {
    for marker in LIFECYCLE_MARKERS {
        if let Some(base) = stem.strip_suffix(marker) {
            if base.len() >= 2 && base.bytes().any(|byte| byte.is_ascii_alphabetic()) {
                return Some((base, *marker));
            }
        }
    }
    None
}

fn equivalent_metadata_stem(stem: &str) -> &str {
    match stem {
        "weixin" => "wechat",
        value => value,
    }
}

fn compact_metadata_matches(stem: &str, value: &str) -> bool {
    let Some((base, marker)) = compact_lifecycle_parts(stem) else {
        return false;
    };
    let metadata = normalized_identity(value);
    if metadata == stem {
        return true;
    }
    compact_lifecycle_parts(&metadata).is_some_and(|(metadata_base, metadata_marker)| {
        marker == metadata_marker
            && equivalent_metadata_stem(base) == equivalent_metadata_stem(metadata_base)
    })
}

fn is_version_like(token: &str) -> bool {
    let raw = token.strip_prefix('v').unwrap_or(token);
    if raw.is_empty() {
        return false;
    }
    if raw.bytes().all(|byte| byte.is_ascii_digit()) {
        return true;
    }
    let segments = raw.split('.').collect::<Vec<_>>();
    (2..=6).contains(&segments.len())
        && segments
            .iter()
            .all(|segment| !segment.is_empty() && segment.bytes().all(|byte| byte.is_ascii_digit()))
}

fn has_lifecycle_signal(value: &str) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return false;
    }
    if ["安装", "卸载", "更新", "维护工具"]
        .iter()
        .any(|marker| normalized.contains(marker))
    {
        return true;
    }
    normalized
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .any(|token| LIFECYCLE_TITLE_MARKERS.contains(&token))
}

pub fn activity_fact_requires_metadata_check(exe_name: &str) -> bool {
    let normalized = normalized_executable(exe_name);
    let stem = executable_stem(&normalized);
    let tokens = lifecycle_tokens(stem);
    normalized == "launcher.exe"
        || normalized == "launcher"
        || compact_lifecycle_parts(stem).is_some()
        || (tokens.len() >= 2
            && tokens.iter().any(|token| is_version_like(token))
            && tokens
                .iter()
                .any(|token| LIFECYCLE_BUILD_TOKENS.contains(token)))
}

pub fn should_track_activity_fact(exe_name: &str, app_name: &str, window_title: &str) -> bool {
    let normalized = normalized_executable(exe_name);
    let stem = executable_stem(&normalized);
    if normalized.ends_with(".tmp") || NON_TRACKABLE_EXES.contains(&stem) {
        return false;
    }
    if !is_standalone_uninstaller(stem) {
        if LIFECYCLE_MARKERS.contains(&stem) {
            return false;
        }
        if compact_lifecycle_parts(stem).is_some()
            && (compact_metadata_matches(stem, app_name)
                || compact_metadata_matches(stem, window_title))
        {
            return false;
        }
        let tokens = lifecycle_tokens(stem);
        if tokens.len() >= 2 && tokens.iter().any(|token| LIFECYCLE_MARKERS.contains(token)) {
            return false;
        }
    }

    let tokens = lifecycle_tokens(stem);
    if tokens.len() >= 2
        && tokens.iter().any(|token| is_version_like(token))
        && tokens
            .iter()
            .any(|token| LIFECYCLE_BUILD_TOKENS.contains(token))
        && (has_lifecycle_signal(app_name) || has_lifecycle_signal(window_title))
    {
        return false;
    }
    if matches!(normalized.as_str(), "launcher" | "launcher.exe")
        && [app_name, window_title]
            .iter()
            .any(|value| normalized_identity(value) == "wallpaperenginelauncher")
    {
        return false;
    }
    true
}

pub fn floor_to_hour(timestamp_ms: i64) -> i64 {
    timestamp_ms.div_euclid(HOUR_MS) * HOUR_MS
}

pub fn ceil_to_hour(timestamp_ms: i64) -> i64 {
    if timestamp_ms.rem_euclid(HOUR_MS) == 0 {
        timestamp_ms
    } else {
        floor_to_hour(timestamp_ms) + HOUR_MS
    }
}

pub fn resolve_activity_precedence<T: Clone>(
    records: &[OwnedActivityRange<T>],
) -> Vec<OwnedActivityRange<T>> {
    let indexed = records
        .iter()
        .cloned()
        .enumerate()
        .filter(|(_, range)| range.end_ms > range.start_ms)
        .map(|(index, range)| IndexedRange { index, range })
        .collect::<Vec<_>>();
    let native = indexed
        .iter()
        .filter(|candidate| candidate.range.origin == ActivityOrigin::Native)
        .cloned()
        .collect::<Vec<_>>();
    let mut exact = indexed
        .iter()
        .filter(|candidate| candidate.range.origin == ActivityOrigin::ImportExact)
        .cloned()
        .collect::<Vec<_>>();
    exact.sort_by_key(sort_key);
    let buckets = indexed
        .iter()
        .filter(|candidate| candidate.range.origin == ActivityOrigin::ImportBucket)
        .cloned()
        .collect::<Vec<_>>();

    let resolved_exact = resolve_exact_ranges(&native, &exact);
    let mut resolved = native.clone();
    resolved.extend(resolved_exact.iter().cloned());
    let occupied = merge_intervals(
        native
            .iter()
            .chain(resolved_exact.iter())
            .map(|candidate| Interval {
                start_ms: candidate.range.start_ms,
                end_ms: candidate.range.end_ms,
            })
            .collect(),
    );

    let mut buckets_by_window: BTreeMap<(i64, i64), Vec<IndexedRange<T>>> = BTreeMap::new();
    for candidate in buckets {
        let capacity_end_ms = candidate
            .range
            .capacity_end_ms
            .unwrap_or(candidate.range.end_ms);
        if capacity_end_ms <= candidate.range.start_ms {
            continue;
        }
        buckets_by_window
            .entry((candidate.range.start_ms, capacity_end_ms))
            .or_default()
            .push(candidate);
    }

    for ((window_start_ms, window_end_ms), mut group) in buckets_by_window {
        group.sort_by_key(|candidate| candidate.index);
        let occupied_duration = intersected_duration(&occupied, window_start_ms, window_end_ms);
        let mut available_duration = (window_end_ms - window_start_ms - occupied_duration).max(0);
        let mut remaining_requested = group
            .iter()
            .map(|candidate| candidate.range.end_ms - candidate.range.start_ms)
            .sum::<i64>();

        for candidate in group {
            let requested = candidate.range.end_ms - candidate.range.start_ms;
            let allocated = if remaining_requested <= available_duration {
                requested
            } else if remaining_requested > 0 {
                requested.saturating_mul(available_duration) / remaining_requested
            } else {
                0
            };
            if allocated > 0 {
                let mut allocated_candidate = candidate.clone();
                allocated_candidate.range.end_ms = allocated_candidate.range.start_ms + allocated;
                resolved.push(allocated_candidate);
            }
            remaining_requested -= requested;
            available_duration -= allocated;
        }
    }

    resolved.sort_by_key(sort_key);
    resolved
        .into_iter()
        .map(|candidate| candidate.range)
        .collect()
}

fn sort_key<T>(candidate: &IndexedRange<T>) -> (i64, ActivityOrigin, usize, i64) {
    (
        candidate.range.start_ms,
        candidate.range.origin,
        candidate.index,
        candidate.range.end_ms,
    )
}

fn resolve_exact_ranges<T: Clone>(
    native: &[IndexedRange<T>],
    exact: &[IndexedRange<T>],
) -> Vec<IndexedRange<T>> {
    #[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
    enum Boundary {
        End,
        Start,
    }

    #[derive(Clone, Copy, Eq, Ord, PartialEq, PartialOrd)]
    struct Event {
        time_ms: i64,
        boundary: Boundary,
        origin: ActivityOrigin,
        candidate_index: usize,
    }

    let mut events = Vec::with_capacity((native.len() + exact.len()) * 2);
    for candidate in native.iter().chain(exact.iter()) {
        events.push(Event {
            time_ms: candidate.range.start_ms,
            boundary: Boundary::Start,
            origin: candidate.range.origin,
            candidate_index: candidate.index,
        });
        events.push(Event {
            time_ms: candidate.range.end_ms,
            boundary: Boundary::End,
            origin: candidate.range.origin,
            candidate_index: candidate.index,
        });
    }
    events.sort_by_key(|event| event.time_ms);

    let exact_by_index = exact
        .iter()
        .map(|candidate| (candidate.index, candidate))
        .collect::<BTreeMap<_, _>>();
    let mut active_exact = BTreeSet::new();
    let mut active_native_count = 0_i64;
    let mut resolved: Vec<IndexedRange<T>> = Vec::new();
    let mut cursor = 0;
    while cursor < events.len() {
        let time_ms = events[cursor].time_ms;
        while cursor < events.len() && events[cursor].time_ms == time_ms {
            let event = events[cursor];
            if event.origin == ActivityOrigin::Native {
                active_native_count += if event.boundary == Boundary::Start {
                    1
                } else {
                    -1
                };
            } else if event.boundary == Boundary::Start {
                if let Some(candidate) = exact_by_index.get(&event.candidate_index) {
                    active_exact.insert(sort_key(candidate));
                }
            } else if let Some(candidate) = exact_by_index.get(&event.candidate_index) {
                active_exact.remove(&sort_key(candidate));
            }
            cursor += 1;
        }

        let Some(next_time_ms) = events.get(cursor).map(|event| event.time_ms) else {
            break;
        };
        if next_time_ms <= time_ms || active_native_count > 0 {
            continue;
        }
        let Some((_, _, winner_index, _)) = active_exact.iter().next().copied() else {
            continue;
        };
        let Some(winner) = exact_by_index.get(&winner_index) else {
            continue;
        };
        if let Some(previous) = resolved.last_mut() {
            if previous.index == winner_index && previous.range.end_ms == time_ms {
                previous.range.end_ms = next_time_ms;
                continue;
            }
        }
        let mut segment = (*winner).clone();
        segment.range.start_ms = time_ms;
        segment.range.end_ms = next_time_ms;
        resolved.push(segment);
    }
    resolved
}

fn merge_intervals(mut intervals: Vec<Interval>) -> Vec<Interval> {
    intervals.retain(|interval| interval.end_ms > interval.start_ms);
    intervals.sort_by_key(|interval| (interval.start_ms, interval.end_ms));
    let mut merged: Vec<Interval> = Vec::new();
    for interval in intervals {
        if let Some(previous) = merged.last_mut() {
            if interval.start_ms <= previous.end_ms {
                previous.end_ms = previous.end_ms.max(interval.end_ms);
                continue;
            }
        }
        merged.push(interval);
    }
    merged
}

fn intersected_duration(intervals: &[Interval], start_ms: i64, end_ms: i64) -> i64 {
    intervals
        .iter()
        .map(|interval| (end_ms.min(interval.end_ms) - start_ms.max(interval.start_ms)).max(0))
        .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(
        origin: ActivityOrigin,
        start_ms: i64,
        end_ms: i64,
        capacity_end_ms: Option<i64>,
        value: &'static str,
    ) -> OwnedActivityRange<&'static str> {
        OwnedActivityRange {
            origin,
            start_ms,
            end_ms,
            capacity_end_ms,
            value,
        }
    }

    #[test]
    fn native_masks_exact_and_reduces_bucket_capacity_globally() {
        let resolved = resolve_activity_precedence(&[
            range(ActivityOrigin::ImportExact, 0, 60, None, "exact"),
            range(ActivityOrigin::Native, 10, 30, None, "native"),
            range(ActivityOrigin::ImportBucket, 0, 40, Some(100), "bucket-a"),
            range(ActivityOrigin::ImportBucket, 0, 40, Some(100), "bucket-b"),
        ]);
        let compact = resolved
            .iter()
            .map(|item| (item.value, item.start_ms, item.end_ms))
            .collect::<Vec<_>>();
        assert_eq!(
            compact,
            vec![
                ("exact", 0, 10),
                ("bucket-a", 0, 20),
                ("bucket-b", 0, 20),
                ("native", 10, 30),
                ("exact", 30, 60),
            ]
        );
    }

    #[test]
    fn exact_winner_is_stable_and_lower_priority_reappears() {
        let resolved = resolve_activity_precedence(&[
            range(ActivityOrigin::ImportExact, 10, 80, None, "first"),
            range(ActivityOrigin::ImportExact, 20, 50, None, "second"),
            range(ActivityOrigin::Native, 30, 40, None, "native"),
        ]);
        let compact = resolved
            .iter()
            .map(|item| (item.value, item.start_ms, item.end_ms))
            .collect::<Vec<_>>();
        assert_eq!(
            compact,
            vec![("first", 10, 30), ("native", 30, 40), ("first", 40, 80),]
        );
    }

    #[test]
    fn app_keys_and_epoch_hours_are_deterministic() {
        assert_eq!(
            normalize_app_key("  \"Code.EXE\" "),
            Some("code.exe".into())
        );
        assert_eq!(normalize_app_key("Code"), Some("code.exe".into()));
        assert_eq!(normalize_app_key("   "), None);
        assert_eq!(floor_to_hour(HOUR_MS + 1), HOUR_MS);
        assert_eq!(ceil_to_hour(HOUR_MS + 1), HOUR_MS * 2);
        assert_eq!(ceil_to_hour(HOUR_MS), HOUR_MS);
    }

    #[test]
    fn legacy_lifecycle_facts_match_the_frontend_read_model_contract() {
        assert!(!should_track_activity_fact(
            "alma-0.0.750-win-x64.exe",
            "Alma",
            "Alma 安装"
        ));
        assert!(should_track_activity_fact(
            "alma-0.0.750-win-x64.exe",
            "Alma",
            "Alma"
        ));
        assert!(!should_track_activity_fact(
            "weixinupdate.exe",
            "WeChatUpdate",
            ""
        ));
        assert!(should_track_activity_fact(
            "productupdate.exe",
            "Productivity Update",
            ""
        ));
        assert!(!should_track_activity_fact(
            "launcher.exe",
            "Wallpaper Engine Launcher",
            ""
        ));
        assert!(should_track_activity_fact(
            "geek-uninstaller.exe",
            "Geek Uninstaller",
            ""
        ));
    }
}
