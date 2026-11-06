use super::*;
use crate::data::repositories::tools::{self, free_focus};
use crate::domain::free_focus::{FreeFocusAction, RestMode};
use crate::domain::tools::PomodoroTaskAction;
use sqlx::Executor;

async fn db() -> SqlitePool {
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

#[tokio::test]
async fn history_tracks_actual_starts_switches_and_due_times() {
    let pool = db().await;
    let timer = tools::start_pomodoro(&pool, 1000, 1000, 1000, 2, 1000)
        .await
        .unwrap();
    free_focus::apply(
        &pool,
        FreeFocusAction::Save {
            id: None,
            label: "Read".into(),
            rest_mode: RestMode::Fixed,
            rest_minutes: 1,
            rest_ratio: 5,
        },
        1100,
    )
    .await
    .unwrap();
    free_focus::apply(&pool, FreeFocusAction::Resume { id: 1 }, 1500)
        .await
        .unwrap();
    free_focus::apply(&pool, FreeFocusAction::Finish { id: 1 }, 1800)
        .await
        .unwrap();
    let resume = |now| {
        tools::pomodoro_tasks::apply(&pool, PomodoroTaskAction::Resume { id: timer.id }, now, "")
    };
    resume(2000).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    tools::complete_due_pomodoro_phase(&mut tx, "2026-11-06", 3000)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    let history = read(&pool, FocusKind::Pomodoro, timer.id).await.unwrap();
    let spans = &history[0].spans;
    assert_eq!(spans.len(), 2);
    assert_eq!((spans[0].started_at, spans[0].ended_at), (1000, Some(1500)));
    assert_eq!(
        (spans[1].started_at, spans[1].phase_finished_at),
        (2000, Some(2500))
    );
    resume(5000).await.unwrap();
    let spans = &read(&pool, FocusKind::Pomodoro, timer.id).await.unwrap()[0].spans;
    assert_eq!(
        (&*spans[2].phase, spans[2].started_at),
        ("short_break", 5000)
    );
    free_focus::apply(&pool, FreeFocusAction::Resume { id: 1 }, 6000)
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    free_focus::complete_due(&mut tx, 80_000).await.unwrap();
    tx.commit().await.unwrap();
    free_focus::apply(&pool, FreeFocusAction::Resume { id: 1 }, 90_000)
        .await
        .unwrap();
    let history = read(&pool, FocusKind::Free, 1).await.unwrap();
    assert_eq!(history.len(), 2);
    assert_eq!(history[1].outcome, "completed");
    assert_eq!(history[1].spans[0].ended_at, Some(1800));
    assert_eq!(
        (history[1].spans[1].started_at, history[1].spans[1].ended_at),
        (6000, Some(66_000))
    );
    assert_eq!(history[0].spans[0].started_at, 90_000);
    free_focus::apply(&pool, FreeFocusAction::Delete { id: 1 }, 91_000)
        .await
        .unwrap();
    assert!(read(&pool, FocusKind::Free, 1).await.unwrap().is_empty());
}

#[tokio::test]
async fn completing_and_restarting_a_pomodoro_keeps_the_previous_group() {
    let pool = db().await;
    let timer = tools::start_pomodoro(&pool, 1000, 1000, 1000, 2, 1000)
        .await
        .unwrap();
    for n in 0..4 {
        let mut tx = pool.begin().await.unwrap();
        tools::complete_due_pomodoro_phase(&mut tx, "2026-11-06", 2000 + 2000 * n)
            .await
            .unwrap()
            .unwrap();
        tx.commit().await.unwrap();
        tools::pomodoro_tasks::apply(
            &pool,
            PomodoroTaskAction::Resume { id: timer.id },
            3000 + 2000 * n,
            "",
        )
        .await
        .unwrap();
    }
    let groups = read(&pool, FocusKind::Pomodoro, timer.id).await.unwrap();
    assert_eq!(groups.len(), 2);
    assert_eq!(groups[1].outcome, "completed");
    assert_eq!(
        groups[1]
            .spans
            .iter()
            .map(|s| s.phase.as_str())
            .collect::<Vec<_>>(),
        ["focus", "short_break", "focus", "long_break"]
    );
    assert_eq!(groups[0].spans[0].started_at, 9000);
}

#[tokio::test]
async fn reopened_database_preserves_spans_and_rolls_back_a_failed_resume() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.db");
    let pool = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&path, true)
        .await
        .unwrap();
    crate::data::sqlite_pool::prepare_pool_schema(&pool, &path)
        .await
        .unwrap();
    let run = tools::start_pomodoro(&pool, 10000, 1000, 1000, 2, 1000)
        .await
        .unwrap();
    tools::pause_pomodoro(&pool, 2000).await.unwrap();
    pool.close().await;
    let pool = crate::data::sqlite_pool::open_single_connection_sqlite_pool(&path, false)
        .await
        .unwrap();
    pool.execute(
        "CREATE TRIGGER reject_span BEFORE INSERT ON focus_history_spans
        BEGIN SELECT RAISE(ABORT,'synthetic history failure'); END;",
    )
    .await
    .unwrap();
    assert!(tools::resume_pomodoro(&pool, 3000).await.is_err());
    let status: String = sqlx::query_scalar("SELECT status FROM tool_pomodoro_runs")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(status, "paused");
    pool.execute("DROP TRIGGER reject_span").await.unwrap();
    tools::resume_pomodoro(&pool, 4000).await.unwrap();
    let groups = read(&pool, FocusKind::Pomodoro, run.id).await.unwrap();
    assert_eq!(groups.len(), 1);
    let spans = &groups[0].spans;
    assert_eq!(spans.len(), 2);
    assert_eq!((spans[0].started_at, spans[0].ended_at), (1000, Some(2000)));
    assert_eq!((spans[1].started_at, spans[1].ended_at), (4000, None));
    pool.close().await;
}
