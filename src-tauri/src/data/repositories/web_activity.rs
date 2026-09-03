use crate::domain::backup::{BackupWebActivitySegment, BackupWebFaviconCache};
use crate::domain::web_activity::{
    parse_domain_override_capture_title, parse_domain_override_enabled, WebActivitySegmentInput,
    WEB_ACTIVITY_OBSERVATION_TTL_MS, WEB_ACTIVITY_SOURCE_BROWSER_EXTENSION,
    WEB_DOMAIN_OVERRIDE_KEY_PREFIX,
};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::HashMap;

#[derive(Clone, Debug)]
struct ActiveWebActivitySegment {
    id: i64,
    browser_client_id: String,
    browser_kind: String,
    browser_exe_name: String,
    normalized_domain: String,
    url: Option<String>,
    title: Option<String>,
    start_time: i64,
    updated_at: i64,
    native_session_id: Option<i64>,
}

pub async fn load_domain_recording_enabled(
    pool: &Pool<Sqlite>,
    normalized_domain: &str,
) -> Result<bool, sqlx::Error> {
    let key = format!("{WEB_DOMAIN_OVERRIDE_KEY_PREFIX}{normalized_domain}");
    let row = sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    let Some(row) = row else {
        return Ok(true);
    };
    let value: String = row.get("value");
    Ok(parse_domain_override_enabled(&value))
}

pub async fn load_domain_title_recording_enabled(
    pool: &Pool<Sqlite>,
    normalized_domain: &str,
) -> Result<bool, sqlx::Error> {
    let key = format!("{WEB_DOMAIN_OVERRIDE_KEY_PREFIX}{normalized_domain}");
    let row = sqlx::query("SELECT value FROM settings WHERE key = ? LIMIT 1")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    let Some(row) = row else {
        return Ok(true);
    };
    let value: String = row.get("value");
    Ok(parse_domain_override_capture_title(&value))
}

pub async fn upsert_active_segment(
    pool: &Pool<Sqlite>,
    input: &WebActivitySegmentInput,
    timestamp_ms: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let mut persisted_input = input.clone();
    let settings: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM settings WHERE key IN ('tracking_paused', 'web_activity_enabled', 'title_recording_enabled', ?, ?)")
        .bind(format!("__app_override::{}", input.browser_exe_name.to_ascii_lowercase()))
        .bind(format!("{WEB_DOMAIN_OVERRIDE_KEY_PREFIX}{}", input.normalized_domain))
        .fetch_all(&mut *tx).await?;
    for (key, value) in settings {
        let denied = match key.as_str() {
            "title_recording_enabled" => {
                if !crate::domain::settings::parse_boolean_setting(&value, true) {
                    persisted_input.title = None;
                }
                false
            }
            "tracking_paused" => crate::domain::settings::parse_boolean_setting(&value, false),
            "web_activity_enabled" => {
                !crate::domain::settings::parse_boolean_setting(&value, false)
            }
            key if key.starts_with(WEB_DOMAIN_OVERRIDE_KEY_PREFIX) => {
                if !parse_domain_override_capture_title(&value) {
                    persisted_input.title = None;
                }
                !parse_domain_override_enabled(&value)
            }
            _ => {
                serde_json::from_str::<serde_json::Value>(&value)
                    .ok()
                    .and_then(|value| value.get("track").and_then(|track| track.as_bool()))
                    == Some(false)
            }
        };
        if denied {
            return Ok(false);
        }
    }
    let input = &persisted_input;
    let matching_session: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sessions WHERE id = ? AND end_time IS NULL AND LOWER(exe_name) = LOWER(?) AND start_time <= ?)"
    ).bind(input.native_session_id).bind(&input.browser_exe_name).bind(timestamp_ms)
        .fetch_one(&mut *tx).await?;
    if !matching_session {
        return Ok(false);
    }
    let active = load_active_segment_tx(&mut tx).await?;

    if let Some(active) = active {
        if timestamp_ms < active.updated_at {
            return Ok(false);
        }
        let expires_at = active
            .updated_at
            .saturating_add(WEB_ACTIVITY_OBSERVATION_TTL_MS);
        if is_same_segment_identity(&active, input) && timestamp_ms <= expires_at {
            sqlx::query(
                "UPDATE web_activity_segments
                 SET domain = ?,
                     title = ?,
                     favicon_url = ?,
                     updated_at = ?
                 WHERE id = ?",
            )
            .bind(&input.domain)
            .bind(&input.title)
            .bind(&input.favicon_url)
            .bind(timestamp_ms)
            .bind(active.id)
            .execute(&mut *tx)
            .await?;
            upsert_favicon_cache_tx(
                &mut tx,
                &input.normalized_domain,
                input.favicon_url.as_deref(),
                timestamp_ms,
            )
            .await?;
            tx.commit().await?;
            return Ok(timestamp_ms != active.updated_at);
        }

        finish_segment_tx(
            &mut tx,
            active.id,
            active.start_time,
            timestamp_ms.min(expires_at),
        )
        .await?;
    }

    let inserted = sqlx::query(
        "INSERT INTO web_activity_segments (
             browser_client_id,
             browser_kind,
             browser_exe_name,
             domain,
             normalized_domain,
             url,
             title,
             favicon_url,
             start_time,
             source,
             created_at,
             updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&input.browser_client_id)
    .bind(&input.browser_kind)
    .bind(&input.browser_exe_name)
    .bind(&input.domain)
    .bind(&input.normalized_domain)
    .bind(&input.url)
    .bind(&input.title)
    .bind(&input.favicon_url)
    .bind(timestamp_ms)
    .bind(WEB_ACTIVITY_SOURCE_BROWSER_EXTENSION)
    .bind(timestamp_ms)
    .bind(timestamp_ms)
    .execute(&mut *tx)
    .await?;

    bind_native_session_tx(
        &mut tx,
        inserted.last_insert_rowid(),
        Some(input.native_session_id),
    )
    .await?;
    upsert_favicon_cache_tx(
        &mut tx,
        &input.normalized_domain,
        input.favicon_url.as_deref(),
        timestamp_ms,
    )
    .await?;

    tx.commit().await?;
    Ok(true)
}

pub async fn end_active_segment(
    pool: &Pool<Sqlite>,
    timestamp_ms: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let changed = end_active_segment_tx(&mut tx, timestamp_ms).await?;
    tx.commit().await?;
    Ok(changed)
}

pub(crate) async fn end_active_segment_tx(
    tx: &mut Transaction<'_, Sqlite>,
    timestamp_ms: i64,
) -> Result<bool, sqlx::Error> {
    let active = load_active_segment_tx(tx).await?;
    let Some(active) = active else {
        return Ok(false);
    };

    finish_segment_tx(
        tx,
        active.id,
        active.start_time,
        timestamp_ms.min(
            active
                .updated_at
                .saturating_add(WEB_ACTIVITY_OBSERVATION_TTL_MS),
        ),
    )
    .await?;
    Ok(true)
}

pub async fn seal_interrupted_segments(
    pool: &Pool<Sqlite>,
    now_ms: i64,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE web_activity_segments SET end_time = CASE WHEN updated_at BETWEEN start_time AND ? THEN updated_at ELSE start_time END, duration = CASE WHEN updated_at BETWEEN start_time AND ? THEN updated_at - start_time ELSE 0 END WHERE end_time IS NULL")
        .bind(now_ms).bind(now_ms).execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

pub async fn expire_active_segment(pool: &Pool<Sqlite>, now_ms: i64) -> Result<bool, sqlx::Error> {
    let result = sqlx::query("UPDATE web_activity_segments SET end_time = MAX(start_time, updated_at + ?), duration = MAX(0, updated_at + ? - start_time) WHERE end_time IS NULL AND updated_at + ? < ?")
        .bind(WEB_ACTIVITY_OBSERVATION_TTL_MS).bind(WEB_ACTIVITY_OBSERVATION_TTL_MS).bind(WEB_ACTIVITY_OBSERVATION_TTL_MS).bind(now_ms)
        .execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

pub async fn end_active_segment_for_source(
    pool: &Pool<Sqlite>,
    client: &str,
    native_session_id: i64,
    now_ms: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let Some(active) = load_active_segment_tx(&mut tx).await? else {
        return Ok(false);
    };
    if active.browser_client_id != client
        || active.native_session_id != Some(native_session_id)
        || now_ms < active.updated_at
    {
        return Ok(false);
    }
    finish_segment_tx(
        &mut tx,
        active.id,
        active.start_time,
        now_ms.min(
            active
                .updated_at
                .saturating_add(WEB_ACTIVITY_OBSERVATION_TTL_MS),
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn end_active_segment_for_domain(
    pool: &Pool<Sqlite>,
    normalized_domain: &str,
    timestamp_ms: i64,
) -> Result<bool, sqlx::Error> {
    let Some(target_domain) = crate::domain::web_activity::normalize_domain(normalized_domain)
    else {
        return Ok(false);
    };
    let mut tx = pool.begin().await?;
    let active = load_active_segment_tx(&mut tx).await?;
    let Some(active) = active else {
        tx.rollback().await?;
        return Ok(false);
    };
    if active.normalized_domain != target_domain {
        tx.rollback().await?;
        return Ok(false);
    }
    finish_segment_tx(
        &mut tx,
        active.id,
        active.start_time,
        timestamp_ms.min(
            active
                .updated_at
                .saturating_add(WEB_ACTIVITY_OBSERVATION_TTL_MS),
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn fetch_all_for_backup(
    pool: &Pool<Sqlite>,
) -> Result<Vec<BackupWebActivitySegment>, String> {
    let rows = sqlx::query(
        "SELECT id, (SELECT session_id FROM web_activity_native_sessions WHERE segment_id = web_activity_segments.id) AS native_session_id, browser_client_id, browser_kind, browser_exe_name, domain,
                normalized_domain, url, title, favicon_url, start_time, end_time,
                duration, source, created_at, updated_at
         FROM web_activity_segments
         ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read web activity for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupWebActivitySegment {
            native_session_id: row.get("native_session_id"),
            id: row.get("id"),
            browser_client_id: row.get("browser_client_id"),
            browser_kind: row.get("browser_kind"),
            browser_exe_name: row.get("browser_exe_name"),
            domain: row.get("domain"),
            normalized_domain: row.get("normalized_domain"),
            url: row.get("url"),
            title: row.get("title"),
            favicon_url: row.get("favicon_url"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
            duration: row.get("duration"),
            source: row.get("source"),
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
        .collect())
}

pub async fn fetch_all_favicon_cache_for_backup(
    pool: &Pool<Sqlite>,
) -> Result<Vec<BackupWebFaviconCache>, String> {
    let rows = sqlx::query(
        "SELECT normalized_domain, favicon_url, updated_at FROM web_favicon_cache ORDER BY normalized_domain ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read web favicon cache for backup: {error}"))?;
    Ok(rows
        .into_iter()
        .map(|row| BackupWebFaviconCache {
            normalized_domain: row.get("normalized_domain"),
            favicon_url: row.get("favicon_url"),
            updated_at: row.get("updated_at"),
        })
        .collect())
}

pub async fn insert_favicon_cache_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    entries: &[BackupWebFaviconCache],
) -> Result<(), String> {
    for entry in entries {
        upsert_favicon_cache_tx(
            tx,
            &entry.normalized_domain,
            Some(&entry.favicon_url),
            entry.updated_at,
        )
        .await
        .map_err(|error| format!("failed to restore web favicon cache: {error}"))?;
    }
    Ok(())
}

pub async fn insert_missing_favicon_cache_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    entries: &[BackupWebFaviconCache],
) -> Result<(), String> {
    for entry in entries {
        insert_missing_favicon_cache_tx(
            tx,
            &entry.normalized_domain,
            Some(&entry.favicon_url),
            entry.updated_at,
        )
        .await
        .map_err(|error| format!("failed to merge web favicon cache: {error}"))?;
    }
    Ok(())
}

pub async fn clear_for_restore(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("DELETE FROM web_favicon_cache")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear web favicon cache before restore: {error}"))?;
    sqlx::query("DELETE FROM web_activity_segments")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear web activity before restore: {error}"))?;
    Ok(())
}

pub async fn insert_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    segments: &[BackupWebActivitySegment],
    session_id_map: &HashMap<i64, i64>,
) -> Result<(), String> {
    for segment in segments {
        let inserted = sqlx::query(
            "INSERT INTO web_activity_segments (
                id, browser_client_id, browser_kind, browser_exe_name, domain,
                normalized_domain, url, title, favicon_url, start_time, end_time,
                duration, source, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(segment.id)
        .bind(&segment.browser_client_id)
        .bind(&segment.browser_kind)
        .bind(&segment.browser_exe_name)
        .bind(&segment.domain)
        .bind(&segment.normalized_domain)
        .bind(&segment.url)
        .bind(&segment.title)
        .bind(&segment.favicon_url)
        .bind(segment.start_time)
        .bind(segment.end_time)
        .bind(segment.duration)
        .bind(&segment.source)
        .bind(segment.created_at)
        .bind(segment.updated_at)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore web activity: {error}"))?;
        if inserted.rows_affected() > 0 {
            bind_native_session_tx(
                tx,
                inserted.last_insert_rowid(),
                segment
                    .native_session_id
                    .and_then(|id| session_id_map.get(&id).copied()),
            )
            .await
            .map_err(|error| format!("failed to restore native web relation: {error}"))?;
        }
        upsert_favicon_cache_tx(
            tx,
            &segment.normalized_domain,
            segment.favicon_url.as_deref(),
            segment.updated_at,
        )
        .await
        .map_err(|error| format!("failed to restore web favicon cache: {error}"))?;
    }

    Ok(())
}

pub async fn insert_missing_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    segments: &[BackupWebActivitySegment],
    session_id_map: &HashMap<i64, i64>,
) -> Result<(), String> {
    for segment in segments {
        let inserted = sqlx::query(
            "INSERT INTO web_activity_segments (
                browser_client_id, browser_kind, browser_exe_name, domain,
                normalized_domain, url, title, favicon_url, start_time, end_time,
                duration, source, created_at, updated_at
             )
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (
                SELECT 1
                FROM web_activity_segments
                WHERE browser_client_id = ?
                  AND browser_kind = ?
                  AND LOWER(browser_exe_name) = LOWER(?)
                  AND start_time = ?
             )
               AND (? IS NOT NULL OR NOT EXISTS (
                 SELECT 1 FROM web_activity_segments WHERE end_time IS NULL
               ))",
        )
        .bind(&segment.browser_client_id)
        .bind(&segment.browser_kind)
        .bind(&segment.browser_exe_name)
        .bind(&segment.domain)
        .bind(&segment.normalized_domain)
        .bind(&segment.url)
        .bind(&segment.title)
        .bind(&segment.favicon_url)
        .bind(segment.start_time)
        .bind(segment.end_time)
        .bind(segment.duration)
        .bind(&segment.source)
        .bind(segment.created_at)
        .bind(segment.updated_at)
        .bind(&segment.browser_client_id)
        .bind(&segment.browser_kind)
        .bind(&segment.browser_exe_name)
        .bind(segment.start_time)
        .bind(segment.end_time)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to merge restore web activity: {error}"))?;
        if inserted.rows_affected() > 0 {
            bind_native_session_tx(
                tx,
                inserted.last_insert_rowid(),
                segment
                    .native_session_id
                    .and_then(|id| session_id_map.get(&id).copied()),
            )
            .await
            .map_err(|error| format!("failed to restore native web relation: {error}"))?;
        }
        insert_missing_favicon_cache_tx(
            tx,
            &segment.normalized_domain,
            segment.favicon_url.as_deref(),
            segment.updated_at,
        )
        .await
        .map_err(|error| format!("failed to merge restore web favicon cache: {error}"))?;
    }

    Ok(())
}

async fn bind_native_session_tx(
    tx: &mut Transaction<'_, Sqlite>,
    segment_id: i64,
    session_id: Option<i64>,
) -> Result<(), sqlx::Error> {
    if let Some(session_id) = session_id {
        sqlx::query(
            "INSERT INTO web_activity_native_sessions (segment_id, session_id) VALUES (?, ?)",
        )
        .bind(segment_id)
        .bind(session_id)
        .execute(&mut **tx)
        .await?;
        // Merge may retain a shorter, already closed native session. Binding a
        // new child must enforce that existing boundary without updating its parent.
        let boundary: Option<(i64, i64)> = sqlx::query_as(
            "SELECT w.start_time, MIN(COALESCE(w.end_time, w.updated_at + ?), s.end_time)
             FROM web_activity_segments w JOIN sessions s ON s.id = ?
             WHERE w.id = ? AND s.end_time IS NOT NULL
               AND (w.end_time IS NULL OR w.end_time > MAX(w.start_time, s.end_time))",
        )
        .bind(WEB_ACTIVITY_OBSERVATION_TTL_MS)
        .bind(session_id)
        .bind(segment_id)
        .fetch_optional(&mut **tx)
        .await?;
        if let Some((start, end)) = boundary {
            finish_segment_tx(tx, segment_id, start, end).await?;
        }
    }
    Ok(())
}

async fn load_active_segment_tx(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<Option<ActiveWebActivitySegment>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, browser_client_id, browser_kind, browser_exe_name, normalized_domain,
                url, title, start_time, updated_at, (SELECT session_id FROM web_activity_native_sessions WHERE segment_id = web_activity_segments.id) AS native_session_id
         FROM web_activity_segments
         WHERE end_time IS NULL
         ORDER BY start_time DESC, id DESC
         LIMIT 1",
    )
    .fetch_optional(&mut **tx)
    .await?;

    Ok(row.map(|row| ActiveWebActivitySegment {
        id: row.get("id"),
        browser_client_id: row.get("browser_client_id"),
        browser_kind: row.get("browser_kind"),
        browser_exe_name: row.get("browser_exe_name"),
        normalized_domain: row.get("normalized_domain"),
        url: row.get("url"),
        title: row.get("title"),
        start_time: row.get("start_time"),
        updated_at: row.get("updated_at"),
        native_session_id: row.get("native_session_id"),
    }))
}

async fn finish_segment_tx(
    tx: &mut Transaction<'_, Sqlite>,
    id: i64,
    start_time: i64,
    raw_end_time: i64,
) -> Result<(), sqlx::Error> {
    let end_time = raw_end_time.max(start_time);
    let duration = end_time - start_time;
    sqlx::query(
        "UPDATE web_activity_segments
         SET end_time = ?,
             duration = ?,
             updated_at = ?
         WHERE id = ?",
    )
    .bind(end_time)
    .bind(duration)
    .bind(end_time)
    .bind(id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn upsert_favicon_cache_tx(
    tx: &mut Transaction<'_, Sqlite>,
    normalized_domain: &str,
    favicon_url: Option<&str>,
    timestamp_ms: i64,
) -> Result<(), sqlx::Error> {
    let domain = normalized_domain.trim();
    let favicon = favicon_url.unwrap_or("").trim();
    if domain.is_empty() || favicon.is_empty() {
        return Ok(());
    }

    sqlx::query(
        "INSERT INTO web_favicon_cache (normalized_domain, favicon_url, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(normalized_domain) DO UPDATE SET
             favicon_url = excluded.favicon_url,
             updated_at = excluded.updated_at
         WHERE web_favicon_cache.favicon_url <> excluded.favicon_url",
    )
    .bind(domain)
    .bind(favicon)
    .bind(timestamp_ms)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn insert_missing_favicon_cache_tx(
    tx: &mut Transaction<'_, Sqlite>,
    normalized_domain: &str,
    favicon_url: Option<&str>,
    timestamp_ms: i64,
) -> Result<(), sqlx::Error> {
    let domain = normalized_domain.trim();
    let favicon = favicon_url.unwrap_or("").trim();
    if domain.is_empty() || favicon.is_empty() {
        return Ok(());
    }

    sqlx::query(
        "INSERT OR IGNORE INTO web_favicon_cache (normalized_domain, favicon_url, updated_at)
         VALUES (?, ?, ?)",
    )
    .bind(domain)
    .bind(favicon)
    .bind(timestamp_ms)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

fn is_same_segment_identity(
    active: &ActiveWebActivitySegment,
    input: &WebActivitySegmentInput,
) -> bool {
    active.native_session_id == Some(input.native_session_id)
        && active.browser_client_id == input.browser_client_id
        && active.browser_kind == input.browser_kind
        && active
            .browser_exe_name
            .eq_ignore_ascii_case(&input.browser_exe_name)
        && active.normalized_domain == input.normalized_domain
        && active.url == input.url
        && active.title == input.title
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema as db_schema;
    use sqlx::{Executor, Row, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SESSION_SCHEMA_SQL)
            .await
            .unwrap();
        super::super::sessions::start_session(&pool, "Chrome", "chrome.exe", "", 0, 0)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    fn timing_input(domain: &str) -> WebActivitySegmentInput {
        WebActivitySegmentInput {
            native_session_id: 2,
            browser_client_id: "timing-test".into(),
            browser_kind: "edge".into(),
            browser_exe_name: "msedge.exe".into(),
            domain: domain.into(),
            normalized_domain: domain.into(),
            url: Some(format!("https://{domain}")),
            title: None,
            favicon_url: None,
        }
    }

    #[test]
    fn observations_expire_without_bridging_a_gap_and_duplicate_requests_are_idempotent() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let page = input("example.test", "Page");
            assert!(upsert_active_segment(&pool, &page, 2_000).await.unwrap());
            assert!(!upsert_active_segment(&pool, &page, 2_000).await.unwrap());
            assert!(!expire_active_segment(&pool, 47_000).await.unwrap());
            assert!(expire_active_segment(&pool, 47_001).await.unwrap());
            assert!(!expire_active_segment(&pool, 48_000).await.unwrap());
            assert!(upsert_active_segment(&pool, &page, 602_000).await.unwrap());
            super::super::sessions::end_active_sessions(&pool, 603_000)
                .await
                .unwrap();
            let rows: Vec<(i64, i64, i64)> = sqlx::query_as(
                "SELECT start_time,end_time,duration FROM web_activity_segments ORDER BY id",
            )
            .fetch_all(&pool)
            .await
            .unwrap();
            assert_eq!(
                rows,
                vec![(2_000, 47_000, 45_000), (602_000, 603_000, 1_000)]
            );
        });
    }

    #[test]
    fn browser_switch_and_source_scoped_stops_cannot_reuse_an_old_session() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let page = input("example.test", "Page");
            upsert_active_segment(&pool, &page, 2_000).await.unwrap();
            assert!(
                !end_active_segment_for_source(&pool, "other-profile", 1, 3_000)
                    .await
                    .unwrap()
            );
            assert!(!end_active_segment_for_source(&pool, "client", 2, 3_000)
                .await
                .unwrap());
            super::super::sessions::start_session(&pool, "Edge", "msedge.exe", "", 8_000, 8_000)
                .await
                .unwrap();
            let ended: i64 = sqlx::query_scalar("SELECT end_time FROM web_activity_segments")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(ended, 8_000);
            assert!(!upsert_active_segment(&pool, &page, 9_000).await.unwrap());
            super::super::sessions::start_session(
                &pool,
                "Chrome",
                "chrome.exe",
                "",
                18_000,
                18_000,
            )
            .await
            .unwrap();
            assert!(!upsert_active_segment(&pool, &page, 19_000).await.unwrap());
            let resumed = WebActivitySegmentInput {
                native_session_id: 3,
                ..page
            };
            assert!(!upsert_active_segment(&pool, &resumed, 17_000)
                .await
                .unwrap());
            assert!(upsert_active_segment(&pool, &resumed, 19_000)
                .await
                .unwrap());
            assert!(!end_active_segment_for_source(&pool, "client", 1, 20_000)
                .await
                .unwrap());
            assert!(end_active_segment_for_source(&pool, "client", 3, 20_000)
                .await
                .unwrap());
            let rows: Vec<(i64, i64)> =
                sqlx::query_as("SELECT start_time,end_time FROM web_activity_segments ORDER BY id")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
            assert_eq!(rows, vec![(2_000, 8_000), (19_000, 20_000)]);
        });
    }

    #[test]
    fn native_web_boundary_failure_rolls_back_facts_and_revision_together() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            pool.execute(db_schema::WEB_ACTIVITY_REVISION_SCHEMA_SQL)
                .await
                .unwrap();
            upsert_active_segment(&pool, &input("example.test", "A"), 2_000)
                .await
                .unwrap();
            let revision: i64 =
                sqlx::query_scalar("SELECT source_revision FROM web_activity_revision")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            pool.execute("CREATE TRIGGER fail_web_seal BEFORE UPDATE OF end_time ON web_activity_segments BEGIN SELECT RAISE(ABORT, 'injected web seal failure'); END").await.unwrap();
            assert!(super::super::sessions::end_active_sessions(&pool, 5_000)
                .await
                .is_err());
            let native_end: Option<i64> =
                sqlx::query_scalar("SELECT end_time FROM sessions WHERE id=1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let web_end: Option<i64> =
                sqlx::query_scalar("SELECT end_time FROM web_activity_segments")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let after: i64 =
                sqlx::query_scalar("SELECT source_revision FROM web_activity_revision")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!((native_end, web_end, after), (None, None, revision));
            pool.execute("DROP TRIGGER fail_web_seal").await.unwrap();
            assert!(super::super::sessions::end_active_sessions(&pool, 5_000)
                .await
                .unwrap());
            assert!(!super::super::sessions::end_active_sessions(&pool, 5_000)
                .await
                .unwrap());
            let duration: i64 = sqlx::query_scalar("SELECT duration FROM web_activity_segments")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(duration, 3_000);
        });
    }

    #[test]
    fn interrupted_observation_uses_last_observation_and_rejects_future_evidence() {
        tauri::async_runtime::block_on(async {
            for (observed, expected) in [(8_000, 8_000), (30_000, 2_000)] {
                let pool = setup_test_db().await;
                let page = input("example.test", "A");
                upsert_active_segment(&pool, &page, 2_000).await.unwrap();
                upsert_active_segment(&pool, &page, observed).await.unwrap();
                assert!(seal_interrupted_segments(&pool, 20_000).await.unwrap());
                assert!(!seal_interrupted_segments(&pool, 40_000).await.unwrap());
                let end: i64 = sqlx::query_scalar("SELECT end_time FROM web_activity_segments")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
                assert_eq!(end, expected);
            }
        });
    }

    #[test]
    fn restore_clips_new_web_children_to_an_already_closed_mapped_parent() {
        tauri::async_runtime::block_on(async {
            let source = setup_test_db().await;
            upsert_active_segment(&source, &input("example.test", "A"), 2_000)
                .await
                .unwrap();
            super::super::sessions::end_active_sessions(&source, 8_000)
                .await
                .unwrap();
            let backup = fetch_all_for_backup(&source).await.unwrap();
            let target = setup_test_db().await;
            super::super::sessions::end_active_sessions(&target, 4_000)
                .await
                .unwrap();
            let mut tx = target.begin().await.unwrap();
            insert_missing_for_restore(&mut tx, &backup, &HashMap::from([(1, 1)]))
                .await
                .unwrap();
            tx.commit().await.unwrap();
            let row: (i64, i64) =
                sqlx::query_as("SELECT end_time,duration FROM web_activity_segments")
                    .fetch_one(&target)
                    .await
                    .unwrap();
            assert_eq!(row, (4_000, 2_000));
            assert_eq!(
                fetch_all_for_backup(&source).await.unwrap()[0].end_time,
                Some(8_000)
            );
        });
    }

    #[test]
    fn restored_web_relation_remaps_ids_and_cascades_without_deleting_web_history() {
        tauri::async_runtime::block_on(async {
            let source = setup_test_db().await;
            upsert_active_segment(&source, &input("example.test", "A"), 2_000)
                .await
                .unwrap();
            let backup = fetch_all_for_backup(&source).await.unwrap();
            assert_eq!(backup[0].native_session_id, Some(1));
            let target = setup_test_db().await;
            super::super::sessions::start_session(
                &target,
                "Chrome",
                "chrome.exe",
                "another",
                1_000,
                1_000,
            )
            .await
            .unwrap();
            let mut tx = target.begin().await.unwrap();
            insert_missing_for_restore(&mut tx, &backup, &HashMap::from([(1, 2)]))
                .await
                .unwrap();
            tx.commit().await.unwrap();
            super::super::sessions::end_active_sessions(&target, 5_000)
                .await
                .unwrap();
            let row: (i64,i64) = sqlx::query_as("SELECT session_id,duration FROM web_activity_native_sessions JOIN web_activity_segments ON segment_id=id").fetch_one(&target).await.unwrap();
            assert_eq!(row, (2, 3_000));
            target
                .execute("DELETE FROM sessions WHERE id=2")
                .await
                .unwrap();
            let links: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM web_activity_native_sessions")
                    .fetch_one(&target)
                    .await
                    .unwrap();
            let duration: i64 = sqlx::query_scalar("SELECT duration FROM web_activity_segments")
                .fetch_one(&target)
                .await
                .unwrap();
            assert_eq!((links, duration), (0, 3_000));
        });
    }

    #[test]
    fn web_timing_requires_a_matching_native_session() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            pool.execute("DELETE FROM sessions").await.unwrap();
            assert!(
                !upsert_active_segment(&pool, &timing_input("example.test"), 2_000)
                    .await
                    .unwrap()
            );
            super::super::sessions::start_session(&pool, "Chrome", "chrome.exe", "", 1_000, 1_000)
                .await
                .unwrap();
            assert!(
                !upsert_active_segment(&pool, &timing_input("example.test"), 2_000)
                    .await
                    .unwrap()
            );
        });
    }

    #[test]
    fn native_backdate_clips_all_current_web_fragments_and_preserves_unowned_history() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            // An imported/historical row can share browser and timestamps, without
            // proving that it was captured by this running native session.
            pool.execute("INSERT INTO web_activity_segments (browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,source,created_at,updated_at) VALUES ('old','edge','msedge.exe','old.test','old.test',20000,30000,10000,'browser-extension',20000,30000)").await.unwrap();
            super::super::sessions::start_session(&pool, "Edge", "msedge.exe", "", 1_000, 1_000)
                .await
                .unwrap();
            for (domain, time) in [("a.test", 2_000), ("b.test", 20_000), ("c.test", 40_000)] {
                upsert_active_segment(&pool, &timing_input(domain), time)
                    .await
                    .unwrap();
            }
            super::super::sessions::end_active_sessions(&pool, 10_000)
                .await
                .unwrap();
            let rows: Vec<(String, Option<i64>)> =
                sqlx::query_as("SELECT domain, duration FROM web_activity_segments ORDER BY id")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                rows,
                vec![
                    ("old.test".into(), Some(10_000)),
                    ("a.test".into(), Some(8_000)),
                    ("b.test".into(), Some(0)),
                    ("c.test".into(), Some(0))
                ]
            );
        });
    }

    #[test]
    fn merge_keeps_current_evolved_and_active_web_segments() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO web_activity_segments (
                    browser_client_id, browser_kind, browser_exe_name, domain, normalized_domain,
                    url, title, start_time, end_time, duration, source, created_at, updated_at
                 ) VALUES
                    ('a', 'chromium', 'a.exe', 'example.com', 'example.com', 'new', 'new', 100, 300, 200, 'test', 100, 300),
                    ('live', 'chromium', 'live.exe', 'live.test', 'live.test', NULL, NULL, 400, NULL, NULL, 'test', 400, 400)",
            )
            .execute(&pool)
            .await
            .unwrap();
            let backup = vec![
                BackupWebActivitySegment {
                    native_session_id: None,
                    id: 10,
                    browser_client_id: "a".into(),
                    browser_kind: "chromium".into(),
                    browser_exe_name: "a.exe".into(),
                    domain: "example.com".into(),
                    normalized_domain: "example.com".into(),
                    url: Some("old".into()),
                    title: Some("old".into()),
                    favicon_url: None,
                    start_time: 100,
                    end_time: Some(200),
                    duration: Some(100),
                    source: "test".into(),
                    created_at: 100,
                    updated_at: 200,
                },
                BackupWebActivitySegment {
                    native_session_id: None,
                    id: 11,
                    browser_client_id: "other".into(),
                    browser_kind: "chromium".into(),
                    browser_exe_name: "other.exe".into(),
                    domain: "other.test".into(),
                    normalized_domain: "other.test".into(),
                    url: None,
                    title: None,
                    favicon_url: None,
                    start_time: 500,
                    end_time: None,
                    duration: None,
                    source: "test".into(),
                    created_at: 500,
                    updated_at: 500,
                },
            ];
            let mut tx = pool.begin().await.unwrap();
            insert_missing_for_restore(&mut tx, &backup, &HashMap::new())
                .await
                .unwrap();
            tx.commit().await.unwrap();
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM web_activity_segments")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 2);
        });
    }

    #[test]
    fn merge_favicon_cache_keeps_current_value_and_imports_missing_domain() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO web_favicon_cache (normalized_domain, favicon_url, updated_at)
                 VALUES ('current.test', 'current.ico', 20)",
            )
            .execute(&pool)
            .await
            .unwrap();
            let entries = vec![
                BackupWebFaviconCache {
                    normalized_domain: "current.test".into(),
                    favicon_url: "old.ico".into(),
                    updated_at: 10,
                },
                BackupWebFaviconCache {
                    normalized_domain: "missing.test".into(),
                    favicon_url: "missing.ico".into(),
                    updated_at: 10,
                },
            ];
            let mut tx = pool.begin().await.unwrap();
            insert_missing_favicon_cache_for_restore(&mut tx, &entries)
                .await
                .unwrap();
            tx.commit().await.unwrap();
            let current: String = sqlx::query_scalar(
                "SELECT favicon_url FROM web_favicon_cache WHERE normalized_domain = 'current.test'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            let missing: String = sqlx::query_scalar(
                "SELECT favicon_url FROM web_favicon_cache WHERE normalized_domain = 'missing.test'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(current, "current.ico");
            assert_eq!(missing, "missing.ico");
        });
    }

    fn input(domain: &str, title: &str) -> WebActivitySegmentInput {
        WebActivitySegmentInput {
            native_session_id: 1,
            browser_client_id: "client".into(),
            browser_kind: "chrome".into(),
            browser_exe_name: "chrome.exe".into(),
            domain: domain.into(),
            normalized_domain: domain.into(),
            url: None,
            title: Some(title.into()),
            favicon_url: None,
        }
    }

    fn input_with_favicon(domain: &str, title: &str, favicon_url: &str) -> WebActivitySegmentInput {
        WebActivitySegmentInput {
            favicon_url: Some(favicon_url.into()),
            ..input(domain, title)
        }
    }

    #[test]
    fn active_segment_upsert_extends_same_identity_and_splits_changes() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            assert!(
                upsert_active_segment(&pool, &input("github.com", "Issue"), 1_000)
                    .await
                    .unwrap()
            );
            assert!(
                upsert_active_segment(&pool, &input("github.com", "Issue"), 2_000)
                    .await
                    .unwrap()
            );
            assert!(
                upsert_active_segment(&pool, &input("docs.rs", "Docs"), 3_000)
                    .await
                    .unwrap()
            );

            let rows = sqlx::query(
                "SELECT normalized_domain, start_time, end_time, duration
                 FROM web_activity_segments
                 ORDER BY id ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(rows.len(), 2);
            assert_eq!(rows[0].get::<String, _>("normalized_domain"), "github.com");
            assert_eq!(rows[0].get::<Option<i64>, _>("end_time"), Some(3_000));
            assert_eq!(rows[0].get::<Option<i64>, _>("duration"), Some(2_000));
            assert_eq!(rows[1].get::<String, _>("normalized_domain"), "docs.rs");
            assert_eq!(rows[1].get::<Option<i64>, _>("end_time"), None);
        });
    }

    #[test]
    fn domain_override_enabled_defaults_to_true() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            assert!(load_domain_recording_enabled(&pool, "github.com")
                .await
                .unwrap());

            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
                .bind("__web_domain_override::github.com")
                .bind(r#"{"enabled":false}"#)
                .execute(&pool)
                .await
                .unwrap();

            assert!(!load_domain_recording_enabled(&pool, "github.com")
                .await
                .unwrap());
        });
    }

    #[test]
    fn domain_title_recording_defaults_on_and_reads_explicit_block() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            assert!(load_domain_title_recording_enabled(&pool, "github.com")
                .await
                .unwrap());

            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
                .bind("__web_domain_override::github.com")
                .bind(r#"{"captureTitle":false}"#)
                .execute(&pool)
                .await
                .unwrap();

            assert!(!load_domain_title_recording_enabled(&pool, "github.com")
                .await
                .unwrap());
            assert!(load_domain_recording_enabled(&pool, "github.com")
                .await
                .unwrap());
        });
    }

    #[test]
    fn conditional_domain_seal_only_closes_matching_active_segment() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            upsert_active_segment(&pool, &input("github.com", "Issue"), 1_000)
                .await
                .unwrap();

            assert!(!end_active_segment_for_domain(&pool, "docs.rs", 2_000)
                .await
                .unwrap());
            assert!(end_active_segment_for_domain(&pool, "GitHub.COM.", 3_000)
                .await
                .unwrap());

            let end_time: Option<i64> = sqlx::query_scalar(
                "SELECT end_time FROM web_activity_segments WHERE normalized_domain = 'github.com'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(end_time, Some(3_000));
        });
    }

    #[test]
    fn active_segment_upsert_maintains_domain_favicon_cache() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            upsert_active_segment(
                &pool,
                &input_with_favicon("github.com", "Issue", "data:image/png;base64,one"),
                1_000,
            )
            .await
            .unwrap();
            upsert_active_segment(
                &pool,
                &input_with_favicon("github.com", "Issue", "data:image/png;base64,one"),
                2_000,
            )
            .await
            .unwrap();

            let first: (String, i64) = sqlx::query_as(
                "SELECT favicon_url, updated_at
                 FROM web_favicon_cache
                 WHERE normalized_domain = 'github.com'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(first, ("data:image/png;base64,one".to_string(), 1_000));

            upsert_active_segment(
                &pool,
                &input_with_favicon("github.com", "Issue", "data:image/png;base64,two"),
                3_000,
            )
            .await
            .unwrap();

            let second: (String, i64) = sqlx::query_as(
                "SELECT favicon_url, updated_at
                 FROM web_favicon_cache
                 WHERE normalized_domain = 'github.com'",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(second, ("data:image/png;base64,two".to_string(), 3_000));
        });
    }
}
