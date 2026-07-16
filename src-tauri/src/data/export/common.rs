use chrono::{DateTime, Datelike, Timelike};
use serde_json::Value;
use sqlx::{Pool, Row, Sqlite};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_EXPORT_FIELDS: &[&str] = &[
    "record_type",
    "category",
    "start_time",
    "end_time",
    "duration_ms",
    "app_name",
    "exe_name",
    "window_title",
    "domain",
    "normalized_domain",
    "url",
    "page_title",
];

pub const ALL_EXPORT_FIELDS: &[&str] = &[
    "record_type",
    "category",
    "start_time",
    "end_time",
    "duration_ms",
    "app_name",
    "exe_name",
    "window_title",
    "domain",
    "normalized_domain",
    "url",
    "page_title",
    "category_id",
    "local_date",
    "local_week",
    "local_month",
    "weekday",
    "start_hour",
    "duration_minutes",
    "source_key",
    "source_name",
    "session_id",
    "web_segment_id",
    "continuity_group_start_time",
    "browser_client_id",
    "browser_kind",
    "browser_exe_name",
    "favicon_url",
    "web_source",
    "created_at",
    "updated_at",
    "category_color",
];

const APP_OVERRIDE_KEY_PREFIX: &str = "__app_override::";
const WEB_DOMAIN_OVERRIDE_KEY_PREFIX: &str = "__web_domain_override::";
const CATEGORY_LABEL_OVERRIDE_KEY_PREFIX: &str = "__category_label_override::";
const CATEGORY_COLOR_OVERRIDE_KEY_PREFIX: &str = "__category_color_override::";
const DELETED_CATEGORY_KEY_PREFIX: &str = "__deleted_category::";

const SYSTEM_EXECUTABLES: &[&str] = &[
    "taskmgr.exe",
    "regedit.exe",
    "mmc.exe",
    "control.exe",
    "system",
    "searchhost.exe",
    "smss.exe",
    "wininit.exe",
    "services.exe",
    "lsass.exe",
    "svchost.exe",
    "shellhost.exe",
    "sihost.exe",
    "shellexperiencehost.exe",
    "consent.exe",
    "pickerhost.exe",
    "openwith.exe",
    "startmenuexperiencehost.exe",
    "applicationframehost.exe",
    "textinputhost.exe",
    "runtimebroker.exe",
    "taskhostw.exe",
    "lockapp.exe",
    "logonui.exe",
    "dwm.exe",
    "csrss.exe",
    "gameinputsvc.exe",
    "fontdrvhost.exe",
    "wuauclt.exe",
    "usoclient.exe",
    "uninstall.exe",
    "unins000.exe",
];

const DEFAULT_ACCENT_COLOR: &str = "#4F5FD7";
const OTHER_CATEGORY_COLOR: &str = "#8F98A8";
const SYSTEM_CATEGORY_COLOR: &str = "#475569";

pub fn resolve_export_fields(
    selected_fields: Option<&[String]>,
) -> Result<Vec<&'static str>, String> {
    let Some(selected_fields) = selected_fields else {
        return Ok(DEFAULT_EXPORT_FIELDS.to_vec());
    };

    if selected_fields.is_empty() {
        return Err("select at least one export field".to_string());
    }

    let allowed: HashSet<&str> = ALL_EXPORT_FIELDS.iter().copied().collect();
    let mut seen = HashSet::new();
    let mut ordered = Vec::new();

    for field in selected_fields {
        if !allowed.contains(field.as_str()) {
            return Err(format!("unknown export field: {field}"));
        }

        if seen.insert(field.as_str()) {
            ordered.push(
                ALL_EXPORT_FIELDS
                    .iter()
                    .find(|candidate| **candidate == field.as_str())
                    .copied()
                    .expect("validated export field should exist"),
            );
        }
    }

    Ok(ordered)
}

pub fn paths_refer_to_same_file(left: &Path, right: &Path) -> bool {
    fn normalized(path: &Path) -> Option<PathBuf> {
        if let Ok(canonical) = std::fs::canonicalize(path) {
            return Some(canonical);
        }
        let file_name = path.file_name()?;
        let parent = path
            .parent()
            .filter(|value| !value.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        std::fs::canonicalize(parent)
            .ok()
            .map(|value| value.join(file_name))
    }

    let (Some(left), Some(right)) = (normalized(left), normalized(right)) else {
        return false;
    };
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

#[derive(Clone, Debug)]
pub struct ResolvedExportCategory {
    pub id: String,
    pub label: String,
    pub color: String,
}

#[derive(Clone, Debug, Default)]
pub struct ExportClassification {
    app_categories: HashMap<String, String>,
    web_categories: HashMap<String, String>,
    label_overrides: HashMap<String, String>,
    color_overrides: HashMap<String, String>,
    deleted_categories: HashSet<String>,
    language: String,
}

pub async fn load_export_classification(
    pool: &Pool<Sqlite>,
) -> Result<ExportClassification, String> {
    let rows = sqlx::query(
        "SELECT key, value
         FROM settings
         WHERE key = 'language'
            OR key LIKE ?
            OR key LIKE ?
            OR key LIKE ?
            OR key LIKE ?
            OR key LIKE ?",
    )
    .bind(format!("{APP_OVERRIDE_KEY_PREFIX}%"))
    .bind(format!("{WEB_DOMAIN_OVERRIDE_KEY_PREFIX}%"))
    .bind(format!("{CATEGORY_LABEL_OVERRIDE_KEY_PREFIX}%"))
    .bind(format!("{CATEGORY_COLOR_OVERRIDE_KEY_PREFIX}%"))
    .bind(format!("{DELETED_CATEGORY_KEY_PREFIX}%"))
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read classification settings: {error}"))?;

    let mut classification = ExportClassification {
        language: "zh-CN".to_string(),
        ..ExportClassification::default()
    };

    for row in rows {
        let key: String = row.get("key");
        let value: String = row.get("value");
        if key == "language" {
            if value.eq_ignore_ascii_case("en-US") {
                classification.language = "en-US".to_string();
            }
            continue;
        }

        if let Some(raw_exe) = key.strip_prefix(APP_OVERRIDE_KEY_PREFIX) {
            if let Some(category) = parse_override_category(&value) {
                classification
                    .app_categories
                    .insert(canonical_exe(raw_exe), category);
            }
            continue;
        }

        if let Some(raw_domain) = key.strip_prefix(WEB_DOMAIN_OVERRIDE_KEY_PREFIX) {
            if let Some(category) = parse_override_category(&value) {
                classification
                    .web_categories
                    .insert(normalize_domain_key(raw_domain), category);
            }
            continue;
        }

        if let Some(category) = key.strip_prefix(CATEGORY_LABEL_OVERRIDE_KEY_PREFIX) {
            let label = normalize_label(&value);
            if !label.is_empty() {
                classification
                    .label_overrides
                    .insert(category.to_string(), label);
            }
            continue;
        }

        if let Some(category) = key.strip_prefix(CATEGORY_COLOR_OVERRIDE_KEY_PREFIX) {
            if let Some(color) = normalize_hex_color(&value) {
                classification
                    .color_overrides
                    .insert(category.to_string(), color);
            }
            continue;
        }

        if let Some(category) = key.strip_prefix(DELETED_CATEGORY_KEY_PREFIX) {
            classification
                .deleted_categories
                .insert(category.to_string());
        }
    }

    Ok(classification)
}

impl ExportClassification {
    pub fn language(&self) -> &str {
        &self.language
    }
    pub fn resolve_session_category(&self, exe_name: &str) -> ResolvedExportCategory {
        let canonical = canonical_exe(exe_name);
        let raw_category = self
            .app_categories
            .get(&canonical)
            .cloned()
            .unwrap_or_else(|| {
                if SYSTEM_EXECUTABLES.contains(&canonical.as_str()) {
                    "system".to_string()
                } else {
                    "other".to_string()
                }
            });
        self.resolve_category(raw_category)
    }

    pub fn resolve_web_category(&self, normalized_domain: &str) -> ResolvedExportCategory {
        let domain = normalize_domain_key(normalized_domain);
        let raw_category = self
            .web_categories
            .get(&domain)
            .cloned()
            .unwrap_or_else(|| "other".to_string());
        self.resolve_category(raw_category)
    }

    fn resolve_category(&self, raw_category: String) -> ResolvedExportCategory {
        let category =
            if raw_category != "system" && self.deleted_categories.contains(&raw_category) {
                "other".to_string()
            } else {
                raw_category
            };
        ResolvedExportCategory {
            id: category.clone(),
            label: self.category_label(&category),
            color: self.category_color(&category),
        }
    }

    fn category_label(&self, category: &str) -> String {
        if let Some(label) = self.label_overrides.get(category) {
            return label.clone();
        }
        seeded_category_label(category, &self.language).unwrap_or_else(|| {
            extended_category_label(category).unwrap_or_else(|| category.to_string())
        })
    }

    fn category_color(&self, category: &str) -> String {
        if let Some(color) = self.color_overrides.get(category) {
            return color.clone();
        }
        match category {
            "system" => SYSTEM_CATEGORY_COLOR.to_string(),
            "other" => OTHER_CATEGORY_COLOR.to_string(),
            _ => DEFAULT_ACCENT_COLOR.to_string(),
        }
    }
}

fn parse_override_category(raw_value: &str) -> Option<String> {
    let parsed = serde_json::from_str::<Value>(raw_value).ok()?;
    if parsed
        .get("enabled")
        .and_then(Value::as_bool)
        .is_some_and(|enabled| !enabled)
    {
        return None;
    }
    parsed
        .get("category")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn canonical_exe(value: &str) -> String {
    value.trim().trim_matches('"').to_ascii_lowercase()
}

fn normalize_domain_key(value: &str) -> String {
    value.trim().trim_end_matches('.').to_ascii_lowercase()
}

fn normalize_label(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalize_hex_color(value: &str) -> Option<String> {
    let raw = value.trim();
    if raw.is_empty() {
        return None;
    }
    let normalized = if raw.starts_with('#') {
        raw.to_string()
    } else {
        format!("#{raw}")
    };
    if normalized.len() == 7 && normalized.chars().skip(1).all(|ch| ch.is_ascii_hexdigit()) {
        return Some(normalized.to_ascii_uppercase());
    }
    None
}

fn seeded_category_label(category: &str, language: &str) -> Option<String> {
    let label = match (language, category) {
        ("en-US", "ai") => "AI",
        ("en-US", "development") => "Development",
        ("en-US", "office") => "Office",
        ("en-US", "browser") => "Browser",
        ("en-US", "communication") => "Communication",
        ("en-US", "video") => "Video",
        ("en-US", "music") => "Music",
        ("en-US", "game") => "Game",
        ("en-US", "design") => "Design",
        ("en-US", "utility") => "Utility",
        ("en-US", "other") => "Other",
        ("en-US", "system") => "System",
        (_, "ai") => "AI",
        (_, "development") => "开发",
        (_, "office") => "办公",
        (_, "browser") => "浏览器",
        (_, "communication") => "沟通",
        (_, "video") => "视频",
        (_, "music") => "音乐",
        (_, "game") => "游戏",
        (_, "design") => "设计",
        (_, "utility") => "工具",
        (_, "other") => "其他",
        (_, "system") => "系统",
        _ => return None,
    };
    Some(label.to_string())
}

fn extended_category_label(category: &str) -> Option<String> {
    let raw = category.strip_prefix("custom:")?;
    if raw.is_empty() {
        return None;
    }
    if raw.starts_with("category_") {
        return None;
    }
    Some(percent_decode(raw).trim().chars().take(20).collect())
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = &value[index + 1..index + 3];
            if let Ok(byte) = u8::from_str_radix(hex, 16) {
                output.push(byte);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(output).unwrap_or_else(|_| value.to_string())
}

pub fn validate_time_range(start_time: Option<i64>, end_time: Option<i64>) -> Result<(), String> {
    if let (Some(start_time), Some(end_time)) = (start_time, end_time) {
        if start_time >= end_time {
            return Err("export start time must be before end time".to_string());
        }
    }

    Ok(())
}

#[derive(Clone, Copy, Debug)]
pub struct ExportTimeFilter {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    pub effective_now_ms: i64,
}

pub fn build_overlap_where_clause(filter: ExportTimeFilter) -> (String, Vec<i64>) {
    match (filter.start_time, filter.end_time) {
        (Some(start_time), Some(end_time)) => (
            "WHERE start_time < ? AND COALESCE(end_time, ?) > ?".to_string(),
            vec![end_time, filter.effective_now_ms, start_time],
        ),
        (Some(start_time), None) => (
            "WHERE COALESCE(end_time, ?) > ?".to_string(),
            vec![filter.effective_now_ms, start_time],
        ),
        (None, Some(end_time)) => ("WHERE start_time < ?".to_string(), vec![end_time]),
        (None, None) => (String::new(), Vec::new()),
    }
}

pub fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

pub fn ms_to_datetime_str(ms: i64) -> String {
    let secs = ms / 1000;
    let millis = ms.rem_euclid(1000);
    let nanos = (millis * 1_000_000) as u32;
    let odt = DateTime::from_timestamp(secs, nanos)
        .unwrap_or_default()
        .with_timezone(&chrono::Local);
    odt.format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn ms_to_local_date(ms: i64) -> String {
    let datetime = local_datetime(ms);
    format!(
        "{:04}-{:02}-{:02}",
        datetime.year(),
        datetime.month(),
        datetime.day()
    )
}

pub fn ms_to_local_week(ms: i64) -> String {
    let iso_week = local_datetime(ms).iso_week();
    format!("{}-W{:02}", iso_week.year(), iso_week.week())
}

pub fn ms_to_local_month(ms: i64) -> String {
    let datetime = local_datetime(ms);
    format!("{:04}-{:02}", datetime.year(), datetime.month())
}

pub fn ms_to_local_weekday(ms: i64) -> i64 {
    i64::from(local_datetime(ms).weekday().number_from_monday())
}

pub fn ms_to_local_hour(ms: i64) -> i64 {
    i64::from(local_datetime(ms).hour())
}

fn local_datetime(ms: i64) -> DateTime<chrono::Local> {
    let secs = ms / 1000;
    let millis = ms.rem_euclid(1000);
    let nanos = (millis * 1_000_000) as u32;
    DateTime::from_timestamp(secs, nanos)
        .unwrap_or_default()
        .with_timezone(&chrono::Local)
}

pub fn sanitize_csv_text_for_excel(value: &str) -> String {
    let first_non_whitespace = value.chars().find(|ch| !ch.is_whitespace());
    if matches!(
        first_non_whitespace,
        Some('=') | Some('+') | Some('-') | Some('@')
    ) {
        format!("'{value}")
    } else {
        value.to_string()
    }
}

pub fn unique_temp_path(output_path: &str, extension: &str) -> Result<PathBuf, String> {
    let output = Path::new(output_path);
    let directory = output.parent().unwrap_or_else(|| Path::new("."));
    let file_name = output
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "output path must include a file name".to_string())?;
    let extension = extension.trim_start_matches('.');
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();

    Ok(directory.join(format!(
        ".{file_name}.tmp-{}-{suffix}.{extension}",
        std::process::id()
    )))
}

pub fn replace_output_file(temp_path: &Path, output_path: &str) -> Result<(), String> {
    let output_path = Path::new(output_path);
    if output_path.exists() {
        std::fs::remove_file(output_path)
            .map_err(|e| format!("failed to replace existing output file: {e}"))?;
    }

    std::fs::rename(temp_path, output_path)
        .map_err(|e| format!("failed to move export into place: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_user_field_selection_is_rejected() {
        let fields: Vec<String> = Vec::new();
        assert!(resolve_export_fields(Some(&fields)).is_err());
        assert_eq!(
            resolve_export_fields(None).unwrap(),
            DEFAULT_EXPORT_FIELDS.to_vec()
        );
    }

    #[test]
    fn duplicate_export_fields_are_deduped_in_user_order() {
        let fields = vec![
            "url".to_string(),
            "url".to_string(),
            "record_type".to_string(),
        ];
        assert_eq!(
            resolve_export_fields(Some(&fields)).unwrap(),
            vec!["url", "record_type"]
        );
    }

    #[test]
    fn output_path_guard_recognizes_the_same_existing_file() {
        let path =
            std::env::temp_dir().join(format!("patina-export-source-{}.db", std::process::id()));
        std::fs::write(&path, b"source").unwrap();
        assert!(paths_refer_to_same_file(&path, &path));
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn overlap_clause_matches_existing_read_model_shape() {
        let filter = ExportTimeFilter {
            start_time: Some(100),
            end_time: Some(200),
            effective_now_ms: 180,
        };

        assert_eq!(
            build_overlap_where_clause(filter),
            (
                "WHERE start_time < ? AND COALESCE(end_time, ?) > ?".to_string(),
                vec![200, 180, 100]
            )
        );
    }

    #[test]
    fn csv_excel_formula_prefixes_are_escaped_after_whitespace() {
        assert_eq!(sanitize_csv_text_for_excel("=1+1"), "'=1+1");
        assert_eq!(sanitize_csv_text_for_excel("  @cmd"), "'  @cmd");
        assert_eq!(sanitize_csv_text_for_excel("plain"), "plain");
    }

    #[test]
    fn invalid_time_range_is_rejected() {
        assert!(validate_time_range(Some(10), Some(10)).is_err());
        assert!(validate_time_range(Some(10), Some(11)).is_ok());
    }
}
