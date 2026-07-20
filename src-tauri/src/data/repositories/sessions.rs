use super::session_title_samples;
use crate::domain::backup::BackupSession;
use crate::domain::tracking::{resolve_app_override_executable, ActiveSessionSnapshot};
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::collections::HashMap;

pub async fn fetch_all_for_backup(pool: &Pool<Sqlite>) -> Result<Vec<BackupSession>, String> {
    let rows = sqlx::query(
        "SELECT id, app_name, exe_name, window_title, start_time, end_time, duration,
                continuity_group_start_time
         FROM sessions
         ORDER BY id ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read sessions for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupSession {
            id: row.get("id"),
            app_name: row.get("app_name"),
            exe_name: row.get("exe_name"),
            window_title: row.get("window_title"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
            duration: row.get("duration"),
            continuity_group_start_time: row.get("continuity_group_start_time"),
        })
        .collect())
}

pub async fn clear_for_restore(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("DELETE FROM sessions")
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to clear sessions before restore: {error}"))?;
    Ok(())
}

pub async fn insert_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    sessions: &[BackupSession],
) -> Result<(), String> {
    for session in sessions {
        sqlx::query(
            "INSERT INTO sessions (
               id, app_name, exe_name, window_title, start_time, end_time, duration,
               continuity_group_start_time
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(session.id)
        .bind(&session.app_name)
        .bind(&session.exe_name)
        .bind(&session.window_title)
        .bind(session.start_time)
        .bind(session.end_time)
        .bind(session.duration)
        .bind(
            session
                .continuity_group_start_time
                .unwrap_or(session.start_time),
        )
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore sessions: {error}"))?;
    }

    Ok(())
}

pub async fn insert_missing_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    sessions: &[BackupSession],
) -> Result<(), String> {
    for session in sessions {
        sqlx::query(
            "INSERT INTO sessions (
               app_name, exe_name, window_title, start_time, end_time, duration,
               continuity_group_start_time
             )
             SELECT ?, ?, ?, ?, ?, ?, ?
             WHERE NOT EXISTS (
               SELECT 1
               FROM sessions
               WHERE LOWER(exe_name) = LOWER(?)
                 AND start_time = ?
             )
               AND (? IS NOT NULL OR NOT EXISTS (
                 SELECT 1 FROM sessions WHERE end_time IS NULL
               ))",
        )
        .bind(&session.app_name)
        .bind(&session.exe_name)
        .bind(&session.window_title)
        .bind(session.start_time)
        .bind(session.end_time)
        .bind(session.duration)
        .bind(
            session
                .continuity_group_start_time
                .unwrap_or(session.start_time),
        )
        .bind(&session.exe_name)
        .bind(session.start_time)
        .bind(session.end_time)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to merge restore sessions: {error}"))?;
    }

    Ok(())
}

pub async fn resolve_restore_session_id_map(
    tx: &mut Transaction<'_, Sqlite>,
    sessions: &[BackupSession],
) -> Result<HashMap<i64, i64>, String> {
    let mut session_id_map = HashMap::new();

    for session in sessions {
        let restored_id: Option<i64> = sqlx::query_scalar(
            "SELECT id
             FROM sessions
             WHERE LOWER(exe_name) = LOWER(?)
               AND start_time = ?
             ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id ASC
             LIMIT 1",
        )
        .bind(&session.exe_name)
        .bind(session.start_time)
        .bind(session.id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|error| format!("failed to resolve restored session id: {error}"))?;

        if let Some(restored_id) = restored_id {
            session_id_map.insert(session.id, restored_id);
        }
    }

    Ok(session_id_map)
}

pub async fn normalize_closed_session_durations(pool: &Pool<Sqlite>) -> Result<u64, sqlx::Error> {
    let result = sqlx::query(
        "UPDATE sessions
         SET duration = MAX(0, end_time - start_time)
         WHERE end_time IS NOT NULL
           AND COALESCE(duration, -1) <> MAX(0, end_time - start_time)",
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected())
}

pub async fn load_active_session(
    pool: &Pool<Sqlite>,
) -> Result<Option<ActiveSessionSnapshot>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT start_time,
                COALESCE(continuity_group_start_time, start_time) AS continuity_group_start_time
         FROM sessions
         WHERE end_time IS NULL
         ORDER BY start_time DESC, id DESC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| ActiveSessionSnapshot {
        start_time: row.get("start_time"),
        continuity_group_start_time: row.get("continuity_group_start_time"),
    }))
}

pub async fn end_active_sessions(
    pool: &Pool<Sqlite>,
    raw_end_time: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let did_end = end_active_sessions_tx(&mut tx, raw_end_time).await?;
    tx.commit().await?;
    Ok(did_end)
}

pub async fn end_active_session_for_exe(
    pool: &Pool<Sqlite>,
    target_exe_name: &str,
    raw_end_time: i64,
) -> Result<bool, sqlx::Error> {
    let Some(target) = resolve_app_override_executable(target_exe_name) else {
        return Ok(false);
    };

    let mut tx = pool.begin().await?;
    let active = sqlx::query(
        "SELECT id, start_time, exe_name
         FROM sessions
         WHERE end_time IS NULL
         ORDER BY start_time DESC, id DESC
         LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some(active) = active else {
        tx.rollback().await?;
        return Ok(false);
    };

    let exe_name: String = active.get("exe_name");
    if resolve_app_override_executable(&exe_name).as_deref() != Some(target.as_str()) {
        tx.rollback().await?;
        return Ok(false);
    }

    let id: i64 = active.get("id");
    let start_time: i64 = active.get("start_time");
    let end_time = raw_end_time.max(start_time);
    sqlx::query("UPDATE sessions SET end_time = ?, duration = ? WHERE id = ?")
        .bind(end_time)
        .bind(end_time - start_time)
        .bind(id)
        .execute(&mut *tx)
        .await?;
    session_title_samples::finish_active_title_sample_tx(&mut tx, id, end_time).await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn disable_active_title_for_exe(
    pool: &Pool<Sqlite>,
    target_exe_name: &str,
    timestamp_ms: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let active: Option<(i64, String, String)> = sqlx::query_as(
        "SELECT id, exe_name, COALESCE(window_title, '') FROM sessions WHERE end_time IS NULL ORDER BY start_time DESC, id DESC LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some((session_id, exe_name, window_title)) = active else {
        tx.rollback().await?;
        return Ok(false);
    };
    let target = resolve_app_override_executable(target_exe_name);
    if target.is_none() || resolve_app_override_executable(&exe_name) != target {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query("UPDATE sessions SET window_title = '' WHERE id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
    let changed = crate::data::repositories::session_title_samples::finish_active_title_sample_tx(
        &mut tx,
        session_id,
        timestamp_ms,
    )
    .await?;
    tx.commit().await?;
    Ok(changed || !window_title.is_empty())
}

pub async fn disable_active_title(
    pool: &Pool<Sqlite>,
    timestamp_ms: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let active = sqlx::query_as::<_, (i64, String)>(
        "SELECT id, COALESCE(window_title, '') FROM sessions WHERE end_time IS NULL ORDER BY start_time DESC, id DESC LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some((session_id, window_title)) = active else {
        tx.rollback().await?;
        return Ok(false);
    };
    sqlx::query("UPDATE sessions SET window_title = '' WHERE id = ?")
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
    let changed = crate::data::repositories::session_title_samples::finish_active_title_sample_tx(
        &mut tx,
        session_id,
        timestamp_ms,
    )
    .await?;
    tx.commit().await?;
    Ok(changed || !window_title.is_empty())
}

async fn end_active_sessions_tx(
    tx: &mut Transaction<'_, Sqlite>,
    raw_end_time: i64,
) -> Result<bool, sqlx::Error> {
    let active_sessions = sqlx::query(
        "SELECT id, start_time
         FROM sessions
         WHERE end_time IS NULL
         ORDER BY start_time DESC, id DESC",
    )
    .fetch_all(&mut **tx)
    .await?;

    if active_sessions.is_empty() {
        return Ok(false);
    }

    for session in active_sessions {
        let id: i64 = session.get("id");
        let start_time: i64 = session.get("start_time");
        let end_time = raw_end_time.max(start_time);
        let duration = end_time - start_time;

        sqlx::query(
            "UPDATE sessions
             SET end_time = ?, duration = ?
             WHERE id = ?",
        )
        .bind(end_time)
        .bind(duration)
        .bind(id)
        .execute(&mut **tx)
        .await?;

        session_title_samples::finish_active_title_sample_tx(tx, id, end_time).await?;
    }

    Ok(true)
}

pub async fn refresh_active_session_metadata(
    pool: &Pool<Sqlite>,
    exe_name: &str,
    window_title: &str,
    timestamp_ms: i64,
) -> Result<bool, sqlx::Error> {
    let Some(row) = sqlx::query(
        "SELECT id,
                start_time,
                exe_name,
                COALESCE(window_title, '') AS window_title
         FROM sessions
         WHERE end_time IS NULL
         ORDER BY start_time DESC, id DESC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await?
    else {
        return Ok(false);
    };

    let session_id: i64 = row.get("id");
    let active_exe_name: String = row.get("exe_name");
    let active_window_title: String = row.get("window_title");

    if !active_exe_name.eq_ignore_ascii_case(exe_name) || active_window_title == window_title {
        return Ok(false);
    }

    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE sessions
         SET window_title = ?
         WHERE id = ?",
    )
    .bind(window_title)
    .bind(session_id)
    .execute(&mut *tx)
    .await?;

    session_title_samples::replace_active_title_sample_tx(
        &mut tx,
        session_id,
        window_title,
        timestamp_ms,
    )
    .await?;

    tx.commit().await?;
    Ok(true)
}

pub async fn start_session(
    pool: &Pool<Sqlite>,
    app_name: &str,
    exe_name: &str,
    window_title: &str,
    start_time: i64,
    continuity_group_start_time: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let active_session: Option<(String, String)> = sqlx::query_as(
        "SELECT exe_name, COALESCE(window_title, '')
         FROM sessions
         WHERE end_time IS NULL
         ORDER BY start_time DESC, id DESC
         LIMIT 1",
    )
    .fetch_optional(&mut *tx)
    .await?;

    if let Some((active_exe_name, active_window_title)) = active_session {
        if active_exe_name.eq_ignore_ascii_case(exe_name) && active_window_title == window_title {
            tx.rollback().await?;
            return Ok(false);
        }

        end_active_sessions_tx(&mut tx, start_time).await?;
    }

    let result = sqlx::query(
        "INSERT INTO sessions (
            app_name,
            exe_name,
            window_title,
            start_time,
            continuity_group_start_time
         ) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(app_name)
    .bind(exe_name)
    .bind(window_title)
    .bind(start_time)
    .bind(continuity_group_start_time)
    .execute(&mut *tx)
    .await?;
    let session_id = result.last_insert_rowid();

    session_title_samples::start_title_sample_tx(&mut tx, session_id, window_title, start_time)
        .await?;

    tx.commit().await?;
    Ok(true)
}

#[cfg(test)]
mod exclusion_tests {
    use super::*;
    use crate::data::schema as db_schema;
    use sqlx::{Executor, SqlitePool};

    async fn setup_test_db() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[test]
    fn conditional_exe_seal_closes_matching_session_and_title_only() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            assert!(start_session(&pool, "QQ", "QQ.exe", "Chat", 1_000, 1_000)
                .await
                .unwrap());

            assert!(!end_active_session_for_exe(&pool, "code.exe", 2_000)
                .await
                .unwrap());
            assert!(end_active_session_for_exe(&pool, "qq", 3_000)
                .await
                .unwrap());

            let session_end: Option<i64> =
                sqlx::query_scalar("SELECT end_time FROM sessions LIMIT 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let title_end: Option<i64> =
                sqlx::query_scalar("SELECT end_time FROM session_title_samples LIMIT 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(session_end, Some(3_000));
            assert_eq!(title_end, Some(3_000));
        });
    }

    #[test]
    fn merge_keeps_current_evolved_and_active_sessions() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
                 VALUES ('App', 'app.exe', 'Current', 100, 300, 200),
                        ('Live', 'live.exe', 'Current live', 400, NULL, NULL)",
            )
            .execute(&pool)
            .await
            .unwrap();
            let backup = vec![
                BackupSession {
                    id: 10,
                    app_name: "App".into(),
                    exe_name: "app.exe".into(),
                    window_title: Some("Old".into()),
                    start_time: 100,
                    end_time: Some(200),
                    duration: Some(100),
                    continuity_group_start_time: Some(100),
                },
                BackupSession {
                    id: 11,
                    app_name: "Other".into(),
                    exe_name: "other.exe".into(),
                    window_title: Some("Backup live".into()),
                    start_time: 500,
                    end_time: None,
                    duration: None,
                    continuity_group_start_time: Some(500),
                },
            ];
            let mut tx = pool.begin().await.unwrap();
            insert_missing_for_restore(&mut tx, &backup).await.unwrap();
            tx.commit().await.unwrap();
            let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, 2);
        });
    }
}
