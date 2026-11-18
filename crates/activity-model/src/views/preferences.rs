use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Default, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum Theme {
    #[default]
    Light,
    Dark,
    System,
}
impl Theme {
    pub fn tag(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
            Self::System => "system",
        }
    }
    pub fn read(s: &str) -> Self {
        match s {
            "dark" => Self::Dark,
            "system" => Self::System,
            _ => Self::Light,
        }
    }
}
#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
pub struct AppPreferences {
    pub web: crate::settings::WebActivityBridgeSettings,
    pub remote: crate::settings::RemoteStatusBridgeSettings,
    pub desktop: crate::settings::DesktopBehaviorSettings,
    #[serde(rename = "gap")]
    pub timeline_merge_gap_secs: i64,
    #[serde(rename = "idle")]
    pub idle_timeout_secs: i64,
    #[serde(rename = "minimum")]
    pub min_session_secs: i64,
    #[serde(rename = "refresh")]
    pub refresh_interval_secs: i64,
    pub paused: bool,
    pub titles: bool,
    pub locale: crate::localization::Locale,
    pub theme: Theme,
    pub schemes: [String; 2],
}
impl AppPreferences {
    pub fn remote_endpoint_valid(&self) -> bool {
        url::Url::parse(&self.remote.url).is_ok_and(|u| {
            matches!(u.scheme(), "ws" | "wss") && u.host().is_some() && u.fragment().is_none()
        })
    }
    pub fn valid(&self) -> bool {
        self.web.port >= crate::settings::WEB_ACTIVITY_PORT_MIN
            && (!self.web.enabled || !self.web.token.trim().is_empty())
            && (!self.remote.enabled
                || (!self.remote.token.trim().is_empty() && self.remote_endpoint_valid()))
            && (60..=300).contains(&self.timeline_merge_gap_secs)
            && self.timeline_merge_gap_secs % 60 == 0
            && (300..=1800).contains(&self.idle_timeout_secs)
            && self.idle_timeout_secs % 60 == 0
            && (0..=600).contains(&self.min_session_secs)
            && self.min_session_secs % 60 == 0
            && (1..=3).contains(&self.refresh_interval_secs)
    }
}

#[cfg(test)]
mod tests {
    use super::AppPreferences;
    use serde_json::json;

    #[test]
    fn app_preferences_preserve_the_desktop_wire_keys_and_second_values() {
        let payload = json!({
            "web":{"enabled":false,"port":12345,"token":""},
            "remote":{"enabled":false,"url":"","token":"","machine_id":""},
            "desktop":{"show_tray_icon":true,"close_behavior":"tray",
                "launch_at_login":false,"start_minimized":true},
            "gap":180,"idle":900,"minimum":300,"refresh":2,"paused":false,
            "titles":true,"locale":"EnUs","theme":"Dark","schemes":["light","dark"]
        });
        let preferences: AppPreferences = serde_json::from_value(payload.clone()).unwrap();
        assert_eq!(preferences.timeline_merge_gap_secs, 180);
        assert_eq!(preferences.idle_timeout_secs, 900);
        assert_eq!(preferences.min_session_secs, 300);
        assert_eq!(preferences.refresh_interval_secs, 2);
        assert_eq!(serde_json::to_value(preferences).unwrap(), payload);
    }
}
