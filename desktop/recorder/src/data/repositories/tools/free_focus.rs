use crate::domain::free_focus::{FreeFocusAction, FreeFocusTask, RestMode};
use sqlx::{Pool, Row, Sqlite, Transaction};

#[cfg(test)]
#[path = "free_focus_tests.rs"]
mod tests;

fn map(row: sqlx::sqlite::SqliteRow) -> FreeFocusTask {
    FreeFocusTask {
        id: row.get("id"),
        label: row.get("label"),
        rest_mode: if row.get::<String, _>("rest_mode") == "ratio" {
            RestMode::Ratio
        } else {
            RestMode::Fixed
        },
        rest_minutes: row.get("rest_minutes"),
        rest_ratio: row.get("rest_ratio"),
        phase: row.get("phase"),
        status: row.get("status"),
        elapsed_ms: row.get("elapsed_ms"),
        rest_remaining_ms: row.get("rest_remaining_ms"),
        started_at: row.get("started_at"),
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        deleted_at: row.get("deleted_at"),
    }
}

pub(crate) async fn fetch(pool: &Pool<Sqlite>) -> Result<Vec<FreeFocusTask>, String> {
    Ok(
        sqlx::query("SELECT * FROM tool_free_focus ORDER BY created_at,id")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(map)
            .collect(),
    )
}

async fn read(tx: &mut Transaction<'_, Sqlite>, id: i64) -> Result<FreeFocusTask, String> {
    sqlx::query("SELECT * FROM tool_free_focus WHERE id=? AND deleted_at IS NULL")
        .bind(id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| e.to_string())?
        .map(map)
        .ok_or_else(|| "free focus unavailable".into())
}

pub(crate) async fn pause_active(tx: &mut Transaction<'_, Sqlite>, now: i64) -> Result<(), String> {
    let rows =
        sqlx::query("SELECT * FROM tool_free_focus WHERE status='running' AND deleted_at IS NULL")
            .fetch_all(&mut **tx)
            .await
            .map_err(|e| e.to_string())?;
    for row in rows {
        let mut task = map(row);
        task.elapsed_ms = task.elapsed_at(now);
        task.rest_remaining_ms = task.remaining_at(now);
        task.status = "paused".into();
        task.started_at = None;
        write(tx, &task, now).await?;
    }
    Ok(())
}

pub(crate) async fn recover_single_active(pool: &Pool<Sqlite>, now: i64) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query("SELECT * FROM tool_free_focus WHERE status='running' AND deleted_at IS NULL ORDER BY updated_at DESC,id DESC")
        .fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
    let pomodoro_updated: Option<i64> = sqlx::query_scalar("SELECT MAX(r.updated_at) FROM tool_pomodoro_runs r LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id WHERE r.status='running' AND t.deleted_at IS NULL")
        .fetch_one(&mut *tx).await.map_err(|e| e.to_string())?;
    let mut tasks = rows.into_iter().map(map);
    if let Some(first) = tasks.next() {
        if pomodoro_updated.is_some_and(|updated| updated >= first.updated_at) {
            pause_active(&mut tx, now).await?;
        } else {
            super::pomodoro_tasks::pause_active(&mut tx, now).await?;
            for mut task in tasks {
                task.elapsed_ms = task.elapsed_at(now);
                task.rest_remaining_ms = task.remaining_at(now);
                task.status = "paused".into();
                task.started_at = None;
                write(&mut tx, &task, now).await?;
            }
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}

async fn write(
    tx: &mut Transaction<'_, Sqlite>,
    t: &FreeFocusTask,
    now: i64,
) -> Result<(), String> {
    sqlx::query("UPDATE tool_free_focus SET label=?,rest_mode=?,rest_minutes=?,rest_ratio=?,phase=?,status=?,elapsed_ms=?,rest_remaining_ms=?,started_at=?,updated_at=?,deleted_at=? WHERE id=?")
        .bind(&t.label).bind(if t.rest_mode==RestMode::Fixed {"fixed"} else {"ratio"}).bind(t.rest_minutes).bind(t.rest_ratio)
        .bind(&t.phase).bind(&t.status).bind(t.elapsed_ms).bind(t.rest_remaining_ms).bind(t.started_at)
        .bind(now.max(t.updated_at.saturating_add(1))).bind(t.deleted_at).bind(t.id).execute(&mut **tx).await.map_err(|e|e.to_string())?;
    Ok(())
}

pub(crate) async fn apply(
    pool: &Pool<Sqlite>,
    action: FreeFocusAction,
    now: i64,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    match action {
        FreeFocusAction::Save {
            id,
            label,
            rest_mode,
            rest_minutes,
            rest_ratio,
        } => {
            if label.trim().chars().count() > 160
                || !(1..=120).contains(&rest_minutes)
                || !(1..=20).contains(&rest_ratio)
            {
                return Err("invalid free focus settings".into());
            }
            if let Some(id) = id {
                let mut task = read(&mut tx, id).await?;
                if task.status == "running" {
                    return Err("pause before editing".into());
                }
                task.label = label.trim().into();
                task.rest_mode = rest_mode;
                task.rest_minutes = rest_minutes;
                task.rest_ratio = rest_ratio;
                // The current break keeps its prepared duration; new settings apply to the next break.
                write(&mut tx, &task, now).await?;
            } else {
                sqlx::query("INSERT INTO tool_free_focus(label,rest_mode,rest_minutes,rest_ratio,created_at,updated_at) VALUES(?,?,?,?,(SELECT MAX(?,COALESCE(MAX(created_at)+1,?)) FROM tool_free_focus),?)")
                    .bind(label.trim()).bind(if rest_mode==RestMode::Fixed {"fixed"} else {"ratio"}).bind(rest_minutes).bind(rest_ratio).bind(now).bind(now).bind(now)
                    .execute(&mut *tx).await.map_err(|e|e.to_string())?;
            }
        }
        action => {
            let id = match &action {
                FreeFocusAction::Resume { id }
                | FreeFocusAction::StartNext { id, .. }
                | FreeFocusAction::Pause { id }
                | FreeFocusAction::Finish { id }
                | FreeFocusAction::Reset { id }
                | FreeFocusAction::Delete { id } => *id,
                FreeFocusAction::Save { .. } => unreachable!(),
            };
            let mut task = read(&mut tx, id).await?;
            if let FreeFocusAction::StartNext {
                expected_updated_at,
                ..
            } = &action
            {
                if task.updated_at != *expected_updated_at
                    || !matches!(task.status.as_str(), "paused" | "completed")
                {
                    return Err("free focus notification is stale".into());
                }
            }
            match action {
                FreeFocusAction::Resume { .. } | FreeFocusAction::StartNext { .. } => {
                    if task.status == "running" {
                        return Ok(());
                    }
                    pause_active(&mut tx, now).await?;
                    super::pomodoro_tasks::pause_active(&mut tx, now).await?;
                    if task.status == "completed" {
                        task.phase = "focus".into();
                        task.elapsed_ms = 0;
                        task.rest_remaining_ms = 0;
                    }
                    task.status = "running".into();
                    task.started_at = Some(now);
                }
                FreeFocusAction::Pause { .. } => {
                    if task.status != "running" {
                        return Ok(());
                    }
                    task.elapsed_ms = task.elapsed_at(now);
                    task.rest_remaining_ms = task.remaining_at(now);
                    task.status = "paused".into();
                    task.started_at = None;
                }
                FreeFocusAction::Finish { .. } => {
                    if task.phase != "focus"
                        || !matches!(task.status.as_str(), "running" | "paused")
                    {
                        return Err("free focus is not active".into());
                    }
                    task.rest_remaining_ms = task.rest_duration(now);
                    task.elapsed_ms = task.elapsed_at(now);
                    task.phase = "break".into();
                    task.status = "paused".into();
                    task.started_at = None;
                }
                FreeFocusAction::Reset { .. } => {
                    task.phase = "focus".into();
                    task.status = "idle".into();
                    task.elapsed_ms = 0;
                    task.rest_remaining_ms = 0;
                    task.started_at = None;
                }
                FreeFocusAction::Delete { .. } => {
                    task.elapsed_ms = task.elapsed_at(now);
                    task.rest_remaining_ms = task.remaining_at(now);
                    task.status = "paused".into();
                    task.started_at = None;
                    task.deleted_at = Some(now);
                }
                FreeFocusAction::Save { .. } => unreachable!(),
            }
            write(&mut tx, &task, now).await?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}

pub(crate) async fn complete_due(
    tx: &mut Transaction<'_, Sqlite>,
    now: i64,
) -> Result<Vec<FreeFocusTask>, String> {
    let rows=sqlx::query("SELECT * FROM tool_free_focus WHERE status='running' AND phase='break' AND deleted_at IS NULL").fetch_all(&mut **tx).await.map_err(|e|e.to_string())?;
    let mut completed = vec![];
    for row in rows {
        let mut task = map(row);
        if task.remaining_at(now) > 0 {
            continue;
        }
        task.status = "completed".into();
        task.phase = "focus".into();
        task.rest_remaining_ms = 0;
        task.started_at = None;
        write(tx, &task, now).await?;
        completed.push(read(tx, task.id).await?);
    }
    Ok(completed)
}

pub(crate) async fn restore(
    tx: &mut Transaction<'_, Sqlite>,
    tasks: &[FreeFocusTask],
) -> Result<(), String> {
    for task in tasks {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tool_free_focus WHERE created_at=?)")
                .bind(task.created_at)
                .fetch_one(&mut **tx)
                .await
                .map_err(|e| e.to_string())?;
        if exists {
            continue;
        }
        // Imported clocks wait for explicit resume and do not count time since the backup.
        sqlx::query("INSERT INTO tool_free_focus(label,rest_mode,rest_minutes,rest_ratio,phase,status,elapsed_ms,rest_remaining_ms,started_at,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?)")
            .bind(&task.label).bind(if task.rest_mode==RestMode::Fixed {"fixed"} else {"ratio"}).bind(task.rest_minutes).bind(task.rest_ratio).bind(&task.phase)
            .bind(if task.status=="running" {"paused"} else {&task.status}).bind(task.elapsed_ms).bind(task.rest_remaining_ms).bind(task.created_at).bind(task.updated_at).bind(task.deleted_at)
            .execute(&mut **tx).await.map_err(|e|e.to_string())?;
    }
    Ok(())
}
