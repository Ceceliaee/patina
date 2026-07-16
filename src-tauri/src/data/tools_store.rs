use crate::data::repositories::tools;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
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
    ) -> Result<ToolsTickEvents, String> {
        let pool = wait_for_sqlite_pool(&self.app).await?;
        let reminders = tools::fire_due_reminders(&pool, now_ms).await?;
        let software_reminders =
            tools::fire_due_software_reminders(&pool, date_key, day_start_ms, now_ms).await?;
        let completed_timer = tools::complete_due_countdown(&pool, now_ms).await?;
        let completed_pomodoro =
            tools::complete_due_pomodoro_phase(&pool, date_key, now_ms).await?;
        let state_changed = !reminders.is_empty()
            || !software_reminders.is_empty()
            || completed_timer.is_some()
            || completed_pomodoro.is_some();

        Ok(ToolsTickEvents {
            reminders,
            software_reminders,
            completed_timer,
            completed_pomodoro,
            state_changed,
        })
    }
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
                } => {
                    tools::create_reminder(&pool, &label, scheduled_at, now_ms).await?;
                }
                ToolsMutation::CancelReminder { reminder_id } => {
                    tools::cancel_reminder(&pool, reminder_id, now_ms).await?;
                }
                ToolsMutation::CreateSoftwareReminderRule(request) => {
                    tools::create_software_reminder_rule(
                        &pool,
                        &request.app_name,
                        request.exe_name.as_deref(),
                        request.limit_ms,
                        &request.message,
                        now_ms,
                    )
                    .await?;
                }
                ToolsMutation::DisableSoftwareReminderRule { rule_id } => {
                    tools::disable_software_reminder_rule(&pool, rule_id, now_ms).await?;
                }
                ToolsMutation::StartTimer(request) => {
                    tools::start_timer(
                        &pool,
                        request.mode,
                        request.duration_ms,
                        request.label.as_deref(),
                        now_ms,
                    )
                    .await?;
                }
                ToolsMutation::PauseTimer => tools::pause_timer(&pool, now_ms).await?,
                ToolsMutation::ResumeTimer => tools::resume_timer(&pool, now_ms).await?,
                ToolsMutation::ResetTimer => tools::reset_timer(&pool, now_ms).await?,
                ToolsMutation::AddTimerLap => {
                    tools::add_timer_lap(&pool, now_ms).await?;
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
            tools::pause_running_stopwatch_after_restart(&pool, now_ms).await?;
            drop(pool);
            self.tick_with_pool(now_ms, &date_key, day_start_ms).await
        })
    }

    fn tick(
        &self,
        now_ms: i64,
        date_key: String,
        day_start_ms: i64,
    ) -> ToolsStoreFuture<'_, ToolsTickEvents> {
        Box::pin(async move { self.tick_with_pool(now_ms, &date_key, day_start_ms).await })
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
