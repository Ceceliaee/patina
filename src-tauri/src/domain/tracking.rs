use std::path::Path;

#[path = "tracking/contracts.rs"]
mod contracts;
#[path = "tracking/session_identity.rs"]
mod session_identity;

pub use contracts::*;
pub use session_identity::*;

// Owner ledger: this file keeps stable tracking domain decisions. Contract
// types live in tracking/contracts.rs; session identity lives in
// tracking/session_identity.rs; runtime orchestration stays in engine/tracking.
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

pub fn sustained_participation_app_identity(
    exe_name: &str,
    process_path: &str,
) -> Option<SustainedParticipationAppIdentity> {
    let normalized_exe = normalize_process_value(exe_name);
    let normalized_path = normalize_process_value(process_path);
    let normalized_exe_stem = normalized_exe
        .strip_suffix(".exe")
        .unwrap_or(&normalized_exe);

    if normalized_exe.is_empty() && normalized_path.is_empty() {
        return None;
    }

    if matches!(normalized_exe.as_str(), "chrome.exe" | "chrome")
        || normalized_path.ends_with("\\chrome.exe")
    {
        return Some(SustainedParticipationAppIdentity::Chrome);
    }

    if matches!(normalized_exe.as_str(), "msedge.exe" | "msedge")
        || normalized_path.ends_with("\\msedge.exe")
    {
        return Some(SustainedParticipationAppIdentity::Edge);
    }

    if matches!(normalized_exe.as_str(), "firefox.exe" | "firefox")
        || normalized_path.ends_with("\\firefox.exe")
    {
        return Some(SustainedParticipationAppIdentity::Firefox);
    }

    if matches!(normalized_exe.as_str(), "brave.exe" | "brave")
        || normalized_path.ends_with("\\brave.exe")
    {
        return Some(SustainedParticipationAppIdentity::Brave);
    }

    if matches!(normalized_exe.as_str(), "zoom.exe" | "zoom")
        || normalized_path.ends_with("\\zoom.exe")
    {
        return Some(SustainedParticipationAppIdentity::Zoom);
    }

    if matches!(normalized_exe.as_str(), "teams.exe" | "teams")
        || normalized_path.ends_with("\\teams.exe")
    {
        return Some(SustainedParticipationAppIdentity::Teams);
    }

    if matches!(normalized_exe.as_str(), "vlc.exe" | "vlc")
        || normalized_path.ends_with("\\vlc.exe")
    {
        return Some(SustainedParticipationAppIdentity::Vlc);
    }

    if matches!(
        normalized_exe.as_str(),
        "bilibili.exe" | "哔哩哔哩.exe" | "哔哩哔哩"
    ) || normalized_exe_stem.starts_with("bilibili")
        || normalized_path.contains("\\bilibili\\")
    {
        return Some(SustainedParticipationAppIdentity::Bilibili);
    }

    if matches!(normalized_exe.as_str(), "douyin.exe" | "douyin")
        || normalized_exe_stem.starts_with("douyin")
        || normalized_path.contains("\\douyin\\")
        || normalized_path.contains("\\bytedance\\douyin\\")
    {
        return Some(SustainedParticipationAppIdentity::Douyin);
    }

    if matches!(
        normalized_exe.as_str(),
        "wemeetapp.exe" | "tencentmeeting.exe" | "wemeetapp" | "tencentmeeting"
    ) || normalized_path.ends_with("\\wemeetapp.exe")
        || normalized_path.ends_with("\\tencentmeeting.exe")
    {
        return Some(SustainedParticipationAppIdentity::WeMeet);
    }

    None
}

pub fn source_app_id_identity(source_app_id: &str) -> Option<SustainedParticipationAppIdentity> {
    let normalized_source = normalize_source_identifier(source_app_id);
    if normalized_source.is_empty() {
        return None;
    }

    if normalized_source.contains("chrome") {
        return Some(SustainedParticipationAppIdentity::Chrome);
    }

    if normalized_source.contains("msedge")
        || normalized_source.contains("microsoftedge")
        || normalized_source == "edge"
    {
        return Some(SustainedParticipationAppIdentity::Edge);
    }

    if normalized_source.contains("firefox") {
        return Some(SustainedParticipationAppIdentity::Firefox);
    }

    if normalized_source.contains("brave") {
        return Some(SustainedParticipationAppIdentity::Brave);
    }

    if normalized_source.contains("zoom") {
        return Some(SustainedParticipationAppIdentity::Zoom);
    }

    if normalized_source.contains("msteams") || normalized_source.contains("teams") {
        return Some(SustainedParticipationAppIdentity::Teams);
    }

    if normalized_source.contains("vlc") {
        return Some(SustainedParticipationAppIdentity::Vlc);
    }

    if normalized_source.contains("bilibilipc") || normalized_source.contains("bilibili") {
        return Some(SustainedParticipationAppIdentity::Bilibili);
    }

    if normalized_source.contains("douyin") || normalized_source.contains("aweme") {
        return Some(SustainedParticipationAppIdentity::Douyin);
    }

    if normalized_source.contains("wemeet")
        || normalized_source.contains("tencentmeeting")
        || normalized_source.contains("voovmeeting")
    {
        return Some(SustainedParticipationAppIdentity::WeMeet);
    }

    None
}

pub fn signal_origin_matches_window(
    exe_name: &str,
    process_path: &str,
    signal: &SustainedParticipationSignalSnapshot,
) -> bool {
    let window_identity = sustained_participation_app_identity(exe_name, process_path);
    let identity_matches = matches!(
        (window_identity, signal.source_app_identity),
        (Some(window_identity), Some(source_identity)) if window_identity == source_identity
    );
    let source_app_id_matches = signal
        .source_app_id
        .as_deref()
        .map(|source_app_id| source_app_id_matches_window(exe_name, process_path, source_app_id))
        .unwrap_or(false);

    identity_matches || source_app_id_matches
}

pub fn signal_explicitly_stopped_for_window(
    exe_name: &str,
    process_path: &str,
    signal: &SustainedParticipationSignalSnapshot,
) -> bool {
    signal.is_available
        && !signal.is_active
        && signal_origin_matches_window(exe_name, process_path, signal)
}

pub fn signal_matches_window(
    exe_name: &str,
    process_path: &str,
    signal: &SustainedParticipationSignalSnapshot,
) -> bool {
    signal.is_active && signal_origin_matches_window(exe_name, process_path, signal)
}

pub fn resolve_sustained_participation_kind(
    exe_name: &str,
    process_path: &str,
    signal: &SustainedParticipationSignalSnapshot,
) -> Option<SustainedParticipationKind> {
    if !signal_matches_window(exe_name, process_path, signal) {
        return None;
    }

    Some(SustainedParticipationKind::Audio)
}

pub fn evaluate_sustained_participation_signal(
    exe_name: &str,
    process_path: &str,
    signal: &SustainedParticipationSignalSnapshot,
) -> SustainedParticipationSignalEvaluationSnapshot {
    if !signal.is_available {
        return SustainedParticipationSignalEvaluationSnapshot {
            signal: signal.clone(),
            match_result: SustainedParticipationSignalMatchResult::Unavailable,
        };
    }

    if !signal.is_active {
        return SustainedParticipationSignalEvaluationSnapshot {
            signal: signal.clone(),
            match_result: SustainedParticipationSignalMatchResult::Inactive,
        };
    }

    SustainedParticipationSignalEvaluationSnapshot {
        signal: signal.clone(),
        match_result: if signal_origin_matches_window(exe_name, process_path, signal) {
            SustainedParticipationSignalMatchResult::Matched
        } else {
            SustainedParticipationSignalMatchResult::IdentityMismatch
        },
    }
}

pub fn resolve_sustained_participation_identity_key(
    exe_name: &str,
    process_path: &str,
) -> Option<String> {
    sustained_participation_app_identity(exe_name, process_path)
        .map(|identity| format!("{identity:?}").to_lowercase())
        .or_else(|| {
            let normalized_path_name = normalize_process_file_name(process_path);
            if !normalized_path_name.is_empty() {
                return Some(normalized_path_name);
            }

            let normalized_exe = normalize_process_file_name(exe_name);
            if normalized_exe.is_empty() {
                None
            } else {
                Some(normalized_exe)
            }
        })
}

#[allow(dead_code)]
pub fn resolve_tracking_status(
    exe_name: &str,
    process_path: &str,
    idle_time_ms: u32,
    is_afk: bool,
    continuity_window_secs: u64,
    sustained_participation_secs: u64,
    tracking_paused: bool,
    signal: &SustainedParticipationSignalSnapshot,
) -> TrackingStatusSnapshot {
    if tracking_paused || exe_name.trim().is_empty() {
        return TrackingStatusSnapshot::default();
    }

    let continuity_active = !is_afk && u64::from(idle_time_ms) <= continuity_window_secs * 1000;
    let eligible_kind = resolve_sustained_participation_kind(exe_name, process_path, signal);
    let sustained_participation_active =
        eligible_kind.is_some() && u64::from(idle_time_ms) <= sustained_participation_secs * 1000;

    TrackingStatusSnapshot {
        is_tracking_active: continuity_active || sustained_participation_active,
        sustained_participation_eligible: eligible_kind.is_some(),
        sustained_participation_active,
        sustained_participation_kind: eligible_kind,
        sustained_participation_state: if sustained_participation_active {
            SustainedParticipationState::Active
        } else if signal.is_available {
            SustainedParticipationState::Candidate
        } else {
            SustainedParticipationState::Inactive
        },
        sustained_participation_signal_source: signal.signal_source,
        sustained_participation_reason: if sustained_participation_active {
            SustainedParticipationStatusReason::SignalMatched
        } else if signal.is_available && !signal.is_active {
            SustainedParticipationStatusReason::SignalInactive
        } else if signal.is_available {
            SustainedParticipationStatusReason::IdentityMismatch
        } else {
            SustainedParticipationStatusReason::NoSignal
        },
        sustained_participation_diagnostics: SustainedParticipationDiagnosticsSnapshot {
            state: if sustained_participation_active {
                SustainedParticipationState::Active
            } else if signal.is_available {
                SustainedParticipationState::Candidate
            } else {
                SustainedParticipationState::Inactive
            },
            reason: if sustained_participation_active {
                SustainedParticipationStatusReason::SignalMatched
            } else if signal.is_available && !signal.is_active {
                SustainedParticipationStatusReason::SignalInactive
            } else if signal.is_available {
                SustainedParticipationStatusReason::IdentityMismatch
            } else {
                SustainedParticipationStatusReason::NoSignal
            },
            window_identity: sustained_participation_app_identity(exe_name, process_path),
            effective_signal_source: signal.signal_source,
            last_match_at_ms: None,
            grace_deadline_ms: None,
            system_media: SustainedParticipationSignalEvaluationSnapshot::default(),
            audio_session: SustainedParticipationSignalEvaluationSnapshot::default(),
        },
    }
}

fn normalize_process_value(value: &str) -> String {
    value.trim().trim_matches('"').to_lowercase()
}

fn normalize_process_file_name(value: &str) -> String {
    let trimmed = value.trim().trim_matches('"');
    if trimmed.is_empty() {
        return String::new();
    }

    Path::new(trimmed)
        .file_name()
        .map(|file_name| file_name.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| trimmed.to_lowercase())
}

fn normalize_source_identifier(source_app_id: &str) -> String {
    source_app_id
        .trim()
        .to_lowercase()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect()
}

fn push_match_candidate(candidates: &mut Vec<String>, value: String) {
    if value.is_empty() || candidates.contains(&value) {
        return;
    }

    candidates.push(value);
}

fn source_app_id_matches_window(exe_name: &str, process_path: &str, source_app_id: &str) -> bool {
    let normalized_source = normalize_source_identifier(source_app_id);
    if normalized_source.is_empty() {
        return false;
    }

    let mut candidates = Vec::new();
    for raw in [exe_name, process_path] {
        let normalized_value = normalize_process_value(raw);
        let normalized_file_name = normalize_process_file_name(raw);

        for candidate in [normalized_value, normalized_file_name] {
            if candidate.is_empty() {
                continue;
            }

            push_match_candidate(&mut candidates, normalize_source_identifier(&candidate));
            push_match_candidate(
                &mut candidates,
                normalize_source_identifier(candidate.strip_suffix(".exe").unwrap_or(&candidate)),
            );
        }
    }

    candidates
        .iter()
        .filter(|candidate| !candidate.is_empty())
        .any(|candidate| {
            normalized_source == *candidate
                || normalized_source.contains(candidate)
                || candidate.contains(&normalized_source)
        })
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

#[cfg(test)]
mod tests {
    use super::{
        is_trackable_window, resolve_sustained_participation_kind, resolve_tracking_status,
        should_track, signal_matches_window, source_app_id_identity,
        sustained_participation_app_identity, SustainedParticipationAppIdentity,
        SustainedParticipationKind, SustainedParticipationSignalSnapshot,
        SustainedParticipationSignalSource, SystemMediaPlaybackType, TrackingDataChangedPayload,
        WindowSessionIdentity, WindowTrackingCandidate, WindowTransitionDecision,
        TRACKING_REASON_STARTUP_SEALED, TRACKING_REASON_STATUS_CHANGED,
        TRACKING_REASON_TRACKING_PAUSED_SEALED, TRACKING_REASON_WATCHDOG_SEALED,
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
    fn sealed_reason_contracts_are_stable() {
        assert_eq!(TRACKING_REASON_WATCHDOG_SEALED, "watchdog-sealed");
        assert_eq!(TRACKING_REASON_STARTUP_SEALED, "startup-sealed");
        assert_eq!(
            TRACKING_REASON_TRACKING_PAUSED_SEALED,
            "tracking-paused-sealed"
        );
        assert_eq!(TRACKING_REASON_STATUS_CHANGED, "tracking-status-changed");
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
    fn sustained_participation_profiles_cover_known_audio_signal_apps() {
        assert_eq!(
            sustained_participation_app_identity("Zoom.exe", r"C:\Program Files\Zoom\Zoom.exe"),
            Some(SustainedParticipationAppIdentity::Zoom)
        );
        assert_eq!(
            sustained_participation_app_identity(
                "douyin.exe",
                r"C:\Program Files (x86)\ByteDance\douyin\douyin.exe"
            ),
            Some(SustainedParticipationAppIdentity::Douyin)
        );
        assert_eq!(
            sustained_participation_app_identity("douyin_widget.exe", ""),
            Some(SustainedParticipationAppIdentity::Douyin)
        );
        assert_eq!(
            sustained_participation_app_identity(
                "哔哩哔哩.exe",
                r"C:\Program Files\bilibili\哔哩哔哩.exe"
            ),
            Some(SustainedParticipationAppIdentity::Bilibili)
        );
        assert_eq!(
            sustained_participation_app_identity(
                "Chrome.exe",
                r"C:\Program Files\Google\Chrome\Application\chrome.exe"
            ),
            Some(SustainedParticipationAppIdentity::Chrome)
        );
        assert_eq!(sustained_participation_app_identity("QQ.exe", ""), None);
    }

    #[test]
    fn source_app_identity_matching_uses_known_aliases() {
        assert_eq!(
            source_app_id_identity("Chrome"),
            Some(SustainedParticipationAppIdentity::Chrome)
        );
        assert_eq!(
            source_app_id_identity("MSTeams_8wekyb3d8bbwe!MSTeams"),
            Some(SustainedParticipationAppIdentity::Teams)
        );
        assert_eq!(
            source_app_id_identity("BiliBiliPC"),
            Some(SustainedParticipationAppIdentity::Bilibili)
        );
        assert_eq!(
            source_app_id_identity("TencentMeeting"),
            Some(SustainedParticipationAppIdentity::WeMeet)
        );
        assert_eq!(source_app_id_identity("Spotify"), None);
    }

    #[test]
    fn signal_matching_requires_active_signal_and_matching_source() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("Chrome".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Chrome),
            playback_type: Some(SystemMediaPlaybackType::Video),
        };

        assert!(signal_matches_window(
            "chrome.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            &signal
        ));
        assert!(!signal_matches_window(
            "firefox.exe",
            r"C:\Program Files\Mozilla Firefox\firefox.exe",
            &signal
        ));
    }

    #[test]
    fn signal_matching_accepts_unknown_apps_when_source_app_id_matches_window() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("PotPlayerMini64".into()),
            source_app_identity: None,
            playback_type: Some(SystemMediaPlaybackType::Audio),
        };

        assert!(signal_matches_window(
            "PotPlayerMini64.exe",
            r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
            &signal
        ));
        assert_eq!(
            resolve_sustained_participation_kind(
                "PotPlayerMini64.exe",
                r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
                &signal,
            ),
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn browser_audio_signal_counts_as_sustained_participation() {
        let audio_only_signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::AudioSession),
            source_app_id: Some("Chrome.exe".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Chrome),
            playback_type: None,
        };
        assert!(signal_matches_window(
            "chrome.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            &audio_only_signal
        ));
        assert_eq!(
            resolve_sustained_participation_kind(
                "chrome.exe",
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                &audio_only_signal,
            ),
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn tracking_status_prefers_signal_gated_sustained_participation() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("Chrome".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Chrome),
            playback_type: Some(SystemMediaPlaybackType::Video),
        };

        let status = resolve_tracking_status(
            "chrome.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            500_000,
            false,
            180,
            600,
            false,
            &signal,
        );

        assert!(status.is_tracking_active);
        assert!(status.sustained_participation_eligible);
        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_kind,
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn tracking_status_falls_back_to_continuity_without_signal() {
        let signal = SustainedParticipationSignalSnapshot::default();

        let status = resolve_tracking_status(
            "zoom.exe",
            r"C:\Program Files\Zoom\Zoom.exe",
            250_000,
            false,
            180,
            600,
            false,
            &signal,
        );

        assert!(!status.is_tracking_active);
        assert!(!status.sustained_participation_eligible);
        assert!(!status.sustained_participation_active);
        assert_eq!(status.sustained_participation_kind, None);
    }

    #[test]
    fn tracking_status_accepts_unknown_audio_session_matches() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::AudioSession),
            source_app_id: Some("PotPlayerMini64.exe".into()),
            source_app_identity: None,
            playback_type: None,
        };

        let status = resolve_tracking_status(
            "PotPlayerMini64.exe",
            r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
            240_000,
            false,
            180,
            600,
            false,
            &signal,
        );

        assert!(status.is_tracking_active);
        assert!(status.sustained_participation_eligible);
        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_kind,
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn tracking_status_accepts_browser_audio_only_matches() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::AudioSession),
            source_app_id: Some("Chrome.exe".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Chrome),
            playback_type: None,
        };

        let status = resolve_tracking_status(
            "Chrome.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            240_000,
            true,
            180,
            900,
            false,
            &signal,
        );

        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_kind,
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn tracking_status_keeps_sustained_participation_active_after_generic_afk_threshold() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("Zoom".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Zoom),
            playback_type: Some(SystemMediaPlaybackType::Video),
        };

        let status = resolve_tracking_status(
            "zoom.exe",
            r"C:\Program Files\Zoom\Zoom.exe",
            240_000,
            true,
            180,
            900,
            false,
            &signal,
        );

        assert!(status.is_tracking_active);
        assert!(status.sustained_participation_eligible);
        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_kind,
            Some(SustainedParticipationKind::Audio)
        );
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
