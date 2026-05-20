use super::session_identity::WindowTrackingCandidate;

pub fn should_track(exe_name: &str) -> bool {
    let lower_name = exe_name.to_lowercase();

    if matches!(
        lower_name.as_str(),
        "time_tracker.exe"
            | "time-tracker.exe"
            | "un.exe"
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
            | "hrupdate.exe"
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

    if is_temporary_executable_process(&lower_name) {
        return false;
    }

    if is_lifecycle_utility_process(&lower_name) {
        return false;
    }

    true
}

pub(super) fn is_trackable_explorer_window(window: WindowTrackingCandidate<'_>) -> bool {
    if window.exe_name.to_lowercase() != "explorer.exe" {
        return true;
    }

    matches!(
        window.window_class.to_lowercase().as_str(),
        "cabinetwclass" | "explorewclass"
    )
}

pub(super) fn is_desktop_shell_window(window: WindowTrackingCandidate<'_>) -> bool {
    let lower_name = window.exe_name.to_lowercase();
    let has_title = !window.title.trim().is_empty();
    if !has_title
        && matches!(
            lower_name.as_str(),
            "ui32.exe" | "wallpaper32.exe" | "wallpaper64.exe" | "wallpaperengine.exe"
        )
    {
        return true;
    }

    matches!(
        window.window_class.to_lowercase().as_str(),
        "progman"
            | "workerw"
            | "shelldll_defview"
            | "syslistview32"
            | "shell_traywnd"
            | "shell_secondarytraywnd"
    )
}

pub(super) fn is_lifecycle_utility_window(window: WindowTrackingCandidate<'_>) -> bool {
    if !is_lifecycle_metadata_candidate_executable(window.exe_name) {
        return false;
    }

    has_lifecycle_metadata_signal(window.title)
}

fn is_lifecycle_utility_process(lower_name: &str) -> bool {
    let normalized = lower_name.trim().trim_matches('"');
    let stem = normalized.strip_suffix(".exe").unwrap_or(normalized);

    if stem.is_empty() {
        return false;
    }

    if is_standalone_uninstaller_app_stem(stem) {
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

fn is_temporary_executable_process(lower_name: &str) -> bool {
    lower_name.trim().trim_matches('"').ends_with(".tmp")
}

fn is_standalone_uninstaller_app_stem(stem: &str) -> bool {
    let compact: String = stem
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric())
        .collect();

    matches!(
        compact.as_str(),
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
        || trimmed.contains("瀹夎")
        || trimmed.contains("鍗歌浇")
        || trimmed.contains("鏇存柊")
        || trimmed.contains("缁存姢宸ュ叿")
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
        || matches!(lower_name, "svchost.exe" | "dllhost.exe")
}
