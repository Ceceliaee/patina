use serde::{Deserialize, Serialize};

pub const DEFAULT_LAUNCH_AT_LOGIN: bool = true;
pub const DEFAULT_START_MINIMIZED: bool = true;
pub const DEFAULT_WEB_ACTIVITY_ENABLED: bool = false;
pub const DEFAULT_WEB_ACTIVITY_PORT: u16 = 12_345;
pub const DEFAULT_WEB_ACTIVITY_TOKEN: &str = "";
pub const DEFAULT_REMOTE_STATUS_BRIDGE_ENABLED: bool = false;
pub const DEFAULT_REMOTE_STATUS_BRIDGE_URL: &str = "";
pub const DEFAULT_REMOTE_STATUS_BRIDGE_TOKEN: &str = "";
pub const DEFAULT_REMOTE_STATUS_BRIDGE_MACHINE_ID: &str = "";
pub const WEB_ACTIVITY_PORT_MIN: u16 = 1024;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    Exit,
    #[default]
    Tray,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DesktopBehaviorSettings {
    pub show_tray_icon: bool,
    pub close_behavior: CloseBehavior,
    pub launch_at_login: bool,
    pub start_minimized: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StartupUiStrategy {
    Show,
    OptimizeHidden,
}

impl StartupUiStrategy {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Show => "show-main-window",
            Self::OptimizeHidden => "start-in-tray-optimized",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StartupSource {
    Manual,
    Autostart,
    UpdateRestart,
    StorageRestart,
    SettingsRecovery,
}

impl StartupSource {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Autostart => "autostart",
            Self::UpdateRestart => "update-restart",
            Self::StorageRestart => "storage-restart",
            Self::SettingsRecovery => "settings-recovery",
        }
    }

    fn must_show_main_window(self) -> bool {
        matches!(
            self,
            Self::UpdateRestart | Self::StorageRestart | Self::SettingsRecovery
        )
    }
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
            show_tray_icon: true,
            close_behavior: CloseBehavior::Tray,
            launch_at_login: DEFAULT_LAUNCH_AT_LOGIN,
            start_minimized: DEFAULT_START_MINIMIZED,
        }
    }
}

impl DesktopBehaviorSettings {
    pub fn with_close_behavior(self, close_behavior: CloseBehavior) -> Self {
        Self {
            close_behavior,
            ..self
        }
    }

    #[cfg(test)]
    pub fn with_raw_close_behavior(self, close_behavior: &str) -> Self {
        self.with_close_behavior(parse_close_behavior(close_behavior))
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
        launch_at_login: Option<&str>,
        start_minimized: Option<&str>,
    ) -> Self {
        let close_behavior = close_behavior.map(parse_close_behavior).unwrap_or_default();
        let launch_at_login = launch_at_login
            .map(|raw| parse_boolean_setting(raw, DEFAULT_LAUNCH_AT_LOGIN))
            .unwrap_or(DEFAULT_LAUNCH_AT_LOGIN);
        let start_minimized = start_minimized
            .map(|raw| parse_boolean_setting(raw, DEFAULT_START_MINIMIZED))
            .unwrap_or(DEFAULT_START_MINIMIZED);

        Self::default()
            .with_close_behavior(close_behavior)
            .with_launch_behavior(launch_at_login, start_minimized)
    }

    pub fn should_keep_running_in_background(self) -> bool {
        self.close_behavior == CloseBehavior::Tray
    }

    pub fn should_keep_tray_visible(self) -> bool {
        self.show_tray_icon && self.should_keep_running_in_background()
    }

    pub(crate) fn startup_ui_strategy(self, source: StartupSource) -> StartupUiStrategy {
        if source.must_show_main_window() || !self.start_minimized {
            return StartupUiStrategy::Show;
        }

        StartupUiStrategy::OptimizeHidden
    }
}

pub fn parse_close_behavior(raw: &str) -> CloseBehavior {
    if raw.trim().eq_ignore_ascii_case("tray") {
        CloseBehavior::Tray
    } else {
        CloseBehavior::Exit
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
        parse_boolean_setting, parse_close_behavior, parse_web_activity_port, CloseBehavior,
        DesktopBehaviorSettings, RemoteStatusBridgeSettings, StartupSource, StartupUiStrategy,
        WebActivityBridgeSettings, WebActivitySettings, DEFAULT_LAUNCH_AT_LOGIN,
        DEFAULT_START_MINIMIZED, DEFAULT_WEB_ACTIVITY_PORT,
    };

    #[test]
    fn parse_desktop_behavior_keeps_invalid_values_conservative() {
        assert_eq!(parse_close_behavior("tray"), CloseBehavior::Tray);
        assert_eq!(parse_close_behavior("unknown"), CloseBehavior::Exit);
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
            .with_close_behavior(CloseBehavior::Tray)
            .with_launch_behavior(false, true);

        assert_eq!(updated.close_behavior, CloseBehavior::Tray);
        assert!(!updated.launch_at_login);
        assert!(updated.start_minimized);
        assert_eq!(defaults.launch_at_login, DEFAULT_LAUNCH_AT_LOGIN);
    }

    #[test]
    fn from_storage_values_applies_defaults_and_domain_parsing() {
        let defaults = DesktopBehaviorSettings::from_storage_values(None, None, None);
        assert_eq!(defaults, DesktopBehaviorSettings::default());

        let merged =
            DesktopBehaviorSettings::from_storage_values(Some("tray"), Some("no"), Some("invalid"));
        assert_eq!(merged.close_behavior, CloseBehavior::Tray);
        assert!(!merged.launch_at_login);
        assert_eq!(merged.start_minimized, DEFAULT_START_MINIMIZED);
    }

    #[test]
    fn tray_visibility_and_launch_rules_follow_settings_semantics() {
        let defaults = DesktopBehaviorSettings::default();
        assert!(defaults.should_keep_tray_visible());
        assert!(defaults.start_minimized);

        let close_to_exit = defaults.with_close_behavior(CloseBehavior::Exit);
        assert!(!close_to_exit.should_keep_tray_visible());

        let no_autostart_minimize = defaults.with_launch_behavior(false, true);
        assert!(no_autostart_minimize.start_minimized);
    }

    #[test]
    fn raw_desktop_behavior_update_stays_inside_domain() {
        let updated = DesktopBehaviorSettings::default().with_raw_close_behavior("tray");
        assert_eq!(updated.close_behavior, CloseBehavior::Tray);
    }

    #[test]
    fn manual_and_autostart_launches_share_the_start_minimized_preference() {
        let settings = DesktopBehaviorSettings::default().with_close_behavior(CloseBehavior::Tray);

        assert_eq!(
            settings.startup_ui_strategy(StartupSource::Manual),
            StartupUiStrategy::OptimizeHidden
        );
        assert_eq!(
            settings.startup_ui_strategy(StartupSource::Autostart),
            StartupUiStrategy::OptimizeHidden
        );

        let visible_start = settings.with_launch_behavior(false, false);
        assert_eq!(
            visible_start.startup_ui_strategy(StartupSource::Manual),
            StartupUiStrategy::Show
        );
        assert_eq!(
            visible_start.startup_ui_strategy(StartupSource::Autostart),
            StartupUiStrategy::Show
        );
    }

    #[test]
    fn explicit_restarts_and_settings_recovery_show_the_main_window() {
        let settings = DesktopBehaviorSettings::default();

        for source in [
            StartupSource::UpdateRestart,
            StartupSource::StorageRestart,
            StartupSource::SettingsRecovery,
        ] {
            assert_eq!(
                settings.startup_ui_strategy(source),
                StartupUiStrategy::Show
            );
        }
    }

    #[test]
    fn launch_at_login_only_controls_registration() {
        let settings = DesktopBehaviorSettings::default().with_launch_behavior(false, true);

        assert_eq!(
            settings.startup_ui_strategy(StartupSource::Manual),
            StartupUiStrategy::OptimizeHidden
        );
        assert_eq!(
            settings.startup_ui_strategy(StartupSource::Autostart),
            StartupUiStrategy::OptimizeHidden
        );
    }
}
