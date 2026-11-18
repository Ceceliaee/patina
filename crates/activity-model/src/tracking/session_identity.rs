#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowSessionIdentity {
    pub app_key: String,
    pub instance_key: String,
}

const APP_OVERRIDE_DERIVED_ALIAS_SUFFIXES: &[&str] = &["webhelper", "helper", "widget", "tray"];
const APP_OVERRIDE_DERIVED_ALIAS_OWNERS: &[&str] = &["douyin.exe", "steam.exe"];
const APP_OVERRIDE_LIFECYCLE_ALIAS_OWNERS: &[&str] =
    &["alma.exe", "cursor.exe", "notion.exe", "obsidian.exe"];
const APP_OVERRIDE_LIFECYCLE_MARKERS: &[&str] = &[
    "uninstaller",
    "uninstall",
    "installer",
    "install",
    "updater",
    "update",
    "setup",
    "upgrade",
    "unins000",
    "unins",
    "remove",
    "maintenancetool",
    "maintenance",
];
const APP_OVERRIDE_BUILD_CONTEXT: &[&str] = &[
    "win", "windows", "x64", "x86", "amd64", "arm64", "ia32", "portable", "release", "latest",
    "beta", "alpha", "nightly", "stable", "desktop", "app",
];

fn is_version_like_app_override_token(token: &str) -> bool {
    !token.is_empty() && token.chars().all(|character| character.is_ascii_digit())
}

fn resolve_explicit_lifecycle_owner_from_tokens(tokens: &[&str]) -> Option<String> {
    let base = tokens
        .iter()
        .copied()
        .filter(|token| {
            !APP_OVERRIDE_LIFECYCLE_MARKERS.contains(token)
                && !APP_OVERRIDE_BUILD_CONTEXT.contains(token)
                && !is_version_like_app_override_token(token)
        })
        .collect::<Vec<_>>();
    if base.len() != 1 {
        return None;
    }

    let owner = format!("{}.exe", base[0]);
    APP_OVERRIDE_LIFECYCLE_ALIAS_OWNERS
        .contains(&owner.as_str())
        .then_some(owner)
}

fn resolve_lifecycle_app_override_owner(stem: &str) -> Option<String> {
    let tokens = stem
        .split(['_', '-', '.', ' '])
        .filter(|token| !token.is_empty())
        .collect::<Vec<_>>();
    if tokens.len() < 2 {
        return None;
    }

    for marker_index in 1..tokens.len() {
        if APP_OVERRIDE_LIFECYCLE_MARKERS.contains(&tokens[marker_index]) {
            if let Some(owner) =
                resolve_explicit_lifecycle_owner_from_tokens(&tokens[..marker_index])
            {
                return Some(owner);
            }
        }
    }

    if APP_OVERRIDE_LIFECYCLE_MARKERS.contains(&tokens[0]) {
        if let Some(owner) = resolve_explicit_lifecycle_owner_from_tokens(&tokens[1..]) {
            return Some(owner);
        }
    }

    let has_version = tokens
        .iter()
        .any(|token| is_version_like_app_override_token(token));
    let has_marker = tokens
        .iter()
        .any(|token| APP_OVERRIDE_LIFECYCLE_MARKERS.contains(token));
    let has_build_context = tokens
        .iter()
        .any(|token| APP_OVERRIDE_BUILD_CONTEXT.contains(token));
    if has_version && (has_marker || has_build_context) {
        return resolve_explicit_lifecycle_owner_from_tokens(&tokens[..1]);
    }

    None
}

/// Resolves the persisted app-override identity used by both the frontend and
/// the native sampling loop. The allowlist intentionally mirrors the narrow
/// derived-component owner contract in the frontend classification domain;
/// a generic suffix is never enough to merge an unknown executable.
pub fn resolve_app_override_executable(exe_name: &str) -> Option<String> {
    let trimmed = exe_name.trim().trim_matches('"');
    if trimmed.is_empty() {
        return None;
    }

    let mut normalized = trimmed.to_ascii_lowercase();
    if !normalized.ends_with(".exe") {
        normalized.push_str(".exe");
    }

    let stem = normalized.strip_suffix(".exe").unwrap_or(&normalized);
    for suffix in APP_OVERRIDE_DERIVED_ALIAS_SUFFIXES {
        let Some(base_with_separator) = stem.strip_suffix(suffix) else {
            continue;
        };
        let base = base_with_separator.trim_end_matches(['_', '-', '.']);
        if base.is_empty() {
            continue;
        }

        let owner = format!("{base}.exe");
        if APP_OVERRIDE_DERIVED_ALIAS_OWNERS.contains(&owner.as_str()) {
            return Some(owner);
        }
    }

    if let Some(owner) = resolve_lifecycle_app_override_owner(stem) {
        return Some(owner);
    }

    Some(normalized)
}

impl WindowSessionIdentity {
    pub fn from_window_fields(
        exe_name: &str,
        process_id: u32,
        root_owner_hwnd: &str,
        hwnd: &str,
        window_class: &str,
    ) -> Option<Self> {
        if exe_name.is_empty() {
            return None;
        }

        let app_key = exe_name.to_lowercase();
        let owner_key = if root_owner_hwnd.is_empty() {
            hwnd
        } else {
            root_owner_hwnd
        };
        let class_key = window_class.to_lowercase();
        let instance_key = format!(
            "{}|pid:{}|root:{}|class:{}",
            app_key, process_id, owner_key, class_key
        );

        Some(Self {
            app_key,
            instance_key,
        })
    }

    pub fn is_same_app(&self, other: &Self) -> bool {
        self.app_key == other.app_key
    }

    pub fn is_same_instance(&self, other: &Self) -> bool {
        self.instance_key == other.instance_key
    }
}

#[derive(Clone, Copy, Debug)]
pub struct WindowTrackingCandidate<'a> {
    pub exe_name: &'a str,
    pub title: &'a str,
    pub window_class: &'a str,
    pub is_afk: bool,
}

impl<'a> WindowTrackingCandidate<'a> {
    pub fn from_window_fields(
        exe_name: &'a str,
        title: &'a str,
        window_class: &'a str,
        is_afk: bool,
    ) -> Self {
        Self {
            exe_name,
            title,
            window_class,
            is_afk,
        }
    }
}

pub fn is_trackable_window(window: Option<WindowTrackingCandidate<'_>>) -> bool {
    let Some(window) = window else {
        return false;
    };

    !window.exe_name.is_empty()
        && !window.is_afk
        && super::process_filters::should_track(window.exe_name)
        && !super::process_filters::is_desktop_shell_window(window)
        && super::process_filters::is_trackable_explorer_window(window)
        && !super::process_filters::is_lifecycle_utility_window(window)
}

#[cfg(test)]
mod tests {
    use super::resolve_app_override_executable;

    #[test]
    fn app_override_identity_resolves_only_verified_derived_components() {
        assert_eq!(
            resolve_app_override_executable(" SteamWebHelper.EXE ").as_deref(),
            Some("steam.exe")
        );
        assert_eq!(
            resolve_app_override_executable("Douyin_widget.exe").as_deref(),
            Some("douyin.exe")
        );
        assert_eq!(
            resolve_app_override_executable("alma-0.0.750-win-x64.exe").as_deref(),
            Some("alma.exe")
        );
        assert_eq!(
            resolve_app_override_executable("setup-notion.exe").as_deref(),
            Some("notion.exe")
        );
        assert_eq!(
            resolve_app_override_executable("setup-notion-beta.exe").as_deref(),
            Some("notion.exe")
        );
        assert_eq!(
            resolve_app_override_executable("beta-setup-notion.exe").as_deref(),
            Some("beta-setup-notion.exe")
        );
        assert_eq!(
            resolve_app_override_executable("unknownhelper.exe").as_deref(),
            Some("unknownhelper.exe")
        );
    }
}
