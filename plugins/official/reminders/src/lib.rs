use extism_pdk::*;
use patina_plugin_sdk::{Control, Event, Request, Response, Timer};
use serde_json::{Value, json};

#[plugin_fn]
pub fn panel(Json(request): Json<Request>) -> FnResult<Json<Response>> {
    let data = &request.data;
    let label = |key: &str| data["labels"][key].as_str().unwrap_or(key).to_string();
    let mut panel = Vec::new();
    let mut timer: Option<Timer> = None;
    let mut command = matches!(request.event, Event::Due).then(|| json!({"kind":"due"}));
    let mut state = request.state.clone();
    let mut editing = None;
    let mut button = |panel: &mut Vec<Control>, id: String, title: String, op: Value| {
        if matches!(&request.event, Event::Action(action) if action == &id) {
            command = Some(op);
        }
        panel.push(Control::Button { id, label: title });
    };
    let title = label("tools.remindersTitle");
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
        panel.push(Control::Text(format!(
            "{} · {}",
            title,
            item["local_at"].as_str().unwrap_or("")
        )));
        let edit = format!("edit-{id}");
        if matches!(&request.event,Event::Action(a) if *a==edit) {
            state["edit"] = id.into();
        }
        if state["edit"] == id {
            editing = Some(item);
        }
        panel.push(Control::Button {
            id: edit,
            label: label("tools.reminderEditTitle"),
        });
        button(
            &mut panel,
            format!("delete-{id}"),
            label("tools.activityReminderDelete"),
            json!({"kind":"cancel","id":id}),
        );
        match item["status"].as_str() {
            Some("scheduled") => {
                button(
                    &mut panel,
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
                        &mut panel,
                        format!("{action}-{id}"),
                        label(key),
                        json!({"kind":"confirm","id":id,"fired_at":item["fired_at"],"delay":delay}),
                    );
                }
            }
            Some("paused") => button(
                &mut panel,
                format!("enable-{id}"),
                label("tools.start"),
                json!({"kind":"edit","id":id,"label":title,"enabled":true,"at":at.max(request.now_ms+60000),"recurrence":item["recurrence"]}),
            ),
            _ => (),
        }
    }
    let item = editing.unwrap_or(&Value::Null);
    let recurrence = &item["recurrence"];
    for (id, key, default) in [
        (
            "name",
            "tools.reminderLabel",
            item["label"].as_str().unwrap_or(&title),
        ),
        ("minutes", "tools.reminderMinutesUnit", "5"),
        (
            "local",
            "tools.reminderTimeLabel",
            item["local_at"].as_str().unwrap_or(""),
        ),
    ] {
        panel.push(Control::Input {
            id: id.into(),
            label: label(key),
            value: default.into(),
        });
    }
    let kinds = [
        ("none", "tools.reminderRepeatNone"),
        ("interval", "tools.reminderRepeatInterval"),
        ("daily", "tools.reminderRepeatDaily"),
        ("weekly", "tools.reminderRepeatWeekly"),
        ("monthly", "tools.reminderRepeatMonthly"),
        ("yearly", "tools.reminderRepeatYearly"),
    ];
    panel.push(Control::Select {
        id: "repeat".into(),
        label: label("tools.reminderRepeatLabel"),
        value: recurrence["kind"].as_str().unwrap_or("none").into(),
        choices: kinds.map(|(v, k)| (v.into(), label(k))).into(),
    });
    panel.push(Control::Input {
        id: "interval".into(),
        label: label("tools.reminderRepeatInterval"),
        value: recurrence["minutes"].as_i64().unwrap_or(60).to_string(),
    });
    let weekdays = recurrence["weekdays"]
        .as_array()
        .map(|d| d.iter().map(Value::to_string).collect::<Vec<_>>().join(","))
        .unwrap_or_else(|| "1".into());
    panel.push(Control::Input {
        id: "weekdays".into(),
        label: format!("{} (1–7)", label("tools.reminderRepeatWeekly")),
        value: weekdays,
    });
    panel.push(Control::Submit {
        id: "new-reminder".into(),
        label: label(if editing.is_some() {
            "common.save"
        } else {
            "tools.newReminder"
        }),
    });
    if editing.is_some() {
        panel.push(Control::Button {
            id: "cancel-edit".into(),
            label: label("common.cancel"),
        });
    }
    if matches!(&request.event,Event::Action(a) if a=="cancel-edit") {
        state = Value::Null;
    }
    panel.push(Control::Text(label("tools.reminderModeUsage")));
    let rows = data["rules"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let visible = page("rule-page", rows.len(), &mut panel, &mut state);
    for r in &rows[visible] {
        let Some(id) = r["id"].as_i64() else { continue };
        let enabled = r["enabled"] == true;
        panel.push(Control::Text(format!(
            "{} · {} min",
            r["label_snapshot"].as_str().unwrap_or(""),
            r["limit_ms"].as_i64().unwrap_or(0) / 60000
        )));
        button(
            &mut panel,
            format!("toggle-usage-{id}"),
            label(if enabled {
                "tools.activityReminderDisable"
            } else {
                "tools.start"
            }),
            json!({"kind":"usage_enabled","id":id,"enabled":!enabled}),
        );
        panel.push(Control::Submit {
            id: format!("limit-{id}"),
            label: label("tools.activityReminderEdit"),
        });
    }
    panel.push(Control::Select {
        id: "target".into(),
        label: label("tools.activityReminderTargetLabel"),
        value: "app".into(),
        choices: [
            ("app", "tools.reminderModeApp"),
            ("category", "tools.reminderModeCategory"),
            ("web", "tools.reminderModeWeb"),
        ]
        .map(|(v, k)| (v.into(), label(k)))
        .into(),
    });
    panel.push(Control::Input {
        id: "value".into(),
        label: label("tools.activityReminderTargetLabel"),
        value: String::new(),
    });
    panel.push(Control::Input {
        id: "limit".into(),
        label: label("tools.activityReminderDurationLabel"),
        value: "30".into(),
    });
    panel.push(Control::Submit {
        id: "usage".into(),
        label: label("tools.reminderModeUsage"),
    });
    if let Event::Submit { id, fields } = &request.event
        && id == "new-reminder"
    {
        let minutes = fields
            .get("minutes")
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        let at = request.now_ms.saturating_add(minutes.saturating_mul(60000));
        let repeat = match fields.get("repeat").map(String::as_str) {
            None | Some("none") => Value::Null,
            Some("interval") => {
                json!({"kind":"interval","minutes":fields.get("interval").and_then(|s|s.parse::<u32>().ok()).unwrap_or(0)})
            }
            Some("weekly") => {
                json!({"kind":"weekly","weekdays":fields.get("weekdays").map(|s|s.split(',').map(|x|x.trim().parse::<u32>().unwrap_or(0)).collect::<Vec<_>>())})
            }
            Some(kind) => json!({"kind":kind}),
        };
        command = Some(if editing.is_some() {
            json!({"kind":"edit","id":item["id"],"enabled":item["status"]=="scheduled","label":fields.get("name"),"at":at,
            "local_at":fields.get("local"),"recurrence":repeat})
        } else {
            json!({"kind":"create","label":fields.get("name"),"at":at,"local_at":fields.get("local"),"recurrence":repeat})
        });
        state = Value::Null;
    }
    if let Event::Submit { id, fields } = &request.event {
        let minutes = fields
            .get("limit")
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);
        if id == "usage" {
            command = Some(
                json!({"kind":"usage","target":fields.get("target"),"value":fields.get("value"),"label":fields.get("name"),"minutes":minutes}),
            );
        }
        if let Some(rule) = id
            .strip_prefix("limit-")
            .and_then(|s| s.parse::<i64>().ok())
        {
            command = Some(json!({"kind":"usage_limit","id":rule,"minutes":minutes}));
        }
    }
    let reload = state != request.state && command.is_none();
    Ok(Json(Response {
        state,
        panel,
        timer,
        command,
        reload,
    }))
}
