use crate::data::repositories::app_settings::{
    commit_app_setting_mutations, commit_app_setting_mutations_in_tx, AppSettingMutation,
};
use patina_activity_model::views::mini::MiniPreferences;
use patina_activity_model::views::preferences::{MainNavigation, MainSection};
use sqlx::SqlitePool;
use std::collections::BTreeMap;

pub use patina_activity_model::views::preferences::{AppPreferences, Theme};

pub async fn load_preferences(pool: SqlitePool) -> Result<AppPreferences, String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let preferences = load_preferences_in_tx(&mut tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(preferences)
}
async fn load_preferences_in_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
) -> Result<AppPreferences, String> {
    let values: BTreeMap<String, String> = sqlx::query_as::<_, (String, String)>(
        "SELECT key,value FROM settings WHERE key IN (
         'timeline_merge_gap_secs','idle_timeout_secs','min_session_secs','refresh_interval_secs',
         'tracking_paused','title_recording_enabled','language','theme_mode','window_scale','color_scheme_light','color_scheme_dark',
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
        // Registering for login requires explicit opt-in.
        value("launch_at_login").or(Some("0")),
        value("start_minimized"),
    );
    desktop.show_tray_icon = value("show_tray_icon")
        .is_none_or(|v| crate::domain::settings::parse_boolean_setting(v, true));
    let integer_setting = |key: &str, default| {
        value(key)
            .and_then(|text| text.parse().ok())
            .unwrap_or(default)
    };
    Ok(AppPreferences {
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
        window_scale: value("window_scale")
            .and_then(|s| s.parse().ok())
            .filter(|v| (AppPreferences::MIN_SCALE..=AppPreferences::MAX_SCALE).contains(v))
            .unwrap_or_else(AppPreferences::default_scale),
        schemes: ["color_scheme_light", "color_scheme_dark"]
            .map(|key| value(key).unwrap_or("default").trim().to_ascii_lowercase()),
        timeline_merge_gap_secs: ((integer_setting("timeline_merge_gap_secs", 180).clamp(60, 300)
            + 30)
            / 60)
            * 60,
        idle_timeout_secs: ((integer_setting("idle_timeout_secs", 900).clamp(300, 1800) + 30) / 60)
            * 60,
        min_session_secs: ((integer_setting("min_session_secs", 300).clamp(0, 600) + 30) / 60) * 60,
        refresh_interval_secs: match integer_setting("refresh_interval_secs", 2) {
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
    original: &AppPreferences,
    edited: &AppPreferences,
) -> Result<AppPreferences, crate::ActivityError> {
    if !edited.valid() {
        return Err("invalid settings".into());
    }
    let integer_fields = |preferences: &AppPreferences| {
        [
            (
                "timeline_merge_gap_secs",
                preferences.timeline_merge_gap_secs,
            ),
            ("idle_timeout_secs", preferences.idle_timeout_secs),
            ("min_session_secs", preferences.min_session_secs),
            ("refresh_interval_secs", preferences.refresh_interval_secs),
            ("window_scale", i64::from(preferences.window_scale)),
            ("tracking_paused", i64::from(preferences.paused)),
            ("title_recording_enabled", i64::from(preferences.titles)),
            ("web_activity_enabled", i64::from(preferences.web.enabled)),
            ("web_activity_port", i64::from(preferences.web.port)),
            (
                "remote_status_bridge_enabled",
                i64::from(preferences.remote.enabled),
            ),
            (
                "show_tray_icon",
                i64::from(preferences.desktop.show_tray_icon),
            ),
            (
                "launch_at_login",
                i64::from(preferences.desktop.launch_at_login),
            ),
            (
                "start_minimized",
                i64::from(preferences.desktop.start_minimized),
            ),
        ]
    };
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let stored = load_preferences_in_tx(&mut tx).await?;
    let mut changes = Vec::new();
    for (((key, value), (_, was)), (_, current)) in integer_fields(edited)
        .into_iter()
        .zip(integer_fields(original))
        .zip(integer_fields(&stored))
    {
        if value == was {
            continue;
        }
        if current != was {
            return Err(crate::ActivityError::Conflict(
                "setting changed since loading".into(),
            ));
        }
        changes.push(AppSettingMutation {
            key: key.into(),
            value: value.to_string(),
        });
    }
    let close_behavior_tag = |preferences: &AppPreferences| match preferences.desktop.close_behavior
    {
        crate::CloseBehavior::Tray => "tray",
        crate::CloseBehavior::Exit => "exit",
    };
    for (key, from, to, current) in [
        (
            "web_activity_token",
            original.web.token.as_str(),
            edited.web.token.as_str(),
            stored.web.token.as_str(),
        ),
        (
            "remote_status_bridge_url",
            original.remote.url.as_str(),
            edited.remote.url.as_str(),
            stored.remote.url.as_str(),
        ),
        (
            "remote_status_bridge_token",
            original.remote.token.as_str(),
            edited.remote.token.as_str(),
            stored.remote.token.as_str(),
        ),
        (
            "close_behavior",
            close_behavior_tag(original),
            close_behavior_tag(edited),
            close_behavior_tag(&stored),
        ),
        (
            "color_scheme_light",
            original.schemes[0].as_str(),
            edited.schemes[0].as_str(),
            stored.schemes[0].as_str(),
        ),
        (
            "color_scheme_dark",
            original.schemes[1].as_str(),
            edited.schemes[1].as_str(),
            stored.schemes[1].as_str(),
        ),
        (
            "language",
            original.locale.tag(),
            edited.locale.tag(),
            stored.locale.tag(),
        ),
        (
            "theme_mode",
            original.theme.tag(),
            edited.theme.tag(),
            stored.theme.tag(),
        ),
    ] {
        if from != to {
            if current != from {
                return Err(crate::ActivityError::Conflict(
                    "setting changed since loading".into(),
                ));
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
    if original.titles != edited.titles || original.web != edited.web {
        if original.titles != edited.titles && !edited.titles {
            crate::data::repositories::sessions::disable_active_title_tx(&mut tx, now)
                .await
                .map_err(|e| e.to_string())?;
        }
        crate::data::repositories::web_activity::end_active_segment_tx(&mut tx, now)
            .await
            .map_err(|e| e.to_string())?;
    }
    if original.web != edited.web {
        crate::data::repositories::anonymous_activity::seal_web_tx(&mut tx, now)
            .await
            .map_err(|e| e.to_string())?;
    }
    let committed = load_preferences_in_tx(&mut tx).await?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(committed)
}

use super::{
    desktop::{RecordingSignals, TrackingHost},
    services::ActivityBridges,
};
use std::{cell::Cell, rc::Rc, sync::Arc};

struct LivePreferences {
    signals: RecordingSignals,
    bridges: Arc<ActivityBridges>,
}

pub struct Preferences {
    pool: SqlitePool,
    locale: Rc<Cell<crate::Locale>>,
    live: Option<LivePreferences>,
}

async fn write_main_navigation(
    conn: &mut sqlx::SqliteConnection,
    navigation: MainNavigation,
) -> Result<(), String> {
    sqlx::query(
        "INSERT INTO settings(key,value) VALUES('__ui_main_section',?),('__ui_data_detailed',?),
            ('__ui_data_kind',?),('__ui_sidebar_labels',?),('hourly_activity_chart_mode',?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value",
    )
    .bind(serde_json::to_string(&navigation.section).map_err(|e| e.to_string())?)
    .bind(if navigation.data_detailed { "1" } else { "0" })
    .bind(serde_json::to_string(&navigation.data_kind).map_err(|e| e.to_string())?)
    .bind(if navigation.sidebar_labels { "1" } else { "0" })
    .bind(if navigation.hourly_by_category {
        "category"
    } else {
        "total"
    })
    .execute(conn)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

impl Preferences {
    pub fn new(pool: SqlitePool, locale: crate::Locale) -> Self {
        Self {
            pool,
            locale: Rc::new(Cell::new(locale)),
            live: None,
        }
    }
    pub fn with_recording(
        pool: SqlitePool,
        locale: Rc<Cell<crate::Locale>>,
        signals: RecordingSignals,
        bridges: Arc<ActivityBridges>,
    ) -> Self {
        Self {
            pool,
            locale,
            live: Some(LivePreferences { signals, bridges }),
        }
    }
    pub fn locale(&self) -> crate::Locale {
        self.locale.get()
    }
    pub async fn mini(&self) -> Result<MiniPreferences, String> {
        let raw: Option<String> =
            sqlx::query_scalar("SELECT value FROM settings WHERE key='mini_window_preferences'")
                .fetch_optional(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
        Ok(raw
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default())
    }

    pub async fn save_mini(&self, prefs: &MiniPreferences) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO settings(key,value) VALUES('mini_window_preferences',?)
             ON CONFLICT(key) DO UPDATE SET value=json_set(
                CASE WHEN json_valid(value) THEN
                    CASE WHEN json_type(value)='object' THEN value ELSE '{}' END
                    ELSE '{}' END,
                '$.placement',json_extract(excluded.value,'$.placement'),
                '$.held',json(excluded.value -> '$.held'))",
        )
        .bind(serde_json::to_string(prefs).map_err(|e| e.to_string())?)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }
    pub async fn preferences(&self) -> Result<AppPreferences, crate::ActivityError> {
        Ok(load_preferences(self.pool.clone()).await?)
    }
    pub async fn main_navigation(&self) -> Result<MainNavigation, String> {
        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
        let handoff: Option<String> = sqlx::query_scalar(
            "DELETE FROM settings WHERE key='__update_resume_page' RETURNING value",
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let history: Option<String> =
            sqlx::query_scalar("SELECT value FROM settings WHERE key='__ui_history_modes'")
                .fetch_optional(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        if let Some([distribution @ 0..=2, timeline @ 0..=2, grouped @ 0..=1]) =
            history.and_then(|v| serde_json::from_str::<[u8; 3]>(&v).ok())
        {
            sqlx::query(
                "INSERT INTO settings(key,value) VALUES('hourly_activity_chart_mode',?),('__ui_history_modes',?)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE excluded.key='__ui_history_modes'",
            )
            .bind(if grouped == 1 { "category" } else { "total" })
            .bind(serde_json::to_string(&[distribution, timeline]).map_err(|e| e.to_string())?)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
        }
        let (saved, data_detailed, data_kind, sidebar_labels, hourly_by_category): (
            Option<String>,
            bool,
            Option<String>,
            bool,
            bool,
        ) = sqlx::query_as(
            "SELECT (SELECT value FROM settings WHERE key='__ui_main_section'),
                    EXISTS(SELECT 1 FROM settings WHERE key='__ui_data_detailed' AND value='1'),
                    (SELECT value FROM settings WHERE key='__ui_data_kind'),
                    EXISTS(SELECT 1 FROM settings WHERE key='__ui_sidebar_labels' AND value='1'),
                    EXISTS(SELECT 1 FROM settings WHERE key='hourly_activity_chart_mode' AND value='category')",
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        let mut navigation = MainNavigation {
            section: saved
                .and_then(|page| serde_json::from_str(&page).ok())
                .unwrap_or_default(),
            data_detailed,
            data_kind: data_kind
                .and_then(|v| serde_json::from_str(&v).ok())
                .unwrap_or_default(),
            sidebar_labels,
            hourly_by_category,
        };
        if let Some(section) = handoff.and_then(|page| {
            serde_json::from_value::<MainSection>(serde_json::Value::String(page)).ok()
        }) {
            navigation.section = section;
            write_main_navigation(&mut tx, navigation).await?;
        }
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(navigation)
    }

    pub async fn save_main_navigation(&self, navigation: MainNavigation) -> Result<(), String> {
        let mut conn = self.pool.acquire().await.map_err(|e| e.to_string())?;
        write_main_navigation(&mut conn, navigation).await
    }

    pub async fn save_window_scale(&self, percent: u16) -> Result<(), String> {
        if !(AppPreferences::MIN_SCALE..=AppPreferences::MAX_SCALE).contains(&percent) {
            return Err("invalid main window scale".into());
        }
        commit_app_setting_mutations(
            &self.pool,
            &[AppSettingMutation {
                key: "window_scale".into(),
                value: percent.to_string(),
            }],
        )
        .await
        .map_err(|e| e.to_string())
    }
    pub async fn save_preferences(
        &self,
        old: AppPreferences,
        next: AppPreferences,
    ) -> Result<(), crate::ActivityError> {
        let _guard = match &self.live {
            Some(live) => Some(live.signals.projection().transition.lock().await),
            None => None,
        };
        let committed = save_preferences(self.pool.clone(), &old, &next).await?;
        if let Some(live) = &self.live {
            let host = &live.signals;
            if old.web != next.web || old.paused != next.paused {
                host.titles().clear_browser_title();
                host.titles().clear_anonymous_web();
            }
            if old.paused != next.paused {
                host.pause().set_after_write(
                    next.paused,
                    crate::platform::clock::unix_timestamp_millis_i64(),
                );
            }
            if old.titles != next.titles {
                host.titles().set_enabled(next.titles);
            }
            if old.web != next.web || old.remote != next.remote {
                live.bridges.apply(&committed);
            }
            host.projection().note_tracking_policy_change();
            host.notify();
        }
        if old.locale != next.locale {
            self.locale.set(committed.locale);
        }
        Ok(())
    }
    pub async fn detail_zoom(&self, hours: Option<f32>) -> Result<f32, String> {
        self.zoom_preference("__ui_detail_zoom_hours", 24., hours)
            .await
    }

    pub async fn history_modes(&self, modes: Option<[u8; 2]>) -> Result<([u8; 2], bool), String> {
        let pool = self.pool.clone();

        if let Some(modes) = modes {
            if modes[0] > 2 || modes[1] > 2 {
                return Err("invalid history modes".into());
            }
            sqlx::query("INSERT INTO settings(key,value) VALUES('__ui_history_modes',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
                    .bind(serde_json::to_string(&modes).map_err(|e| e.to_string())?).execute(&pool).await.map_err(|e| e.to_string())?;
        }
        let modes = sqlx::query_scalar::<_, String>(
            "SELECT value FROM settings WHERE key='__ui_history_modes'",
        )
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?
        .and_then(|v| serde_json::from_str::<[u8; 2]>(&v).ok())
        .filter(|v| v[0] <= 2 && v[1] <= 2)
        .unwrap_or_default();
        let enabled = super::preferences::load_preferences(pool)
            .await?
            .web
            .enabled;
        Ok((modes, enabled))
    }

    pub async fn history_zoom(&self, hours: Option<f32>) -> Result<f32, String> {
        self.zoom_preference("__ui_history_zoom_hours", 4., hours)
            .await
    }

    async fn zoom_preference(
        &self,
        key: &'static str,
        default: f32,
        hours: Option<f32>,
    ) -> Result<f32, String> {
        let pool = self.pool.clone();

        if let Some(hours) = hours {
            if !hours.is_finite() || !(1.0..=24.0).contains(&hours) {
                return Err("invalid detail zoom".to_owned());
            }
            sqlx::query("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
                    .bind(key).bind(hours.to_string()).execute(&pool).await.map_err(|e| e.to_string())?;
            Ok(hours)
        } else {
            Ok(
                sqlx::query_scalar::<_, String>("SELECT value FROM settings WHERE key=?")
                    .bind(key)
                    .fetch_optional(&pool)
                    .await
                    .map_err(|e| e.to_string())?
                    .and_then(|value| value.parse::<f32>().ok())
                    .filter(|value| value.is_finite() && (1.0..=24.0).contains(value))
                    .unwrap_or(default),
            )
        }
    }

    pub async fn set_history_minimum(&self, detail: bool, secs: i64) -> Result<(), String> {
        let pool = self.pool.clone();

        if !(0..=600).contains(&secs) || secs % 60 != 0 {
            return Err("invalid history minimum".into());
        }
        if detail {
            sqlx::query("INSERT INTO settings(key,value) VALUES('__ui_detail_min_secs',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(secs.to_string()).execute(&pool).await.map_err(|e|e.to_string())?;
        } else {
            commit_app_setting_mutations(
                &pool,
                &[AppSettingMutation {
                    key: "min_session_secs".into(),
                    value: secs.to_string(),
                }],
            )
            .await
            .map_err(|e| e.to_string())?;
        }
        Ok(())
    }
}
