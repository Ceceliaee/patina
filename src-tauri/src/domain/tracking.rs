use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrackingDataChangedPayload {
    pub reason: String,
    pub changed_at_ms: u64,
}

impl TrackingDataChangedPayload {
    pub fn new(reason: impl Into<String>, changed_at_ms: u64) -> Self {
        Self {
            reason: reason.into(),
            changed_at_ms,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowTransitionDecision {
    pub reason: &'static str,
    pub should_end_previous: bool,
    pub should_start_next: bool,
    pub should_refresh_metadata: bool,
    pub end_time_override: Option<i64>,
}

impl WindowTransitionDecision {
    pub fn has_session_work(&self) -> bool {
        self.should_end_previous || self.should_start_next
    }

    pub fn has_mutation_plan(&self) -> bool {
        self.has_session_work() || self.should_refresh_metadata
    }

    pub fn resolved_end_time(&self, fallback_end_time: i64) -> i64 {
        self.end_time_override.unwrap_or(fallback_end_time)
    }

    pub fn mutation_reason(&self, did_mutate: bool) -> Option<&'static str> {
        if !did_mutate {
            return None;
        }

        Some(if self.should_end_previous && self.should_start_next {
            "session-transition"
        } else if self.should_end_previous {
            "session-ended"
        } else if self.should_start_next {
            "session-started"
        } else {
            self.reason
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowSessionIdentity {
    pub app_key: String,
    pub instance_key: String,
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
    pub is_afk: bool,
}

impl<'a> WindowTrackingCandidate<'a> {
    pub fn from_window_fields(exe_name: &'a str, title: &'a str, is_afk: bool) -> Self {
        Self {
            exe_name,
            title,
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
        && should_track(window.exe_name)
        && !is_lifecycle_utility_window(window)
}

pub fn should_track(exe_name: &str) -> bool {
    let lower_name = exe_name.to_lowercase();

    if matches!(
        lower_name.as_str(),
        "time_tracker.exe"
            | "time-tracker.exe"
            | "un.exe"
            | "powershell.exe"
            | "pwsh.exe"
            | "cmd.exe"
            | "windowsterminal.exe"
            | "wt.exe"
            | "explorer.exe"
            | "taskmgr.exe"
            | "regedit.exe"
            | "mmc.exe"
            | "control.exe"
            | "searchhost.exe"
            | "searchapp.exe"
            | "searchindexer.exe"
            | "shellhost.exe"
            | "shellexperiencehost.exe"
            | "startmenuexperiencehost.exe"
            | "applicationframehost.exe"
            | "textinputhost.exe"
            | "runtimebroker.exe"
            | "taskhostw.exe"
            | "consent.exe"
            | "lockapp.exe"
            | "logonui.exe"
            | "sihost.exe"
            | "dwm.exe"
            | "ctfmon.exe"
            | "fontdrvhost.exe"
            | "securityhealthsystray.exe"
            | "smartscreen.exe"
            | "winlogon.exe"
            | "userinit.exe"
            | "pickerhost.exe"
            | "openwith.exe"
    ) {
        return false;
    }

    if is_likely_system_process(&lower_name) {
        return false;
    }

    if is_lifecycle_utility_process(&lower_name) {
        return false;
    }

    true
}

fn is_lifecycle_utility_process(lower_name: &str) -> bool {
    let normalized = lower_name.trim().trim_matches('"');
    let stem = normalized.strip_suffix(".exe").unwrap_or(normalized);

    if stem.is_empty() {
        return false;
    }

    if matches!(
        stem,
        "setup"
            | "install"
            | "installer"
            | "uninstall"
            | "uninstaller"
            | "unins"
            | "unins000"
            | "update"
            | "updater"
            | "upgrade"
            | "remove"
            | "maintenance"
            | "maintenancetool"
    ) {
        return true;
    }

    let mut tokens = stem
        .split(|ch: char| ch == '-' || ch == '_' || ch == '.' || ch.is_whitespace())
        .filter(|token| !token.is_empty());

    let first = tokens.next();
    let second = tokens.next();
    if first.is_none() || second.is_none() {
        return false;
    }

    std::iter::once(first.unwrap())
        .chain(std::iter::once(second.unwrap()))
        .chain(tokens)
        .any(|token| {
            matches!(
                token,
                "setup"
                    | "install"
                    | "installer"
                    | "uninstall"
                    | "uninstaller"
                    | "unins"
                    | "unins000"
                    | "update"
                    | "updater"
                    | "upgrade"
                    | "remove"
                    | "maintenance"
                    | "maintenancetool"
            )
        })
}

fn is_lifecycle_utility_window(window: WindowTrackingCandidate<'_>) -> bool {
    if !is_lifecycle_metadata_candidate_executable(window.exe_name) {
        return false;
    }

    has_lifecycle_metadata_signal(window.title)
}

fn is_lifecycle_metadata_candidate_executable(exe_name: &str) -> bool {
    let normalized = exe_name.trim().trim_matches('"').to_lowercase();
    let stem = normalized
        .strip_suffix(".exe")
        .unwrap_or(normalized.as_str());
    if stem.is_empty() {
        return false;
    }

    let tokens: Vec<&str> = stem
        .split(|ch: char| ch == '-' || ch == '_' || ch == '.' || ch.is_whitespace())
        .filter(|token| !token.is_empty())
        .collect();
    if tokens.len() < 2 {
        return false;
    }

    let has_version = tokens.iter().any(|token| is_version_like_token(token));
    if !has_version {
        return false;
    }

    tokens.iter().any(|token| {
        matches!(
            *token,
            "win"
                | "windows"
                | "x64"
                | "x86"
                | "amd64"
                | "arm64"
                | "ia32"
                | "portable"
                | "release"
                | "latest"
                | "beta"
                | "alpha"
                | "nightly"
                | "stable"
                | "desktop"
                | "app"
        )
    })
}

fn is_version_like_token(token: &str) -> bool {
    let raw = token.trim();
    if raw.is_empty() {
        return false;
    }

    let version = raw.strip_prefix('v').unwrap_or(raw);
    if version.chars().all(|ch| ch.is_ascii_digit()) {
        return true;
    }

    let mut segment_count = 0usize;
    for segment in version.split('.') {
        if segment.is_empty() || !segment.chars().all(|ch| ch.is_ascii_digit()) {
            return false;
        }
        segment_count += 1;
    }

    (2..=6).contains(&segment_count)
}

fn has_lifecycle_metadata_signal(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return false;
    }

    if trimmed.contains("安装")
        || trimmed.contains("卸载")
        || trimmed.contains("更新")
        || trimmed.contains("维护工具")
    {
        return true;
    }

    trimmed
        .to_lowercase()
        .split(|ch: char| !ch.is_ascii_alphanumeric())
        .filter(|token| !token.is_empty())
        .any(|token| {
            matches!(
                token,
                "setup"
                    | "install"
                    | "installer"
                    | "installation"
                    | "installing"
                    | "uninstall"
                    | "uninstaller"
                    | "uninstallation"
                    | "uninstalling"
                    | "unins"
                    | "unins000"
                    | "update"
                    | "updater"
                    | "updating"
                    | "upgrade"
                    | "remove"
                    | "maintenance"
                    | "maintenancetool"
            )
        })
}

fn is_likely_system_process(lower_name: &str) -> bool {
    (lower_name.starts_with("search") && lower_name.ends_with(".exe"))
        || (lower_name.ends_with("host.exe")
            && (lower_name.contains("experience")
                || lower_name.contains("runtime")
                || lower_name.contains("task")
                || lower_name.contains("applicationframe")
                || lower_name.contains("textinput")
                || lower_name.contains("fontdrv")))
        || lower_name.ends_with("broker.exe")
        || lower_name.ends_with("systray.exe")
        || matches!(lower_name, "svchost.exe" | "dllhost.exe" | "conhost.exe")
}

#[derive(Clone, Debug)]
pub struct ActiveSessionSnapshot {
    pub start_time: i64,
    pub exe_name: String,
    pub window_title: String,
}

#[cfg(test)]
mod tests {
    use super::{
        is_trackable_window, should_track, TrackingDataChangedPayload, WindowSessionIdentity,
        WindowTrackingCandidate, WindowTransitionDecision,
    };

    #[test]
    fn session_identity_uses_stable_window_fields() {
        let identity = WindowSessionIdentity::from_window_fields(
            "QQ.exe",
            42,
            "0x100",
            "0x100",
            "Chrome_WidgetWin_1",
        )
        .unwrap();

        assert_eq!(identity.app_key, "qq.exe");
        assert_eq!(
            identity.instance_key,
            "qq.exe|pid:42|root:0x100|class:chrome_widgetwin_1"
        );
        assert!(identity.is_same_app(
            &WindowSessionIdentity::from_window_fields(
                "qq.exe",
                100,
                "0x200",
                "0x200",
                "OtherClass",
            )
            .unwrap()
        ));
        assert!(!identity.is_same_instance(
            &WindowSessionIdentity::from_window_fields(
                "qq.exe",
                100,
                "0x200",
                "0x200",
                "OtherClass",
            )
            .unwrap()
        ));
    }

    #[test]
    fn transition_decision_exposes_stable_mutation_semantics() {
        let decision = WindowTransitionDecision {
            reason: "session-transition-app-change",
            should_end_previous: true,
            should_start_next: false,
            should_refresh_metadata: false,
            end_time_override: Some(8_000),
        };

        assert!(decision.has_session_work());
        assert!(decision.has_mutation_plan());
        assert_eq!(decision.resolved_end_time(10_000), 8_000);
        assert_eq!(decision.mutation_reason(true), Some("session-ended"));
        assert_eq!(decision.mutation_reason(false), None);
    }

    #[test]
    fn tracking_payload_constructor_preserves_contract_fields() {
        let payload = TrackingDataChangedPayload::new("session-transition", 123);
        assert_eq!(payload.reason, "session-transition");
        assert_eq!(payload.changed_at_ms, 123);
    }

    #[test]
    fn should_track_filters_system_and_lifecycle_processes() {
        assert!(!should_track("LockApp.exe"));
        assert!(!should_track("SearchHost.exe"));
        assert!(!should_track("obsidian-setup.exe"));
        assert!(!should_track("cursor-updater.exe"));
        assert!(should_track("Antigravity.exe"));
    }

    #[test]
    fn trackable_window_rejects_versioned_lifecycle_titles() {
        let installer = WindowTrackingCandidate::from_window_fields(
            "alma-0.0.750-win-x64.exe",
            "Alma 安装",
            false,
        );
        let app = WindowTrackingCandidate::from_window_fields("Alma.exe", "Alma", false);

        assert!(!is_trackable_window(Some(installer)));
        assert!(is_trackable_window(Some(app)));
    }
}
