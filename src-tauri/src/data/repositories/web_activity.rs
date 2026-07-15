use crate::domain::backup::{BackupWebActivitySegment, BackupWebFaviconCache};
use crate::domain::web_activity::{
    parse_domain_override_capture_title, parse_domain_override_enabled, SanitizedWebActivityInput,
    WEB_ACTIVITY_SOURCE_BROWSER_EXTENSION, WEB_DOMAIN_OVERRIDE_KEY_PREFIX,
};
use sqlx::{Pool, Row, Sqlite, Transaction};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebActivitySegmentInput {
    pub browser_client_id: String,
    pub browser_kind: String,
    pub browser_exe_name: String,
    pub domain: String,
    pub normalized_domain: String,
    pub url: Option<String>,
    pub title: Option<String>,
    pub favicon_url: Option<String>,
}

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
}

impl WebActivitySegmentInput {
    pub fn from_sanitized(input: SanitizedWebActivityInput, browser_exe_name: String) -> Self {
        Self {
            browser_client_id: input.browser_client_id,
            browser_kind: input.browser_kind,
            browser_exe_name,
            domain: input.domain,
            normalized_domain: input.normalized_domain,
            url: input.url,
            title: input.title,
            favicon_url: input.favicon_url,
        }
    }
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
    let active = load_active_segment_tx(&mut tx).await?;

    if let Some(active) = active {
        if is_same_segment_identity(&active, input) {
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
            return Ok(false);
        }

        finish_segment_tx(&mut tx, active.id, active.start_time, timestamp_ms).await?;
    }

    sqlx::query(
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
    let active = load_active_segment_tx(&mut tx).await?;
    let Some(active) = active else {
        tx.rollback().await?;
        return Ok(false);
    };

    finish_segment_tx(&mut tx, active.id, active.start_time, timestamp_ms).await?;
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
    finish_segment_tx(&mut tx, active.id, active.start_time, timestamp_ms).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn fetch_all_for_backup(
    pool: &Pool<Sqlite>,
) -> Result<Vec<BackupWebActivitySegment>, String> {
    let rows = sqlx::query(
        "SELECT id, browser_client_id, browser_kind, browser_exe_name, domain,
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
) -> Result<(), String> {
    for segment in segments {
        sqlx::query(
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
) -> Result<(), String> {
    for segment in segments {
        sqlx::query(
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

async fn load_active_segment_tx(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<Option<ActiveWebActivitySegment>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, browser_client_id, browser_kind, browser_exe_name, normalized_domain,
                url, title, start_time
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
    active.browser_client_id == input.browser_client_id
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
        pool.execute(db_schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
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
            insert_missing_for_restore(&mut tx, &backup).await.unwrap();
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
                !upsert_active_segment(&pool, &input("github.com", "Issue"), 2_000)
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
