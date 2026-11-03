use crate::domain::tools::{PomodoroStatus, PomodoroTaskAction, ToolPomodoroRun, ToolPomodoroTask};
use sqlx::{Pool, Row, Sqlite, Transaction};

pub(super) async fn notification_task(
    tx: &mut Transaction<'_, Sqlite>,
    id: i64,
) -> Result<ToolPomodoroTask, String> {
    let run = read_task(tx, id).await?;
    let (label, completed_groups): (String, i64) = sqlx::query_as(
        "SELECT COALESCE(t.label,''), COALESCE(c.completed_groups,0) FROM tool_pomodoro_runs r
         LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id
         LEFT JOIN tool_pomodoro_task_completions c ON c.run_id=r.id WHERE r.id=?",
    )
    .bind(id)
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(ToolPomodoroTask {
        label,
        completed_groups,
        run,
    })
}

pub(super) async fn complete_group(
    tx: &mut Transaction<'_, Sqlite>,
    run: &ToolPomodoroRun,
    now_ms: i64,
) -> Result<crate::domain::tools::CompletedPomodoroNotification, String> {
    sqlx::query("UPDATE tool_pomodoro_runs SET status='completed',phase_started_at=NULL,phase_paused_at=NULL,phase_remaining_ms=0,updated_at=? WHERE id=?")
        .bind(now_ms).bind(run.id).execute(&mut **tx).await.map_err(|e| e.to_string())?;
    sqlx::query(
        "INSERT INTO tool_pomodoro_task_completions(run_id,completed_groups) VALUES(?,1)
        ON CONFLICT(run_id) DO UPDATE SET completed_groups=completed_groups+1",
    )
    .bind(run.id)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(crate::domain::tools::CompletedPomodoroNotification {
        task: notification_task(tx, run.id).await?,
        run_id: run.id,
        completed_phase: run.phase,
        next_phase: crate::domain::tools::PomodoroPhase::Focus,
        completed_focus_count: run.completed_focus_count,
    })
}

pub(super) async fn fetch_tasks(pool: &Pool<Sqlite>) -> Result<Vec<ToolPomodoroTask>, String> {
    let rows = sqlx::query("SELECT r.*, COALESCE(t.label, '') AS task_label, COALESCE(c.completed_groups, 0) AS completed_groups FROM tool_pomodoro_runs r
        LEFT JOIN tool_pomodoro_tasks t ON t.run_id = r.id
        LEFT JOIN tool_pomodoro_task_completions c ON c.run_id = r.id WHERE t.deleted_at IS NULL ORDER BY r.created_at, r.id")
        .fetch_all(pool).await.map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|row| ToolPomodoroTask {
            label: row.get("task_label"),
            completed_groups: row.get("completed_groups"),
            run: super::read::map_pomodoro_row(row),
        })
        .collect())
}

async fn read_task(tx: &mut Transaction<'_, Sqlite>, id: i64) -> Result<ToolPomodoroRun, String> {
    let row = sqlx::query(
        "SELECT r.* FROM tool_pomodoro_runs r LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id
        WHERE r.id=? AND t.deleted_at IS NULL",
    )
    .bind(id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())?
    .ok_or_else(|| "pomodoro task is unavailable".to_string())?;
    Ok(super::read::map_pomodoro_row(row))
}

async fn pause(
    tx: &mut Transaction<'_, Sqlite>,
    run: &ToolPomodoroRun,
    now_ms: i64,
) -> Result<(), String> {
    if run.status != PomodoroStatus::Running {
        return Ok(());
    }
    sqlx::query(
        "UPDATE tool_pomodoro_runs SET status='paused', phase_started_at=NULL, phase_paused_at=?,
        phase_remaining_ms=?, updated_at=? WHERE id=?",
    )
    .bind(now_ms)
    .bind(run.remaining_ms_at(now_ms))
    .bind(now_ms)
    .bind(run.id)
    .execute(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub(super) async fn pause_active(
    tx: &mut Transaction<'_, Sqlite>,
    now_ms: i64,
) -> Result<(), String> {
    let rows = sqlx::query("SELECT * FROM tool_pomodoro_runs WHERE status='running'")
        .fetch_all(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
    for row in rows {
        pause(tx, &super::read::map_pomodoro_row(row), now_ms).await?;
    }
    Ok(())
}

pub(crate) async fn recover_single_active(pool: &Pool<Sqlite>, now_ms: i64) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let rows = sqlx::query(
        "SELECT r.* FROM tool_pomodoro_runs r LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id
        WHERE r.status='running' AND t.deleted_at IS NULL ORDER BY r.updated_at DESC,r.id DESC",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    for row in rows.into_iter().skip(1) {
        pause(&mut tx, &super::read::map_pomodoro_row(row), now_ms).await?;
    }
    tx.commit().await.map_err(|e| e.to_string())
}

pub(crate) async fn apply(
    pool: &Pool<Sqlite>,
    action: PomodoroTaskAction,
    now_ms: i64,
    date_key: &str,
) -> Result<(), String> {
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    if let PomodoroTaskAction::StartNext {
        id,
        expected_updated_at,
    } = &action
    {
        let run = read_task(&mut tx, *id).await?;
        if run.updated_at != *expected_updated_at
            || !matches!(
                run.status,
                PomodoroStatus::Paused | PomodoroStatus::Completed
            )
        {
            return Err("pomodoro notification is stale".to_owned());
        }
    }
    match action {
        PomodoroTaskAction::Save {
            id,
            label,
            focus_ms,
            short_break_ms,
            long_break_ms,
            long_break_every,
        } => {
            if label.trim().chars().count() > 160
                || !(60_000..=10_800_000).contains(&focus_ms)
                || !(60_000..=3_600_000).contains(&short_break_ms)
                || !(60_000..=7_200_000).contains(&long_break_ms)
                || !(2..=12).contains(&long_break_every)
            {
                return Err("invalid pomodoro task configuration".into());
            }
            let id = if let Some(id) = id {
                let run = read_task(&mut tx, id).await?;
                if run.status == PomodoroStatus::Running {
                    return Err("pause pomodoro before editing".into());
                }
                if run.focus_ms != focus_ms
                    || run.short_break_ms != short_break_ms
                    || run.long_break_ms != long_break_ms
                    || run.long_break_every != long_break_every
                {
                    sqlx::query("UPDATE tool_pomodoro_runs SET phase='focus', status='idle', cycle_index=1, focus_ms=?, short_break_ms=?,
                    long_break_ms=?, long_break_every=?, phase_started_at=NULL, phase_paused_at=NULL, phase_remaining_ms=?, completed_focus_count=0, updated_at=? WHERE id=?")
                    .bind(focus_ms).bind(short_break_ms).bind(long_break_ms).bind(long_break_every).bind(focus_ms).bind(now_ms).bind(id)
                    .execute(&mut *tx).await.map_err(|e| e.to_string())?;
                }
                id
            } else {
                let created_at: i64 = sqlx::query_scalar(
                    "SELECT MAX(?, COALESCE(MAX(created_at)+1, ?)) FROM tool_pomodoro_runs",
                )
                .bind(now_ms)
                .bind(now_ms)
                .fetch_one(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
                sqlx::query("INSERT INTO tool_pomodoro_runs(phase,status,cycle_index,focus_ms,short_break_ms,long_break_ms,long_break_every,
                    phase_started_at,phase_paused_at,phase_remaining_ms,completed_focus_count,created_at,updated_at)
                    VALUES('focus','idle',1,?,?,?,?,NULL,NULL,?,0,?,?)")
                    .bind(focus_ms).bind(short_break_ms).bind(long_break_ms).bind(long_break_every).bind(focus_ms).bind(created_at).bind(now_ms)
                    .execute(&mut *tx).await.map_err(|e| e.to_string())?.last_insert_rowid()
            };
            sqlx::query("INSERT INTO tool_pomodoro_tasks(run_id,label) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET label=excluded.label")
                .bind(id).bind(label.trim()).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        }
        PomodoroTaskAction::Resume { id } | PomodoroTaskAction::StartNext { id, .. } => {
            let run = read_task(&mut tx, id).await?;
            if run.status != PomodoroStatus::Running {
                super::free_focus::pause_active(&mut tx, now_ms).await?;
                let active=sqlx::query("SELECT r.* FROM tool_pomodoro_runs r LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id WHERE r.status='running' AND t.deleted_at IS NULL")
                    .fetch_all(&mut *tx).await.map_err(|e| e.to_string())?;
                for row in active {
                    pause(&mut tx, &super::read::map_pomodoro_row(row), now_ms).await?;
                }
                if run.status == PomodoroStatus::Completed {
                    sqlx::query("UPDATE tool_pomodoro_runs SET phase='focus',cycle_index=1,phase_remaining_ms=focus_ms WHERE id=?")
                        .bind(id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
                }
                sqlx::query("UPDATE tool_pomodoro_runs SET status='running',phase_started_at=?,phase_paused_at=NULL,updated_at=? WHERE id=?")
                    .bind(now_ms).bind(now_ms).bind(id).execute(&mut *tx).await.map_err(|e| e.to_string())?;
            }
        }
        PomodoroTaskAction::Pause { id } => {
            let run = read_task(&mut tx, id).await?;
            pause(&mut tx, &run, now_ms).await?;
        }
        PomodoroTaskAction::Skip { id } => {
            let run = read_task(&mut tx, id).await?;
            super::advance_pomodoro_phase(&mut tx, run, date_key, now_ms, false, false).await?;
        }
        PomodoroTaskAction::Reset { id } => {
            read_task(&mut tx, id).await?;
            sqlx::query("UPDATE tool_pomodoro_runs SET phase='focus',status='idle',cycle_index=1,phase_started_at=NULL,phase_paused_at=NULL,
                phase_remaining_ms=focus_ms,completed_focus_count=0,updated_at=? WHERE id=?").bind(now_ms).bind(id)
                .execute(&mut *tx).await.map_err(|e| e.to_string())?;
        }
        PomodoroTaskAction::Delete { id } => {
            let run = read_task(&mut tx, id).await?;
            pause(&mut tx, &run, now_ms).await?;
            sqlx::query("INSERT INTO tool_pomodoro_tasks(run_id,label,deleted_at) VALUES(?,'',?) ON CONFLICT(run_id) DO UPDATE SET deleted_at=excluded.deleted_at")
                .bind(id).bind(now_ms).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        }
    }
    tx.commit().await.map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::Executor;

    async fn database() -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in crate::data::schema::tracker_migrations() {
            pool.execute(migration.sql).await.unwrap();
        }
        pool
    }
    fn save(id: Option<i64>, label: &str) -> PomodoroTaskAction {
        PomodoroTaskAction::Save {
            id,
            label: label.into(),
            focus_ms: 60_000,
            short_break_ms: 60_000,
            long_break_ms: 120_000,
            long_break_every: 4,
        }
    }
    #[tokio::test]
    async fn pomodoro_task_rename_preserves_progress_and_settings_changes_reset_only_that_task() {
        let pool = database().await;
        apply(&pool, save(None, "Read"), 1_000, "2026-11-03")
            .await
            .unwrap();
        apply(&pool, save(None, "Write"), 1_001, "2026-11-03")
            .await
            .unwrap();
        pool.execute("INSERT INTO tool_daily_stats(date_key,completed_pomodoros,updated_at) VALUES('2026-11-03',7,1000)").await.unwrap();
        let other = fetch_tasks(&pool).await.unwrap()[1].clone();
        for phase in ["focus", "short_break", "long_break"] {
            sqlx::query("UPDATE tool_pomodoro_runs SET phase=?,status='paused',cycle_index=3,phase_paused_at=2000,phase_remaining_ms=8000,completed_focus_count=2 WHERE id=1")
                .bind(phase).execute(&pool).await.unwrap();
            let before = fetch_tasks(&pool).await.unwrap()[0].run.clone();
            apply(&pool, save(Some(1), "Renamed"), 5_000, "2026-11-03")
                .await
                .unwrap();
            let tasks = fetch_tasks(&pool).await.unwrap();
            assert_eq!(tasks[0].label, "Renamed");
            assert_eq!(tasks[0].run, before);
            assert_eq!(tasks[1], other);
        }
        for field in 0..4 {
            pool.execute("UPDATE tool_pomodoro_runs SET phase='short_break',status='paused',cycle_index=3,focus_ms=60000,short_break_ms=60000,long_break_ms=120000,long_break_every=4,phase_paused_at=2000,phase_remaining_ms=8000,completed_focus_count=2 WHERE id=1").await.unwrap();
            let mut values = [60_000, 60_000, 120_000, 4];
            values[field] += if field == 3 { 1 } else { 60_000 };
            apply(
                &pool,
                PomodoroTaskAction::Save {
                    id: Some(1),
                    label: "Changed".into(),
                    focus_ms: values[0],
                    short_break_ms: values[1],
                    long_break_ms: values[2],
                    long_break_every: values[3],
                },
                6_000,
                "2026-11-03",
            )
            .await
            .unwrap();
            let tasks = fetch_tasks(&pool).await.unwrap();
            let run = &tasks[0].run;
            assert_eq!(run.status, PomodoroStatus::Idle);
            assert_eq!(run.phase, crate::domain::tools::PomodoroPhase::Focus);
            assert_eq!(run.cycle_index, 1);
            assert_eq!(run.phase_remaining_ms, Some(values[0]));
            assert_eq!(run.phase_paused_at, None);
            assert_eq!(run.completed_focus_count, 0);
            assert_eq!(tasks[1], other);
        }
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT completed_pomodoros FROM tool_daily_stats WHERE date_key='2026-11-03'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            7
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn pomodoro_groups_stop_count_once_and_restart_explicitly() {
        let pool = database().await;
        apply(&pool, save(None, "Read"), 1_000, "2026-11-03")
            .await
            .unwrap();
        let mut now = 2_000;
        for group in 1..=2 {
            apply(
                &pool,
                PomodoroTaskAction::Resume { id: 1 },
                now,
                "2026-11-03",
            )
            .await
            .unwrap();
            let started = fetch_tasks(&pool).await.unwrap().remove(0);
            assert_eq!(
                started.run.phase,
                crate::domain::tools::PomodoroPhase::Focus
            );
            assert_eq!(started.run.cycle_index, 1);
            assert_eq!(started.run.phase_remaining_ms, Some(60_000));
            assert_eq!(started.completed_groups, group - 1);
            for phase in 0..8 {
                let run = fetch_tasks(&pool).await.unwrap().remove(0).run;
                now += run.phase_remaining_ms.unwrap();
                let mut tx = pool.begin().await.unwrap();
                assert!(
                    super::super::complete_due_pomodoro_phase(&mut tx, "2026-11-03", now)
                        .await
                        .unwrap()
                        .is_some()
                );
                tx.commit().await.unwrap();
                let task = fetch_tasks(&pool).await.unwrap().remove(0);
                assert_eq!(
                    task.completed_groups,
                    if phase == 7 { group } else { group - 1 }
                );
                assert_eq!(
                    task.run.status,
                    if phase == 7 {
                        PomodoroStatus::Completed
                    } else {
                        PomodoroStatus::Paused
                    }
                );
                if phase != 7 {
                    assert_eq!(
                        task.run.remaining_ms_at(now + 999_999),
                        task.run.phase_duration_ms()
                    );
                    now += 999_999;
                    let action = PomodoroTaskAction::StartNext {
                        id: 1,
                        expected_updated_at: task.run.updated_at,
                    };
                    apply(&pool, action.clone(), now, "2026-11-03")
                        .await
                        .unwrap();
                    assert!(apply(&pool, action, now + 1, "2026-11-03").await.is_err());
                }
            }
            let finished = fetch_tasks(&pool).await.unwrap().remove(0);
            assert_eq!(finished.run.phase_remaining_ms, Some(0));
            assert_eq!(finished.run.cycle_index, 4);
            assert_eq!(finished.run.phase_started_at, None);
            assert_eq!(finished.run.completed_focus_count, group * 4);
            for _ in 0..2 {
                let mut tx = pool.begin().await.unwrap();
                assert!(super::super::complete_due_pomodoro_phase(
                    &mut tx,
                    "2026-11-03",
                    now + 999_999
                )
                .await
                .unwrap()
                .is_none());
                tx.commit().await.unwrap();
            }
            apply(&pool, save(Some(1), "Renamed"), now, "2026-11-03")
                .await
                .unwrap();
            assert_eq!(fetch_tasks(&pool).await.unwrap()[0].run, finished.run);
        }
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT completed_pomodoros FROM tool_daily_stats WHERE date_key='2026-11-03'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            8
        );
        let backup = super::super::fetch_all_pomodoro_runs_for_backup(&pool)
            .await
            .unwrap();
        let restored = database().await;
        for _ in 0..2 {
            let mut tx = restored.begin().await.unwrap();
            super::super::insert_missing_for_restore(&mut tx, &[], &backup, &[])
                .await
                .unwrap();
            tx.commit().await.unwrap();
        }
        let task = fetch_tasks(&restored).await.unwrap().remove(0);
        assert_eq!(task.completed_groups, 2);
        assert_eq!(task.run.status, PomodoroStatus::Completed);
        apply(
            &pool,
            PomodoroTaskAction::Reset { id: 1 },
            now,
            "2026-11-03",
        )
        .await
        .unwrap();
        assert_eq!(fetch_tasks(&pool).await.unwrap()[0].completed_groups, 2);
        pool.close().await;
        restored.close().await;
    }

    #[tokio::test]
    async fn pomodoro_tasks_backup_preserves_labels_deletions_and_single_active_recovery() {
        let source = database().await;
        apply(&source, save(None, "Read"), 1_000, "2026-11-03")
            .await
            .unwrap();
        apply(&source, save(None, "Write"), 1_000, "2026-11-03")
            .await
            .unwrap();
        apply(&source, save(None, "Deleted"), 1_000, "2026-11-03")
            .await
            .unwrap();
        apply(
            &source,
            PomodoroTaskAction::Delete { id: 3 },
            2_000,
            "2026-11-03",
        )
        .await
        .unwrap();
        source.execute("UPDATE tool_pomodoro_runs SET status='running',phase_started_at=2000 WHERE id IN(1,2)").await.unwrap();
        let backup = super::super::fetch_all_pomodoro_runs_for_backup(&source)
            .await
            .unwrap();
        let target = database().await;
        for _ in 0..2 {
            let mut tx = target.begin().await.unwrap();
            super::super::insert_missing_for_restore(&mut tx, &[], &backup, &[])
                .await
                .unwrap();
            tx.commit().await.unwrap();
        }
        assert!(fetch_tasks(&target)
            .await
            .unwrap()
            .iter()
            .all(|task| task.run.status == PomodoroStatus::Paused));
        target.execute("UPDATE tool_pomodoro_runs SET status='running',phase_started_at=2000 WHERE id IN(1,2)").await.unwrap();
        recover_single_active(&target, 12_000).await.unwrap();
        let tasks = fetch_tasks(&target).await.unwrap();
        assert_eq!(
            tasks
                .iter()
                .map(|task| task.label.as_str())
                .collect::<Vec<_>>(),
            vec!["Read", "Write"]
        );
        assert_eq!(
            tasks
                .iter()
                .filter(|task| task.run.status == PomodoroStatus::Running)
                .count(),
            1
        );
        assert_eq!(tasks[0].run.remaining_ms_at(99_000), 50_000);
        source.close().await;
        target.close().await;
    }

    #[tokio::test]
    async fn pomodoro_tasks_migration_keeps_latest_legacy_run_and_all_history() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        for migration in crate::data::schema::tracker_migrations()
            .into_iter()
            .filter(|migration| migration.version < 23)
        {
            pool.execute(migration.sql).await.unwrap();
        }
        pool.execute("INSERT INTO tool_pomodoro_runs(id,phase,status,cycle_index,focus_ms,short_break_ms,long_break_ms,long_break_every,phase_started_at,phase_remaining_ms,completed_focus_count,created_at,updated_at) VALUES
            (1,'focus','paused',1,60000,60000,120000,4,NULL,30000,0,1000,3000),
            (2,'focus','running',2,60000,60000,120000,4,4000,45000,1,2000,4000)").await.unwrap();
        let legacy = super::super::fetch_all_pomodoro_runs_for_backup(&pool)
            .await
            .unwrap();
        for _ in 0..2 {
            pool.execute(crate::data::schema::POMODORO_TASKS_SQL)
                .await
                .unwrap();
            pool.execute(crate::data::schema::POMODORO_COMPLETIONS_SQL)
                .await
                .unwrap();
        }
        let tasks = fetch_tasks(&pool).await.unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].run.id, 2);
        assert_eq!(tasks[0].run.remaining_ms_at(5000), 44000);
        assert_eq!(
            super::super::fetch_all_pomodoro_runs_for_backup(&pool)
                .await
                .unwrap()
                .len(),
            2
        );
        let target = database().await;
        let mut tx = target.begin().await.unwrap();
        super::super::insert_missing_for_restore(&mut tx, &[], &legacy, &[])
            .await
            .unwrap();
        tx.commit().await.unwrap();
        assert_eq!(fetch_tasks(&target).await.unwrap().len(), 1);
        pool.close().await;
        target.close().await;
    }
    #[tokio::test]
    async fn pomodoro_tasks_switch_preserves_each_remaining_time_and_creation_does_not_switch() {
        let pool = database().await;
        apply(&pool, save(None, "Read"), 1_000, "2026-11-03")
            .await
            .unwrap();
        apply(
            &pool,
            PomodoroTaskAction::Resume { id: 1 },
            2_000,
            "2026-11-03",
        )
        .await
        .unwrap();
        apply(&pool, save(None, "Write"), 12_000, "2026-11-03")
            .await
            .unwrap();
        assert_eq!(
            super::super::read::fetch_latest_pomodoro(&pool)
                .await
                .unwrap()
                .unwrap()
                .id,
            1
        );
        apply(
            &pool,
            PomodoroTaskAction::Resume { id: 2 },
            22_000,
            "2026-11-03",
        )
        .await
        .unwrap();
        let tasks = fetch_tasks(&pool).await.unwrap();
        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].run.status, PomodoroStatus::Paused);
        assert_eq!(tasks[0].run.remaining_ms_at(99_000), 40_000);
        assert_eq!(tasks[1].run.status, PomodoroStatus::Running);
        apply(
            &pool,
            PomodoroTaskAction::Resume { id: 1 },
            32_000,
            "2026-11-03",
        )
        .await
        .unwrap();
        let tasks = fetch_tasks(&pool).await.unwrap();
        assert_eq!(tasks[0].run.remaining_ms_at(42_000), 30_000);
        assert_eq!(tasks[1].run.remaining_ms_at(99_000), 50_000);
        assert_eq!(
            tasks
                .iter()
                .filter(|task| task.run.status == PomodoroStatus::Running)
                .count(),
            1
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn pomodoro_tasks_failed_switch_rolls_back_and_deleted_tasks_do_not_return() {
        let pool = database().await;
        apply(&pool, save(None, "Read"), 1_000, "2026-11-03")
            .await
            .unwrap();
        apply(&pool, save(None, "Write"), 1_001, "2026-11-03")
            .await
            .unwrap();
        apply(
            &pool,
            PomodoroTaskAction::Resume { id: 1 },
            2_000,
            "2026-11-03",
        )
        .await
        .unwrap();
        pool.execute("CREATE TRIGGER reject_resume BEFORE UPDATE OF status ON tool_pomodoro_runs WHEN NEW.id=2 AND NEW.status='running' BEGIN SELECT RAISE(ABORT,'synthetic switch failure'); END").await.unwrap();
        assert!(apply(
            &pool,
            PomodoroTaskAction::Resume { id: 2 },
            3_000,
            "2026-11-03"
        )
        .await
        .is_err());
        assert_eq!(
            fetch_tasks(&pool).await.unwrap()[0].run.status,
            PomodoroStatus::Running
        );
        assert!(apply(&pool, save(Some(1), "Changed"), 4_000, "2026-11-03")
            .await
            .is_err());
        apply(
            &pool,
            PomodoroTaskAction::Delete { id: 1 },
            5_000,
            "2026-11-03",
        )
        .await
        .unwrap();
        assert_eq!(fetch_tasks(&pool).await.unwrap().len(), 1);
        assert!(apply(
            &pool,
            PomodoroTaskAction::Resume { id: 1 },
            6_000,
            "2026-11-03"
        )
        .await
        .is_err());
        assert_eq!(
            super::super::read::fetch_latest_pomodoro(&pool)
                .await
                .unwrap()
                .unwrap()
                .id,
            2
        );
        pool.close().await;
    }
}
