use super::{date, db, labels, NativeToolData};
use crate::domain::{free_focus::FreeFocusAction, localization::Locale, tools::PomodoroTaskAction};
use serde::Deserialize;
use serde_json::{json, Value};
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum FocusCommand {
    Pomodoro { action: PomodoroTaskAction },
    Free { action: FreeFocusAction },
    Due,
}

pub struct FocusTasks(pub(super) NativeToolData);
impl FocusTasks {
    pub fn current_focus(&self, kind: &str, id: i64, revision: i64) -> Result<bool, String> {
        let sql=match kind {
            "pomodoro"=>"SELECT EXISTS(SELECT 1 FROM tool_pomodoro_runs r LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id WHERE r.id=? AND r.updated_at=? AND t.deleted_at IS NULL)",
            "free"=>"SELECT EXISTS(SELECT 1 FROM tool_free_focus WHERE id=? AND updated_at=? AND deleted_at IS NULL)",
            _=>return Ok(false),
        };
        self.0
            .runtime
            .block_on(
                sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
                    .bind(id)
                    .bind(revision)
                    .fetch_one(&self.0.pool),
            )
            .map_err(|e| e.to_string())
    }
    pub fn has_scheduled_work(&self) -> Result<bool, String> {
        self.0.runtime.block_on(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tool_pomodoro_runs WHERE status='running') OR EXISTS(SELECT 1 FROM tool_free_focus WHERE status='running' AND phase='break' AND deleted_at IS NULL)").fetch_one(&self.0.pool)).map_err(|e|e.to_string())
    }
    pub fn read(&self, language: &str, _now: i64, view: &Value) -> Result<Value, String> {
        self.0.runtime.block_on(async {
            let pomodoro = db::pomodoro_tasks::fetch_tasks(&self.0.pool).await?;
            let free: Vec<_> = db::free_focus::fetch(&self.0.pool)
                .await?
                .into_iter()
                .filter(|task| task.deleted_at.is_none())
                .collect();
            let mut data = json!({"pomodoro":pomodoro, "free":free});
            labels(
                &mut data,
                Locale::from_tag(Some(language)),
                &[
                    "tools.pomodoroTitle",
                    "tools.focusModePomodoro",
                    "tools.focusModeFree",
                    "tools.freeFocusStart",
                    "tools.freeFocusFinish",
                    "tools.freeFocusRest",
                    "tools.pomodoroStartNextGroup",
                    "tools.pause",
                    "tools.start",
                    "tools.reset",
                    "tools.pomodoroTaskCreate",
                    "tools.focusDetails",
                    "tools.pomodoroTaskName",
                    "tools.focusDuration",
                    "tools.shortBreakDuration",
                    "tools.longBreakDuration",
                    "tools.longBreakEvery",
                    "tools.activityReminderEdit",
                    "tools.freeRestProportion",
                    "tools.focusHistoryEmpty",
                    "tools.focusHistoryOpen",
                    "tools.focusHistoryEnded",
                    "common.save",
                    "common.cancel",
                ],
            );
            if let Some(task) = view["history_id"].as_i64() {
                use crate::domain::focus_history::FocusKind;
                let kind = if view["kind"] == "free" {
                    FocusKind::Free
                } else {
                    FocusKind::Pomodoro
                };
                data["history"] = json!(db::focus_history::read(&self.0.pool, kind, task).await?);
            }
            Ok(data)
        })
    }
    pub fn apply(&self, command: Value, now: i64) -> Result<(), String> {
        let date = date(now)?;
        self.0.runtime.block_on(async {
            match serde_json::from_value(command).map_err(|e| format!("Focus action: {e}"))? {
                FocusCommand::Pomodoro { action } => {
                    db::pomodoro_tasks::apply(&self.0.pool, action, now, &date).await?
                }
                FocusCommand::Free { action } => {
                    db::free_focus::apply(&self.0.pool, action, now).await?
                }
                FocusCommand::Due => {
                    let mut tx = self.0.pool.begin().await.map_err(|e| e.to_string())?;
                    db::complete_due_pomodoro_phase(&mut tx, &date, now).await?;
                    db::free_focus::complete_due(&mut tx, now).await?;
                    tx.commit().await.map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })
    }
    pub fn suspend(&self, now: i64) -> Result<(), String> {
        self.0.runtime.block_on(async {
            let mut tx = self.0.pool.begin().await.map_err(|e| e.to_string())?;

            db::pomodoro_tasks::pause_active(&mut tx, now).await?;
            db::free_focus::pause_active(&mut tx, now).await?;
            tx.commit().await.map_err(|e| e.to_string())
        })
    }
    pub fn uninstall_impact(
        &self,
        locale: &str,
        now: i64,
        fallback: &str,
    ) -> Result<Vec<String>, String> {
        let data = self.read(locale, now, &Value::Null)?;
        Ok(["free", "pomodoro"]
            .iter()
            .flat_map(|key| data[key].as_array().into_iter().flatten())
            .filter(|task| task["status"] == "running" || task["run"]["status"] == "running")
            .map(|task| {
                task["label"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .unwrap_or(fallback)
                    .to_owned()
            })
            .collect())
    }
}
