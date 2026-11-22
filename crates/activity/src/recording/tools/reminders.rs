use super::{date, db, NativeToolData, UsageEvaluation};
use crate::domain::reminder_schedule::ReminderRecurrence;
use chrono::{Datelike, Local, NaiveDateTime, TimeZone};
use serde::Deserialize;
use serde_json::{json, Value};
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum ReminderCommand {
    Create {
        label: String,
        at: i64,
        local_at: Option<String>,
        recurrence: Option<Value>,
    },
    Edit {
        id: i64,
        label: String,
        at: i64,
        local_at: Option<String>,
        enabled: bool,
        recurrence: Option<Value>,
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
        display_name: Option<String>,
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
    UsageRemove {
        id: i64,
    },
    Extend {
        id: i64,
        at: i64,
        extension: crate::domain::tools::ActivityReminderExtension,
    },
    Due,
}

pub struct ReminderTasks(pub(super) NativeToolData);
impl ReminderTasks {
    pub fn pending(&self) -> Result<Vec<(i64, i64, String)>, String> {
        let rows = self
            .0
            .runtime
            .block_on(db::timed_reminders::pending_reminder_alerts(&self.0.pool))?;
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
        let rules = self
            .0
            .runtime
            .block_on(db::fetch_active_activity_reminder_rules(&self.0.pool))?;
        Ok(rules
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
        self.0.runtime.block_on(async {
            let mut tx = self.0.pool.begin().await.map_err(|e| e.to_string())?;
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
    pub fn has_scheduled_work(&self) -> Result<bool, String> {
        self.0.runtime.block_on(sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM tool_reminders WHERE status IN ('scheduled','pending_confirmation'))").fetch_one(&self.0.pool)).map_err(|e|e.to_string())
    }
    pub fn read(&self, _language: &str, now: i64, _view: &Value) -> Result<Value, String> {
        self.0.runtime.block_on(async {
            let reminders = db::fetch_visible_reminders(&self.0.pool).await?;
            let rules = db::fetch_active_activity_reminder_rules(&self.0.pool).await?;
            let local_at = |at| {
                Local
                    .timestamp_millis_opt(at)
                    .single()
                    .map(|local| local.format("%Y-%m-%d %H:%M").to_string())
            };
            let reminders: Vec<_> = reminders
                .iter()
                .map(|reminder| {
                    let mut row = json!(reminder);
                    row["local_at"] = json!(local_at(reminder.scheduled_at));
                    row
                })
                .collect();
            Ok(json!({
                "reminders": reminders, "rules": rules,
                "default_local_at": local_at(now.saturating_add(5 * 60_000)),
            }))
        })
    }
    pub fn apply(&self, command: Value, now: i64) -> Result<(), String> {
        let date = date(now)?;
        self.0.runtime.block_on(async {
            match serde_json::from_value(command).map_err(|e| format!("Reminder action: {e}"))? {
                ReminderCommand::Create {
                    label,
                    at,
                    local_at,
                    recurrence,
                } => {
                    let (at, recurrence) = resolve_schedule(local_at, at, recurrence)?;
                    if at <= now || label.trim().is_empty() {
                        return Err("A reminder needs a label and a future time".into());
                    }
                    db::timed_reminders::create_reminder(&self.0.pool, &label, at, recurrence, now)
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
                    let (at, recurrence) = resolve_schedule(local_at, at, recurrence)?;
                    db::timed_reminders::update_reminder(
                        &self.0.pool,
                        id,
                        &label,
                        at,
                        enabled,
                        recurrence,
                        now,
                    )
                    .await?;
                }
                ReminderCommand::Usage {
                    target,
                    value,
                    display_name,
                    minutes,
                    label,
                } => {
                    use crate::domain::tools::ActivityReminderTarget as Target;
                    let display_name = display_name
                        .as_deref()
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or(&value);
                    let target = match target.as_str() {
                        "app" => Target::App {
                            app_name: display_name.to_owned(),
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
                        &self.0.pool,
                        &target,
                        display_name,
                        minutes.saturating_mul(60_000),
                        &label,
                        now,
                    )
                    .await?;
                }
                ReminderCommand::UsageEnabled { id, enabled } => {
                    db::set_activity_reminder_enabled(&self.0.pool, id, enabled, now).await?
                }
                ReminderCommand::UsageRemove { id } => {
                    db::disable_activity_reminder_rule(&self.0.pool, id, now).await?
                }
                ReminderCommand::UsageLimit { id, minutes } => {
                    db::update_activity_reminder_limit(
                        &self.0.pool,
                        id,
                        minutes.saturating_mul(60000),
                        now,
                    )
                    .await?
                }
                ReminderCommand::Extend { id, at, extension } => {
                    db::extend_activity_reminder(
                        &self.0.pool,
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
                        &self.0.pool,
                        id,
                        fired_at,
                        delay,
                        now,
                    )
                    .await?
                }
                ReminderCommand::Cancel { id } => {
                    db::timed_reminders::cancel_reminder(&self.0.pool, id, now).await?
                }
                ReminderCommand::Due => {
                    let mut tx = self.0.pool.begin().await.map_err(|e| e.to_string())?;
                    db::timed_reminders::fire_due_reminders(&mut tx, now).await?;
                    tx.commit().await.map_err(|e| e.to_string())?;
                }
            }
            Ok(())
        })
    }
    pub fn suspend(&self, _now: i64) -> Result<(), String> {
        self.0.runtime.block_on(async {
            let mut tx=self.0.pool.begin().await.map_err(|e|e.to_string())?;

                    sqlx::query("UPDATE tool_reminders SET status='paused', fired_at=NULL WHERE status IN ('scheduled','pending_confirmation')")
                        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
                    sqlx::query("INSERT INTO tool_activity_reminder_states(rule_id,enabled) SELECT id,0 FROM tool_activity_reminder_rules WHERE disabled_at IS NULL ON CONFLICT(rule_id) DO UPDATE SET enabled=0")
                        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
            tx.commit().await.map_err(|e|e.to_string())
        })
    }
    pub fn delete_data(&self) -> Result<(), String> {
        self.0
            .runtime
            .block_on(db::delete_reminder_data(&self.0.pool))
            .map_err(|e| e.to_string())
    }
    pub fn uninstall_impact(
        &self,
        locale: &str,
        now: i64,
        fallback: &str,
    ) -> Result<Vec<String>, String> {
        let data = self.read(locale, now, &Value::Null)?;
        let mut labels = Vec::new();
        for (collection, label) in [("reminders", "label"), ("rules", "label_snapshot")] {
            for task in data[collection].as_array().into_iter().flatten() {
                if task["status"] == "scheduled"
                    || task["status"] == "pending_confirmation"
                    || task["enabled"] == true
                {
                    labels.push(
                        task[label]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .unwrap_or(fallback)
                            .to_owned(),
                    );
                }
            }
        }
        Ok(labels)
    }
}
fn resolve_schedule(
    local_at: Option<String>,
    fallback: i64,
    recurrence: Option<Value>,
) -> Result<(i64, Option<ReminderRecurrence>), String> {
    let at = local_time(local_at, fallback)?;
    let rule = match recurrence {
        Some(value) if value == "weekly" => {
            let local = Local
                .timestamp_millis_opt(at)
                .single()
                .ok_or("Invalid reminder time")?;
            Some(ReminderRecurrence::Weekly {
                weekdays: vec![local.weekday().number_from_monday()],
            })
        }
        Some(rule) => {
            Some(serde_json::from_value(rule).map_err(|e| format!("Reminder recurrence: {e}"))?)
        }
        None => None,
    };
    Ok((at, rule))
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
