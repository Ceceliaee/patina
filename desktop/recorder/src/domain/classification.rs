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
    "office",
    "communication",
    "browser",
    "video",
    "game",
    "design",
    "development",
    "learning",
    "utility",
    "other",
    "system",
];

const CATEGORY_PALETTE: &[&str] = &[
    "#4F5FD7", "#5968DE", "#6471E3", "#6F7AE6", "#4B78C8", "#5380CD", "#5D88D1", "#3F86C9",
    "#4790CF", "#3293C8", "#399CCB", "#2E9FAE", "#35A69E", "#2FA58B", "#36AC7E", "#3D9C6B",
    "#46956F", "#4F987F", "#5A9861", "#66955C", "#7C945C", "#8A9058", "#9A8C52", "#AA8752",
    "#B07E55", "#B97A58", "#C07158", "#C56A73", "#BE657D", "#B6688B", "#A06A7D", "#976C90",
    "#8C6FA1", "#8572A5", "#7E74A8", "#6F7F92", "#637D9F",
];
pub fn default_category_color(category: &str) -> String {
    let seeded = match category {
        "system" => Some(SYSTEM_CATEGORY_COLOR),
        "other" => Some(OTHER_CATEGORY_COLOR),
        "ai" => Some("#3293C8"),
        "development" => Some("#4790CF"),
        "office" => Some("#6F7AE6"),
        "browser" => Some("#36AC7E"),
        "communication" => Some("#C56A73"),
        "video" => Some("#66955C"),
        "music" => Some("#3D9C6B"),
        "game" => Some("#B07E55"),
        "design" => Some("#8C6FA1"),
        "utility" => Some("#35A69E"),
        "learning" => Some("#AA8752"),
        _ => None,
    };
    if let Some(color) = seeded {
        return color.into();
    }
    let hash = category.chars().fold(2166136261u32, |hash, ch| {
        (hash ^ u32::from(ch.encode_utf16(&mut [0; 2])[0])).wrapping_mul(16777619)
    });
    CATEGORY_PALETTE[hash as usize % CATEGORY_PALETTE.len()].into()
}

const OTHER_CATEGORY_COLOR: &str = "#8F98A8";
const SYSTEM_CATEGORY_COLOR: &str = "#475569";

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ClassificationOverride {
    category: Option<String>,
    enabled: bool,
    display_name: Option<String>,
    color: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolvedCategory {
    pub id: String,
    pub label: String,
    pub color: String,
}

#[derive(Clone, Debug, Default)]
pub struct ClassificationSnapshot {
    app_links: HashMap<String, String>,
    app_overrides: HashMap<String, ClassificationOverride>,
    web_overrides: HashMap<String, ClassificationOverride>,
    web_sites: crate::domain::web_links::WebLinkRules,
    label_overrides: HashMap<String, String>,
    color_overrides: HashMap<String, String>,
    color_defaults: HashMap<String, String>,
    custom_categories: HashSet<String>,
    deleted_categories: HashSet<String>,
    locale: Locale,
}

impl ClassificationSnapshot {
    pub fn from_settings(rows: impl IntoIterator<Item = (String, String)>) -> Self {
        let mut snapshot = Self::default();
        for (key, value) in rows {
            if let Some(root) = key.strip_prefix(crate::domain::web_links::SETTING_PREFIX) {
                if let Ok(rule) = serde_json::from_str(&value) {
                    snapshot.web_sites.insert(root.to_string(), rule);
                }
                continue;
            }
            if let Some(member) = key.strip_prefix("__app_link::") {
                snapshot.app_links.insert(member.to_string(), value);
                continue;
            }
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
            if let Some(category) = key.strip_prefix("__category_default_color_assignment::") {
                if let Some(color) =
                    normalize_hex_color(&value).filter(|c| CATEGORY_PALETTE.contains(&c.as_str()))
                {
                    snapshot.color_defaults.insert(category.to_string(), color);
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
        let category = normalize_category_id(category);
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
        let association_key = crate::domain::tracking::resolve_app_override_executable(&canonical)
            .unwrap_or_else(|| canonical.clone());
        let canonical = self
            .app_links
            .get(&canonical)
            .or_else(|| self.app_links.get(&association_key))
            .cloned()
            .unwrap_or(canonical);
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
        let owner = crate::domain::web_links::resolve_owner(&domain, &self.web_sites);
        let raw_category = if let Some(root) = crate::domain::web_links::group_domain(&owner) {
            self.web_sites
                .get(&root)
                .and_then(|rule| rule.category.clone())
        } else {
            self.web_overrides
                .get(&domain)
                .and_then(|value| value.category.clone())
        }
        .unwrap_or_else(|| "other".to_string());
        Some(self.resolve_category(raw_category))
    }

    pub fn resolve_category_by_id(&self, category: &str) -> Option<ResolvedCategory> {
        self.category_is_available(category)
            .then(|| self.resolve_category(category.to_string()))
    }

    fn resolve_category(&self, raw_category: String) -> ResolvedCategory {
        let raw_category = normalize_category_id(&raw_category).to_owned();
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
        if let Some(color) = self.category_color_override(category) {
            return color.to_owned();
        }
        self.default_category_color(category)
    }

    pub fn category_color_override(&self, category: &str) -> Option<&str> {
        self.color_overrides.get(category).map(String::as_str)
    }

    pub fn default_category_color(&self, category: &str) -> String {
        if !matches!(category, "other" | "system") {
            if let Some(color) = self.color_defaults.get(category) {
                return color.clone();
            }
        }
        default_category_color(category)
    }
}

#[allow(
    dead_code,
    reason = "native Today presentation also consumes this classification snapshot"
)]
impl ClassificationSnapshot {
    pub fn app_owner(&self, exe: &str) -> String {
        let canonical = crate::domain::tracking::resolve_app_override_executable(exe)
            .unwrap_or_else(|| canonical_exe(exe));
        self.app_links
            .get(&canonical)
            .or_else(|| self.app_links.get(canonical.trim_end_matches(".exe")))
            .cloned()
            .unwrap_or(canonical)
    }

    pub fn app_appearance(&self, owner: &str) -> (Option<&str>, Option<&str>) {
        let value = self.app_overrides.get(owner);
        (
            value.and_then(|v| v.display_name.as_deref()),
            value.and_then(|v| v.color.as_deref()),
        )
    }

    pub fn available_categories(&self) -> Vec<ResolvedCategory> {
        let mut categories: Vec<_> = SEEDED_CATEGORIES
            .iter()
            .copied()
            .chain(self.custom_categories.iter().map(String::as_str))
            .filter_map(|id| self.resolve_category_by_id(id))
            .collect();
        categories.sort_by(|a, b| a.label.cmp(&b.label).then(a.id.cmp(&b.id)));
        categories
    }

    pub fn display_category(
        &self,
        exe: &str,
        defaults: &std::collections::BTreeMap<String, String>,
    ) -> ResolvedCategory {
        let mut c = self.resolve_session_category(exe);
        if SEEDED_CATEGORIES.contains(&c.id.as_str())
            && c.id != "ai"
            && !self.label_overrides.contains_key(&c.id)
        {
            c.label = localization::text(self.locale, &format!("categories.short.{}", c.id));
        }
        if !self.color_overrides.contains_key(&c.id) && c.id != "other" && c.id != "system" {
            c.color = defaults
                .get(&format!("__category_default_color_assignment::{}", c.id))
                .cloned()
                .unwrap_or_else(|| self.default_category_color(&c.id));
        }
        c
    }
}

pub fn canonical_exe(value: &str) -> String {
    value.trim().trim_matches('"').to_ascii_lowercase()
}

pub(crate) fn normalize_category_id(category: &str) -> &str {
    match category {
        "ai" => "office",
        "music" => "video",
        _ => category,
    }
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
    Some(ClassificationOverride {
        category,
        enabled,
        display_name: parsed
            .get("displayName")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
        color: parsed
            .get("color")
            .and_then(Value::as_str)
            .and_then(normalize_hex_color),
    })
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
    fn default_categories_are_nine_categories_and_unclassified() {
        let classification = snapshot(&[("language", "zh-CN")]);
        let categories = classification.available_categories();
        let expected = [
            ("office", "办公"),
            ("communication", "社交"),
            ("browser", "浏览"),
            ("video", "影音"),
            ("game", "游戏"),
            ("design", "创作"),
            ("development", "开发"),
            ("learning", "学习"),
            ("utility", "工具"),
            ("other", "未分类"),
        ];
        assert_eq!(categories.len(), expected.len());
        for (id, label) in expected {
            let category = categories
                .iter()
                .find(|category| category.id == id)
                .unwrap();
            assert_eq!(category.label, label);
        }
        assert!(!classification.category_is_available("system"));
    }

    #[test]
    fn legacy_categories_resolve_for_apps_domains_and_groups() {
        let classification = snapshot(&[
            (
                "__app_override::assistant.exe",
                r##"{"category":"ai","displayName":"Assistant","color":"#123456"}"##,
            ),
            ("__app_override::player.exe", r#"{"category":"music"}"#),
            (
                "__web_domain_override::standalone.test",
                r#"{"category":"ai"}"#,
            ),
            (
                "__web_site::example.com",
                r#"{"version":2,"exceptions":[],"category":"music"}"#,
            ),
            ("__custom_category::custom:research", "1"),
        ]);
        assert_eq!(
            classification.resolve_session_category("assistant.exe").id,
            "office"
        );
        assert_eq!(
            classification.resolve_session_category("player.exe").id,
            "video"
        );
        assert_eq!(
            classification.resolve_web_category("standalone.test").id,
            "office"
        );
        assert_eq!(
            classification.resolve_web_category("www.example.com").id,
            "video"
        );
        assert_eq!(
            classification.app_appearance("assistant.exe"),
            (Some("Assistant"), Some("#123456"))
        );
        assert!(classification.category_is_available("custom:research"));
        assert_eq!(classification.available_categories().len(), 11);
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
    fn linked_member_inherits_category_but_keeps_its_own_exclusion() {
        let classification = snapshot(&[
            ("__app_link::b.exe", "a.exe"),
            (
                "__app_override::a.exe",
                r#"{"category":"office","track":false}"#,
            ),
            ("__app_override::b.exe", r#"{"category":"development"}"#),
        ]);
        assert_eq!(
            classification
                .resolve_tracked_session_category("b.exe")
                .unwrap()
                .id,
            "office"
        );
        assert!(classification
            .resolve_tracked_session_category("a.exe")
            .is_none());
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
