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
#[derive(Serialize, Deserialize)]
pub struct Rules {
    pub apps: Vec<AppRule>,
    pub categories: Vec<(String, String)>,
}
pub(super) async fn rules(pool: SqlitePool) -> Result<Rules, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let map = load_classification_snapshot_in_tx(&mut tx).await?;
    let identities:Vec<(String,String)>=sqlx::query_as("SELECT exe_name,MAX(app_name) FROM (SELECT exe_name,app_name FROM sessions UNION ALL SELECT exe_name,app_name FROM import_exact_sessions UNION ALL SELECT exe_name,app_name FROM import_time_buckets UNION ALL SELECT substr(key,17),'' FROM settings WHERE key GLOB '__app_override::*') GROUP BY exe_name ORDER BY exe_name").fetch_all(&mut *tx).await.map_err(|e|e.to_string())?;
    let overrides: BTreeMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT substr(key,17),value FROM settings WHERE key GLOB '__app_override::*'",
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
            category: raw["category"].as_str().unwrap_or(&cat.id).to_owned(),
            color: color.unwrap_or("").into(),
            track: map.is_app_enabled(&exe),
            titles: raw["captureTitle"].as_bool().unwrap_or(true),
            exe,
            original,
        });
    }
    let categories = map
        .available_categories()
        .into_iter()
        .map(|c| (c.id, c.label))
        .collect();
    Ok(Rules { apps, categories })
}
#[derive(Clone, Serialize, Deserialize)]
pub struct CategoryEdit {
    pub id: String,
    pub previous: Option<String>,
    pub label: String,
}
pub(super) async fn save_rules(
    pool: &SqlitePool,
    apps: &[AppRule],
    categories: &[CategoryEdit],
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let map = load_classification_snapshot_in_tx(&mut tx).await?;
    let mut mutations = Vec::new();
    let mut labels = map
        .available_categories()
        .into_iter()
        .map(|c| (c.id, c.label))
        .collect::<BTreeMap<_, _>>();
    for change in categories {
        let name = change.label.trim();
        if name.is_empty()
            || name.encode_utf16().count() > 80
            || change.id == "other"
            || change.id == "system"
            || change.id == "anonymous"
            || labels.get(&change.id) != change.previous.as_ref()
        {
            return Err("category changed or invalid".into());
        }
        if labels
            .iter()
            .any(|(id, label)| id != &change.id && label.to_lowercase() == name.to_lowercase())
        {
            return Err("duplicate category name".into());
        }
        if change.previous.is_none() {
            if !change.id.starts_with("custom:category_") {
                return Err("invalid new category".into());
            }
            mutations.push(ClassificationSettingMutation {
                key: format!("__custom_category::{}", change.id),
                value: Some(crate::platform::clock::unix_timestamp_millis_i64().to_string()),
            });
        }
        mutations.push(ClassificationSettingMutation {
            key: format!("__category_label_override::{}", change.id),
            value: Some(name.to_owned()),
        });
        labels.insert(change.id.clone(), name.into());
    }
    for a in apps {
        if a.exe.is_empty()
            || a.exe == "activity:anonymous"
            || map.app_owner(&a.exe) != a.exe
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
            (
                "category",
                if a.category == "other" {
                    ""
                } else {
                    &a.category
                },
            ),
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
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct TrackingPreferences {
    pub gap: i64,
    pub idle: i64,
    pub minimum: i64,
    pub refresh: i64,
    pub paused: bool,
    pub titles: bool,
    pub locale: crate::Locale,
    pub theme: Theme,
}
impl TrackingPreferences {
    pub fn valid(&self) -> bool {
        (60..=300).contains(&self.gap)
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
    let values:BTreeMap<String,String>=sqlx::query_as::<_,(String,String)>("SELECT key,value FROM settings WHERE key IN ('timeline_merge_gap_secs','idle_timeout_secs','min_session_secs','refresh_interval_secs','tracking_paused','title_recording_enabled','language','theme_mode')").fetch_all(&mut **tx).await.map_err(|e|e.to_string())?.into_iter().collect();
    let n = |k: &str, d| values.get(k).and_then(|s| s.parse().ok()).unwrap_or(d);
    Ok(TrackingPreferences {
        locale: crate::Locale::from_tag(values.get("language").map(String::as_str)),
        theme: Theme::read(values.get("theme_mode").map_or("light", String::as_str)),
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
    old: TrackingPreferences,
    p: TrackingPreferences,
) -> Result<(), String> {
    if !p.valid() {
        return Err("invalid time preference".into());
    }
    let fields = |p: TrackingPreferences| {
        [
            ("timeline_merge_gap_secs", p.gap),
            ("idle_timeout_secs", p.idle),
            ("min_session_secs", p.minimum),
            ("refresh_interval_secs", p.refresh),
            ("tracking_paused", i64::from(p.paused)),
            ("title_recording_enabled", i64::from(p.titles)),
        ]
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let actual = preferences_in_tx(&mut tx).await?;
    let mut changes = Vec::new();
    for (((key, value), (_, was)), (_, current)) in
        fields(p).into_iter().zip(fields(old)).zip(fields(actual))
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
    for (key, from, to, current) in [
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
    if old.titles != p.titles {
        if !p.titles {
            crate::data::repositories::sessions::disable_active_title_tx(&mut tx, now)
                .await
                .map_err(|e| e.to_string())?;
        }
        crate::data::repositories::web_activity::end_active_segment_tx(&mut tx, now)
            .await
            .map_err(|e| e.to_string())?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}
