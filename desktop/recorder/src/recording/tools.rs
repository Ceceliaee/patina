use crate::data::repositories::tools as db;
use crate::domain::{
    free_focus::FreeFocusAction,
    localization::{text, Locale},
    reminder_schedule::ReminderRecurrence,
    tools::PomodoroTaskAction,
};
use chrono::{Local, NaiveDateTime, TimeZone};
use serde::Deserialize;
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::SqlitePool;

#[derive(Clone)]
pub struct NativeToolData {
    pool: SqlitePool,
    runtime: tokio::runtime::Handle,
}

pub struct UsageEvaluation {
    pub watched: Vec<i64>,
    pub next: Option<i64>,
    pub alerts: Vec<(i64, String)>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub enum ToolTarget {
    Focus,
    Reminders,
}

impl ToolTarget {
    pub fn id(self) -> &'static str {
        match self {
            Self::Focus => "patina.focus",
            Self::Reminders => "patina.reminders",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Shortcut {
    pub target: ToolTarget,
    pub label: String,
    pub at: i64,
    pub counting_up: bool,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum FocusCommand {
    Pomodoro { action: PomodoroTaskAction },
    Free { action: FreeFocusAction },
    Due,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ReminderCommand {
    Create {
        label: String,
        at: i64,
        local_at: Option<String>,
        recurrence: Option<ReminderRecurrence>,
    },
    Edit {
        id: i64,
        label: String,
        at: i64,
        local_at: Option<String>,
        enabled: bool,
        recurrence: Option<ReminderRecurrence>,
    },
    Cancel {
        id: i64,
    },
    Confirm {
        id: i64,
        fired_at: i64,
        delay: Option<u32>,
    },
    Usage {
        target: String,
        value: String,
        minutes: i64,
        label: String,
    },
    UsageEnabled {
        id: i64,
        enabled: bool,
    },
    UsageLimit {
        id: i64,
        minutes: i64,
    },
    Extend {
        id: i64,
        at: i64,
        extension: crate::domain::tools::ActivityReminderExtension,
    },
    Due,
}

impl NativeToolData {
    pub fn last_section(&self) -> Result<Option<String>, String> {
        self.runtime
            .block_on(
                sqlx::query_scalar(
                    "SELECT value FROM settings WHERE key = 'tools_selected_section'",
                )
                .fetch_optional(&self.pool),
            )
            .map_err(|e| e.to_string())
    }

    pub fn remember_section(&self, id: &str) -> Result<(), String> {
        self.runtime.block_on(
            sqlx::query("INSERT INTO settings(key,value) VALUES ('tools_selected_section',?)
                         ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value <> excluded.value")
                .bind(id).execute(&self.pool)
        ).map(|_| ()).map_err(|e| e.to_string())
    }

    pub fn preferences(&self) -> Result<crate::NoticePreferences, String> {
        self.runtime
            .block_on(db::notification_preferences::load(&self.pool))
    }
    pub fn save_preferences(
        &self,
        patch: crate::NoticePreferencesPatch,
    ) -> Result<crate::NoticePreferences, String> {
        let sound = patch.sound;
        let saved = self
            .runtime
            .block_on(db::notification_preferences::save(&self.pool, patch))?;
        if let Some(sound) = sound {
            Self::play(sound);
        }
        Ok(saved)
    }
    pub fn play(sound: crate::NoticeSound) {
        crate::platform::windows::notification_sound::play(sound);
    }

    pub fn current_focus(&self, kind: &str, id: i64, revision: i64) -> Result<bool, String> {
        let sql=match kind {
            "pomodoro"=>"SELECT EXISTS(SELECT 1 FROM tool_pomodoro_runs r LEFT JOIN tool_pomodoro_tasks t ON t.run_id=r.id WHERE r.id=? AND r.updated_at=? AND t.deleted_at IS NULL)",
            "free"=>"SELECT EXISTS(SELECT 1 FROM tool_free_focus WHERE id=? AND updated_at=? AND deleted_at IS NULL)",
            _=>return Ok(false),
        };
        self.runtime
            .block_on(
                sqlx::query_scalar(sqlx::AssertSqlSafe(sql))
                    .bind(id)
                    .bind(revision)
                    .fetch_one(&self.pool),
            )
            .map_err(|e| e.to_string())
    }
    pub fn pending(&self) -> Result<Vec<(i64, i64, String)>, String> {
        let rows = self
            .runtime
            .block_on(db::timed_reminders::pending_reminder_alerts(&self.pool))?;
        Ok(rows
            .into_iter()
            .filter_map(|r| Some((r.id, r.fired_at?, r.label)))
            .collect())
    }

    pub fn current_usage(
        &self,
        pending: &std::collections::BTreeMap<i64, i64>,
        now: i64,
    ) -> Result<Vec<i64>, String> {
        if pending.is_empty() {
            return Ok(vec![]);
        }
        let day = date(now)?;
        let snapshot = self
            .runtime
            .block_on(db::fetch_tools_snapshot(&self.pool, now, &day))?;
        Ok(snapshot
            .activity_reminder_rules
            .into_iter()
            .filter_map(|rule| {
                let at = *pending.get(&rule.id)?;
                (rule.enabled
                    && rule.disabled_at.is_none()
                    && rule.suspension_reason.is_none()
                    && rule.last_fired_date_key.as_deref() == Some(day.as_str())
                    && rule.last_fired_at == Some(at)
                    && rule.last_extended_alert_at != Some(at)
                    && rule.limit_for_date(&day).is_some())
                .then_some(rule.id)
            })
            .collect())
    }
    pub fn usage(&self, now: i64, pending: &[i64]) -> Result<UsageEvaluation, String> {
        let (start, end) = crate::platform::clock::local_day_range_at(now)?;
        let date = date(now)?;
        self.runtime.block_on(async {
            let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
            let evaluation = db::fire_due_activity_reminders(
                &mut tx,
                &date,
                start,
                now,
                pending,
                &crate::domain::tools::ActivityReminderCheck::All,
            )
            .await?;
            tx.commit().await.map_err(|e| e.to_string())?;
            let active = !evaluation.watch.rules.is_empty();
            let next = active.then(|| evaluation.watch.next_check_at().unwrap_or(end).min(end));
            Ok(UsageEvaluation {
                watched: evaluation
                    .watch
                    .rules
                    .into_iter()
                    .map(|rule| rule.id)
                    .collect(),
                next,
                alerts: evaluation
                    .notifications
                    .into_iter()
                    .map(|n| {
                        (
                            n.rule_id,
                            if n.message.is_empty() {
                                n.target_label
                            } else {
                                n.message
                            },
                        )
                    })
                    .collect(),
            })
        })
    }
    pub fn shortcuts(
        &self,
        focus: bool,
        reminders: bool,
        locale: &str,
        now: i64,
    ) -> Result<Vec<Shortcut>, String> {
        use crate::domain::mini_window::content::{build_mini_status_snapshot, MiniToolState};
        if !focus && !reminders {
            return Ok(vec![]);
        }
        let s = self
            .runtime
            .block_on(db::fetch_tools_snapshot(&self.pool, now, &date(now)?))?;
        let snapshot = build_mini_status_snapshot(s, now);
        let mut result = Vec::new();
        if let Some(t) = snapshot
            .tools
            .into_iter()
            .find(|t| focus && t.state == MiniToolState::Running)
        {
            let label = if t.label.is_empty() {
                text(Locale::from_tag(Some(locale)), "tools.pomodoroTitle")
            } else {
                t.label
            };
            result.push(Shortcut {
                target: ToolTarget::Focus,
                at: if t.counting_up {
                    now - t.value_ms
                } else {
                    now + t.value_ms
                },
                counting_up: t.counting_up,
                label,
            });
        }
        if let Some(r) = snapshot.reminder.filter(|_| reminders) {
            result.push(Shortcut {
                target: ToolTarget::Reminders,
                at: r.scheduled_at,
                counting_up: false,
                label: r.label,
            });
        }
        Ok(result)
    }
    pub(super) fn new(pool: SqlitePool, runtime: tokio::runtime::Handle) -> Self {
        Self { pool, runtime }
    }

    pub fn has_scheduled_work(&self, id: &str) -> Result<bool, String> {
        let sql=match id {
            "patina.focus"=>"SELECT EXISTS(SELECT 1 FROM tool_pomodoro_runs WHERE status='running') OR EXISTS(SELECT 1 FROM tool_free_focus WHERE status='running' AND phase='break' AND deleted_at IS NULL)",
            "patina.reminders"=>"SELECT EXISTS(SELECT 1 FROM tool_reminders WHERE status IN ('scheduled','pending_confirmation'))",
            _=>return Ok(false),
        };
        self.runtime
            .block_on(sqlx::query_scalar(sqlx::AssertSqlSafe(sql)).fetch_one(&self.pool))
            .map_err(|e| e.to_string())
    }

    pub fn read(&self, id: &str, language: &str, now: i64, view: &Value) -> Result<Value, String> {
        let locale = Locale::from_tag(Some(language));
        let date = date(now)?;
        self.runtime.block_on(async {
            let s = db::fetch_tools_snapshot(&self.pool, now, &date).await?;
            let (mut data, keys): (Value, &[&str]) = match id {
                "patina.focus" => (json!({"pomodoro":s.pomodoro_tasks, "free":s.free_focus_tasks}),
                    &["tools.pomodoroTitle", "tools.focusModePomodoro", "tools.focusModeFree", "tools.freeFocusStart",
                    "tools.freeFocusFinish", "tools.freeFocusRest", "tools.pomodoroStartNextGroup", "tools.pause",
                    "tools.start", "tools.reset", "tools.pomodoroTaskCreate", "tools.focusDetails", "tools.pomodoroTaskName",
                    "tools.focusDuration","tools.shortBreakDuration","tools.longBreakDuration","tools.longBreakEvery",
                    "tools.activityReminderEdit","tools.freeRestProportion","tools.focusHistoryEmpty","tools.focusHistoryOpen","tools.focusHistoryEnded","common.save","common.cancel"]),
                "patina.reminders" => (json!({"reminders":s.reminders.iter().map(|r|{
                    let mut v=json!(r);v["local_at"]=json!(Local.timestamp_millis_opt(r.scheduled_at).single().map(|t|t.format("%Y-%m-%d %H:%M").to_string()));v
                }).collect::<Vec<_>>(), "rules":s.activity_reminder_rules}),
                    &["tools.remindersTitle", "tools.newReminder", "tools.pause", "tools.start", "tools.reminderSnooze",
                    "tools.reminderConfirmComplete", "tools.reminderEmpty", "tools.reminderLabel", "tools.reminderMinutesUnit",
                    "tools.reminderTimeLabel","tools.reminderRepeatLabel","tools.reminderRepeatNone","tools.reminderRepeatDaily",
                    "tools.reminderRepeatWeekly","tools.reminderRepeatMonthly","tools.reminderRepeatYearly","tools.reminderRepeatInterval",
                    "tools.activityReminderEdit","tools.activityReminderDelete","tools.reminderEditTitle","common.save","common.cancel",
                    "tools.reminderModeUsage","tools.reminderModeApp","tools.reminderModeCategory","tools.reminderModeWeb",
                    "tools.activityReminderTargetLabel","tools.activityReminderDurationLabel","tools.activityReminderDisable"]),
                _ => return Err("Unknown task data owner".into()),
            };
            data["labels"] = json!(keys.iter().map(|key| (*key,text(locale,key))).collect::<std::collections::BTreeMap<_,_>>());
            for key in ["miniWindow.previousPage","miniWindow.nextPage"]{data["labels"][key]=json!(text(locale,key));}
            if let Some(task)=view["history_id"].as_i64().filter(|_| id=="patina.focus") {
                use crate::domain::focus_history::FocusKind;
                let kind=if view["kind"]=="free" {FocusKind::Free} else {FocusKind::Pomodoro};
                data["history"]=json!(db::focus_history::read(&self.pool,kind,task).await?);
            }
            Ok(data)
        })
    }

    pub fn apply(&self, id: &str, command: Value, now: i64) -> Result<(), String> {
        let date = date(now)?;
        self.runtime.block_on(async {
            match id {
                "patina.focus" => match serde_json::from_value(command)
                    .map_err(|e| format!("Focus action: {e}"))?
                {
                    FocusCommand::Pomodoro { action } => {
                        db::pomodoro_tasks::apply(&self.pool, action, now, &date).await?
                    }
                    FocusCommand::Free { action } => {
                        db::free_focus::apply(&self.pool, action, now).await?
                    }
                    FocusCommand::Due => {
                        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
                        db::complete_due_pomodoro_phase(&mut tx, &date, now).await?;
                        db::free_focus::complete_due(&mut tx, now).await?;
                        tx.commit().await.map_err(|e| e.to_string())?;
                    }
                },
                "patina.reminders" => match serde_json::from_value(command)
                    .map_err(|e| format!("Reminder action: {e}"))?
                {
                    ReminderCommand::Create {
                        label,
                        at,
                        local_at,
                        recurrence,
                    } => {
                        let at = local_time(local_at, at)?;
                        if at <= now || label.trim().is_empty() {
                            return Err("A reminder needs a label and a future time".into());
                        }
                        db::timed_reminders::create_reminder(
                            &self.pool, &label, at, recurrence, now,
                        )
                        .await?;
                    }
                    ReminderCommand::Edit {
                        id,
                        label,
                        at,
                        local_at,
                        enabled,
                        recurrence,
                    } => {
                        let at = local_time(local_at, at)?;
                        db::timed_reminders::update_reminder(
                            &self.pool, id, &label, at, enabled, recurrence, now,
                        )
                        .await?;
                    }
                    ReminderCommand::Usage {
                        target,
                        value,
                        minutes,
                        label,
                    } => {
                        use crate::domain::tools::ActivityReminderTarget as Target;
                        let target = match target.as_str() {
                            "app" => Target::App {
                                app_name: value.clone(),
                                exe_name: Some(value.clone()),
                            },
                            "category" => Target::Category {
                                category_id: value.clone(),
                            },
                            "web" => Target::Web {
                                normalized_domain: value.clone(),
                            },
                            _ => return Err("Unknown usage target".into()),
                        };
                        db::create_activity_reminder_rule(
                            &self.pool,
                            &target,
                            &value,
                            minutes.saturating_mul(60_000),
                            &label,
                            now,
                        )
                        .await?;
                    }
                    ReminderCommand::UsageEnabled { id, enabled } => {
                        db::set_activity_reminder_enabled(&self.pool, id, enabled, now).await?
                    }
                    ReminderCommand::UsageLimit { id, minutes } => {
                        db::update_activity_reminder_limit(
                            &self.pool,
                            id,
                            minutes.saturating_mul(60000),
                            now,
                        )
                        .await?
                    }
                    ReminderCommand::Extend { id, at, extension } => {
                        db::extend_activity_reminder(
                            &self.pool,
                            id,
                            at,
                            extension,
                            &date,
                            crate::platform::clock::local_day_range_at(now)?.0,
                            now,
                        )
                        .await?
                    }
                    ReminderCommand::Confirm {
                        id,
                        fired_at,
                        delay,
                    } => {
                        db::timed_reminders::resolve_reminder_alert(
                            &self.pool, id, fired_at, delay, now,
                        )
                        .await?
                    }
                    ReminderCommand::Cancel { id } => {
                        db::timed_reminders::cancel_reminder(&self.pool, id, now).await?
                    }
                    ReminderCommand::Due => {
                        let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
                        db::timed_reminders::fire_due_reminders(&mut tx, now).await?;
                        tx.commit().await.map_err(|e| e.to_string())?;
                    }
                },
                _ => return Err("Unknown task data owner".into()),
            }
            Ok(())
        })
    }

    pub fn suspend(&self, id: &str, now: i64) -> Result<(), String> {
        self.runtime.block_on(async {
            let mut tx = self.pool.begin().await.map_err(|e| e.to_string())?;
            match id {
                "patina.focus" => {
                    db::pomodoro_tasks::pause_active(&mut tx,now).await?;
                    db::free_focus::pause_active(&mut tx,now).await?;
                }
                "patina.reminders" => {
                    sqlx::query("UPDATE tool_reminders SET status='paused', fired_at=NULL WHERE status IN ('scheduled','pending_confirmation')")
                        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
                    sqlx::query("INSERT INTO tool_activity_reminder_states(rule_id,enabled) SELECT id,0 FROM tool_activity_reminder_rules WHERE disabled_at IS NULL ON CONFLICT(rule_id) DO UPDATE SET enabled=0")
                        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
                }
                _ => return Err("Unknown task data owner".into()),
            }
            tx.commit().await.map_err(|e| e.to_string())
        })
    }
}

fn date(now: i64) -> Result<String, String> {
    Local
        .timestamp_millis_opt(now)
        .single()
        .map(|t| t.format("%Y-%m-%d").to_string())
        .ok_or_else(|| "Invalid task time".into())
}

fn local_time(input: Option<String>, fallback: i64) -> Result<i64, String> {
    let Some(input) = input.filter(|s| !s.trim().is_empty()) else {
        return Ok(fallback);
    };
    let civil =
        NaiveDateTime::parse_from_str(input.trim(), "%Y-%m-%d %H:%M").map_err(|e| e.to_string())?;
    Local
        .from_local_datetime(&civil)
        .earliest()
        .map(|t| t.timestamp_millis())
        .ok_or_else(|| "This local time does not exist".into())
}
