use super::contracts::{
    SustainedParticipationAppIdentity, SustainedParticipationKind,
    SustainedParticipationSignalEvaluationSnapshot, SustainedParticipationSignalMatchResult,
    SustainedParticipationSignalSnapshot,
};
use std::path::Path;

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
        "bilibili.exe" | "哔哩哔哩.exe" | "哔哩哔哩" | "鍝斿摡鍝斿摡.exe" | "鍝斿摡鍝斿摡"
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
