use serde::{Deserialize, Serialize};

pub const DEFAULT_LAUNCH_AT_LOGIN: bool = true;
pub const DEFAULT_START_MINIMIZED: bool = true;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    #[default]
    Exit,
    Tray,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MinimizeBehavior {
    #[default]
    Taskbar,
    Tray,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DesktopBehaviorSettings {
    pub close_behavior: CloseBehavior,
    pub minimize_behavior: MinimizeBehavior,
    pub launch_at_login: bool,
    pub start_minimized: bool,
}

impl Default for DesktopBehaviorSettings {
    fn default() -> Self {
        Self {
            close_behavior: CloseBehavior::Exit,
            minimize_behavior: MinimizeBehavior::Taskbar,
            launch_at_login: DEFAULT_LAUNCH_AT_LOGIN,
            start_minimized: DEFAULT_START_MINIMIZED,
        }
    }
}

impl DesktopBehaviorSettings {
    pub fn with_desktop_behavior(
        self,
        close_behavior: CloseBehavior,
        minimize_behavior: MinimizeBehavior,
    ) -> Self {
        Self {
            close_behavior,
            minimize_behavior,
            ..self
        }
    }

    pub fn with_raw_desktop_behavior(self, close_behavior: &str, minimize_behavior: &str) -> Self {
        self.with_desktop_behavior(
            parse_close_behavior(close_behavior),
            parse_minimize_behavior(minimize_behavior),
        )
    }

    pub fn with_launch_behavior(self, launch_at_login: bool, start_minimized: bool) -> Self {
        Self {
            launch_at_login,
            start_minimized,
            ..self
        }
    }

    pub fn from_storage_values(
        close_behavior: Option<&str>,
        minimize_behavior: Option<&str>,
        launch_at_login: Option<&str>,
        start_minimized: Option<&str>,
    ) -> Self {
        let close_behavior = close_behavior.map(parse_close_behavior).unwrap_or_default();
        let minimize_behavior = minimize_behavior
            .map(parse_minimize_behavior)
            .unwrap_or_default();
        let launch_at_login = launch_at_login
            .map(|raw| parse_boolean_setting(raw, DEFAULT_LAUNCH_AT_LOGIN))
            .unwrap_or(DEFAULT_LAUNCH_AT_LOGIN);
        let start_minimized = start_minimized
            .map(|raw| parse_boolean_setting(raw, DEFAULT_START_MINIMIZED))
            .unwrap_or(DEFAULT_START_MINIMIZED);

        Self::default()
            .with_desktop_behavior(close_behavior, minimize_behavior)
            .with_launch_behavior(launch_at_login, start_minimized)
    }

    pub fn should_keep_tray_visible(self) -> bool {
        self.close_behavior == CloseBehavior::Tray
            || self.minimize_behavior == MinimizeBehavior::Tray
    }

    pub fn should_start_minimized_on_autostart(self) -> bool {
        self.launch_at_login && self.start_minimized
    }
}

pub fn parse_close_behavior(raw: &str) -> CloseBehavior {
    if raw.trim().eq_ignore_ascii_case("tray") {
        CloseBehavior::Tray
    } else {
        CloseBehavior::Exit
    }
}

pub fn parse_minimize_behavior(raw: &str) -> MinimizeBehavior {
    if raw.trim().eq_ignore_ascii_case("tray") {
        MinimizeBehavior::Tray
    } else {
        MinimizeBehavior::Taskbar
    }
}

pub fn parse_boolean_setting(raw: &str, fallback: bool) -> bool {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => true,
        "0" | "false" | "no" | "off" => false,
        _ => fallback,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        parse_boolean_setting, parse_close_behavior, parse_minimize_behavior, CloseBehavior,
        DesktopBehaviorSettings, MinimizeBehavior, DEFAULT_LAUNCH_AT_LOGIN,
        DEFAULT_START_MINIMIZED,
    };

    #[test]
    fn parse_desktop_behavior_defaults_to_safe_values() {
        assert_eq!(parse_close_behavior("tray"), CloseBehavior::Tray);
        assert_eq!(parse_close_behavior("unknown"), CloseBehavior::Exit);
        assert_eq!(parse_minimize_behavior("tray"), MinimizeBehavior::Tray);
        assert_eq!(
            parse_minimize_behavior("anything-else"),
            MinimizeBehavior::Taskbar
        );
    }

    #[test]
    fn parse_boolean_setting_supports_common_raw_values() {
        assert!(parse_boolean_setting("1", false));
        assert!(parse_boolean_setting("YES", false));
        assert!(!parse_boolean_setting("0", true));
        assert!(!parse_boolean_setting("off", true));
        assert!(parse_boolean_setting("invalid", true));
        assert!(!parse_boolean_setting("invalid", false));
    }

    #[test]
    fn with_methods_keep_settings_updates_explicit() {
        let defaults = DesktopBehaviorSettings::default();
        let updated = defaults
            .with_desktop_behavior(CloseBehavior::Tray, MinimizeBehavior::Taskbar)
            .with_launch_behavior(false, true);

        assert_eq!(updated.close_behavior, CloseBehavior::Tray);
        assert_eq!(updated.minimize_behavior, MinimizeBehavior::Taskbar);
        assert!(!updated.launch_at_login);
        assert!(updated.start_minimized);
        assert_eq!(defaults.launch_at_login, DEFAULT_LAUNCH_AT_LOGIN);
    }

    #[test]
    fn from_storage_values_applies_defaults_and_domain_parsing() {
        let defaults = DesktopBehaviorSettings::from_storage_values(None, None, None, None);
        assert_eq!(defaults, DesktopBehaviorSettings::default());

        let merged = DesktopBehaviorSettings::from_storage_values(
            Some("tray"),
            Some("tray"),
            Some("no"),
            Some("invalid"),
        );
        assert_eq!(merged.close_behavior, CloseBehavior::Tray);
        assert_eq!(merged.minimize_behavior, MinimizeBehavior::Tray);
        assert!(!merged.launch_at_login);
        assert_eq!(merged.start_minimized, DEFAULT_START_MINIMIZED);
    }

    #[test]
    fn tray_visibility_and_autostart_rules_follow_settings_semantics() {
        let hidden = DesktopBehaviorSettings::default();
        assert!(!hidden.should_keep_tray_visible());
        assert!(hidden.should_start_minimized_on_autostart());

        let close_to_tray =
            hidden.with_desktop_behavior(CloseBehavior::Tray, MinimizeBehavior::Taskbar);
        assert!(close_to_tray.should_keep_tray_visible());

        let no_autostart_minimize = hidden.with_launch_behavior(false, true);
        assert!(!no_autostart_minimize.should_start_minimized_on_autostart());
    }

    #[test]
    fn raw_desktop_behavior_update_stays_inside_domain() {
        let updated =
            DesktopBehaviorSettings::default().with_raw_desktop_behavior("tray", "taskbar");
        assert_eq!(updated.close_behavior, CloseBehavior::Tray);
        assert_eq!(updated.minimize_behavior, MinimizeBehavior::Taskbar);
    }
}
