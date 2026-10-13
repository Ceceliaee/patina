use serde::Serialize;
use sqlx::{FromRow, Pool, QueryBuilder, Sqlite};

#[derive(Debug, Serialize, FromRow)]
pub struct HistorySessionRow {
    pub id: i64,
    pub origin: String,
    pub app_name: String,
    pub exe_name: String,
    pub window_title: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub duration: Option<i64>,
    pub continuity_group_start_time: Option<i64>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct TitleSampleRow {
    pub session_id: i64,
    pub title: String,
    pub start_time: i64,
    pub end_time: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRangeRows {
    pub sessions: Vec<HistorySessionRow>,
    pub title_samples: Vec<TitleSampleRow>,
}

pub async fn load_history_range(
    pool: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
    now_ms: i64,
    include_title_samples: bool,
) -> Result<HistoryRangeRows, sqlx::Error> {
    if end_ms <= start_ms {
        return Ok(HistoryRangeRows {
            sessions: vec![],
            title_samples: vec![],
        });
    }
    // Facts and their titles must belong to the same database snapshot.
    let mut tx = pool.begin().await?;
    let sessions: Vec<HistorySessionRow> = sqlx::query_as(
        "SELECT id, origin, app_name, exe_name, window_title, start_time, end_time,
                duration, continuity_group_start_time
         FROM (
           SELECT id, 'native' AS origin, app_name, exe_name, window_title, start_time, end_time,
                  COALESCE(duration, MAX(0, ? - start_time)) AS duration, continuity_group_start_time
           FROM sessions WHERE start_time < ? AND (end_time > ? OR (end_time IS NULL AND ? > ?))
           UNION ALL
           SELECT -7000000000000000 - rowid, 'native', '', 'activity:anonymous', '', start_time,
                  COALESCE(end_time, observed_until), COALESCE(end_time, observed_until) - start_time, start_time
           FROM anonymous_activity WHERE start_time < ? AND COALESCE(end_time, observed_until) > ?
           UNION ALL
           SELECT id, 'import_exact', app_name, exe_name, window_title, start_time, end_time,
                  duration, start_time
           FROM import_exact_sessions WHERE start_time < ? AND end_time > ?
         ) ORDER BY start_time ASC",
    )
    .bind(now_ms).bind(end_ms).bind(start_ms).bind(now_ms).bind(start_ms)
    .bind(end_ms).bind(start_ms).bind(end_ms).bind(start_ms)
    .fetch_all(&mut *tx).await?;
    let mut title_samples = Vec::new();
    if include_title_samples {
        let ids: Vec<i64> = sessions
            .iter()
            .filter(|row| row.origin == "native" && row.id > 0)
            .map(|row| row.id)
            .collect();
        for batch in ids.chunks(900) {
            let mut query = QueryBuilder::<Sqlite>::new(
                "SELECT session_id, title, start_time, end_time FROM session_title_samples WHERE session_id IN (",
            );
            let mut values = query.separated(", ");
            for id in batch {
                values.push_bind(id);
            }
            query
                .push(") AND start_time < ")
                .push_bind(end_ms)
                .push(" AND COALESCE(end_time, ")
                .push_bind(now_ms)
                .push(") > ")
                .push_bind(start_ms)
                .push(" ORDER BY session_id ASC, start_time ASC, id ASC");
            title_samples.extend(
                query
                    .build_query_as::<TitleSampleRow>()
                    .fetch_all(&mut *tx)
                    .await?,
            );
        }
    }
    tx.commit().await?;
    Ok(HistoryRangeRows {
        sessions,
        title_samples,
    })
}

pub async fn earliest_activity_start(pool: &Pool<Sqlite>) -> Result<Option<i64>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT MIN(start_time) FROM (
           SELECT start_time FROM sessions UNION ALL SELECT start_time FROM anonymous_activity
           UNION ALL SELECT start_time FROM import_exact_sessions
           UNION ALL SELECT bucket_start_time FROM import_time_buckets
         )",
    )
    .fetch_one(pool)
    .await
}

pub async fn recorded_executable_names(pool: &Pool<Sqlite>) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT DISTINCT exe_name FROM (
           SELECT exe_name FROM sessions UNION ALL SELECT exe_name FROM import_exact_sessions
           UNION ALL SELECT exe_name FROM import_time_buckets
         ) ORDER BY exe_name",
    )
    .fetch_all(pool)
    .await
}

#[cfg(test)]
mod tests;
