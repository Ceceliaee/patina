use crate::data::repositories::tools;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::tools::ActivityReminderCheck;
use crate::engine::tools::{ToolsMutation, ToolsStore, ToolsStoreFuture, ToolsTickEvents};
use tauri::{AppHandle, Runtime};

pub struct SqliteToolsStore<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> SqliteToolsStore<R> {
    pub fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }

    async fn tick_with_pool(
        &self,
        now_ms: i64,
        date_key: &str,
        day_start_ms: i64,
        pending_activity_rule_ids: &[i64],
        activity_check: Option<&ActivityReminderCheck>,
    ) -> Result<ToolsTickEvents, String> {
        let pool = wait_for_sqlite_pool(&self.app).await?;
        tick_tools_with_pool(
            &pool,
            now_ms,
            date_key,
            day_start_ms,
            pending_activity_rule_ids,
            activity_check,
        )
        .await
    }
}

async fn tick_tools_with_pool(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    now_ms: i64,
    date_key: &str,
    day_start_ms: i64,
    pending_activity_rule_ids: &[i64],
    activity_check: Option<&ActivityReminderCheck>,
) -> Result<ToolsTickEvents, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start tools tick transaction: {error}"))?;
    let reminders = tools::timed_reminders::fire_due_reminders(&mut tx, now_ms).await?;
    let activity = if let Some(check) = activity_check {
        tools::fire_due_activity_reminders(
            &mut tx,
            date_key,
            day_start_ms,
            now_ms,
            pending_activity_rule_ids,
            check,
        )
        .await?
    } else {
        Default::default()
    };
    let completed_pomodoro = tools::complete_due_pomodoro_phase(&mut tx, date_key, now_ms).await?;
    let state_changed =
        !reminders.is_empty() || !activity.notifications.is_empty() || completed_pomodoro.is_some();
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit tools tick transaction: {error}"))?;

    Ok(ToolsTickEvents {
        reminders,
        activity_reminders: activity.notifications,
        activity_watch: activity.watch,
        completed_pomodoro,
        state_changed,
    })
}

impl<R: Runtime> ToolsStore for SqliteToolsStore<R> {
    fn apply_mutation(
        &self,
        mutation: ToolsMutation,
        now_ms: i64,
        date_key: String,
    ) -> ToolsStoreFuture<'_, ()> {
        Box::pin(async move {
            let pool = wait_for_sqlite_pool(&self.app).await?;
            match mutation {
                ToolsMutation::CreateReminder {
                    label,
                    scheduled_at,
                    recurrence,
                } => {
                    tools::timed_reminders::create_reminder(
                        &pool,
                        &label,
                        scheduled_at,
                        recurrence,
                        now_ms,
                    )
                    .await?;
                }
                ToolsMutation::CancelReminder { reminder_id } => {
                    tools::timed_reminders::cancel_reminder(&pool, reminder_id, now_ms).await?;
                }
                ToolsMutation::ResolveReminderAlert {
                    reminder_id,
                    fired_at,
                    delay_minutes,
                } => {
                    tools::timed_reminders::resolve_reminder_alert(
                        &pool,
                        reminder_id,
                        fired_at,
                        delay_minutes,
                        now_ms,
                    )
                    .await?;
                }
                ToolsMutation::UpdateReminder {
                    reminder_id,
                    label,
                    scheduled_at,
                    enabled,
                    recurrence,
                } => {
                    tools::timed_reminders::update_reminder(
                        &pool,
                        reminder_id,
                        &label,
                        scheduled_at,
                        enabled,
                        recurrence,
                        now_ms,
                    )
                    .await?;
                }
                ToolsMutation::CreateActivityReminderRule(request) => {
                    tools::create_activity_reminder_rule(
                        &pool,
                        &request.target,
                        &request.label_snapshot,
                        request.limit_ms,
                        &request.message,
                        now_ms,
                    )
                    .await?;
                }
                ToolsMutation::DisableActivityReminderRule { rule_id } => {
                    tools::disable_activity_reminder_rule(&pool, rule_id, now_ms).await?;
                }
                ToolsMutation::SetActivityReminderEnabled { rule_id, enabled } => {
                    tools::set_activity_reminder_enabled(&pool, rule_id, enabled, now_ms).await?;
                }
                ToolsMutation::UpdateActivityReminderLimit { rule_id, limit_ms } => {
                    tools::update_activity_reminder_limit(&pool, rule_id, limit_ms, now_ms).await?;
                }
                ToolsMutation::ExtendActivityReminder {
                    rule_id,
                    alert_at,
                    extension,
                    day_start_ms,
                } => {
                    tools::extend_activity_reminder(
                        &pool,
                        rule_id,
                        alert_at,
                        extension,
                        &date_key,
                        day_start_ms,
                        now_ms,
                    )
                    .await?;
                }
                ToolsMutation::StartPomodoro(request) => {
                    tools::start_pomodoro(
                        &pool,
                        request.focus_ms,
                        request.short_break_ms,
                        request.long_break_ms,
                        request.long_break_every,
                        now_ms,
                    )
                    .await?;
                }
                ToolsMutation::PausePomodoro => tools::pause_pomodoro(&pool, now_ms).await?,
                ToolsMutation::ResumePomodoro => tools::resume_pomodoro(&pool, now_ms).await?,
                ToolsMutation::SkipPomodoroPhase => {
                    tools::skip_pomodoro_phase(&pool, &date_key, now_ms).await?;
                }
                ToolsMutation::ResetPomodoro => tools::reset_pomodoro(&pool, now_ms).await?,
            }
            Ok(())
        })
    }

    fn recover_after_startup(
        &self,
        now_ms: i64,
        date_key: String,
        day_start_ms: i64,
    ) -> ToolsStoreFuture<'_, ToolsTickEvents> {
        Box::pin(async move {
            let pool = wait_for_sqlite_pool(&self.app).await?;
            let mut events = tick_tools_with_pool(
                &pool,
                now_ms,
                &date_key,
                day_start_ms,
                &[],
                Some(&ActivityReminderCheck::All),
            )
            .await?;
            events.reminders = tools::timed_reminders::pending_reminder_alerts(&pool).await?;
            Ok(events)
        })
    }

    fn tick(
        &self,
        now_ms: i64,
        date_key: String,
        day_start_ms: i64,
        pending_activity_rule_ids: Vec<i64>,
        activity_check: Option<ActivityReminderCheck>,
    ) -> ToolsStoreFuture<'_, ToolsTickEvents> {
        Box::pin(async move {
            self.tick_with_pool(
                now_ms,
                &date_key,
                day_start_ms,
                &pending_activity_rule_ids,
                activity_check.as_ref(),
            )
            .await
        })
    }

    fn fetch_snapshot(
        &self,
        now_ms: i64,
        date_key: String,
    ) -> ToolsStoreFuture<'_, crate::domain::tools::ToolsRuntimeSnapshot> {
        Box::pin(async move {
            let pool = wait_for_sqlite_pool(&self.app).await?;
            tools::fetch_tools_snapshot(&pool, now_ms, &date_key).await
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema;
    use crate::domain::tools::ActivityReminderTarget;
    use futures_util::FutureExt;
    use sqlx::{Executor, SqlitePool};
    use std::panic::AssertUnwindSafe;

    #[tokio::test]
    async fn tools_tick_skips_activity_tables_when_no_check_is_due() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        for migration in schema::tracker_migrations() {
            pool.execute(migration.sql).await.unwrap();
        }
        pool.execute(
            "ALTER TABLE tool_activity_reminder_rules RENAME TO unavailable_activity_rules",
        )
        .await
        .unwrap();
        let events = tick_tools_with_pool(&pool, 120_000, "2026-06-07", 0, &[], None)
            .await
            .unwrap();
        assert!(events.activity_reminders.is_empty());
        assert_eq!(events.activity_watch.next_check_at(), None);
        assert!(!events.state_changed);
        assert!(tick_tools_with_pool(
            &pool,
            120_000,
            "2026-06-07",
            0,
            &[],
            Some(&ActivityReminderCheck::All)
        )
        .await
        .is_err());
        pool.close().await;
    }

    #[tokio::test]
    async fn tools_tick_late_sql_failure_preserves_all_due_events_for_retry() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let outcome = AssertUnwindSafe(async {
            for sql in [schema::CURRENT_BASELINE_SCHEMA_SQL, schema::TOOLS_TABLES_SCHEMA_SQL,
                schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL, schema::ACTIVITY_REMINDER_RULES_SCHEMA_SQL, schema::ACTIVITY_REMINDER_EXTENSION_SQL, schema::ACTIVITY_REMINDER_ENABLED_SQL,
            schema::REMINDER_RECURRENCE_SQL,
                schema::WEB_ACTIVITY_SCHEMA_SQL] {
                pool.execute(sql).await.unwrap();
            }
            pool.execute("INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time)
                VALUES ('Editor', 'editor.exe', 'Doc', 0, 60000, 60000, 0);").await.unwrap();
            tools::timed_reminders::create_reminder(&pool, "Due reminder", 115_000, None, 110_000).await.unwrap();
            tools::create_activity_reminder_rule(&pool, &ActivityReminderTarget::App {
                app_name: "Editor".into(), exe_name: Some("editor.exe".into()),
            }, "Editor", 60_000, "Take a break", 110_000).await.unwrap();
            tools::start_pomodoro(&pool, 5_000, 5_000, 10_000, 4, 110_000).await.unwrap();
            pool.execute("CREATE TRIGGER reject_tick_daily_stat BEFORE INSERT ON tool_daily_stats
                BEGIN SELECT RAISE(ABORT, 'controlled late tick failure'); END;").await.unwrap();

            let error = tick_tools_with_pool(&pool, 120_000, "2026-06-07", 0, &[], Some(&ActivityReminderCheck::All)).await.unwrap_err();
            assert!(error.contains("controlled late tick failure"), "{error}");
            let persisted: (String, Option<String>, String, i64, i64) = sqlx::query_as(
                "SELECT (SELECT status FROM tool_reminders LIMIT 1),
                    (SELECT last_fired_date_key FROM tool_activity_reminder_rules LIMIT 1),
                    (SELECT phase FROM tool_pomodoro_runs LIMIT 1),
                    (SELECT completed_focus_count FROM tool_pomodoro_runs LIMIT 1),
                    (SELECT COUNT(*) FROM tool_daily_stats)").fetch_one(&pool).await.unwrap();
            assert_eq!(persisted, ("scheduled".into(), None, "focus".into(), 0, 0),
                "a failed tick must not consume notifications before their event batch exists");

            pool.execute("DROP TRIGGER reject_tick_daily_stat").await.unwrap();
            let recovered = tick_tools_with_pool(&pool, 120_000, "2026-06-07", 0, &[], Some(&ActivityReminderCheck::All)).await.unwrap();
            assert_eq!(recovered.reminders.len(), 1);
            assert_eq!(recovered.activity_reminders.len(), 1);
            assert!(recovered.completed_pomodoro.is_some());
            assert!(recovered.state_changed);
            let repeated = tick_tools_with_pool(&pool, 120_000, "2026-06-07", 0, &[], Some(&ActivityReminderCheck::All)).await.unwrap();
            assert!(repeated.reminders.is_empty());
            assert!(repeated.activity_reminders.is_empty());
            assert!(repeated.completed_pomodoro.is_none());
            assert!(!repeated.state_changed);
        }).catch_unwind().await;
        pool.close().await;
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}
