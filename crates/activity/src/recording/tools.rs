mod scopes;
mod shortcuts;
use crate::data::repositories::tools as db;
use crate::domain::localization::Locale;
use chrono::{Local, TimeZone};
pub use scopes::TaskKind;
use sqlx::SqlitePool;

#[derive(Clone)]
pub struct NativeToolData {
    pool: SqlitePool,
    scopes: std::sync::Arc<std::sync::Mutex<scopes::Scopes>>,
    runtime: tokio::runtime::Handle,
}

pub struct UsageEvaluation {
    pub watched: Vec<i64>,
    pub next: Option<i64>,
    pub alerts: Vec<(i64, String)>,
}

pub use patina_activity_model::views::shortcuts::{Shortcut, ToolTarget};

pub mod focus;
pub mod reminders;
pub use focus::FocusTasks;
pub use reminders::ReminderTasks;

impl NativeToolData {
    pub fn last_section(&self) -> Result<Option<String>, String> {
        self.runtime
            .block_on(
                sqlx::query_scalar(
                    "SELECT value FROM settings WHERE key = 'tools_selected_section'",
                )
                .fetch_optional(&self.pool),
            )
            .map_err(|e| e.to_string())
    }

    pub fn remember_section(&self, id: &str) -> Result<(), String> {
        self.runtime.block_on(
            sqlx::query("INSERT INTO settings(key,value) VALUES ('tools_selected_section',?)
                         ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value <> excluded.value")
                .bind(id).execute(&self.pool)
        ).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn clear_section(&self) -> Result<(), String> {
        self.runtime
            .block_on(
                sqlx::query("DELETE FROM settings WHERE key='tools_selected_section'")
                    .execute(&self.pool),
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    pub fn preferences(&self) -> Result<crate::NoticePreferences, String> {
        self.runtime
            .block_on(db::notification_preferences::load(&self.pool))
    }
    pub fn save_preferences(
        &self,
        patch: crate::NoticePreferencesPatch,
    ) -> Result<crate::NoticePreferences, String> {
        let sound = patch.sound;
        let saved = self
            .runtime
            .block_on(db::notification_preferences::save(&self.pool, patch))?;
        if let Some(sound) = sound {
            crate::platform::windows::notification_sound::preview(sound);
        }
        Ok(saved)
    }
    pub fn play(sound: crate::NoticeSound) {
        crate::platform::windows::notification_sound::play(sound);
    }

    pub fn shortcuts(
        &self,
        focus: bool,
        reminders: bool,
        locale: &str,
        now: i64,
    ) -> Result<Vec<Shortcut>, String> {
        if !focus && !reminders {
            return Ok(vec![]);
        }
        let snapshot =
            self.runtime
                .block_on(db::fetch_tools_snapshot(&self.pool, now, &date(now)?))?;
        Ok(shortcuts::from_snapshot(
            snapshot,
            focus,
            reminders,
            Locale::from_tag(Some(locale)),
            now,
        ))
    }
    pub fn new(pool: SqlitePool, runtime: tokio::runtime::Handle) -> Self {
        Self {
            pool,
            runtime,
            scopes: Default::default(),
        }
    }

    pub fn focus(&self) -> FocusTasks {
        FocusTasks(self.clone())
    }
    pub fn reminders(&self) -> ReminderTasks {
        ReminderTasks(self.clone())
    }
}

fn date(now: i64) -> Result<String, String> {
    Local
        .timestamp_millis_opt(now)
        .single()
        .map(|t| t.format("%Y-%m-%d").to_string())
        .ok_or_else(|| "Invalid task time".into())
}
