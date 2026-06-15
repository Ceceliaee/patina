use crate::domain::backup::BackupWebActivitySegment;
use crate::domain::web_activity::{
    parse_domain_override_enabled, SanitizedWebActivityInput,
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

pub async fn clear_for_restore(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
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
                  AND browser_exe_name = ?
                  AND normalized_domain = ?
                  AND COALESCE(url, '') = COALESCE(?, '')
                  AND COALESCE(title, '') = COALESCE(?, '')
                  AND start_time = ?
                  AND COALESCE(end_time, -1) = COALESCE(?, -1)
             )",
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
        .bind(&segment.normalized_domain)
        .bind(&segment.url)
        .bind(&segment.title)
        .bind(segment.start_time)
        .bind(segment.end_time)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to merge restore web activity: {error}"))?;
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
        pool
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
}
