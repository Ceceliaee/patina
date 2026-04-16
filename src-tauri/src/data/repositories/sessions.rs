use crate::domain::backup::BackupSession;
use crate::domain::tracking::ActiveSessionSnapshot;
use sqlx::{Pool, Row, Sqlite, Transaction};

pub async fn fetch_all_for_backup(pool: &Pool<Sqlite>) -> Result<Vec<BackupSession>, String> {
    let rows = sqlx::query(
        "SELECT id, app_name, exe_name, window_title, start_time, end_time, duration
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
               id, app_name, exe_name, window_title, start_time, end_time, duration
             ) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(session.id)
        .bind(&session.app_name)
        .bind(&session.exe_name)
        .bind(&session.window_title)
        .bind(session.start_time)
        .bind(session.end_time)
        .bind(session.duration)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to restore sessions: {error}"))?;
    }

    Ok(())
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
        "SELECT start_time, exe_name, COALESCE(window_title, '') AS window_title
         FROM sessions
         WHERE end_time IS NULL
         ORDER BY start_time DESC, id DESC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|row| ActiveSessionSnapshot {
        start_time: row.get("start_time"),
        exe_name: row.get("exe_name"),
        window_title: row.get("window_title"),
    }))
}

pub async fn end_active_sessions(
    pool: &Pool<Sqlite>,
    raw_end_time: i64,
) -> Result<bool, sqlx::Error> {
    let active_sessions = sqlx::query(
        "SELECT id, start_time
         FROM sessions
         WHERE end_time IS NULL
         ORDER BY start_time DESC, id DESC",
    )
    .fetch_all(pool)
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
        .execute(pool)
        .await?;
    }

    Ok(true)
}

pub async fn refresh_active_session_metadata(
    pool: &Pool<Sqlite>,
    exe_name: &str,
    window_title: &str,
) -> Result<bool, sqlx::Error> {
    let Some(active_session) = load_active_session(pool).await? else {
        return Ok(false);
    };

    if !active_session.exe_name.eq_ignore_ascii_case(exe_name)
        || active_session.window_title == window_title
    {
        return Ok(false);
    }

    sqlx::query(
        "UPDATE sessions
         SET window_title = ?
         WHERE end_time IS NULL",
    )
    .bind(window_title)
    .execute(pool)
    .await?;

    Ok(true)
}

pub async fn start_session(
    pool: &Pool<Sqlite>,
    app_name: &str,
    exe_name: &str,
    window_title: &str,
    start_time: i64,
) -> Result<bool, sqlx::Error> {
    if let Some(existing_session) = load_active_session(pool).await? {
        if existing_session.exe_name.eq_ignore_ascii_case(exe_name)
            && existing_session.window_title == window_title
        {
            return Ok(false);
        }
    }

    sqlx::query(
        "INSERT INTO sessions (app_name, exe_name, window_title, start_time)
         VALUES (?, ?, ?, ?)",
    )
    .bind(app_name)
    .bind(exe_name)
    .bind(window_title)
    .bind(start_time)
    .execute(pool)
    .await?;

    Ok(true)
}
