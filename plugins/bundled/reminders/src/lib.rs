mod page;
mod notification;
use extism_pdk::*;
use patina_plugin_sdk::{Control, Event, Request, Response, Timer};
use serde_json::{Value, json};

const REPEAT_KINDS: [(&str, &str); 6] = [
    ("none", "tools.reminderRepeatNone"),
    ("interval", "tools.reminderRepeatInterval"),
    ("daily", "tools.reminderRepeatDaily"),
    ("weekly", "tools.reminderRepeatWeekly"),
    ("monthly", "tools.reminderRepeatMonthly"),
    ("yearly", "tools.reminderRepeatYearly"),
];

#[plugin_fn]
pub fn panel(Json(request): Json<Request>) -> FnResult<Json<Response>> {
    let data = &request.data;
    let label = |key: &str| request.text(key);
    let mut panel = Vec::new();
    let mut timer: Option<Timer> = None;
    let mut command = notification::command(&request.event).or_else(|| matches!(request.event, Event::Due).then(|| json!({"kind":"due"})));
    let mut state = request.state.clone();
    let mut editing = None;
    let mut button = |actions: &mut Vec<(String, String)>, id: String, title: String, op: Value| {
        if matches!(&request.event, Event::Action(action) if action == &id) {
            command = Some(op);
        }
        actions.push((id, title));
    };
    let page = |key: &str, count, panel: &mut Vec<Control>, state: &mut Value| {
        patina_plugin_sdk::page_range(
            key,
            count,
            &request,
            state,
            panel,
            &label("miniWindow.previousPage"),
            &label("miniWindow.nextPage"),
        )
    };
    let rows = data["reminders"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let visible = page("reminder-page", rows.len(), &mut panel, &mut state);
    for (i, item) in rows.iter().enumerate() {
        let Some(id) = item["id"].as_i64() else {
            continue;
        };
        let title = item["label"].as_str().unwrap_or("");
        let Some(at) = item["scheduled_at"].as_i64() else {
            continue;
        };
        if item["status"] == "scheduled" && timer.as_ref().is_none_or(|t| t.at_ms > at) {
            timer = Some(Timer {
                at_ms: at,
                label: title.into(),
                task: None,
            });
        }
        if !visible.contains(&i) {
            continue;
        }
        let mut actions = Vec::new();
        let edit = format!("edit-{id}");
        if matches!(&request.event,Event::Action(a) if *a==edit) {
            state["edit"] = id.into();
        }
        if state["edit"] == id {
            editing = Some(item);
        }
        match item["status"].as_str() {
            Some("scheduled") => {
                button(
                    &mut actions,
                    format!("pause-{id}"),
                    label("tools.pause"),
                    json!({"kind":"edit","id":id,"label":title,"enabled":false,"at":at,"recurrence":item["recurrence"]}),
                );
            }
            Some("pending_confirmation") => {
                for (action, key, delay) in [
                    ("confirm", "tools.reminderConfirmComplete", None),
                    ("later", "tools.reminderSnooze", Some(5)),
                ] {
                    button(
                        &mut actions,
                        format!("{action}-{id}"),
                        label(key),
                        json!({"kind":"confirm","id":id,"fired_at":item["fired_at"],"delay":delay}),
                    );
                }
            }
            Some("paused") => button(
                &mut actions,
                format!("enable-{id}"),
                label("tools.start"),
                json!({"kind":"edit","id":id,"label":title,"enabled":true,"at":at.max(request.now_ms+60000),"recurrence":item["recurrence"]}),
            ),
            _ => (),
        }
        actions.push((edit, label("tools.reminderEditTitle")));
        button(
            &mut actions,
            format!("delete-{id}"),
            label("tools.activityReminderDelete"),
            json!({"kind":"cancel","id":id}),
        );
        let mut detail = item["local_at"].as_str().unwrap_or_default().to_owned();
        if let Some((_, key)) = REPEAT_KINDS
            .iter()
            .find(|(kind, _)| item["recurrence"]["kind"] == *kind)
        {
            detail.push_str(&format!(" ･ {}", label(key)));
        }
        let status = match item["status"].as_str() {
            Some("fired") => Some("tools.reminderCompleted"),
            Some("pending_confirmation") => Some("tools.reminderPendingConfirmation"),
            _ => None,
        };
        if let Some(key) = status {
            detail.push_str(&format!(" ･ {}", label(key)));
        }
        panel.push(Control::ListRow {
            id: format!("reminder-{id}"),
            title: title.into(),
            detail,
            clock: None,
            actions,
        });
    }
    let item = editing.unwrap_or(&Value::Null);
    let recurrence = &item["recurrence"];
    for (id, key, default) in [
        (
            "name",
            "tools.reminderLabel",
            item["label"].as_str().unwrap_or_default(),
        ),
        (
            "local",
            "tools.reminderTimeLabel",
            item["local_at"]
                .as_str()
                .or_else(|| data["default_local_at"].as_str())
                .unwrap_or_default(),
        ),
    ] {
        panel.push(Control::Input {
            id: id.into(),
            label: label(key),
            value: default.into(),
        });
    }
    panel.push(Control::Select {
        id: "repeat".into(),
        label: label("tools.reminderRepeatLabel"),
        value: recurrence["kind"].as_str().unwrap_or("none").into(),
        choices: REPEAT_KINDS.map(|(v, k)| (v.into(), label(k))).into(),
    });
    panel.push(Control::Input {
        id: "interval".into(),
        label: label("tools.reminderRepeatInterval"),
        value: recurrence["minutes"].as_i64().unwrap_or(60).to_string(),
    });
    let timed_submit = item["id"].as_i64().map_or_else(
        || "new-reminder".to_owned(),
        |id| format!("save-reminder-{id}"),
    );
    panel.push(Control::Submit {
        id: timed_submit.clone(),
        label: label(if editing.is_some() {
            "common.save"
        } else {
            "tools.createReminder"
        }),
    });
    if editing.is_some() {
        panel.push(Control::Button {
            id: "cancel-edit".into(),
            label: label("common.cancel"),
        });
    }
    if matches!(&request.event,Event::Action(a) if a=="cancel-edit") {
        state["edit"] = Value::Null;
    }
    let rows = data["rules"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let visible = page("rule-page", rows.len(), &mut panel, &mut state);
    let mut editing_rule = None;
    for r in &rows[visible] {
        let Some(id) = r["id"].as_i64() else { continue };
        let enabled = r["enabled"] == true;
        let mut actions = Vec::new();
        button(
            &mut actions,
            format!("{}-usage-{id}", if enabled { "pause" } else { "enable" }),
            label(if enabled {
                "tools.activityReminderDisable"
            } else {
                "tools.start"
            }),
            json!({"kind":"usage_enabled","id":id,"enabled":!enabled}),
        );
        let edit = format!("edit-rule-{id}");
        if matches!(&request.event, Event::Action(a) if a == &edit) {
            state["edit_rule"] = id.into();
        }
        if state["edit_rule"] == id {
            editing_rule = Some((id, r["limit_ms"].as_i64().unwrap_or(0) / 60000));
        }
        actions.push((edit, label("tools.activityReminderEdit")));
        button(
            &mut actions,
            format!("delete-rule-{id}"),
            label("tools.activityReminderDelete"),
            json!({"kind":"usage_remove","id":id}),
        );
        panel.push(Control::ListRow {
            id: format!("rule-{id}"),
            title: r["label_snapshot"].as_str().unwrap_or_default().into(),
            detail: label("tools.minuteValue").replace(
                "{minutes}",
                &(r["limit_ms"].as_i64().unwrap_or_default() / 60_000).to_string(),
            ),
            clock: None,
            actions,
        });
    }
    panel.push(Control::Input {
        id: "target".into(),
        label: label("tools.activityReminderTargetLabel"),
        value: String::new(),
    });
    panel.push(Control::Input {
        id: "limit".into(),
        label: label("tools.activityReminderDurationLabel"),
        value: editing_rule.map_or(30, |(_, minutes)| minutes).to_string(),
    });
    panel.push(Control::Submit {
        id: editing_rule.map_or_else(|| "usage".into(), |(id, _)| format!("limit-{id}")),
        label: label(if editing_rule.is_some() {
            "common.save"
        } else {
            "tools.createReminder"
        }),
    });
    if editing_rule.is_some() {
        panel.push(Control::Button {
            id: "cancel-rule-edit".into(),
            label: label("common.cancel"),
        });
    }
    if matches!(&request.event, Event::Action(a) if a == "cancel-rule-edit") {
        state["edit_rule"] = Value::Null;
    }
    if let Event::Submit { id, fields } = &request.event
        && *id == timed_submit
    {
        let minutes = fields
            .get("minutes")
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let at = request.now_ms.saturating_add(minutes.saturating_mul(60000));
        let default_name = label("tools.defaultReminderLabel");
        let name = fields
            .get("name")
            .map(String::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(&default_name);
        let repeat = match fields.get("repeat").map(String::as_str) {
            None | Some("none") => Value::Null,
            Some("interval") => {
                json!({"kind":"interval","minutes":fields.get("interval").and_then(|s|s.parse::<u32>().ok()).unwrap_or(0)})
            }
            Some("weekly") => json!("weekly"),
            Some(kind) => json!({"kind":kind}),
        };
        command = Some(if editing.is_some() {
            json!({"kind":"edit","id":item["id"],"enabled":item["status"]=="scheduled" || item["status"]=="fired","label":name,"at":at,
            "local_at":fields.get("local"),"recurrence":repeat})
        } else {
            json!({"kind":"create","label":name,"at":at,"local_at":fields.get("local"),"recurrence":repeat})
        });
        state["edit"] = Value::Null;
    }
    if let Event::Submit { id, fields } = &request.event {
        let minutes = fields
            .get("limit")
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        if id == "usage" {
            let target = serde_json::from_str::<patina_plugin_sdk::layout::SelectedActivityTarget>(
                fields.get("target").map(String::as_str).unwrap_or_default(),
            )?;
            command = Some(
                json!({"kind":"usage","target":target.kind,"value":target.value,
                "display_name":target.label,"label":"","minutes":minutes}),
            );
        }
        if let Some(rule) = id
            .strip_prefix("limit-")
            .and_then(|s| s.parse::<i64>().ok())
        {
            command = Some(json!({"kind":"usage_limit","id":rule,"minutes":minutes}));
            state["edit_rule"] = Value::Null;
        }
    }
    let reload = state != request.state && command.is_none();
    let mut layout = page::layout(&panel, &request);
    layout.remember_tab(&mut state, &request.event);
    panel.push(Control::Page(Box::new(layout)));
    Ok(Json(Response {
        state,
        panel,
        timer,
        command,
        reload,
    }))
}
