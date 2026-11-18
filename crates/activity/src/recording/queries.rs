use super::{analysis, history, recent, today};
use crate::{platform::clock::unix_timestamp_millis_i64, Locale};
use sqlx::SqlitePool;

pub struct ActivityQueries {
    pool: SqlitePool,
}

impl ActivityQueries {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn load_today_summary(&self, locale: Locale) -> Result<crate::DaySummary, String> {
        self.load_day_summary_at(unix_timestamp_millis_i64(), locale)
            .await
    }

    pub async fn load_day_summary_at(
        &self,
        as_of_ms: i64,
        locale: Locale,
    ) -> Result<crate::DaySummary, String> {
        today::load_day_summary_at(self.pool.clone(), as_of_ms, locale).await
    }

    pub async fn icons(&self, keys: Vec<String>) -> Result<Vec<(String, Vec<u8>)>, String> {
        today::icons(self.pool.clone(), keys).await
    }

    pub async fn trends(
        &self,
        range: Option<(i64, i64)>,
        kind: crate::SeriesKind,
        locale: Locale,
    ) -> Result<crate::Trends, String> {
        analysis::load(self.pool.clone(), range, kind, locale).await
    }

    pub async fn history_source(
        &self,
        day: i64,
        app: Option<String>,
        titles: bool,
        web: bool,
        locale: Locale,
        last_successful_sample_ms: Option<i64>,
    ) -> Result<crate::HistoryDay, String> {
        history::load(
            self.pool.clone(),
            day,
            app,
            titles,
            last_successful_sample_ms,
            locale,
            web,
        )
        .await
    }

    pub async fn recent(
        &self,
        locale: Locale,
        last_successful_sample_ms: Option<i64>,
    ) -> Result<crate::Recent, String> {
        recent::load(
            self.pool.clone(),
            unix_timestamp_millis_i64(),
            last_successful_sample_ms,
            locale,
        )
        .await
    }
}
