use serde::{Deserialize, Serialize};

pub const DEFAULT_LAUNCH_AT_LOGIN: bool = true;
pub const DEFAULT_START_MINIMIZED: bool = true;
pub const DEFAULT_LOCAL_API_ENABLED: bool = false;
pub const DEFAULT_LOCAL_API_PORT: u16 = 17_321;
pub const DEFAULT_LOCAL_API_TOKEN: &str = "";
pub const LOCAL_API_PORT_MIN: u16 = 1024;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    Exit,
    #[default]
    Tray,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MinimizeBehavior {
    Taskbar,
    #[default]
    Widget,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DesktopBehaviorSettings {
    pub close_behavior: CloseBehavior,
    pub minimize_behavior: MinimizeBehavior,
    pub launch_at_login: bool,
    pub start_minimized: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalApiSettings {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
}

impl Default for LocalApiSettings {
    fn default() -> Self {
        Self {
            enabled: DEFAULT_LOCAL_API_ENABLED,
            port: DEFAULT_LOCAL_API_PORT,
            token: DEFAULT_LOCAL_API_TOKEN.to_string(),
        }
    }
}

impl LocalApiSettings {
    pub fn from_storage_values(
        enabled: Option<&str>,
        port: Option<&str>,
        token: Option<&str>,
    ) -> Self {
        let token = token.unwrap_or(DEFAULT_LOCAL_API_TOKEN).trim().to_string();
        let enabled = enabled
            .map(|raw| parse_boolean_setting(raw, DEFAULT_LOCAL_API_ENABLED))
            .unwrap_or(DEFAULT_LOCAL_API_ENABLED)
            && !token.is_empty();

        Self {
            enabled,
            port: port
                .and_then(parse_local_api_port)
                .unwrap_or(DEFAULT_LOCAL_API_PORT),
            token,
        }
    }
}

impl Default for DesktopBehaviorSettings {
    fn default() -> Self {
        Self {
            close_behavior: CloseBehavior::Tray,
            minimize_behavior: MinimizeBehavior::Widget,
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
    match raw.trim().to_ascii_lowercase().as_str() {
        "widget" => MinimizeBehavior::Widget,
        "taskbar" => MinimizeBehavior::Taskbar,
        _ => MinimizeBehavior::default(),
    }
}

pub fn parse_boolean_setting(raw: &str, fallback: bool) -> bool {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => true,
        "0" | "false" | "no" | "off" => false,
        _ => fallback,
    }
}

pub fn parse_local_api_port(raw: &str) -> Option<u16> {
    let port = raw.trim().parse::<u16>().ok()?;
    (LOCAL_API_PORT_MIN..=u16::MAX)
        .contains(&port)
        .then_some(port)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_boolean_setting, parse_close_behavior, parse_local_api_port, parse_minimize_behavior,
        CloseBehavior, DesktopBehaviorSettings, LocalApiSettings, MinimizeBehavior,
        DEFAULT_LAUNCH_AT_LOGIN, DEFAULT_LOCAL_API_PORT, DEFAULT_START_MINIMIZED,
    };

    #[test]
    fn parse_desktop_behavior_keeps_invalid_values_conservative() {
        assert_eq!(parse_close_behavior("tray"), CloseBehavior::Tray);
        assert_eq!(parse_close_behavior("unknown"), CloseBehavior::Exit);
        assert_eq!(parse_minimize_behavior("widget"), MinimizeBehavior::Widget);
        assert_eq!(
            parse_minimize_behavior("taskbar"),
            MinimizeBehavior::Taskbar
        );
        assert_eq!(
            parse_minimize_behavior("anything-else"),
            MinimizeBehavior::Widget
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
    fn local_api_settings_parse_defaults_and_invalid_port() {
        assert_eq!(
            LocalApiSettings::from_storage_values(None, None, None),
            LocalApiSettings::default()
        );
        assert_eq!(
            LocalApiSettings::from_storage_values(Some("1"), Some("80"), Some("secret")),
            LocalApiSettings {
                enabled: true,
                port: DEFAULT_LOCAL_API_PORT,
                token: "secret".to_string(),
            }
        );
        assert_eq!(
            LocalApiSettings::from_storage_values(Some("1"), Some("18080"), Some("   ")),
            LocalApiSettings {
                enabled: false,
                port: 18_080,
                token: String::new(),
            }
        );
        assert_eq!(parse_local_api_port("65535"), Some(65_535));
        assert_eq!(parse_local_api_port("1023"), None);
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
            Some("widget"),
            Some("no"),
            Some("invalid"),
        );
        assert_eq!(merged.close_behavior, CloseBehavior::Tray);
        assert_eq!(merged.minimize_behavior, MinimizeBehavior::Widget);
        assert!(!merged.launch_at_login);
        assert_eq!(merged.start_minimized, DEFAULT_START_MINIMIZED);
    }

    #[test]
    fn tray_visibility_and_autostart_rules_follow_settings_semantics() {
        let defaults = DesktopBehaviorSettings::default();
        assert!(defaults.should_keep_tray_visible());
        assert_eq!(defaults.minimize_behavior, MinimizeBehavior::Widget);
        assert!(defaults.should_start_minimized_on_autostart());

        let close_to_exit =
            defaults.with_desktop_behavior(CloseBehavior::Exit, MinimizeBehavior::Widget);
        assert!(!close_to_exit.should_keep_tray_visible());

        let minimize_to_widget =
            defaults.with_desktop_behavior(CloseBehavior::Exit, MinimizeBehavior::Widget);
        assert!(!minimize_to_widget.should_keep_tray_visible());

        let no_autostart_minimize = defaults.with_launch_behavior(false, true);
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
