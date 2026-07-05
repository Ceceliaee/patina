use serde::{Deserialize, Serialize};

pub const DEFAULT_LAUNCH_AT_LOGIN: bool = true;
pub const DEFAULT_START_MINIMIZED: bool = true;
pub const DEFAULT_BACKGROUND_OPTIMIZATION: bool = false;
pub const DEFAULT_WEB_ACTIVITY_ENABLED: bool = false;
pub const DEFAULT_WEB_ACTIVITY_PORT: u16 = 12_345;
pub const DEFAULT_WEB_ACTIVITY_TOKEN: &str = "";
pub const DEFAULT_REMOTE_STATUS_BRIDGE_ENABLED: bool = false;
pub const DEFAULT_REMOTE_STATUS_BRIDGE_URL: &str = "";
pub const DEFAULT_REMOTE_STATUS_BRIDGE_TOKEN: &str = "";
pub const DEFAULT_REMOTE_STATUS_BRIDGE_MACHINE_ID: &str = "";
pub const DEFAULT_PRIVACY_MODE: bool = false;
pub const WEB_ACTIVITY_PORT_MIN: u16 = 1024;

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
    pub background_optimization: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebActivityBridgeSettings {
    pub enabled: bool,
    pub port: u16,
    pub token: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebActivitySettings {
    pub enabled: bool,
    pub token: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemoteStatusBridgeSettings {
    pub enabled: bool,
    pub url: String,
    pub token: String,
    pub machine_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PrivacySettings {
    pub privacy_mode: bool,
}

impl Default for WebActivityBridgeSettings {
    fn default() -> Self {
        Self {
            enabled: DEFAULT_WEB_ACTIVITY_ENABLED,
            port: DEFAULT_WEB_ACTIVITY_PORT,
            token: DEFAULT_WEB_ACTIVITY_TOKEN.to_string(),
        }
    }
}

impl Default for WebActivitySettings {
    fn default() -> Self {
        Self {
            enabled: DEFAULT_WEB_ACTIVITY_ENABLED,
            token: DEFAULT_WEB_ACTIVITY_TOKEN.to_string(),
        }
    }
}

impl Default for RemoteStatusBridgeSettings {
    fn default() -> Self {
        Self {
            enabled: DEFAULT_REMOTE_STATUS_BRIDGE_ENABLED,
            url: DEFAULT_REMOTE_STATUS_BRIDGE_URL.to_string(),
            token: DEFAULT_REMOTE_STATUS_BRIDGE_TOKEN.to_string(),
            machine_id: DEFAULT_REMOTE_STATUS_BRIDGE_MACHINE_ID.to_string(),
        }
    }
}

impl WebActivityBridgeSettings {
    pub fn from_storage_values(
        port: Option<&str>,
        web_activity_enabled: Option<&str>,
        web_activity_token: Option<&str>,
    ) -> Self {
        let token = web_activity_token
            .unwrap_or(DEFAULT_WEB_ACTIVITY_TOKEN)
            .trim()
            .to_string();
        let enabled = web_activity_enabled
            .map(|raw| parse_boolean_setting(raw, DEFAULT_WEB_ACTIVITY_ENABLED))
            .unwrap_or(DEFAULT_WEB_ACTIVITY_ENABLED)
            && !token.is_empty();

        Self {
            enabled,
            port: port
                .and_then(parse_web_activity_port)
                .unwrap_or(DEFAULT_WEB_ACTIVITY_PORT),
            token,
        }
    }
}

impl WebActivitySettings {
    pub fn from_storage_values(enabled: Option<&str>, token: Option<&str>) -> Self {
        let token = token
            .unwrap_or(DEFAULT_WEB_ACTIVITY_TOKEN)
            .trim()
            .to_string();
        let enabled = enabled
            .map(|raw| parse_boolean_setting(raw, DEFAULT_WEB_ACTIVITY_ENABLED))
            .unwrap_or(DEFAULT_WEB_ACTIVITY_ENABLED)
            && !token.is_empty();

        Self { enabled, token }
    }
}

impl Default for PrivacySettings {
    fn default() -> Self {
        Self {
            privacy_mode: DEFAULT_PRIVACY_MODE,
        }
    }
}

impl PrivacySettings {
    pub fn from_storage_values(privacy_mode: Option<&str>) -> Self {
        Self {
            privacy_mode: privacy_mode
                .map(|raw| parse_boolean_setting(raw, DEFAULT_PRIVACY_MODE))
                .unwrap_or(DEFAULT_PRIVACY_MODE),
        }
    }
}

impl RemoteStatusBridgeSettings {
    pub fn from_storage_values(
        enabled: Option<&str>,
        url: Option<&str>,
        token: Option<&str>,
        machine_id: Option<&str>,
    ) -> Self {
        let url = url
            .unwrap_or(DEFAULT_REMOTE_STATUS_BRIDGE_URL)
            .trim()
            .to_string();
        let token = token
            .unwrap_or(DEFAULT_REMOTE_STATUS_BRIDGE_TOKEN)
            .trim()
            .to_string();
        let machine_id = machine_id
            .unwrap_or(DEFAULT_REMOTE_STATUS_BRIDGE_MACHINE_ID)
            .trim()
            .to_string();
        let enabled = enabled
            .map(|raw| parse_boolean_setting(raw, DEFAULT_REMOTE_STATUS_BRIDGE_ENABLED))
            .unwrap_or(DEFAULT_REMOTE_STATUS_BRIDGE_ENABLED)
            && !url.is_empty()
            && !token.is_empty();

        Self {
            enabled,
            url,
            token,
            machine_id,
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
            background_optimization: DEFAULT_BACKGROUND_OPTIMIZATION,
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

    pub fn with_background_optimization(self, background_optimization: bool) -> Self {
        Self {
            background_optimization,
            ..self
        }
    }

    pub fn from_storage_values(
        close_behavior: Option<&str>,
        minimize_behavior: Option<&str>,
        launch_at_login: Option<&str>,
        start_minimized: Option<&str>,
        background_optimization: Option<&str>,
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
        let background_optimization = background_optimization
            .map(|raw| parse_boolean_setting(raw, DEFAULT_BACKGROUND_OPTIMIZATION))
            .unwrap_or(DEFAULT_BACKGROUND_OPTIMIZATION);

        Self::default()
            .with_desktop_behavior(close_behavior, minimize_behavior)
            .with_launch_behavior(launch_at_login, start_minimized)
            .with_background_optimization(background_optimization)
    }

    pub fn should_keep_tray_visible(self) -> bool {
        self.close_behavior == CloseBehavior::Tray
    }

    pub fn should_start_minimized_on_autostart(self) -> bool {
        self.launch_at_login && self.start_minimized
    }

    pub fn should_optimize_background_resources(self) -> bool {
        self.background_optimization
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

pub fn parse_web_activity_port(raw: &str) -> Option<u16> {
    let port = raw.trim().parse::<u16>().ok()?;
    (WEB_ACTIVITY_PORT_MIN..=u16::MAX)
        .contains(&port)
        .then_some(port)
}

#[cfg(test)]
mod tests {
    use super::{
        parse_boolean_setting, parse_close_behavior, parse_minimize_behavior,
        parse_web_activity_port, CloseBehavior, DesktopBehaviorSettings, MinimizeBehavior,
        RemoteStatusBridgeSettings, WebActivityBridgeSettings, WebActivitySettings,
        DEFAULT_BACKGROUND_OPTIMIZATION, DEFAULT_LAUNCH_AT_LOGIN, DEFAULT_START_MINIMIZED,
        DEFAULT_WEB_ACTIVITY_PORT,
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
    fn web_activity_bridge_settings_parse_defaults_and_invalid_port() {
        assert_eq!(
            WebActivityBridgeSettings::from_storage_values(None, None, None),
            WebActivityBridgeSettings::default()
        );
        assert_eq!(
            WebActivityBridgeSettings::from_storage_values(Some("80"), None, None),
            WebActivityBridgeSettings {
                enabled: false,
                port: DEFAULT_WEB_ACTIVITY_PORT,
                token: String::new(),
            }
        );
        assert_eq!(
            WebActivityBridgeSettings::from_storage_values(Some("18080"), Some("1"), Some("   "),),
            WebActivityBridgeSettings {
                enabled: false,
                port: 18_080,
                token: String::new(),
            }
        );
        assert_eq!(
            WebActivityBridgeSettings::from_storage_values(Some("18080"), Some("1"), Some("web")),
            WebActivityBridgeSettings {
                enabled: true,
                port: 18_080,
                token: "web".to_string(),
            }
        );
        assert_eq!(parse_web_activity_port("65535"), Some(65_535));
        assert_eq!(parse_web_activity_port("1023"), None);
    }

    #[test]
    fn web_activity_settings_require_a_token_to_enable() {
        assert_eq!(
            WebActivitySettings::from_storage_values(Some("1"), Some("   ")),
            WebActivitySettings {
                enabled: false,
                token: String::new(),
            }
        );
        assert_eq!(
            WebActivitySettings::from_storage_values(Some("1"), Some("secret")),
            WebActivitySettings {
                enabled: true,
                token: "secret".to_string(),
            }
        );
    }

    #[test]
    fn remote_status_bridge_requires_url_and_token_to_enable() {
        assert_eq!(
            RemoteStatusBridgeSettings::from_storage_values(
                Some("1"),
                Some(""),
                Some("secret"),
                Some("machine")
            ),
            RemoteStatusBridgeSettings {
                enabled: false,
                url: String::new(),
                token: "secret".to_string(),
                machine_id: "machine".to_string(),
            }
        );
        assert_eq!(
            RemoteStatusBridgeSettings::from_storage_values(
                Some("1"),
                Some("wss://worker.example/ws"),
                Some("secret"),
                Some("machine"),
            ),
            RemoteStatusBridgeSettings {
                enabled: true,
                url: "wss://worker.example/ws".to_string(),
                token: "secret".to_string(),
                machine_id: "machine".to_string(),
            }
        );
    }

    #[test]
    fn with_methods_keep_settings_updates_explicit() {
        let defaults = DesktopBehaviorSettings::default();
        let updated = defaults
            .with_desktop_behavior(CloseBehavior::Tray, MinimizeBehavior::Taskbar)
            .with_launch_behavior(false, true)
            .with_background_optimization(true);

        assert_eq!(updated.close_behavior, CloseBehavior::Tray);
        assert_eq!(updated.minimize_behavior, MinimizeBehavior::Taskbar);
        assert!(!updated.launch_at_login);
        assert!(updated.start_minimized);
        assert!(updated.background_optimization);
        assert_eq!(defaults.launch_at_login, DEFAULT_LAUNCH_AT_LOGIN);
        assert_eq!(
            defaults.background_optimization,
            DEFAULT_BACKGROUND_OPTIMIZATION
        );
    }

    #[test]
    fn from_storage_values_applies_defaults_and_domain_parsing() {
        let defaults = DesktopBehaviorSettings::from_storage_values(None, None, None, None, None);
        assert_eq!(defaults, DesktopBehaviorSettings::default());

        let merged = DesktopBehaviorSettings::from_storage_values(
            Some("tray"),
            Some("widget"),
            Some("no"),
            Some("invalid"),
            Some("yes"),
        );
        assert_eq!(merged.close_behavior, CloseBehavior::Tray);
        assert_eq!(merged.minimize_behavior, MinimizeBehavior::Widget);
        assert!(!merged.launch_at_login);
        assert_eq!(merged.start_minimized, DEFAULT_START_MINIMIZED);
        assert!(merged.background_optimization);
    }

    #[test]
    fn tray_visibility_and_autostart_rules_follow_settings_semantics() {
        let defaults = DesktopBehaviorSettings::default();
        assert!(defaults.should_keep_tray_visible());
        assert_eq!(defaults.minimize_behavior, MinimizeBehavior::Widget);
        assert!(defaults.should_start_minimized_on_autostart());
        assert!(!defaults.should_optimize_background_resources());

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
