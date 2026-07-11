use serde::{Deserialize, Serialize};
use url::Url;

pub const WEB_ACTIVITY_CHANGED_REASON: &str = "web-activity-changed";
pub const WEB_ACTIVITY_SOURCE_BROWSER_EXTENSION: &str = "browser-extension";
pub const WEB_DOMAIN_OVERRIDE_KEY_PREFIX: &str = "__web_domain_override::";

const MAX_BROWSER_CLIENT_ID_CHARS: usize = 128;
const MAX_BROWSER_KIND_CHARS: usize = 32;
const MAX_EXTENSION_VERSION_CHARS: usize = 64;
const MAX_TITLE_CHARS: usize = 512;
const MAX_FAVICON_URL_CHARS: usize = 8192;

const WEB_ACTIVITY_CHROMIUM_BROWSER_EXES: &[&str] = &[
    "chrome.exe",
    "msedge.exe",
    "brave.exe",
    "opera.exe",
    "vivaldi.exe",
    "arc.exe",
    "chromium.exe",
    "360chromex.exe",
    "thorium.exe",
    "centbrowser.exe",
    "catsxp.exe",
];

const WEB_ACTIVITY_FIREFOX_BROWSER_EXES: &[&str] =
    &["firefox.exe", "zen.exe", "floorp.exe", "iceweasel.exe"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WebActivityBrowserFamily {
    Chromium,
    Firefox,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserActiveTabPayload {
    pub browser_client_id: Option<String>,
    pub browser_kind: Option<String>,
    pub extension_version: Option<String>,
    pub tab_id: Option<i64>,
    pub window_id: Option<i64>,
    pub url: Option<String>,
    pub title: Option<String>,
    pub fav_icon_url: Option<String>,
    pub incognito: Option<bool>,
    pub captured_at_ms: Option<i64>,
    pub event_reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SanitizedWebActivityInput {
    pub browser_client_id: String,
    pub browser_kind: String,
    pub domain: String,
    pub normalized_domain: String,
    pub url: Option<String>,
    pub title: Option<String>,
    pub favicon_url: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActivityBridgeSnapshot {
    pub enabled: bool,
    pub connected: bool,
    pub browser_client_id: Option<String>,
    pub browser_kind: Option<String>,
    pub extension_version: Option<String>,
    pub last_activity_at_ms: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct WebDomainOverrideStorageValue {
    pub enabled: Option<bool>,
}

pub fn sanitize_browser_client_id(value: Option<&str>) -> String {
    truncate_chars(
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("unknown-browser-client"),
        MAX_BROWSER_CLIENT_ID_CHARS,
    )
}

pub fn sanitize_browser_kind(value: Option<&str>) -> String {
    let normalized = value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("chrome")
        .to_ascii_lowercase();
    truncate_chars(&normalized, MAX_BROWSER_KIND_CHARS)
}

pub fn sanitize_extension_version(value: Option<&str>) -> Option<String> {
    sanitize_optional_text(value, MAX_EXTENSION_VERSION_CHARS)
}

pub fn sanitize_active_tab_payload(
    payload: BrowserActiveTabPayload,
) -> Result<Option<SanitizedWebActivityInput>, String> {
    if payload.incognito.unwrap_or(false) {
        return Ok(None);
    }

    let raw_url = payload
        .url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "missing web activity url".to_string())?;
    let parsed =
        Url::parse(raw_url).map_err(|error| format!("invalid web activity url: {error}"))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Ok(None);
    }

    let host = parsed
        .host_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "missing web activity host".to_string())?;
    let normalized_domain =
        normalize_domain(host).ok_or_else(|| "invalid web activity domain".to_string())?;
    let domain = normalized_domain.clone();
    Ok(Some(SanitizedWebActivityInput {
        browser_client_id: sanitize_browser_client_id(payload.browser_client_id.as_deref()),
        browser_kind: sanitize_browser_kind(payload.browser_kind.as_deref()),
        domain,
        normalized_domain,
        url: Some(raw_url.to_string()),
        title: sanitize_optional_text(payload.title.as_deref(), MAX_TITLE_CHARS),
        favicon_url: sanitize_optional_text(payload.fav_icon_url.as_deref(), MAX_FAVICON_URL_CHARS),
    }))
}

pub fn normalize_domain(value: &str) -> Option<String> {
    let normalized = value.trim().trim_end_matches('.').to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

pub fn resolve_web_activity_browser_family(exe_name: &str) -> Option<WebActivityBrowserFamily> {
    let normalized = exe_name.trim().to_ascii_lowercase();
    if WEB_ACTIVITY_CHROMIUM_BROWSER_EXES.contains(&normalized.as_str()) {
        return Some(WebActivityBrowserFamily::Chromium);
    }
    if WEB_ACTIVITY_FIREFOX_BROWSER_EXES.contains(&normalized.as_str()) {
        return Some(WebActivityBrowserFamily::Firefox);
    }
    None
}

pub fn is_supported_browser_exe(exe_name: &str) -> bool {
    resolve_web_activity_browser_family(exe_name).is_some()
}

pub fn parse_domain_override_enabled(raw_value: &str) -> bool {
    serde_json::from_str::<WebDomainOverrideStorageValue>(raw_value)
        .ok()
        .and_then(|override_value| override_value.enabled)
        .unwrap_or(true)
}

fn sanitize_optional_text(value: Option<&str>, max_chars: usize) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| truncate_chars(value, max_chars))
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_tab_sanitizer_preserves_full_url_for_export() {
        let sanitized = sanitize_active_tab_payload(BrowserActiveTabPayload {
            browser_client_id: Some("client-1".into()),
            browser_kind: Some("Chrome".into()),
            extension_version: Some("0.1.0".into()),
            tab_id: Some(1),
            window_id: Some(2),
            url: Some("https://GitHub.com/Ceceliaee/patina/issues/6".into()),
            title: Some("Issue #6".into()),
            fav_icon_url: Some("https://github.com/favicon.ico".into()),
            incognito: Some(false),
            captured_at_ms: Some(123),
            event_reason: Some("activated".into()),
        })
        .unwrap()
        .unwrap();

        assert_eq!(sanitized.normalized_domain, "github.com");
        assert_eq!(sanitized.browser_kind, "chrome");
        assert_eq!(
            sanitized.url.as_deref(),
            Some("https://GitHub.com/Ceceliaee/patina/issues/6")
        );
        assert_eq!(sanitized.title.as_deref(), Some("Issue #6"));
    }

    #[test]
    fn active_tab_sanitizer_ignores_non_web_and_incognito_tabs() {
        let mut payload = BrowserActiveTabPayload {
            browser_client_id: None,
            browser_kind: None,
            extension_version: None,
            tab_id: None,
            window_id: None,
            url: Some("chrome://extensions".into()),
            title: None,
            fav_icon_url: None,
            incognito: Some(false),
            captured_at_ms: None,
            event_reason: None,
        };
        assert!(sanitize_active_tab_payload(payload.clone())
            .unwrap()
            .is_none());

        payload.url = Some("https://example.com".into());
        payload.incognito = Some(true);
        assert!(sanitize_active_tab_payload(payload).unwrap().is_none());
    }

    #[test]
    fn domain_override_defaults_to_enabled() {
        assert!(parse_domain_override_enabled("{}"));
        assert!(!parse_domain_override_enabled(r#"{"enabled":false}"#));
        assert!(parse_domain_override_enabled("not-json"));
    }

    #[test]
    fn supported_browser_exe_excludes_opera_gx() {
        assert!(is_supported_browser_exe("opera.exe"));
        assert!(!is_supported_browser_exe("opera_gx.exe"));
    }

    #[test]
    fn supported_browser_exe_includes_only_new_360_extreme_browser() {
        assert!(is_supported_browser_exe("360ChromeX.exe"));
        assert!(is_supported_browser_exe(" 360chromex.exe "));
        assert!(!is_supported_browser_exe("360chrome.exe"));
    }

    #[test]
    fn supported_browser_exe_resolves_chromium_family() {
        for exe_name in [
            "chrome.exe",
            "msedge.exe",
            "brave.exe",
            "opera.exe",
            "vivaldi.exe",
            "arc.exe",
            "chromium.exe",
            "360chromex.exe",
            "thorium.exe",
            "centbrowser.exe",
            "catsxp.exe",
        ] {
            assert_eq!(
                resolve_web_activity_browser_family(exe_name),
                Some(WebActivityBrowserFamily::Chromium),
                "{exe_name} should be treated as Chromium family",
            );
        }
    }

    #[test]
    fn supported_browser_exe_resolves_firefox_family() {
        for exe_name in ["firefox.exe", "zen.exe", "floorp.exe", "iceweasel.exe"] {
            assert_eq!(
                resolve_web_activity_browser_family(exe_name),
                Some(WebActivityBrowserFamily::Firefox),
                "{exe_name} should be treated as Firefox family",
            );
        }
    }

    #[test]
    fn supported_browser_exe_normalizes_case_and_space() {
        assert_eq!(
            resolve_web_activity_browser_family(" Firefox.EXE "),
            Some(WebActivityBrowserFamily::Firefox),
        );
        assert_eq!(
            resolve_web_activity_browser_family(" Thorium.EXE "),
            Some(WebActivityBrowserFamily::Chromium),
        );
    }

    #[test]
    fn unsupported_browser_exe_keeps_candidates_out_until_confirmed() {
        for exe_name in [
            "tor.exe",
            "librewolf.exe",
            "waterfox.exe",
            "noraneko.exe",
            "ungoogled-chromium.exe",
            "helium.exe",
            "supermium.exe",
            "edge.exe",
            "egde.exe",
        ] {
            assert_eq!(
                resolve_web_activity_browser_family(exe_name),
                None,
                "{exe_name} should remain unsupported",
            );
        }
    }
}
