use crate::domain::focus_history::{FocusGroup, FocusKind, FocusSpan};

#[cfg(test)]
#[path = "focus_history_tests.rs"]
mod tests;
use sqlx::{Row, Sqlite, SqlitePool, Transaction};

pub(crate) async fn read(
    pool: &SqlitePool,
    kind: FocusKind,
    id: i64,
) -> Result<Vec<FocusGroup>, String> {
    let rows = sqlx::query(
        "SELECT g.group_key,g.started_at AS group_start,g.outcome,s.phase,s.cycle,s.rounds,
        s.started_at,s.ended_at,s.phase_finished_at FROM focus_history_groups g
        JOIN focus_history_spans s USING(group_key) WHERE g.kind=? AND g.task_id=?
        ORDER BY g.started_at DESC,g.rowid DESC,s.id",
    )
    .bind(kind.as_str())
    .bind(id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut groups: Vec<FocusGroup> = Vec::new();
    for row in rows {
        let key: String = row.get("group_key");
        if groups.last().is_none_or(|g| g.key != key) {
            groups.push(FocusGroup {
                key,
                started_at: row.get("group_start"),
                outcome: row.get("outcome"),
                spans: vec![],
            });
        }
        groups.last_mut().unwrap().spans.push(FocusSpan {
            phase: row.get("phase"),
            cycle: row.get("cycle"),
            rounds: row.get("rounds"),
            started_at: row.get("started_at"),
            ended_at: row.get("ended_at"),
            phase_finished_at: row.get("phase_finished_at"),
        });
    }
    Ok(groups)
}

pub(crate) struct BackupHistory {
    kind: FocusKind,
    task_created_at: i64,
    groups: Vec<FocusGroup>,
}

pub(crate) async fn for_backup(pool: &SqlitePool) -> Result<Vec<BackupHistory>, String> {
    let tasks: Vec<(String,i64,i64)> = sqlx::query_as("SELECT DISTINCT g.kind,g.task_id,p.created_at
        FROM focus_history_groups g JOIN tool_pomodoro_runs p ON p.id=g.task_id WHERE g.kind='pomodoro'
        UNION ALL SELECT DISTINCT g.kind,g.task_id,f.created_at FROM focus_history_groups g
        JOIN tool_free_focus f ON f.id=g.task_id WHERE g.kind='free'").fetch_all(pool).await.map_err(|e|e.to_string())?;
    let mut result = Vec::new();
    for (kind, id, created_at) in tasks {
        let kind = if kind == "pomodoro" {
            FocusKind::Pomodoro
        } else {
            FocusKind::Free
        };
        result.push(BackupHistory {
            kind,
            task_created_at: created_at,
            groups: read(pool, kind, id).await?,
        });
    }
    Ok(result)
}

impl BackupHistory {
    async fn target(
        &self,
        tx: &mut Transaction<'_, Sqlite>,
    ) -> Result<Option<(i64, String)>, String> {
        let lookup = match self.kind {
            FocusKind::Pomodoro => "SELECT r.id,r.status FROM tool_pomodoro_runs r
                JOIN tool_pomodoro_tasks t ON t.run_id=r.id WHERE r.created_at=? AND t.deleted_at IS NULL",
            FocusKind::Free => "SELECT id,status FROM tool_free_focus WHERE created_at=? AND deleted_at IS NULL",
        };
        sqlx::query_as(lookup)
            .bind(self.task_created_at)
            .fetch_optional(&mut **tx)
            .await
            .map_err(|error| error.to_string())
    }
}

// A merged task keeps its local timer. Only a newly imported task may resume its source group.
pub(crate) async fn detach_existing_tasks(
    tx: &mut Transaction<'_, Sqlite>,
    histories: &mut [BackupHistory],
) -> Result<(), String> {
    for history in histories {
        if history.groups.iter().any(|group| group.outcome == "open")
            && history.target(tx).await?.is_some()
        {
            for group in &mut history.groups {
                if group.outcome == "open" {
                    group.outcome = "interrupted".into();
                }
            }
        }
    }
    Ok(())
}

pub(crate) async fn restore(
    tx: &mut Transaction<'_, Sqlite>,
    histories: &[BackupHistory],
) -> Result<(), String> {
    for history in histories {
        let Some((id, status)) = history.target(tx).await? else {
            continue;
        };
        for group in &history.groups {
            let outcome = if group.outcome == "open" && status != "paused" {
                "interrupted"
            } else {
                &group.outcome
            };
            let result = sqlx::query(
                "INSERT INTO focus_history_groups(group_key,kind,task_id,started_at,outcome)
                 VALUES(?,?,?,?,?) ON CONFLICT(group_key) DO NOTHING",
            )
            .bind(&group.key)
            .bind(history.kind.as_str())
            .bind(id)
            .bind(group.started_at)
            .bind(outcome)
            .execute(&mut **tx)
            .await
            .map_err(|error| error.to_string())?;
            if result.rows_affected() == 0 {
                continue;
            }
            for span in &group.spans {
                sqlx::query(
                    "INSERT INTO focus_history_spans(group_key,phase,cycle,rounds,started_at,ended_at,phase_finished_at)
                     VALUES(?,?,?,?,?,?,?)",
                )
                .bind(&group.key)
                .bind(&span.phase)
                .bind(span.cycle)
                .bind(span.rounds)
                .bind(span.started_at)
                .bind(span.ended_at)
                .bind(span.phase_finished_at)
                .execute(&mut **tx)
                .await
                .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}
