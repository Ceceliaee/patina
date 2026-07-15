use crate::domain::backup::BackupTitleSample;
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::HashMap;

pub async fn fetch_all_for_backup(pool: &Pool<Sqlite>) -> Result<Vec<BackupTitleSample>, String> {
    let rows = sqlx::query(
        "SELECT id, session_id, title, start_time, end_time
         FROM session_title_samples
         ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read title samples for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupTitleSample {
            id: row.get("id"),
            session_id: row.get("session_id"),
            title: row.get("title"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
        })
        .collect())
}

pub async fn clear_for_restore(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("DELETE FROM session_title_samples")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear title samples before restore: {error}"))?;
    Ok(())
}

pub async fn insert_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    title_samples: &[BackupTitleSample],
    session_id_map: &HashMap<i64, i64>,
) -> Result<(), String> {
    for sample in title_samples {
        let title = sample.title.trim();
        if title.is_empty() {
            continue;
        }
        let Some(restored_session_id) = session_id_map.get(&sample.session_id).copied() else {
            continue;
        };

        sqlx::query(
            "INSERT INTO session_title_samples (id, session_id, title, start_time, end_time)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(sample.id)
        .bind(restored_session_id)
        .bind(title)
        .bind(sample.start_time)
        .bind(sample.end_time)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore title samples: {error}"))?;
    }

    Ok(())
}

pub async fn insert_missing_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    title_samples: &[BackupTitleSample],
    session_id_map: &HashMap<i64, i64>,
) -> Result<(), String> {
    for sample in title_samples {
        let title = sample.title.trim();
        if title.is_empty() {
            continue;
        }
        let Some(restored_session_id) = session_id_map.get(&sample.session_id).copied() else {
            continue;
        };

        sqlx::query(
            "INSERT INTO session_title_samples (session_id, title, start_time, end_time)
             SELECT ?, ?, ?, ?
             WHERE NOT EXISTS (
                 SELECT 1
                 FROM session_title_samples
                 WHERE session_id = ?
                   AND title = ?
                   AND start_time = ?
               )",
        )
        .bind(restored_session_id)
        .bind(title)
        .bind(sample.start_time)
        .bind(sample.end_time)
        .bind(restored_session_id)
        .bind(title)
        .bind(sample.start_time)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to merge restore title samples: {error}"))?;
    }

    Ok(())
}

#[cfg(test)]
pub async fn start_title_sample(
    pool: &Pool<Sqlite>,
    session_id: i64,
    title: &str,
    start_time: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let did_insert = start_title_sample_tx(&mut tx, session_id, title, start_time).await?;
    tx.commit().await?;
    Ok(did_insert)
}

#[cfg(test)]
pub async fn finish_active_title_sample(
    pool: &Pool<Sqlite>,
    session_id: i64,
    end_time: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let did_finish = finish_active_title_sample_tx(&mut tx, session_id, end_time).await?;
    tx.commit().await?;
    Ok(did_finish)
}

#[cfg(test)]
pub async fn replace_active_title_sample(
    pool: &Pool<Sqlite>,
    session_id: i64,
    title: &str,
    timestamp_ms: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let did_replace =
        replace_active_title_sample_tx(&mut tx, session_id, title, timestamp_ms).await?;
    tx.commit().await?;
    Ok(did_replace)
}

pub async fn start_title_sample_tx(
    tx: &mut Transaction<'_, Sqlite>,
    session_id: i64,
    title: &str,
    raw_start_time: i64,
) -> Result<bool, sqlx::Error> {
    let title = title.trim();
    if title.is_empty() {
        return Ok(false);
    }

    let Some(session_start_time) = sqlx::query_scalar::<_, i64>(
        "SELECT start_time
         FROM sessions
         WHERE id = ?
         LIMIT 1",
    )
    .bind(session_id)
    .fetch_optional(&mut **tx)
    .await?
    else {
        return Ok(false);
    };

    let start_time = raw_start_time.max(session_start_time);
    sqlx::query(
        "INSERT INTO session_title_samples (session_id, title, start_time)
         VALUES (?, ?, ?)",
    )
    .bind(session_id)
    .bind(title)
    .bind(start_time)
    .execute(&mut **tx)
    .await?;

    Ok(true)
}

pub async fn finish_active_title_sample_tx(
    tx: &mut Transaction<'_, Sqlite>,
    session_id: i64,
    raw_end_time: i64,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE session_title_samples
         SET end_time = CASE WHEN ? < start_time THEN start_time ELSE ? END
         WHERE session_id = ?
           AND end_time IS NULL",
    )
    .bind(raw_end_time)
    .bind(raw_end_time)
    .bind(session_id)
    .execute(&mut **tx)
    .await?;

    Ok(result.rows_affected() > 0)
}

pub async fn replace_active_title_sample_tx(
    tx: &mut Transaction<'_, Sqlite>,
    session_id: i64,
    title: &str,
    timestamp_ms: i64,
) -> Result<bool, sqlx::Error> {
    let title = title.trim();
    let active_title: Option<String> = sqlx::query_scalar(
        "SELECT title
         FROM session_title_samples
         WHERE session_id = ?
           AND end_time IS NULL
         ORDER BY start_time DESC, id DESC
         LIMIT 1",
    )
    .bind(session_id)
    .fetch_optional(&mut **tx)
    .await?;

    if active_title.as_deref() == Some(title) {
        return Ok(false);
    }

    let mut did_mutate = finish_active_title_sample_tx(tx, session_id, timestamp_ms).await?;
    did_mutate |= start_title_sample_tx(tx, session_id, title, timestamp_ms).await?;

    Ok(did_mutate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema as db_schema;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(
            "INSERT INTO sessions (id, app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time)
             VALUES (1, 'Editor', 'editor.exe', 'Doc A', 1000, NULL, NULL, 1000)",
        )
        .await
        .unwrap();
        pool
    }

    #[test]
    fn new_title_sample_is_inserted_for_non_empty_title() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;

            assert!(start_title_sample(&pool, 1, " Doc A ", 900).await.unwrap());

            let row: (String, i64) = sqlx::query_as(
                "SELECT title, start_time FROM session_title_samples WHERE session_id = 1",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(row, ("Doc A".to_string(), 1000));
        });
    }

    #[test]
    fn unchanged_title_does_not_insert_duplicate_sample() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_title_sample(&pool, 1, "Doc A", 1000).await.unwrap();

            assert!(!replace_active_title_sample(&pool, 1, "Doc A", 2000)
                .await
                .unwrap());

            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session_title_samples")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 1);
        });
    }

    #[test]
    fn changed_title_closes_previous_sample_and_starts_next() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_title_sample(&pool, 1, "Doc A", 1000).await.unwrap();

            assert!(replace_active_title_sample(&pool, 1, "Doc B", 2000)
                .await
                .unwrap());

            let rows: Vec<(String, i64, Option<i64>)> = sqlx::query_as(
                "SELECT title, start_time, end_time
                 FROM session_title_samples
                 ORDER BY id ASC",
            )
            .fetch_all(&pool)
            .await
            .unwrap();

            assert_eq!(
                rows,
                vec![
                    ("Doc A".to_string(), 1000, Some(2000)),
                    ("Doc B".to_string(), 2000, None),
                ]
            );
        });
    }

    #[test]
    fn session_end_closes_last_active_sample() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            start_title_sample(&pool, 1, "Doc A", 1000).await.unwrap();

            assert!(finish_active_title_sample(&pool, 1, 5000).await.unwrap());

            let end_time: Option<i64> =
                sqlx::query_scalar("SELECT end_time FROM session_title_samples WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(end_time, Some(5000));
        });
    }

    #[test]
    fn malicious_title_is_stored_as_data() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            let title = "'; DROP TABLE session_title_samples; --";

            start_title_sample(&pool, 1, title, 1000).await.unwrap();

            let stored: String =
                sqlx::query_scalar("SELECT title FROM session_title_samples WHERE id = 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session_title_samples")
                .fetch_one(&pool)
                .await
                .unwrap();

            assert_eq!(stored, title);
            assert_eq!(count, 1);
        });
    }
}
