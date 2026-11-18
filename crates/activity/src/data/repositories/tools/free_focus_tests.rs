use super::*;
use crate::domain::tools::{PomodoroStatus, PomodoroTaskAction};
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

fn save(id: Option<i64>, label: &str, mode: RestMode) -> FreeFocusAction {
    FreeFocusAction::Save {
        id,
        label: label.into(),
        rest_mode: mode,
        rest_minutes: 5,
        rest_ratio: 5,
    }
}

async fn task(pool: &Pool<Sqlite>, id: i64) -> FreeFocusTask {
    fetch(pool)
        .await
        .unwrap()
        .into_iter()
        .find(|t| t.id == id)
        .unwrap()
}

#[tokio::test]
async fn free_focus_manual_boundaries_pause_rename_and_stale_notifications() {
    let pool = database().await;
    apply(&pool, save(None, "Read", RestMode::Ratio), 1000)
        .await
        .unwrap();
    apply(&pool, FreeFocusAction::Resume { id: 1 }, 2000)
        .await
        .unwrap();
    apply(&pool, FreeFocusAction::Pause { id: 1 }, 602000)
        .await
        .unwrap();
    assert_eq!(task(&pool, 1).await.elapsed_at(999999), 600000);
    apply(&pool, save(Some(1), "Write", RestMode::Ratio), 700000)
        .await
        .unwrap();
    assert_eq!(task(&pool, 1).await.elapsed_ms, 600000);
    apply(&pool, FreeFocusAction::Resume { id: 1 }, 800000)
        .await
        .unwrap();
    apply(&pool, FreeFocusAction::Finish { id: 1 }, 1400000)
        .await
        .unwrap();
    let prepared = task(&pool, 1).await;
    assert_eq!(
        (prepared.phase.as_str(), prepared.status.as_str()),
        ("break", "paused")
    );
    assert_eq!(prepared.elapsed_ms, 1200000);
    assert_eq!(prepared.remaining_at(2000000), 240000);
    // Timing edits apply to the next break, not the already prepared one.
    apply(&pool, save(Some(1), "Write", RestMode::Fixed), 1500000)
        .await
        .unwrap();
    assert_eq!(task(&pool, 1).await.rest_remaining_ms, 240000);
    assert!(apply(
        &pool,
        FreeFocusAction::StartNext {
            id: 1,
            expected_updated_at: prepared.updated_at
        },
        1600000
    )
    .await
    .is_err());
    let version = task(&pool, 1).await.updated_at;
    apply(
        &pool,
        FreeFocusAction::StartNext {
            id: 1,
            expected_updated_at: version,
        },
        1600000,
    )
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    assert!(complete_due(&mut tx, 1839999).await.unwrap().is_empty());
    assert_eq!(complete_due(&mut tx, 1840000).await.unwrap().len(), 1);
    assert!(complete_due(&mut tx, 1840001).await.unwrap().is_empty());
    tx.commit().await.unwrap();
    let done = task(&pool, 1).await;
    assert_eq!(done.status, "completed");
    assert_eq!(done.elapsed_at(3000000), 1200000);
    assert_eq!(done.started_at, None);
    apply(&pool, FreeFocusAction::Resume { id: 1 }, 3000000)
        .await
        .unwrap();
    assert_eq!(task(&pool, 1).await.elapsed_at(3001000), 1000);
    apply(&pool, FreeFocusAction::Finish { id: 1 }, 3001000)
        .await
        .unwrap();
    assert_eq!(task(&pool, 1).await.rest_remaining_ms, 300000);
    pool.close().await;
}

#[tokio::test]
async fn free_focus_switches_both_modes_atomically_and_recovers_only_one() {
    let pool = database().await;
    let pomo = super::super::pomodoro_tasks::apply;
    pomo(
        &pool,
        PomodoroTaskAction::Save {
            id: None,
            label: "Read".into(),
            focus_ms: 60000,
            short_break_ms: 60000,
            long_break_ms: 60000,
            long_break_every: 4,
        },
        1000,
        "2026-11-03",
    )
    .await
    .unwrap();
    pomo(
        &pool,
        PomodoroTaskAction::Resume { id: 1 },
        2000,
        "2026-11-03",
    )
    .await
    .unwrap();
    apply(&pool, save(None, "Write", RestMode::Fixed), 3000)
        .await
        .unwrap();
    apply(&pool, FreeFocusAction::Resume { id: 1 }, 12000)
        .await
        .unwrap();
    let old = super::super::pomodoro_tasks::fetch_tasks(&pool)
        .await
        .unwrap();
    assert_eq!(old[0].run.status, PomodoroStatus::Paused);
    assert_eq!(old[0].run.phase_remaining_ms, Some(50000));
    pomo(
        &pool,
        PomodoroTaskAction::Resume { id: 1 },
        22000,
        "2026-11-03",
    )
    .await
    .unwrap();
    assert_eq!(task(&pool, 1).await.elapsed_at(99000), 10000);
    pool.execute("CREATE TRIGGER reject_free BEFORE UPDATE OF status ON tool_free_focus WHEN NEW.status='running' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END").await.unwrap();
    assert!(apply(&pool, FreeFocusAction::Resume { id: 1 }, 23000)
        .await
        .is_err());
    assert_eq!(
        super::super::pomodoro_tasks::fetch_tasks(&pool)
            .await
            .unwrap()[0]
            .run
            .status,
        PomodoroStatus::Running
    );
    pool.execute("DROP TRIGGER reject_free").await.unwrap();
    apply(&pool, save(None, "Second", RestMode::Fixed), 24000)
        .await
        .unwrap();
    pool.execute(
        "UPDATE tool_free_focus SET status='running',started_at=25000,updated_at=25000+id",
    )
    .await
    .unwrap();
    recover_single_active(&pool, 30000).await.unwrap();
    let tasks = fetch(&pool).await.unwrap();
    assert_eq!(tasks[0].status, "paused");
    assert_eq!(tasks[0].elapsed_ms, 15000);
    assert_eq!(tasks[1].status, "running");
    assert_eq!(
        super::super::pomodoro_tasks::fetch_tasks(&pool)
            .await
            .unwrap()[0]
            .run
            .status,
        PomodoroStatus::Paused
    );
    pool.close().await;
}

#[tokio::test]
async fn free_focus_restore_is_idempotent_preserves_tombstones_and_rejects_invalid_values() {
    let source = database().await;
    let target = database().await;
    apply(&source, save(None, "First", RestMode::Ratio), 1000)
        .await
        .unwrap();
    apply(&source, save(None, "Second", RestMode::Fixed), 1000)
        .await
        .unwrap();
    apply(&source, FreeFocusAction::Resume { id: 1 }, 2000)
        .await
        .unwrap();
    apply(&source, FreeFocusAction::Pause { id: 1 }, 32000)
        .await
        .unwrap();
    let backup = fetch(&source).await.unwrap();
    assert_ne!(backup[0].created_at, backup[1].created_at);
    for _ in 0..2 {
        let mut tx = target.begin().await.unwrap();
        restore(&mut tx, &backup).await.unwrap();
        tx.commit().await.unwrap();
    }
    assert_eq!(fetch(&target).await.unwrap().len(), 2);
    assert_eq!(task(&target, 1).await.elapsed_ms, 30000);
    apply(&target, FreeFocusAction::Delete { id: 1 }, 40000)
        .await
        .unwrap();
    let mut tx = target.begin().await.unwrap();
    restore(&mut tx, &backup).await.unwrap();
    tx.commit().await.unwrap();
    assert!(task(&target, 1).await.deleted_at.is_some());
    assert!(apply(&target, FreeFocusAction::Resume { id: 1 }, 50000)
        .await
        .is_err());
    assert!(apply(
        &target,
        FreeFocusAction::Save {
            id: None,
            label: "".into(),
            rest_mode: RestMode::Ratio,
            rest_minutes: 5,
            rest_ratio: 0
        },
        50000
    )
    .await
    .is_err());
    apply(&source, FreeFocusAction::Reset { id: 1 }, 40000)
        .await
        .unwrap();
    let reset = task(&source, 1).await;
    assert_eq!((reset.status.as_str(), reset.elapsed_ms), ("idle", 0));
    source.close().await;
    target.close().await;
}
