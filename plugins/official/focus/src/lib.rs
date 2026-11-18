use extism_pdk::*;
use patina_plugin_sdk::{Control, Event, Request, Response, Timer};
use serde_json::{Value, json};

#[plugin_fn]
pub fn panel(Json(request): Json<Request>) -> FnResult<Json<Response>> {
    Ok(Json(view(request)))
}

fn view(request: Request) -> Response {
    let data = &request.data;
    let label = |key: &str| data["labels"][key].as_str().unwrap_or(key).to_string();
    let mut panel = Vec::new();
    let mut command = matches!(request.event, Event::Due).then(|| json!({"kind":"due"}));
    let mut timer = None;
    let mut state = request.state.clone();
    let mut reload = false;
    let mut editor: Option<(&str, i64, &Value)> = None;
    let mut button = |panel: &mut Vec<Control>, id: String, title: String, op: Value| {
        if matches!(&request.event, Event::Action(action) if action == &id) {
            command = Some(op);
        }
        panel.push(Control::Button { id, label: title });
    };
    let focus = label("tools.focusModePomodoro");
    panel.push(Control::Text(focus.clone()));
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
    let rows = data["pomodoro"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let visible = page("pomodoro-page", rows.len(), &mut panel, &mut state);
    for (i, task) in rows.iter().enumerate() {
        let start_row = panel.len();
        let run = &task["run"];
        let Some(id) = run["id"].as_i64() else {
            continue;
        };
        let title = task["label"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or(&focus);
        let running = run["status"] == "running";
        let remaining = run["phase_remaining_ms"].as_i64().unwrap_or_default();
        let at = run["phase_started_at"]
            .as_i64()
            .unwrap_or(request.now_ms)
            .saturating_add(remaining);
        let left = if running {
            at.saturating_sub(request.now_ms).max(0)
        } else {
            remaining
        };
        panel.push(if running {
            Control::Clock {
                label: title.into(),
                anchor_ms: at,
                counting_up: false,
            }
        } else {
            Control::Text(format!(
                "{title} · {:02}:{:02}",
                left / 60000,
                left / 1000 % 60
            ))
        });
        if running {
            timer = Some(Timer {
                at_ms: at,
                label: title.into(),
                task: Some(("pomodoro".into(), id)),
            });
        }
        if !visible.contains(&i) {
            panel.truncate(start_row);
            continue;
        }
        let (action, key) = if running {
            ("pause", "tools.pause")
        } else {
            ("resume", "tools.start")
        };
        button(
            &mut panel,
            format!("{action}-pomodoro-{id}"),
            label(key),
            json!({"kind":"pomodoro","action":{"kind":action,"id":id}}),
        );
        button(
            &mut panel,
            format!("reset-pomodoro-{id}"),
            label("tools.reset"),
            json!({"kind":"pomodoro","action":{"kind":"reset","id":id}}),
        );
        detail_buttons(
            &mut panel,
            &request,
            &mut state,
            &mut reload,
            "pomodoro",
            id,
        );
        if state["edit_id"] == id && state["kind"] == "pomodoro" {
            editor = Some(("pomodoro", id, task));
        }
    }
    let free = label("tools.focusModeFree");
    panel.push(Control::Text(free.clone()));
    let rows = data["free"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let visible = page("free-page", rows.len(), &mut panel, &mut state);
    for (i, task) in rows.iter().enumerate() {
        let start_row = panel.len();
        let Some(id) = task["id"].as_i64() else {
            continue;
        };
        let title = task["label"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or(&free);
        let running = task["status"] == "running";
        let start = task["started_at"].as_i64().unwrap_or(request.now_ms);
        let elapsed = task["elapsed_ms"].as_i64().unwrap_or_default()
            + if running && task["phase"] == "focus" {
                (request.now_ms - start).max(0)
            } else {
                0
            };
        panel.push(if running {
            let up = task["phase"] == "focus";
            let anchor = if up {
                request.now_ms - elapsed
            } else {
                start.saturating_add(task["rest_remaining_ms"].as_i64().unwrap_or_default())
            };
            Control::Clock {
                label: title.into(),
                anchor_ms: anchor,
                counting_up: up,
            }
        } else {
            Control::Text(format!(
                "{title} · {:02}:{:02}",
                elapsed / 60000,
                elapsed / 1000 % 60
            ))
        });
        if running && task["phase"] == "break" {
            timer = Some(Timer {
                at_ms: start.saturating_add(task["rest_remaining_ms"].as_i64().unwrap_or_default()),
                label: title.into(),
                task: Some(("free".into(), id)),
            });
        }
        if !visible.contains(&i) {
            panel.truncate(start_row);
            continue;
        }
        let (action, key) = if running {
            ("pause", "tools.pause")
        } else {
            ("resume", "tools.start")
        };
        button(
            &mut panel,
            format!("{action}-free-{id}"),
            label(key),
            json!({"kind":"free","action":{"kind":action,"id":id}}),
        );
        button(
            &mut panel,
            format!("finish-free-{id}"),
            label("tools.freeFocusFinish"),
            json!({"kind":"free","action":{"kind":"finish","id":id}}),
        );
        detail_buttons(&mut panel, &request, &mut state, &mut reload, "free", id);
        if state["edit_id"] == id && state["kind"] == "free" {
            editor = Some(("free", id, task));
        }
    }
    if let Some(groups) = data["history"].as_array() {
        if groups.is_empty() {
            panel.push(Control::Text(label("tools.focusHistoryEmpty")));
        }
        let visible = page("history-page", groups.len(), &mut panel, &mut state);
        for group in &groups[visible] {
            if let Some(spans) = group["spans"].as_array() {
                let elapsed = spans
                    .iter()
                    .filter_map(|span| {
                        Some(
                            span["endedAt"]
                                .as_i64()
                                .unwrap_or(request.now_ms)
                                .saturating_sub(span["startedAt"].as_i64()?)
                                .max(0),
                        )
                    })
                    .fold(0_i64, i64::saturating_add);
                let status = if group["outcome"] == "open" {
                    "tools.focusHistoryOpen"
                } else {
                    "tools.focusHistoryEnded"
                };
                panel.push(Control::Text(format!(
                    "{} · {} min",
                    label(status),
                    elapsed / 60000
                )));
            }
        }
    }
    let task = editor.map(|(_, _, t)| t).unwrap_or(&Value::Null);
    let run = &task["run"];
    for (id, key, value) in [
        (
            "name",
            "tools.pomodoroTaskName",
            task["label"].as_str().unwrap_or("").to_owned(),
        ),
        (
            "duration",
            "tools.focusDuration",
            (run["focus_ms"].as_i64().unwrap_or(1_500_000) / 60_000).to_string(),
        ),
        (
            "short",
            "tools.shortBreakDuration",
            task["rest_minutes"]
                .as_i64()
                .unwrap_or(run["short_break_ms"].as_i64().unwrap_or(300_000) / 60_000)
                .to_string(),
        ),
        (
            "long",
            "tools.longBreakDuration",
            (run["long_break_ms"].as_i64().unwrap_or(900_000) / 60_000).to_string(),
        ),
        (
            "rounds",
            "tools.longBreakEvery",
            run["long_break_every"].as_i64().unwrap_or(4).to_string(),
        ),
        (
            "ratio",
            "tools.freeRestProportion",
            task["rest_ratio"]
                .as_i64()
                .filter(|_| task["rest_mode"] == "ratio")
                .map(|n| n.to_string())
                .unwrap_or_default(),
        ),
    ] {
        panel.push(Control::Input {
            id: id.into(),
            label: label(key),
            value,
        });
    }
    if let Some((kind, _, _)) = editor {
        panel.push(Control::Submit {
            id: format!("new-{kind}"),
            label: label("common.save"),
        });
        panel.push(Control::Button {
            id: "cancel".into(),
            label: label("common.cancel"),
        });
    } else {
        for (id, key) in [
            ("new-pomodoro", "tools.pomodoroTaskCreate"),
            ("new-free", "tools.focusModeFree"),
        ] {
            panel.push(Control::Submit {
                id: id.into(),
                label: label(key),
            });
        }
    }
    if matches!(&request.event,Event::Action(action) if action=="cancel") {
        state = Value::Null;
        reload = true;
    }
    if let Event::Submit { id, fields } = &request.event {
        let field = |s: &str| fields.get(s).map(String::as_str).unwrap_or("");
        let number = |s: &str| field(s).parse::<i64>().unwrap_or(0);
        let task_id = editor.map(|(_, id, _)| id);
        if id == "new-pomodoro" {
            command = Some(
                json!({"kind":"pomodoro","action":{"kind":"save","id":task_id,"label":field("name"),
                "focusMs":number("duration").saturating_mul(60000),"shortBreakMs":number("short").saturating_mul(60000),
                "longBreakMs":number("long").saturating_mul(60000),"longBreakEvery":number("rounds")}}),
            );
        } else if id == "new-free" {
            let ratio = !field("ratio").is_empty();
            command = Some(
                json!({"kind":"free","action":{"kind":"save","id":task_id,"label":field("name"),
                "restMode":if ratio {"ratio"}else{"fixed"},"restMinutes":number("short"),"restRatio":if ratio{number("ratio")}else{5}}}),
            );
        }
        state = Value::Null;
    }
    Response {
        state,
        panel,
        timer,
        command,
        reload,
    }
}

fn detail_buttons(
    panel: &mut Vec<Control>,
    request: &Request,
    state: &mut Value,
    reload: &mut bool,
    kind: &str,
    id: i64,
) {
    for (action, key) in [
        ("edit", "tools.activityReminderEdit"),
        ("history", "tools.focusDetails"),
    ] {
        let button = format!("{action}-{kind}-{id}");
        if matches!(&request.event,Event::Action(a) if a==&button) {
            state["edit_id"] = if action == "edit" {
                id.into()
            } else {
                Value::Null
            };
            state["history_id"] = if action == "history" {
                id.into()
            } else {
                Value::Null
            };
            state["kind"] = kind.into();
            state["history-page"] = 0.into();
            *reload = true;
        }
        panel.push(Control::Button {
            id: button,
            label: request.data["labels"][key].as_str().unwrap_or(key).into(),
        });
    }
}
