use super::{mini_window, sessions::read, web_links};
use crate::data::activity_read_model::{self, ActivityAggregateRangeDto};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, QueryBuilder, Sqlite};
use std::collections::{BTreeMap, BTreeSet};

#[cfg(test)]
mod tests;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MiniActivityKind {
    Today,
    Activity,
}

#[derive(Debug, Serialize)]
pub struct MiniActivitySnapshot {
    pub kind: MiniActivityKind,
    pub sampled_at_ms: i64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub bootstrap: mini_window::MiniBootstrapSnapshot,
    pub aggregate: Option<ActivityAggregateRangeDto>,
    pub sessions: Vec<read::HistorySessionRow>,
    pub web: Option<web_links::WebLinksSnapshot>,
    pub icons: BTreeMap<String, String>,
}

pub async fn load(
    pool: &Pool<Sqlite>,
    kind: MiniActivityKind,
    now: i64,
    day: (i64, i64),
) -> Result<MiniActivitySnapshot, String> {
    if now < 0 || day.0 > now || day.1 <= now {
        return Err("Invalid Mini snapshot clock".into());
    }
    let (start, end) = match kind {
        MiniActivityKind::Today => day,
        MiniActivityKind::Activity => (now.saturating_sub(3_600_000).max(0), now),
    };
    let mut tx = pool.begin().await.map_err(|error| error.to_string())?;
    // This first read pins the SQLite snapshot for metadata and every activity source.
    let bootstrap = mini_window::load_mini_bootstrap_in_tx(&mut tx)
        .await
        .map_err(|error| error.to_string())?;
    let mut aggregate = None;
    let mut sessions = Vec::new();
    let mut web = None;
    let mut icons = BTreeMap::new();
    match kind {
        MiniActivityKind::Today => {
            aggregate =
                Some(activity_read_model::load_range_in_tx(&mut tx, start, now, &[], now).await?);
        }
        MiniActivityKind::Activity
            if bootstrap.settings.web_activity_available
                && bootstrap.settings.history_timeline_mode.as_deref() == Some("web") =>
        {
            web = Some(web_links::recent_snapshot_in_tx(&mut tx, start, end, now).await?);
        }
        MiniActivityKind::Activity => {
            sessions = read::load_history_range_in_tx(&mut tx, start, end, now, false)
                .await
                .map_err(|error| error.to_string())?
                .sessions;
            let keys: BTreeSet<String> = sessions
                .iter()
                .filter(|row| row.exe_name != "activity:anonymous")
                .flat_map(|row| {
                    [
                        row.exe_name.clone(),
                        crate::domain::activity_read_model::normalize_app_key(&row.exe_name)
                            .unwrap_or_else(|| row.exe_name.clone()),
                    ]
                })
                .chain(bootstrap.app_links.iter().map(|row| row.value.clone()))
                .collect();
            for batch in keys.into_iter().collect::<Vec<_>>().chunks(900) {
                let mut query = QueryBuilder::<Sqlite>::new(
                    "SELECT exe_name,icon_base64 FROM icon_cache WHERE exe_name IN (",
                );
                let mut values = query.separated(",");
                for key in batch {
                    values.push_bind(key);
                }
                query.push(")");
                let rows: Vec<(String, String)> = query
                    .build_query_as()
                    .fetch_all(&mut *tx)
                    .await
                    .map_err(|error| error.to_string())?;
                icons.extend(rows);
            }
        }
    }
    tx.commit().await.map_err(|error| error.to_string())?;
    Ok(MiniActivitySnapshot {
        kind,
        sampled_at_ms: now,
        start_ms: start,
        end_ms: end,
        bootstrap,
        aggregate,
        sessions,
        web,
        icons,
    })
}
