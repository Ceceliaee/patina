use crate::data::repositories::{
    app_settings::{commit_app_setting_mutations_in_tx, AppSettingMutation},
    classification_settings::{
        apply_classification_setting_mutations_in_tx, load_classification_snapshot_in_tx,
        ClassificationSettingMutation,
    },
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::BTreeMap;
#[path = "manage/draft.rs"]
mod draft;
#[path = "manage/web.rs"]
mod web;
pub use draft::{WebDraft, WebRule};
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AppRule {
    pub exe: String,
    pub name: String,
    pub category: String,
    pub color: String,
    pub track: bool,
    pub titles: bool,
    pub original: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct AppLinkEdit {
    pub member: String,
    pub parent: Option<String>,
    pub original: Option<String>,
}
#[derive(Serialize, Deserialize)]
pub struct Rules {
    pub web_enabled: bool,
    pub web_mode: bool,
    pub websites: WebDraft,
    pub titles_enabled: bool,
    pub category_default_colors: BTreeMap<String, String>,
    pub category_color_overrides: BTreeMap<String, String>,
    pub apps: Vec<AppRule>,
    pub app_links: BTreeMap<String, String>,
    pub categories: Vec<(String, String)>,
    pub category_colors: BTreeMap<String, String>,
}
pub(super) async fn rules(pool: SqlitePool) -> Result<Rules, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let map = load_classification_snapshot_in_tx(&mut tx).await?;
    let websites = web::read(&mut tx).await?;
    let titles_enabled: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key='title_recording_enabled'")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    let titles_enabled = titles_enabled
        .as_deref()
        .is_none_or(|v| crate::domain::settings::parse_boolean_setting(v, true));
    let web_enabled: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key='web_activity_enabled'")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    let web_enabled = web_enabled
        .as_deref()
        .is_some_and(|v| crate::domain::settings::parse_boolean_setting(v, false));
    let web_mode: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key='classification_object_mode'")
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    let web_mode = web_mode.as_deref() == Some("web");
    let identities:Vec<(String,String)>=sqlx::query_as("SELECT exe_name,MAX(app_name) FROM (SELECT exe_name,app_name FROM sessions UNION ALL SELECT exe_name,app_name FROM import_exact_sessions UNION ALL SELECT exe_name,app_name FROM import_time_buckets UNION ALL SELECT substr(key,17),'' FROM settings WHERE key GLOB '__app_override::*') GROUP BY exe_name ORDER BY exe_name").fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    let overrides: BTreeMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT substr(key,17),value FROM settings WHERE key GLOB '__app_override::*'",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .collect();
    let app_links: BTreeMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT substr(key,13),value FROM settings WHERE key GLOB '__app_link::*'",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .collect();
    tx.commit().await.map_err(|e| e.to_string())?;
    let mut names_by_exe = BTreeMap::<String, String>::new();
    for (exe, name) in identities {
        let exe = crate::domain::classification::canonical_exe(&exe);
        if exe.is_empty() || exe == "activity:anonymous" {
            continue;
        }
        let fallback = names_by_exe.entry(exe).or_default();
        if name > *fallback {
            *fallback = name;
        }
    }
    for identity in app_links.keys().chain(app_links.values()) {
        names_by_exe.entry(identity.clone()).or_default();
    }
    let mut apps = Vec::with_capacity(names_by_exe.len());
    for (exe, fallback) in names_by_exe {
        let original = overrides.get(&exe).cloned();
        let raw: serde_json::Value =
            serde_json::from_str(original.as_deref().unwrap_or("{}")).map_err(|e| e.to_string())?;
        let cat = map.resolve_session_category(&exe);
        let (name, color) = map.app_appearance(&exe);
        apps.push(AppRule {
            name: name
                .unwrap_or(if fallback.is_empty() {
                    exe.trim_end_matches(".exe")
                } else {
                    &fallback
                })
                .to_owned(),
            category: crate::domain::classification::normalize_category_id(
                raw["category"]
                    .as_str()
                    .unwrap_or(if app_links.contains_key(&exe) {
                        "other"
                    } else {
                        &cat.id
                    }),
            )
            .to_owned(),
            color: color.unwrap_or("").into(),
            track: map.is_app_enabled(&exe),
            titles: raw["captureTitle"].as_bool().unwrap_or(true),
            exe,
            original,
        });
    }
    let available = map.available_categories();
    let category_colors = available
        .iter()
        .map(|c| (c.id.clone(), c.color.clone()))
        .collect();
    let category_color_overrides = available
        .iter()
        .filter_map(|c| {
            map.category_color_override(&c.id)
                .map(|color| (c.id.clone(), color.to_owned()))
        })
        .collect();
    let category_default_colors = available
        .iter()
        .map(|c| (c.id.clone(), map.default_category_color(&c.id)))
        .collect();
    let categories = available.into_iter().map(|c| (c.id, c.label)).collect();
    Ok(Rules {
        websites,
        titles_enabled,
        web_enabled,
        web_mode,
        category_color_overrides,
        category_default_colors,
        apps,
        app_links,
        categories,
        category_colors,
    })
}
pub use crate::data::repositories::category_management::CategoryEdit;
pub(super) async fn save_rules(
    pool: &SqlitePool,
    apps: &[AppRule],
    websites: Option<&WebDraft>,
    links: &[AppLinkEdit],
    categories: &[CategoryEdit],
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let map = load_classification_snapshot_in_tx(&mut tx).await?;
    let category_plan = crate::data::repositories::category_management::plan(&map, categories)?;
    let labels = &category_plan.labels;
    let mut mutations = category_plan.mutations.clone();
    mutations.extend(web::changes(&mut tx, websites, labels, categories).await?);
    for link in links {
        mutations.push(ClassificationSettingMutation {
            key: format!("__app_link::{}", link.member),
            value: Some(
                serde_json::json!({"parent":link.parent,"previous":link.original}).to_string(),
            ),
        });
    }
    for a in apps {
        if a.exe.is_empty()
            || a.exe == "activity:anonymous"
            || a.name.trim().encode_utf16().count() > 80
            || !labels.contains_key(&a.category)
        {
            return Err("invalid application change".into());
        }
        if !a.color.is_empty()
            && !(a.color.len() == 7
                && a.color.starts_with('#')
                && a.color[1..].bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err("invalid color".into());
        }
        let key = format!("__app_override::{}", a.exe);
        let old: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
            .bind(&key)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        if old != a.original {
            return Err("application changed since loading".into());
        }
        let mut raw: serde_json::Map<String, serde_json::Value> =
            serde_json::from_str(old.as_deref().unwrap_or("{}")).map_err(|e| e.to_string())?;
        for (field, v) in [
            ("displayName", a.name.trim()),
            ("category", &a.category),
            ("color", &a.color),
        ] {
            if v.is_empty() {
                raw.remove(field);
            } else {
                raw.insert(field.into(), v.into());
            }
        }
        for (field, value) in [("track", a.track), ("captureTitle", a.titles)] {
            if value {
                raw.remove(field);
            } else {
                raw.insert(field.into(), false.into());
            }
        }
        raw.insert(
            "updatedAt".into(),
            crate::platform::clock::unix_timestamp_millis_i64().into(),
        );
        mutations.push(ClassificationSettingMutation {
            key,
            value: Some(serde_json::Value::Object(raw).to_string()),
        });
    }
    category_plan
        .rewrite_assignments(&mut tx, &mut mutations)
        .await?;
    apply_classification_setting_mutations_in_tx(&mut tx, &mutations)
        .await
        .map_err(|e| e.to_string())?;
    let now = crate::platform::clock::unix_timestamp_millis_i64();
    for rule in apps {
        if !rule.track {
            crate::data::repositories::sessions::end_active_session_for_exe_tx(
                &mut tx, &rule.exe, now,
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        if !rule.titles {
            crate::data::repositories::sessions::disable_active_title_for_exe_tx(
                &mut tx, &rule.exe, now,
            )
            .await
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}

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
    pub web: crate::WebActivityBridgeSettings,
    pub remote: crate::RemoteStatusBridgeSettings,
    pub desktop: crate::DesktopBehaviorSettings,
    pub gap: i64,
    pub idle: i64,
    pub minimum: i64,
    pub refresh: i64,
    pub paused: bool,
    pub titles: bool,
    pub locale: crate::Locale,
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
        self.web.port >= crate::domain::settings::WEB_ACTIVITY_PORT_MIN
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
pub(super) async fn preferences(pool: SqlitePool) -> Result<TrackingPreferences, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let p = preferences_in_tx(&mut tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(p)
}
async fn preferences_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<TrackingPreferences, String> {
    let values: BTreeMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT key,value FROM settings WHERE key IN (
         'timeline_merge_gap_secs','idle_timeout_secs','min_session_secs','refresh_interval_secs',
         'tracking_paused','title_recording_enabled','language','theme_mode','color_scheme_light','color_scheme_dark',
         'show_tray_icon','close_behavior','launch_at_login','start_minimized','web_activity_enabled','web_activity_port','web_activity_token',
         'remote_status_bridge_enabled','remote_status_bridge_url','remote_status_bridge_token','remote_status_bridge_machine_id')",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| e.to_string())?
    .into_iter()
    .collect();
    let value = |key: &str| values.get(key).map(String::as_str);
    let mut desktop = crate::DesktopBehaviorSettings::from_storage_values(
        value("close_behavior"),
        // The experimental host only registers for login after an explicit opt-in.
        value("launch_at_login").or(Some("0")),
        value("start_minimized"),
    );
    desktop.show_tray_icon = value("show_tray_icon")
        .is_none_or(|v| crate::domain::settings::parse_boolean_setting(v, true));
    let n = |k: &str, d| values.get(k).and_then(|s| s.parse().ok()).unwrap_or(d);
    Ok(TrackingPreferences {
        web: crate::WebActivityBridgeSettings::from_storage_values(
            value("web_activity_port"),
            value("web_activity_enabled"),
            value("web_activity_token"),
        ),
        remote: crate::RemoteStatusBridgeSettings::from_storage_values(
            value("remote_status_bridge_enabled"),
            value("remote_status_bridge_url"),
            value("remote_status_bridge_token"),
            value("remote_status_bridge_machine_id"),
        ),
        desktop,
        locale: crate::Locale::from_tag(values.get("language").map(String::as_str)),
        theme: Theme::read(values.get("theme_mode").map_or("light", String::as_str)),
        schemes: ["color_scheme_light", "color_scheme_dark"]
            .map(|key| value(key).unwrap_or("default").trim().to_ascii_lowercase()),
        gap: ((n("timeline_merge_gap_secs", 180).clamp(60, 300) + 30) / 60) * 60,
        idle: ((n("idle_timeout_secs", 900).clamp(300, 1800) + 30) / 60) * 60,
        minimum: ((n("min_session_secs", 300).clamp(0, 600) + 30) / 60) * 60,
        refresh: match n("refresh_interval_secs", 2) {
            v @ (1 | 3) => v,
            _ => 2,
        },
        paused: values
            .get("tracking_paused")
            .is_some_and(|s| crate::domain::settings::parse_boolean_setting(s, false)),
        titles: values
            .get("title_recording_enabled")
            .is_none_or(|s| crate::domain::settings::parse_boolean_setting(s, true)),
    })
}
pub(super) async fn save_preferences(
    pool: SqlitePool,
    old: &TrackingPreferences,
    p: &TrackingPreferences,
) -> Result<(), String> {
    if !p.valid() {
        return Err("invalid settings".into());
    }
    let fields = |p: &TrackingPreferences| {
        [
            ("timeline_merge_gap_secs", p.gap),
            ("idle_timeout_secs", p.idle),
            ("min_session_secs", p.minimum),
            ("refresh_interval_secs", p.refresh),
            ("tracking_paused", i64::from(p.paused)),
            ("title_recording_enabled", i64::from(p.titles)),
            ("web_activity_enabled", i64::from(p.web.enabled)),
            ("web_activity_port", i64::from(p.web.port)),
            ("remote_status_bridge_enabled", i64::from(p.remote.enabled)),
            ("show_tray_icon", i64::from(p.desktop.show_tray_icon)),
            ("launch_at_login", i64::from(p.desktop.launch_at_login)),
            ("start_minimized", i64::from(p.desktop.start_minimized)),
        ]
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let actual = preferences_in_tx(&mut tx).await?;
    let mut changes = Vec::new();
    for (((key, value), (_, was)), (_, current)) in
        fields(p).into_iter().zip(fields(old)).zip(fields(&actual))
    {
        if value == was {
            continue;
        }
        if current != was {
            return Err("setting changed since loading".into());
        }
        changes.push(AppSettingMutation {
            key: key.into(),
            value: value.to_string(),
        });
    }
    let close = |p: &TrackingPreferences| match p.desktop.close_behavior {
        crate::CloseBehavior::Tray => "tray",
        crate::CloseBehavior::Exit => "exit",
    };
    for (key, from, to, current) in [
        (
            "web_activity_token",
            old.web.token.as_str(),
            p.web.token.as_str(),
            actual.web.token.as_str(),
        ),
        (
            "remote_status_bridge_url",
            old.remote.url.as_str(),
            p.remote.url.as_str(),
            actual.remote.url.as_str(),
        ),
        (
            "remote_status_bridge_token",
            old.remote.token.as_str(),
            p.remote.token.as_str(),
            actual.remote.token.as_str(),
        ),
        ("close_behavior", close(old), close(p), close(&actual)),
        (
            "color_scheme_light",
            old.schemes[0].as_str(),
            p.schemes[0].as_str(),
            actual.schemes[0].as_str(),
        ),
        (
            "color_scheme_dark",
            old.schemes[1].as_str(),
            p.schemes[1].as_str(),
            actual.schemes[1].as_str(),
        ),
        (
            "language",
            old.locale.tag(),
            p.locale.tag(),
            actual.locale.tag(),
        ),
        (
            "theme_mode",
            old.theme.tag(),
            p.theme.tag(),
            actual.theme.tag(),
        ),
    ] {
        if from != to {
            if current != from {
                return Err("setting changed since loading".into());
            }
            changes.push(AppSettingMutation {
                key: key.into(),
                value: to.into(),
            });
        }
    }
    commit_app_setting_mutations_in_tx(&mut tx, &changes, true)
        .await
        .map_err(|e| e.to_string())?;
    let now = crate::platform::clock::unix_timestamp_millis_i64();
    if old.titles != p.titles || old.web != p.web {
        if old.titles != p.titles && !p.titles {
            crate::data::repositories::sessions::disable_active_title_tx(&mut tx, now)
                .await
                .map_err(|e| e.to_string())?;
        }
        crate::data::repositories::web_activity::end_active_segment_tx(&mut tx, now)
            .await
            .map_err(|e| e.to_string())?;
    }
    if old.web != p.web {
        crate::data::repositories::anonymous_activity::seal_web_tx(&mut tx, now)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}
