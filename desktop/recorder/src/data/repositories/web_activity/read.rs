use super::WEB_ACTIVITY_OBSERVATION_TTL_MS;
use serde::Serialize;
use sqlx::{FromRow, Pool, QueryBuilder, Sqlite};

#[derive(Debug, Serialize, FromRow)]
pub struct WebSegmentRow {
    pub id: i64,
    pub browser_client_id: String,
    pub browser_kind: String,
    pub browser_exe_name: String,
    pub domain: String,
    pub normalized_domain: String,
    pub url: Option<String>,
    pub title: Option<String>,
    pub favicon_url: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub duration: Option<i64>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct ObservedDomainRow {
    pub normalized_domain: String,
    pub domain: String,
    pub total_duration: i64,
    pub last_seen_ms: i64,
    pub favicon_url: Option<String>,
    pub title: Option<String>,
}

#[derive(Debug, Serialize, FromRow)]
pub struct FaviconRow {
    pub normalized_domain: String,
    pub favicon_url: String,
}

pub async fn segments_in_range(
    pool: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
    now_ms: i64,
) -> Result<Vec<WebSegmentRow>, sqlx::Error> {
    if end_ms <= start_ms {
        return Ok(vec![]);
    }
    sqlx::query_as(
        "SELECT id, browser_client_id, browser_kind, browser_exe_name, domain, normalized_domain,
                url, title, NULL AS favicon_url, start_time,
                COALESCE(end_time, MAX(start_time, MIN(?, updated_at + ?))) AS end_time,
                COALESCE(duration, MAX(0, MIN(?, updated_at + ?) - start_time)) AS duration
         FROM web_activity_segments
         WHERE start_time < ? AND COALESCE(end_time, MIN(?, updated_at + ?)) > ?
         ORDER BY start_time ASC, id ASC",
    )
    .bind(now_ms)
    .bind(WEB_ACTIVITY_OBSERVATION_TTL_MS)
    .bind(now_ms)
    .bind(WEB_ACTIVITY_OBSERVATION_TTL_MS)
    .bind(end_ms)
    .bind(now_ms)
    .bind(WEB_ACTIVITY_OBSERVATION_TTL_MS)
    .bind(start_ms)
    .fetch_all(pool)
    .await
}

pub async fn observed_domains(
    pool: &Pool<Sqlite>,
    since_ms: i64,
    now_ms: i64,
    limit: i64,
) -> Result<Vec<ObservedDomainRow>, sqlx::Error> {
    sqlx::query_as(
        "SELECT segment.normalized_domain, MAX(COALESCE(segment.domain, segment.normalized_domain)) AS domain,
                SUM(COALESCE(segment.duration, MAX(0, MIN(?, segment.updated_at + ?) - segment.start_time))) AS total_duration,
                MAX(segment.start_time) AS last_seen_ms, MAX(favicon_cache.favicon_url) AS favicon_url,
                MAX(segment.title) AS title
         FROM web_activity_segments AS segment
         LEFT JOIN web_favicon_cache AS favicon_cache ON favicon_cache.normalized_domain = segment.normalized_domain
         WHERE segment.start_time >= ? GROUP BY segment.normalized_domain
         ORDER BY last_seen_ms DESC, total_duration DESC LIMIT ?",
    ).bind(now_ms).bind(WEB_ACTIVITY_OBSERVATION_TTL_MS).bind(since_ms).bind(limit.clamp(1, 10_000))
        .fetch_all(pool).await
}

pub async fn favicons(
    pool: &Pool<Sqlite>,
    domains: &[String],
) -> Result<Vec<FaviconRow>, sqlx::Error> {
    if domains.len() > 900 {
        return Err(sqlx::Error::Protocol(
            "favicon batch exceeds 900 domains".into(),
        ));
    }
    if domains.is_empty() {
        return Ok(vec![]);
    }
    let mut query = QueryBuilder::<Sqlite>::new(
        "SELECT normalized_domain, favicon_url FROM web_favicon_cache WHERE normalized_domain IN (",
    );
    let mut values = query.separated(", ");
    for domain in domains {
        values.push_bind(domain);
    }
    query.push(")");
    query.build_query_as().fetch_all(pool).await
}

#[cfg(test)]
mod tests;
