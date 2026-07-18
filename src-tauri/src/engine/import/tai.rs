//! Tai `时段.csv` -> `BackupPayload` conversion: BOM strip, local-time parse,
//! row-level skip, dynamic category discovery, back-to-back placement clamped
//! to each hour, merge-by-name against existing settings.

use crate::data::repositories;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::backup::{
    BackupMeta, BackupPayload, BackupSession, BackupSetting, BackupTitleSample,
    CURRENT_BACKUP_SCHEMA_VERSION, CURRENT_BACKUP_VERSION,
};
use chrono::{Local, NaiveDate, TimeZone};
use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::path::Path;

const HOUR_MS: i64 = 3_600_000;
/// One Tai 时段.csv row covers at most a full hour; bounding 时长 here also
/// keeps the downstream `dur_sec * 1000` overflow-free.
const MAX_DURATION_SEC: i64 = 3_600;
const APP_OVERRIDE_PREFIX: &str = "__app_override::";
const CUSTOM_CATEGORY_PREFIX: &str = "__custom_category::";
/// Guards `read_to_string` against loading an absurdly large file.
const MAX_TAI_FILE_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaiSkipReason {
    pub line: usize,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct TaiStats {
    pub rows_parsed: usize,
    pub sessions_created: usize,
    /// Sessions actually written by the Merge (0 on re-import). Filled in
    /// `import_file`; 0 at conversion time.
    pub sessions_inserted: usize,
    pub title_samples_created: usize,
    pub rows_skipped: usize,
    pub categories_created: usize,
    pub categories_reused: usize,
}

#[derive(Clone, Debug)]
pub struct TaiConversion {
    pub payload: BackupPayload,
    pub skipped: Vec<TaiSkipReason>,
    pub stats: TaiStats,
}

/// IPC report returned by `cmd_import_tai_file`. Stable frontend contract — a
/// subset of [`TaiStats`] surfaced in the post-import toast.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportTaiReport {
    pub sessions_created: usize,
    /// Sessions actually written by the Merge (0 on re-import).
    pub sessions_inserted: usize,
    pub categories_created: usize,
    pub categories_reused: usize,
    pub rows_skipped: usize,
}

impl ImportTaiReport {
    pub fn from_stats(stats: &TaiStats) -> Self {
        Self {
            sessions_created: stats.sessions_created,
            sessions_inserted: stats.sessions_inserted,
            categories_created: stats.categories_created,
            categories_reused: stats.categories_reused,
            rows_skipped: stats.rows_skipped,
        }
    }
}

/// When false, the `__custom_category::*` and bound `__app_override::*`
/// settings are skipped; sessions/title_samples are always produced.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TaiConvertOptions {
    pub import_categories: bool,
}

impl Default for TaiConvertOptions {
    fn default() -> Self {
        Self {
            import_categories: true,
        }
    }
}

/// How the Merge write handles a Tai session whose time span overlaps an
/// existing DB session (cases the `(exe, start_time)` natural key misses).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TaiOverlapMode {
    /// Skip Tai sessions whose span intersects an existing session.
    Skip,
    /// Insert all — current behavior, coexist via `(exe, start_time)` dedup.
    Coexist,
}

impl Default for TaiOverlapMode {
    fn default() -> Self {
        Self::Skip
    }
}

/// IPC input for `cmd_import_tai_file`. Drives the convert stage
/// (`import_categories`) and the merge stage (`overlap_mode`) independently.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaiImportOptions {
    pub import_categories: bool,
    pub overlap_mode: TaiOverlapMode,
}

impl Default for TaiImportOptions {
    fn default() -> Self {
        Self {
            import_categories: false,
            overlap_mode: TaiOverlapMode::default(),
        }
    }
}

/// Conversion-time preview returned by `cmd_parse_tai_file` (no DB dry-run).
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaiParsePreview {
    pub sessions_created: usize,
    pub title_samples_created: usize,
    pub categories_created: usize,
    pub categories_reused: usize,
    pub rows_skipped: usize,
}

impl TaiParsePreview {
    pub fn from_stats(stats: &TaiStats) -> Self {
        Self {
            sessions_created: stats.sessions_created,
            title_samples_created: stats.title_samples_created,
            categories_created: stats.categories_created,
            categories_reused: stats.categories_reused,
            rows_skipped: stats.rows_skipped,
        }
    }
}

/// Core converter over raw CSV text. Deterministic for a fixed host TZ.
/// Errors if a required Tai column (`时段`/`应用`/`时长`) is missing; malformed
/// rows are skipped, not fatal.
pub fn convert_text(
    csv_text: &str,
    existing_settings: &[BackupSetting],
) -> Result<TaiConversion, String> {
    convert_text_with_options(csv_text, existing_settings, TaiConvertOptions::default())
}

pub fn convert_text_with_options(
    csv_text: &str,
    existing_settings: &[BackupSetting],
    options: TaiConvertOptions,
) -> Result<TaiConversion, String> {
    let text = csv_text.strip_prefix('\u{feff}').unwrap_or(csv_text);

    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(text.as_bytes());
    let headers = rdr.headers().map(|h| h.to_owned()).unwrap_or_default();
    for required in ["时段", "应用", "时长"] {
        if !headers.iter().any(|h| h == required) {
            return Err(format!(
                "not a valid Tai 时段.csv: missing required column {required:?}"
            ));
        }
    }

    let mut skipped: Vec<TaiSkipReason> = Vec::new();
    let mut norm_rows: Vec<NormRow> = Vec::new();
    let mut rows_parsed = 0usize;
    let mut data_line: usize = 1; // header is source line 1

    for result in rdr.records() {
        let rec = match result {
            Ok(r) => r,
            Err(_) => {
                data_line += 1;
                rows_parsed += 1;
                skipped.push(TaiSkipReason {
                    line: data_line,
                    reason: "csv parse error".to_string(),
                });
                continue;
            }
        };
        // Blank rows are invisible (not counted, not skipped): a trailing
        // newline yields no bogus skip.
        if rec.is_empty() || rec.iter().all(|f| f.is_empty()) {
            continue;
        }
        rows_parsed += 1;
        data_line += 1;
        let line = data_line;

        let ts = cell(&headers, &rec, "时段");
        let bucket_ms = match parse_hour_bucket_ms(ts) {
            Some(ms) => ms,
            None => {
                skipped.push(TaiSkipReason {
                    line,
                    reason: format!("unparseable 时段: {ts:?}"),
                });
                continue;
            }
        };

        let app = cell(&headers, &rec, "应用");
        if app.is_empty() {
            skipped.push(TaiSkipReason {
                line,
                reason: "empty 应用".to_string(),
            });
            continue;
        }

        let dur_raw = cell(&headers, &rec, "时长");
        // Integer parse rejects non-numeric/fractional/inf/nan and bounds the
        // downstream `* 1000`.
        let dur_sec: i64 = match dur_raw.parse() {
            Ok(v) => v,
            Err(_) => {
                skipped.push(TaiSkipReason {
                    line,
                    reason: format!("non-integer 时长: {dur_raw:?}"),
                });
                continue;
            }
        };
        if dur_sec <= 0 || dur_sec > MAX_DURATION_SEC {
            skipped.push(TaiSkipReason {
                line,
                reason: format!("non-positive or over-limit 时长: {dur_raw:?}"),
            });
            continue;
        }

        let desc = cell(&headers, &rec, "描述");
        let label = if desc.is_empty() {
            app.to_string()
        } else {
            desc.to_string()
        };
        norm_rows.push(NormRow {
            line,
            bucket_ms,
            duration_ms: dur_sec * 1000,
            canonical_exe: normalize_exe(app),
            display_app: app.to_string(),
            label,
            category_label: cell(&headers, &rec, "分类").to_string(),
        });
    }

    // Group by hour bucket, preserve CSV order within each bucket.
    let mut by_bucket: HashMap<i64, Vec<NormRow>> = HashMap::new();
    for r in &norm_rows {
        by_bucket.entry(r.bucket_ms).or_default().push(r.clone());
    }
    let mut buckets_asc: Vec<i64> = by_bucket.keys().copied().collect();
    buckets_asc.sort_unstable();

    let mut sessions: Vec<BackupSession> = Vec::new();
    let mut title_samples: Vec<BackupTitleSample> = Vec::new();
    let mut used_rows: Vec<NormRow> = Vec::new();
    let mut next_id: i64 = 1;

    for bucket in buckets_asc {
        let rows = by_bucket.remove(&bucket).unwrap_or_default();
        let bucket_end = bucket + HOUR_MS;
        let mut cursor = bucket;
        for r in rows {
            if cursor >= bucket_end {
                skipped.push(TaiSkipReason {
                    line: r.line,
                    reason: "hour bucket full".to_string(),
                });
                continue;
            }
            let end = std::cmp::min(cursor + r.duration_ms, bucket_end);
            let dur = end - cursor;
            if dur <= 0 {
                skipped.push(TaiSkipReason {
                    line: r.line,
                    reason: "hour bucket full".to_string(),
                });
                continue;
            }
            let id = next_id;
            next_id += 1;
            sessions.push(BackupSession {
                id,
                app_name: r.label.clone(),
                exe_name: r.canonical_exe.clone(),
                window_title: Some(r.label.clone()),
                start_time: cursor,
                end_time: Some(end),
                duration: Some(dur),
                continuity_group_start_time: Some(cursor),
            });
            title_samples.push(BackupTitleSample {
                id,
                session_id: id,
                title: r.label.clone(),
                start_time: cursor,
                end_time: Some(end),
            });
            used_rows.push(r);
            cursor = end;
        }
    }

    validate_placement(&sessions);

    let mut settings: Vec<BackupSetting> = Vec::new();
    let mut categories_created = 0usize;
    let mut categories_reused = 0usize;

    // Deterministic stand-in for now: earliest session start, so the same CSV
    // re-imports byte-identical. Feeds meta.exported_at_ms / override updatedAt.
    let anchor_ms = sessions.iter().map(|s| s.start_time).min().unwrap_or(0);

    // Categories and their app overrides are emitted only when opted in.
    if options.import_categories {
        // An exe tagged with >1 distinct category is ambiguous — skip its
        // override and don't build its category (no orphans); its sessions still
        // import. exe_order preserves insertion order for deterministic output.
        let mut exe_labels: HashMap<String, (HashSet<String>, String, String)> = HashMap::new();
        let mut exe_order: Vec<String> = Vec::new();
        for r in &used_rows {
            if r.category_label.is_empty() || is_unknown_category(&r.category_label) {
                continue;
            }
            let exe = r.canonical_exe.clone();
            let norm = normalize_category_label(&r.category_label);
            match exe_labels.entry(exe.clone()) {
                Entry::Vacant(v) => {
                    exe_order.push(exe);
                    let mut labels = HashSet::new();
                    labels.insert(norm);
                    v.insert((labels, r.category_label.clone(), r.display_app.clone()));
                }
                Entry::Occupied(mut v) => {
                    v.get_mut().0.insert(norm);
                }
            }
        }
        // Single-category exes only; multi-category exes are dropped.
        let mut exe_info: HashMap<String, ExeInfo> = HashMap::new();
        for exe in &exe_order {
            let (labels, raw_label, display) = &exe_labels[exe];
            if labels.len() > 1 {
                continue;
            }
            exe_info.insert(
                exe.clone(),
                ExeInfo {
                    label: raw_label.clone(),
                    display: display.clone(),
                },
            );
        }

        let mut label_to_id: HashMap<String, String> = HashMap::new();
        let mut override_exes: HashSet<String> = HashSet::new();
        for s in existing_settings {
            if let Some(id) = s.key.strip_prefix(CUSTOM_CATEGORY_PREFIX) {
                label_to_id.insert(normalize_category_label(&s.value), id.to_string());
            } else if let Some(exe) = s.key.strip_prefix(APP_OVERRIDE_PREFIX) {
                override_exes.insert(exe.to_string());
            }
        }

        // Distinct labels among single-category exes, in exe insertion order.
        let mut distinct_labels: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        for exe in &exe_order {
            if let Some(info) = exe_info.get(exe) {
                if seen.insert(info.label.clone()) {
                    distinct_labels.push(info.label.clone());
                }
            }
        }
        for label in &distinct_labels {
            let norm = normalize_category_label(label);
            match label_to_id.entry(norm) {
                Entry::Occupied(_) => categories_reused += 1,
                Entry::Vacant(v) => {
                    let id = build_custom_category_id(label);
                    v.insert(id.clone());
                    settings.push(BackupSetting {
                        key: format!("{CUSTOM_CATEGORY_PREFIX}{id}"),
                        value: label.clone(),
                    });
                    categories_created += 1;
                }
            }
        }

        for exe in &exe_order {
            if override_exes.contains(exe) {
                continue;
            }
            let info = match exe_info.get(exe) {
                Some(i) => i,
                None => continue, // multi-category exe — no override
            };
            let cat_id = match label_to_id.get(&normalize_category_label(&info.label)) {
                Some(id) => id.clone(),
                None => continue, // label resolution failed — skip defensively
            };
            let value = serde_json::json!({
                "enabled": true,
                "updatedAt": anchor_ms,
                "category": cat_id,
                "displayName": info.display,
            })
            .to_string();
            settings.push(BackupSetting {
                key: format!("{APP_OVERRIDE_PREFIX}{exe}"),
                value,
            });
        }
    }

    let payload = BackupPayload {
        version: CURRENT_BACKUP_VERSION,
        meta: BackupMeta {
            exported_at_ms: anchor_ms as u64,
            schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
            app_version: "tai-import".to_string(),
        },
        sessions,
        title_samples,
        settings,
        icon_cache: Vec::new(),
        web_activity_segments: Vec::new(),
        web_favicon_cache: Vec::new(),
        tool_reminders: Vec::new(),
        tool_timers: Vec::new(),
        tool_timer_laps: Vec::new(),
        tool_pomodoro_runs: Vec::new(),
        tool_daily_stats: Vec::new(),
        tool_software_reminder_rules: Vec::new(),
    };

    Ok(TaiConversion {
        stats: TaiStats {
            rows_parsed,
            sessions_created: payload.sessions.len(),
            sessions_inserted: 0,
            title_samples_created: payload.title_samples.len(),
            rows_skipped: skipped.len(),
            categories_created,
            categories_reused,
        },
        skipped,
        payload,
    })
}

/// Read a Tai CSV with a size cap and explicit UTF-8 handling: over-limit or
/// non-UTF-8 files are rejected before parsing.
fn read_tai_csv(path: &Path) -> Result<String, String> {
    let len = std::fs::metadata(path)
        .map_err(|e| format!("read {}: {e}", path.display()))?
        .len();
    if len > MAX_TAI_FILE_BYTES {
        return Err(format!(
            "tai csv too large: {len} bytes exceeds {MAX_TAI_FILE_BYTES} byte limit"
        ));
    }
    std::fs::read_to_string(path)
        .map_err(|e| format!("read {} (not valid UTF-8?): {e}", path.display()))
}

/// File-based entry point for the preview path; import_file uses `convert_with_options`.
pub fn convert(path: &Path, existing_settings: &[BackupSetting]) -> Result<TaiConversion, String> {
    let text = read_tai_csv(path)?;
    convert_text(&text, existing_settings)
}

pub fn convert_with_options(
    path: &Path,
    existing_settings: &[BackupSetting],
    options: TaiConvertOptions,
) -> Result<TaiConversion, String> {
    let text = read_tai_csv(path)?;
    convert_text_with_options(&text, existing_settings, options)
}

/// Convert-only preview; reads existing settings so reuse counts are accurate.
pub async fn parse_file(app: &tauri::AppHandle, path: &Path) -> Result<TaiParsePreview, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let existing = repositories::settings::fetch_all_for_backup(&pool).await?;
    let conversion = convert(path, &existing)?;
    Ok(TaiParsePreview::from_stats(&conversion.stats))
}

/// Convert + Merge in one call (engine owns the pool/repositories).
/// `import_categories` shapes conversion; `overlap_mode` selects the merge path.
pub async fn import_file(
    app: &tauri::AppHandle,
    path: &Path,
    options: TaiImportOptions,
) -> Result<TaiConversion, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let existing = repositories::settings::fetch_all_for_backup(&pool).await?;
    let mut conversion = convert_with_options(
        path,
        &existing,
        TaiConvertOptions {
            import_categories: options.import_categories,
        },
    )?;
    let session_merge = match options.overlap_mode {
        TaiOverlapMode::Skip => repositories::sessions::SessionMergePolicy::SkipOverlapping,
        TaiOverlapMode::Coexist => repositories::sessions::SessionMergePolicy::ByNaturalKey,
    };
    let restore =
        crate::data::backup::merge_backup_payload(app, &conversion.payload, session_merge).await?;
    // Backfill the DB-authoritative insert count.
    conversion.stats.sessions_inserted = restore.sessions_inserted;
    Ok(conversion)
}

#[derive(Clone)]
struct NormRow {
    line: usize,
    bucket_ms: i64,
    duration_ms: i64,
    canonical_exe: String,
    display_app: String,
    label: String,
    category_label: String,
}

#[derive(Clone)]
struct ExeInfo {
    label: String,
    display: String,
}

fn cell<'a>(headers: &csv::StringRecord, rec: &'a csv::StringRecord, col: &str) -> &'a str {
    match headers.iter().position(|h| h == col) {
        Some(idx) => rec.get(idx).map(str::trim).unwrap_or(""),
        None => "",
    }
}

/// Parse `MM/DD/YYYY HH:MM:SS` (local) -> epoch ms. None if unparseable, the
/// date is invalid, or the local time is an ambiguous DST gap/fold.
fn parse_hour_bucket_ms(ts: &str) -> Option<i64> {
    let s = ts.trim();
    let mut parts = s.split_whitespace();
    let date = parts.next()?;
    let time = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let dc: Vec<&str> = date.split('/').collect();
    if dc.len() != 3 || dc[2].len() != 4 {
        return None;
    }
    let tc: Vec<&str> = time.split(':').collect();
    if tc.len() != 3 || tc[1].len() != 2 || tc[2].len() != 2 {
        return None;
    }
    let mo: u32 = dc[0].parse().ok()?;
    let d: u32 = dc[1].parse().ok()?;
    let y: i32 = dc[2].parse().ok()?;
    let h: u32 = tc[0].parse().ok()?;
    let mi: u32 = tc[1].parse().ok()?;
    let se: u32 = tc[2].parse().ok()?;
    let ndt = NaiveDate::from_ymd_opt(y, mo, d)?.and_hms_opt(h, mi, se)?;
    let local = Local.from_local_datetime(&ndt).single()?;
    Some(local.timestamp_millis())
}

/// Strip surrounding quotes, lowercase, ensure `.exe`.
fn normalize_exe(raw: &str) -> String {
    let mut v = raw.trim().trim_matches('"').to_ascii_lowercase();
    if !v.is_empty() && !v.ends_with(".exe") {
        v.push_str(".exe");
    }
    v
}

/// Trim, collapse internal whitespace, cap at 20 chars.
fn normalize_category_label(label: &str) -> String {
    label
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ")
        .chars()
        .take(20)
        .collect()
}

/// Tai `未知` means "unclassified" — treat like an empty label (no category,
/// no override) so the exe falls back to Patina's default.
fn is_unknown_category(label: &str) -> bool {
    normalize_category_label(label) == "未知"
}

/// `custom:` + the percent-encoded normalized label.
fn build_custom_category_id(label: &str) -> String {
    format!(
        "custom:{}",
        js_encode_uri_component(&normalize_category_label(label))
    )
}

/// Percent-encode: unescaped set `A-Za-z0-9-_.!~*'()`, rest as `%XX`.
fn js_encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn validate_placement(sessions: &[BackupSession]) {
    for s in sessions {
        debug_assert!(s.start_time < s.end_time.unwrap_or(i64::MIN));
    }
    let mut sorted: Vec<&BackupSession> = sessions.iter().collect();
    sorted.sort_by_key(|s| s.start_time);
    for pair in sorted.windows(2) {
        debug_assert!(pair[1].start_time >= pair[0].end_time.unwrap_or(i64::MAX));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const HDR: &str = "时段,应用,时长,描述,分类\n";

    fn convert(csv: &str) -> TaiConversion {
        convert_text(csv, &[]).unwrap()
    }

    #[test]
    fn converts_basic_single_row() {
        let csv = format!("{}01/15/2026 09:00:00,Chrome.EXE,1800,Browsing,网络", HDR);
        let c = convert(&csv);
        assert_eq!(c.stats.sessions_created, 1);
        assert_eq!(c.stats.rows_skipped, 0);
        let s = &c.payload.sessions[0];
        assert_eq!(s.exe_name, "chrome.exe"); // normalized: lowercase + .exe
        assert_eq!(s.app_name, "Browsing");
        assert_eq!(s.window_title.as_deref(), Some("Browsing"));
        assert_eq!(s.end_time.unwrap() - s.start_time, 1_800_000);
        assert_eq!(s.duration.unwrap(), 1_800_000);
        assert_eq!(s.continuity_group_start_time, Some(s.start_time));
        assert_eq!(c.payload.title_samples.len(), 1);
        let t = &c.payload.title_samples[0];
        assert_eq!(t.title, "Browsing");
        assert_eq!(t.session_id, s.id);
        assert_eq!(c.stats.categories_created, 1);
        assert!(c
            .payload
            .settings
            .iter()
            .any(|s| s.key == "__custom_category::custom:%E7%BD%91%E7%BB%9C" && s.value == "网络"));
        assert!(c
            .payload
            .settings
            .iter()
            .any(|s| s.key == "__app_override::chrome.exe"));
    }

    #[test]
    fn description_falls_back_to_app_when_empty() {
        let csv = format!("{}01/15/2026 09:00:00,app.exe,600,,ACG", HDR);
        let c = convert(&csv);
        let s = &c.payload.sessions[0];
        assert_eq!(s.app_name, "app.exe"); // empty 描述 -> label = app
        assert_eq!(s.window_title.as_deref(), Some("app.exe"));
    }

    #[test]
    fn skips_unparseable_timestamp() {
        let csv = format!("{}not-a-date,app.exe,600,D,C", HDR);
        let c = convert(&csv);
        assert_eq!(c.stats.sessions_created, 0);
        assert_eq!(c.stats.rows_skipped, 1);
        assert!(c.skipped[0].reason.contains("unparseable"));
    }

    #[test]
    fn skips_empty_app() {
        let csv = format!("{}01/15/2026 09:00:00,,600,D,C", HDR);
        let c = convert(&csv);
        assert_eq!(c.stats.rows_skipped, 1);
        assert!(c.skipped[0].reason.contains("empty 应用"));
        assert_eq!(c.stats.sessions_created, 0);
    }

    #[test]
    fn skips_non_integer_and_non_positive_duration() {
        let csv = format!(
            "{}01/15/2026 09:00:00,a.exe,3.5,D,C\n01/15/2026 10:00:00,b.exe,0,D,C\n01/15/2026 11:00:00,c.exe,-5,D,C",
            HDR
        );
        let c = convert(&csv);
        assert_eq!(c.stats.rows_skipped, 3);
        assert_eq!(c.stats.sessions_created, 0);
        assert!(c.skipped.iter().all(|s| s.reason.contains("时长")));
    }

    #[test]
    fn rejects_non_tai_csv_missing_required_columns() {
        // Missing required columns → hard error, not silent 0-session success.
        let result = convert_text("foo,bar,baz\n1,2,3\n", &[]);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("not a valid Tai 时段.csv"));
        assert!(err.contains("时段"));
    }

    #[test]
    fn places_back_to_back_and_clamps_to_hour() {
        // Two 40-min rows in one hour: 40min + 20min(clamped), no skip.
        let csv = format!(
            "{}01/15/2026 09:00:00,a.exe,2400,A,X\n01/15/2026 09:00:00,b.exe,2400,B,X",
            HDR
        );
        let c = convert(&csv);
        assert_eq!(c.stats.sessions_created, 2);
        assert_eq!(c.stats.rows_skipped, 0);
        let s0 = &c.payload.sessions[0];
        let s1 = &c.payload.sessions[1];
        assert_eq!(s0.start_time, s0.continuity_group_start_time.unwrap());
        assert_eq!(s1.start_time, s0.end_time.unwrap()); // back-to-back
        assert_eq!(s0.end_time.unwrap() - s0.start_time, 2_400_000);
        assert_eq!(s1.end_time.unwrap() - s1.start_time, 1_200_000); // clamped to 20min
                                                                     // both within [bucket, bucket+1h)
        assert!(s1.end_time.unwrap() - s0.start_time <= HOUR_MS);
    }

    #[test]
    fn overflows_full_bucket_are_skipped() {
        // Three 40-min rows: 40 + 20 + (bucket full).
        let csv = format!(
            "{}01/15/2026 09:00:00,a.exe,2400,A,X\n01/15/2026 09:00:00,b.exe,2400,B,X\n01/15/2026 09:00:00,c.exe,2400,C,X",
            HDR
        );
        let c = convert(&csv);
        assert_eq!(c.stats.sessions_created, 2);
        assert_eq!(c.stats.rows_skipped, 1);
        assert_eq!(c.skipped[0].reason, "hour bucket full");
    }

    #[test]
    fn multi_hour_buckets_are_sorted_ascending() {
        let csv = format!(
            "{}01/15/2026 10:00:00,b.exe,600,B,X\n01/15/2026 09:00:00,a.exe,600,A,X",
            HDR
        );
        let c = convert(&csv);
        assert_eq!(c.stats.sessions_created, 2);
        let (s0, s1) = (&c.payload.sessions[0], &c.payload.sessions[1]);
        assert_eq!(s0.app_name, "A"); // hour 9 placed first despite CSV order
        assert_eq!(s1.app_name, "B");
        assert!(s1.start_time - s0.start_time >= HOUR_MS);
    }

    #[test]
    fn discovers_categories_dynamically() {
        let csv = format!(
            "{}01/15/2026 09:00:00,a.exe,600,A,X\n01/15/2026 10:00:00,b.exe,600,B,Y",
            HDR
        );
        let c = convert(&csv);
        assert_eq!(c.stats.categories_created, 2);
        let cats: Vec<&str> = c
            .payload
            .settings
            .iter()
            .filter(|s| s.key.starts_with("__custom_category::"))
            .map(|s| s.value.as_str())
            .collect();
        assert_eq!(cats, vec!["X", "Y"]); // first-occurrence order
    }

    #[test]
    fn reuses_existing_category_by_name() {
        let existing = vec![BackupSetting {
            key: "__custom_category::custom:Deep%20Work".to_string(),
            value: "Deep Work".to_string(),
        }];
        let csv = format!("{}01/15/2026 09:00:00,a.exe,600,A,Deep Work", HDR);
        let c = convert_text(&csv, &existing).unwrap();
        assert_eq!(c.stats.categories_reused, 1);
        assert_eq!(c.stats.categories_created, 0);
        // no new __custom_category emitted; override points at existing id.
        assert!(c
            .payload
            .settings
            .iter()
            .all(|s| !s.key.starts_with("__custom_category::")));
        let ov = c
            .payload
            .settings
            .iter()
            .find(|s| s.key == "__app_override::a.exe")
            .expect("override created");
        assert!(ov.value.contains("\"category\":\"custom:Deep%20Work\""));
    }

    #[test]
    fn skips_override_for_exe_with_existing_rule() {
        let existing = vec![BackupSetting {
            key: "__app_override::foo.exe".to_string(),
            value: "{\"enabled\":true}".to_string(),
        }];
        let csv = format!("{}01/15/2026 09:00:00,foo.exe,600,A,X", HDR);
        let c = convert_text(&csv, &existing).unwrap();
        assert!(c
            .payload
            .settings
            .iter()
            .all(|s| s.key != "__app_override::foo.exe")); // not overwritten
        assert_eq!(c.stats.categories_created, 1); // X is still a new category
    }

    #[test]
    fn is_unknown_category_normalizes_whitespace() {
        assert!(is_unknown_category("未知"));
        assert!(is_unknown_category(" 未知 "));
        assert!(!is_unknown_category("工作"));
        assert!(!is_unknown_category(""));
    }

    #[test]
    fn unknown_category_maps_to_uncategorized() {
        // Tai `未知` → Patina `未分类`: no custom category, no app override; the
        // exe falls back to other/未分类.
        let csv = format!("{}01/15/2026 09:00:00,a.exe,600,A,未知", HDR);
        let c = convert(&csv);
        assert_eq!(c.stats.sessions_created, 1);
        assert_eq!(c.stats.categories_created, 0);
        assert_eq!(c.stats.categories_reused, 0);
        // no custom category and no override emitted for the exe
        assert!(c
            .payload
            .settings
            .iter()
            .all(|s| !s.key.starts_with("__custom_category::")));
        assert!(c
            .payload
            .settings
            .iter()
            .all(|s| s.key != "__app_override::a.exe"));
        assert!(c.payload.settings.iter().all(|s| !s.value.contains("未知")));
    }

    #[test]
    fn mixed_unknown_and_real_label_prefers_real() {
        // First non-`未知` label wins; exe isn't stranded in 未分类.
        let csv = format!(
            "{}01/15/2026 09:00:00,a.exe,600,A,未知\n01/15/2026 10:00:00,a.exe,600,A2,工作",
            HDR
        );
        let c = convert(&csv);
        assert_eq!(c.stats.categories_created, 1); // only 工作
        assert!(c.payload.settings.iter().any(|s| s.value == "工作"));
        let ov = c
            .payload
            .settings
            .iter()
            .find(|s| s.key == "__app_override::a.exe")
            .expect("override created for the real label");
        let expected_cat = build_custom_category_id("工作");
        assert!(ov
            .value
            .contains(&format!("\"category\":\"{expected_cat}\"")));
        assert!(c.payload.settings.iter().all(|s| !s.value.contains("未知")));
    }

    #[test]
    fn bom_prefix_is_stripped() {
        let raw = format!("{}01/15/2026 09:00:00,a.exe,600,A,X", HDR);
        let bommed = format!("\u{feff}{}", raw);
        let a = convert_text(&raw, &[]).unwrap();
        let b = convert_text(&bommed, &[]).unwrap();
        assert_eq!(
            serde_json::to_string(&a.payload).unwrap(),
            serde_json::to_string(&b.payload).unwrap()
        );
    }

    #[test]
    fn deterministic_for_same_input() {
        let csv = format!(
            "{}01/15/2026 09:00:00,a.exe,600,A,X\n01/15/2026 10:00:00,b.exe,900,B,Y",
            HDR
        );
        let a = convert_text(&csv, &[]).unwrap();
        let b = convert_text(&csv, &[]).unwrap();
        assert_eq!(a.stats, b.stats);
        assert_eq!(a.skipped, b.skipped);
        assert_eq!(
            serde_json::to_string(&a.payload).unwrap(),
            serde_json::to_string(&b.payload).unwrap()
        );
    }

    #[test]
    fn placement_is_non_overlapping_and_start_before_end() {
        let csv = format!(
            "{}01/15/2026 09:00:00,a.exe,2400,A,X\n01/15/2026 09:00:00,b.exe,600,B,X\n01/15/2026 10:00:00,c.exe,600,C,Y",
            HDR
        );
        let c = convert(&csv);
        let mut sorted = c.payload.sessions.clone();
        sorted.sort_by_key(|s| s.start_time);
        for s in &sorted {
            assert!(s.start_time < s.end_time.unwrap());
        }
        for w in sorted.windows(2) {
            assert!(w[1].start_time >= w[0].end_time.unwrap());
        }
    }

    #[test]
    fn encode_uri_component_matches_js_for_cjk_and_spaces() {
        assert_eq!(js_encode_uri_component("Deep Work"), "Deep%20Work");
        assert_eq!(js_encode_uri_component("网络"), "%E7%BD%91%E7%BB%9C");
        assert_eq!(js_encode_uri_component("A-B_c.d"), "A-B_c.d");
    }

    /// Synthetic Tai 时段.csv: 5 rows, 3 distinct 分类, 2 skipped.
    const TAI_FIXTURE_CSV: &str = "时段,应用,时长,描述,分类
01/15/2026 09:00:00,Chrome,1800,Browsing,网络
01/15/2026 09:00:00,Code,2400,Coding,工作
01/15/2026 09:00:00,Music,600,Jam,娱乐
not-a-date,X.exe,600,D,D
01/15/2026 10:00:00,Chrome,600,Read,网络";

    #[test]
    fn converts_fixture_to_ms_epoch_payload() {
        let conv = convert_text(TAI_FIXTURE_CSV, &[]).unwrap();
        assert_eq!(conv.stats.sessions_created, 3);
        assert_eq!(conv.stats.rows_skipped, 2);

        // Sessions carry epoch-millisecond start/end/duration.
        let mut sessions = conv.payload.sessions.clone();
        sessions.sort_by_key(|s| s.start_time);
        assert_eq!(sessions.len(), 3);
        for s in &sessions {
            let (end, dur) = (s.end_time.unwrap(), s.duration.unwrap());
            assert!(dur > 0);
            assert_eq!(end - s.start_time, dur); // ms consistency: end-start == duration
        }
        // Row 1: 1800s → 1_800_000 ms; row 2: clamped to 30 min; row 3: 600s.
        assert_eq!(sessions[0].duration.unwrap(), 1_800_000);
        assert_eq!(sessions[1].duration.unwrap(), 1_800_000);
        assert_eq!(sessions[2].duration.unwrap(), 600_000);
        // Globally non-overlapping.
        for w in sessions.windows(2) {
            assert!(w[1].start_time >= w[0].end_time.unwrap());
        }

        // 2 categories (网络, 工作) + 2 overrides = 4. Music's 娱乐 isn't built:
        // its row was skipped, so only categories whose exe produced a session count.
        assert_eq!(conv.payload.settings.len(), 4);

        // Title samples mirror sessions 1:1.
        assert_eq!(conv.payload.title_samples.len(), 3);
    }

    #[test]
    fn convert_does_not_mutate_source_file() {
        let pid = std::process::id();
        let path = std::env::temp_dir().join(format!("patina-tai-fixture-{pid}.csv"));
        std::fs::write(&path, TAI_FIXTURE_CSV).unwrap();

        let before = std::fs::read(&path).unwrap();
        let _ = super::convert(&path, &[]).expect("convert should succeed on valid fixture");
        let after = std::fs::read(&path).unwrap();

        assert_eq!(before, after, "source CSV bytes must be byte-identical");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn rejects_over_limit_and_huge_durations_without_overflow() {
        // Over-limit (5000s > 1h cap) and out-of-i64-range integers are
        // rejected before reaching `* 1000`.
        let csv = format!(
            "{}01/15/2026 09:00:00,a.exe,5000,D,C\n01/15/2026 10:00:00,b.exe,9999999999999999999,D,C",
            HDR
        );
        let c = convert(&csv);
        assert_eq!(c.stats.rows_skipped, 2);
        assert_eq!(c.stats.sessions_created, 0);
        assert!(c.skipped.iter().all(|s| s.reason.contains("时长")));
    }

    #[test]
    fn same_exe_multiple_categories_skips_override_for_that_exe() {
        // 同 exe 多分类 → 不写 override 也不建分类（避免孤儿）；
        // sessions 照常导入，单分类 exe 不受影响。
        let csv = format!(
            "{}01/15/2026 09:00:00,a.exe,600,A,工作\n01/15/2026 10:00:00,a.exe,600,A2,娱乐\n01/15/2026 11:00:00,b.exe,600,B,网络",
            HDR
        );
        let c = convert(&csv);
        assert_eq!(c.stats.sessions_created, 3); // sessions 不受分类决策影响
        assert_eq!(c.stats.categories_created, 1); // 只有 b.exe→网络（a.exe 多分类跳过）
                                                   // b.exe 单分类 → 正常 override
        assert!(c
            .payload
            .settings
            .iter()
            .any(|s| s.key == "__app_override::b.exe"));
        // a.exe 多分类 → 无 override，且工作/娱乐 都不建（无孤儿）
        assert!(c
            .payload
            .settings
            .iter()
            .all(|s| s.key != "__app_override::a.exe"));
        assert!(c.payload.settings.iter().all(|s| s.value != "工作"));
        assert!(c.payload.settings.iter().all(|s| s.value != "娱乐"));
    }

    #[test]
    fn read_tai_csv_rejects_missing_file() {
        let path = std::path::Path::new("nonexistent-tai-file.csv");
        let result = read_tai_csv(path);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_lowercase().contains("read"));
    }

    #[test]
    fn read_tai_csv_rejects_non_utf8_file() {
        // Non-UTF-8 bytes are rejected (read_to_string Err) with a hint.
        let pid = std::process::id();
        let path = std::env::temp_dir().join(format!("patina-tai-nonutf8-{pid}.csv"));
        std::fs::write(&path, b"\xff\xfe not valid utf8").unwrap();
        let result = read_tai_csv(&path);
        let _ = std::fs::remove_file(&path);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_lowercase().contains("utf"));
    }
}
