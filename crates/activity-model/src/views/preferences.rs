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
pub struct TrackingPreferences {
    pub web: crate::settings::WebActivityBridgeSettings,
    pub remote: crate::settings::RemoteStatusBridgeSettings,
    pub desktop: crate::settings::DesktopBehaviorSettings,
    pub gap: i64,
    pub idle: i64,
    pub minimum: i64,
    pub refresh: i64,
    pub paused: bool,
    pub titles: bool,
    pub locale: crate::localization::Locale,
    pub theme: Theme,
    pub schemes: [String; 2],
}
impl TrackingPreferences {
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
            && (60..=300).contains(&self.gap)
            && self.gap % 60 == 0
            && (300..=1800).contains(&self.idle)
            && self.idle % 60 == 0
            && (0..=600).contains(&self.minimum)
            && self.minimum % 60 == 0
            && (1..=3).contains(&self.refresh)
    }
}
