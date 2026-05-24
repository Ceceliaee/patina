use super::session_title_samples;
use crate::domain::backup::BackupSession;
use crate::domain::tracking::ActiveSessionSnapshot;
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
               WHERE app_name = ?
                 AND exe_name = ?
                 AND COALESCE(window_title, '') = COALESCE(?, '')
                 AND start_time = ?
                 AND COALESCE(end_time, -1) = COALESCE(?, -1)
                 AND COALESCE(duration, -1) = COALESCE(?, -1)
             )",
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
        .bind(&session.app_name)
        .bind(&session.exe_name)
        .bind(&session.window_title)
        .bind(session.start_time)
        .bind(session.end_time)
        .bind(session.duration)
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
             WHERE app_name = ?
               AND exe_name = ?
               AND COALESCE(window_title, '') = COALESCE(?, '')
               AND start_time = ?
               AND COALESCE(end_time, -1) = COALESCE(?, -1)
               AND COALESCE(duration, -1) = COALESCE(?, -1)
             ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id ASC
             LIMIT 1",
        )
        .bind(&session.app_name)
        .bind(&session.exe_name)
        .bind(&session.window_title)
        .bind(session.start_time)
        .bind(session.end_time)
        .bind(session.duration)
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
                COALESCE(continuity_group_start_time, start_time) AS continuity_group_start_time,
                exe_name,
                COALESCE(window_title, '') AS window_title
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
        exe_name: row.get("exe_name"),
        window_title: row.get("window_title"),
    }))
}

pub async fn end_active_sessions(
    pool: &Pool<Sqlite>,
    raw_end_time: i64,
) -> Result<bool, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let active_sessions = sqlx::query(
        "SELECT id, start_time
         FROM sessions
         WHERE end_time IS NULL
         ORDER BY start_time DESC, id DESC",
    )
    .fetch_all(&mut *tx)
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
        .execute(&mut *tx)
        .await?;

        session_title_samples::finish_active_title_sample_tx(&mut tx, id, end_time).await?;
    }

    tx.commit().await?;
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
    if let Some(existing_session) = load_active_session(pool).await? {
        if existing_session.exe_name.eq_ignore_ascii_case(exe_name)
            && existing_session.window_title == window_title
        {
            return Ok(false);
        }
    }

    let mut tx = pool.begin().await?;
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
