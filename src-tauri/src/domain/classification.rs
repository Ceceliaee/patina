use crate::domain::localization::{self, Locale};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

pub const APP_OVERRIDE_KEY_PREFIX: &str = "__app_override::";
pub const WEB_DOMAIN_OVERRIDE_KEY_PREFIX: &str = "__web_domain_override::";
pub const CATEGORY_LABEL_OVERRIDE_KEY_PREFIX: &str = "__category_label_override::";
pub const CATEGORY_COLOR_OVERRIDE_KEY_PREFIX: &str = "__category_color_override::";
pub const CATEGORY_DEFINITION_KEY_PREFIX: &str = "__custom_category::";
pub const DELETED_CATEGORY_KEY_PREFIX: &str = "__deleted_category::";

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

const SEEDED_CATEGORIES: &[&str] = &[
    "ai",
    "development",
    "office",
    "browser",
    "communication",
    "video",
    "music",
    "game",
    "design",
    "utility",
    "other",
    "system",
];
const DEFAULT_ACCENT_COLOR: &str = "#4F5FD7";
const OTHER_CATEGORY_COLOR: &str = "#8F98A8";
const SYSTEM_CATEGORY_COLOR: &str = "#475569";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ClassificationOverride {
    category: Option<String>,
    enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedCategory {
    pub id: String,
    pub label: String,
    pub color: String,
}

#[derive(Clone, Debug, Default)]
pub struct ClassificationSnapshot {
    app_overrides: HashMap<String, ClassificationOverride>,
    web_overrides: HashMap<String, ClassificationOverride>,
    label_overrides: HashMap<String, String>,
    color_overrides: HashMap<String, String>,
    custom_categories: HashSet<String>,
    deleted_categories: HashSet<String>,
    locale: Locale,
}

impl ClassificationSnapshot {
    pub fn from_settings(rows: impl IntoIterator<Item = (String, String)>) -> Self {
        let mut snapshot = Self::default();
        for (key, value) in rows {
            if key == "language" {
                snapshot.locale = Locale::from_tag(Some(&value));
                continue;
            }
            if let Some(raw_exe) = key.strip_prefix(APP_OVERRIDE_KEY_PREFIX) {
                if let Some(value) = parse_override(&value, true) {
                    snapshot.app_overrides.insert(canonical_exe(raw_exe), value);
                }
                continue;
            }
            if let Some(raw_domain) = key.strip_prefix(WEB_DOMAIN_OVERRIDE_KEY_PREFIX) {
                if let Some(value) = parse_override(&value, false) {
                    snapshot
                        .web_overrides
                        .insert(normalize_domain_key(raw_domain), value);
                }
                continue;
            }
            if let Some(category) = key.strip_prefix(CATEGORY_LABEL_OVERRIDE_KEY_PREFIX) {
                let label = normalize_label(&value);
                if !label.is_empty() {
                    snapshot.label_overrides.insert(category.to_string(), label);
                }
                continue;
            }
            if let Some(category) = key.strip_prefix(CATEGORY_COLOR_OVERRIDE_KEY_PREFIX) {
                if let Some(color) = normalize_hex_color(&value) {
                    snapshot.color_overrides.insert(category.to_string(), color);
                }
                continue;
            }
            if let Some(category) = key.strip_prefix(CATEGORY_DEFINITION_KEY_PREFIX) {
                if is_custom_category(category) {
                    snapshot.custom_categories.insert(category.to_string());
                }
                continue;
            }
            if let Some(category) = key.strip_prefix(DELETED_CATEGORY_KEY_PREFIX) {
                snapshot.deleted_categories.insert(category.to_string());
            }
        }
        snapshot
    }

    pub fn language(&self) -> &str {
        self.locale.tag()
    }

    pub fn is_app_enabled(&self, exe_name: &str) -> bool {
        self.app_overrides
            .get(&canonical_exe(exe_name))
            .map(|value| value.enabled)
            .unwrap_or(true)
    }

    pub fn is_web_domain_enabled(&self, normalized_domain: &str) -> bool {
        self.web_overrides
            .get(&normalize_domain_key(normalized_domain))
            .map(|value| value.enabled)
            .unwrap_or(true)
    }

    pub fn category_is_available(&self, category: &str) -> bool {
        category != "system"
            && !self.deleted_categories.contains(category)
            && (SEEDED_CATEGORIES.contains(&category) || self.custom_categories.contains(category))
    }

    pub fn resolve_session_category(&self, exe_name: &str) -> ResolvedCategory {
        self.resolve_tracked_session_category(exe_name)
            .unwrap_or_else(|| self.resolve_category("other".to_string()))
    }

    pub fn resolve_tracked_session_category(&self, exe_name: &str) -> Option<ResolvedCategory> {
        let canonical = canonical_exe(exe_name);
        if !self.is_app_enabled(&canonical) {
            return None;
        }
        let raw_category = self
            .app_overrides
            .get(&canonical)
            .and_then(|value| value.category.clone())
            .unwrap_or_else(|| {
                if SYSTEM_EXECUTABLES.contains(&canonical.as_str()) {
                    "system".to_string()
                } else {
                    "other".to_string()
                }
            });
        Some(self.resolve_category(raw_category))
    }

    pub fn resolve_web_category(&self, normalized_domain: &str) -> ResolvedCategory {
        self.resolve_tracked_web_category(normalized_domain)
            .unwrap_or_else(|| self.resolve_category("other".to_string()))
    }

    pub fn resolve_tracked_web_category(
        &self,
        normalized_domain: &str,
    ) -> Option<ResolvedCategory> {
        let domain = normalize_domain_key(normalized_domain);
        if !self.is_web_domain_enabled(&domain) {
            return None;
        }
        let raw_category = self
            .web_overrides
            .get(&domain)
            .and_then(|value| value.category.clone())
            .unwrap_or_else(|| "other".to_string());
        Some(self.resolve_category(raw_category))
    }

    pub fn resolve_category_by_id(&self, category: &str) -> Option<ResolvedCategory> {
        self.category_is_available(category)
            .then(|| self.resolve_category(category.to_string()))
    }

    fn resolve_category(&self, raw_category: String) -> ResolvedCategory {
        let category = if raw_category != "system"
            && (!self.category_exists(&raw_category)
                || self.deleted_categories.contains(&raw_category))
        {
            "other".to_string()
        } else {
            raw_category
        };
        ResolvedCategory {
            id: category.clone(),
            label: self.category_label(&category),
            color: self.category_color(&category),
        }
    }

    fn category_exists(&self, category: &str) -> bool {
        SEEDED_CATEGORIES.contains(&category) || self.custom_categories.contains(category)
    }

    fn category_label(&self, category: &str) -> String {
        if let Some(label) = self.label_overrides.get(category) {
            return label.clone();
        }
        seeded_category_label(category, self.locale).unwrap_or_else(|| {
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

pub fn canonical_exe(value: &str) -> String {
    value.trim().trim_matches('"').to_ascii_lowercase()
}

pub fn normalize_domain_key(value: &str) -> String {
    value.trim().trim_end_matches('.').to_ascii_lowercase()
}

fn parse_override(raw_value: &str, read_track: bool) -> Option<ClassificationOverride> {
    let parsed = serde_json::from_str::<Value>(raw_value).ok()?;
    let enabled = parsed
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(true)
        && (!read_track || parsed.get("track").and_then(Value::as_bool).unwrap_or(true));
    let category = parsed
        .get("category")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    Some(ClassificationOverride { category, enabled })
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
    (normalized.len() == 7 && normalized.chars().skip(1).all(|ch| ch.is_ascii_hexdigit()))
        .then(|| normalized.to_ascii_uppercase())
}

fn is_custom_category(category: &str) -> bool {
    category.starts_with("custom:") && category.len() > "custom:".len()
}

fn seeded_category_label(category: &str, locale: Locale) -> Option<String> {
    SEEDED_CATEGORIES
        .contains(&category)
        .then(|| localization::text(locale, &format!("native.category.{category}")))
}

fn extended_category_label(category: &str) -> Option<String> {
    let raw = category.strip_prefix("custom:")?;
    if raw.is_empty() || raw.starts_with("category_") {
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
            if let Ok(byte) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(rows: &[(&str, &str)]) -> ClassificationSnapshot {
        ClassificationSnapshot::from_settings(
            rows.iter()
                .map(|(key, value)| (key.to_string(), value.to_string())),
        )
    }

    #[test]
    fn app_exclusion_and_deleted_categories_are_deterministic() {
        let classification = snapshot(&[
            (
                "__app_override::Code.EXE",
                r#"{"category":"development","track":false}"#,
            ),
            (
                "__app_override::Browser.EXE",
                r#"{"category":"custom:study","enabled":true}"#,
            ),
            ("__custom_category::custom:study", "1"),
            ("__deleted_category::custom:study", "1"),
        ]);

        assert_eq!(
            classification.resolve_tracked_session_category("code.exe"),
            None
        );
        assert_eq!(
            classification.resolve_session_category("browser.exe").id,
            "other"
        );
        assert!(!classification.category_is_available("custom:study"));
    }

    #[test]
    fn malformed_override_does_not_disable_default_classification() {
        let classification = snapshot(&[("__app_override::code.exe", "not-json")]);
        assert_eq!(
            classification.resolve_session_category("code.exe").id,
            "other"
        );
    }

    #[test]
    fn web_exclusion_is_independent_from_app_categories() {
        let classification = snapshot(&[(
            "__web_domain_override::Example.COM.",
            r#"{"category":"development","enabled":false}"#,
        )]);
        assert_eq!(
            classification.resolve_tracked_web_category("example.com"),
            None
        );
        assert_eq!(
            classification.resolve_session_category("browser.exe").id,
            "other"
        );
    }
}
