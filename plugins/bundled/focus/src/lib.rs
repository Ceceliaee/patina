mod page;
mod notification;
use extism_pdk::*;
use patina_plugin_sdk::{Control, Event, Request, Response, RowClock, Timer};
use serde_json::{Value, json};

#[plugin_fn]
pub fn panel(Json(request): Json<Request>) -> FnResult<Json<Response>> {
    let mut response = handle_event(&request);
    let mut layout = page::layout(&response, &request);
    layout.remember_tab(&mut response.state, &request.event);
    response.panel.push(Control::Page(Box::new(layout)));
    Ok(Json(response))
}

fn label(request: &Request, key: &str) -> String {
    request.text(key)
}

fn page(
    key: &str,
    count: usize,
    request: &Request,
    response: &mut Response,
) -> std::ops::Range<usize> {
    patina_plugin_sdk::page_range(
        key,
        count,
        request,
        &mut response.state,
        &mut response.panel,
        &label(request, "miniWindow.previousPage"),
        &label(request, "miniWindow.nextPage"),
    )
}

fn handle_event(request: &Request) -> Response {
    let mut response = Response {
        state: request.state.clone(),
        panel: Vec::new(),
        command: notification::command(&request.event).or_else(|| matches!(request.event, Event::Due).then(|| json!({"kind":"due"}))),
        timer: None,
        reload: false,
    };
    for kind in ["pomodoro", "free"] {
        let pomodoro = kind == "pomodoro";
        let rows = request.data[kind]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        let visible = page(&format!("{kind}-page"), rows.len(), request, &mut response);
        let mut editor = None;
        for (i, task) in rows.iter().enumerate() {
            let run = if pomodoro { &task["run"] } else { task };
            let Some(id) = run["id"].as_i64() else {
                continue;
            };
            let running = run["status"] == "running";
            let clock = task_clock(pomodoro, run, request.now_ms);
            let title = task["label"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| {
                    label(
                        request,
                        if pomodoro {
                            "tools.pomodoroTaskDefault"
                        } else {
                            "tools.focusModeFree"
                        },
                    )
                });
            if let RowClock::Until(at_ms) = clock {
                response.timer = Some(Timer {
                    at_ms,
                    label: title.clone(),
                    task: Some((kind.to_owned(), id)),
                });
            }
            if !running && response.state["edit_id"] == id && response.state["kind"] == kind {
                editor = Some((id, task));
            }
            if !visible.contains(&i) {
                continue;
            }
            let phase = match (run["status"].as_str(), run["phase"].as_str()) {
                (Some("completed"), _) => "tools.pomodoroStatus.completed",
                (Some("idle"), _) => "tools.pomodoroStatus.idle",
                (_, Some("short_break")) => "tools.pomodoroPhase.shortBreak",
                (_, Some("long_break")) => "tools.pomodoroPhase.longBreak",
                (_, Some("break")) => "tools.freeFocusRest",
                _ => "tools.pomodoroPhase.focus",
            };
            let mut actions = Vec::new();
            let mut action = |op: &str, key: &str| {
                let button = format!("{op}-{kind}-{id}");
                if matches!(&request.event, Event::Action(a) if a == &button) {
                    match op {
                        "history" => {
                            response.state["history_id"] = id.into();
                            response.state["history_kind"] = kind.into();
                            response.state["history-page"] = 0.into();
                            response.reload = true;
                        }
                        "edit" => {
                            response.state["edit_id"] = id.into();
                            response.state["kind"] = kind.into();
                            response.reload = true;
                        }
                        _ => {
                            response.command =
                                Some(json!({"kind":kind,"action":{"kind":op,"id":id}}));
                        }
                    }
                }
                actions.push((button, label(request, key)));
            };
            action("history", "tools.focusDetails");
            if running {
                action("pause", "tools.pause");
            } else {
                action("resume", "tools.start");
            }
            if !pomodoro && run["phase"] == "focus" && (running || run["status"] == "paused") {
                action("finish", "tools.freeFocusFinish");
            }
            if !running {
                action("edit", "tools.activityReminderEdit");
            }
            if run["status"] != "idle" {
                action("reset", "tools.reset");
            }
            action("delete", "tools.activityReminderDelete");
            response.panel.push(Control::ListRow {
                id: format!("{kind}-{id}"),
                title,
                detail: label(request, phase),
                clock: Some(clock),
                actions,
            });
        }
        form(kind, editor, request, &mut response);
    }
    history(request, &mut response);
    response
}

fn task_clock(pomodoro: bool, run: &Value, now: i64) -> RowClock {
    let running = run["status"] == "running";
    if !pomodoro && run["phase"] == "focus" {
        let elapsed = run["elapsed_ms"].as_i64().unwrap_or_default();
        return if running {
            RowClock::Since(
                run["started_at"]
                    .as_i64()
                    .unwrap_or(now)
                    .saturating_sub(elapsed),
            )
        } else {
            RowClock::Duration(elapsed)
        };
    }
    let (remaining, started) = if pomodoro {
        ("phase_remaining_ms", "phase_started_at")
    } else {
        ("rest_remaining_ms", "started_at")
    };
    let ms = run[remaining]
        .as_i64()
        .or_else(|| {
            let duration = match run["phase"].as_str() {
                Some("short_break") => "short_break_ms",
                Some("long_break") => "long_break_ms",
                _ => "focus_ms",
            };
            run[duration].as_i64()
        })
        .unwrap_or_default();
    if running {
        RowClock::Until(run[started].as_i64().unwrap_or(now).saturating_add(ms))
    } else {
        RowClock::Duration(ms)
    }
}

fn form(kind: &str, editor: Option<(i64, &Value)>, request: &Request, response: &mut Response) {
    let task = editor.map(|(_, task)| task).unwrap_or(&Value::Null);
    let run = &task["run"];
    let mut input = |suffix: &str, key: &str, value: String| {
        response.panel.push(Control::Input {
            id: format!("{kind}-{suffix}"),
            label: label(request, key),
            value,
        })
    };
    input(
        "name",
        "tools.pomodoroTaskName",
        task["label"].as_str().unwrap_or_default().into(),
    );
    if kind == "pomodoro" {
        for (suffix, key, field, default) in [
            ("duration", "tools.focusDuration", "focus_ms", 1_500_000),
            (
                "short",
                "tools.shortBreakDuration",
                "short_break_ms",
                300_000,
            ),
            ("long", "tools.longBreakDuration", "long_break_ms", 900_000),
        ] {
            input(
                suffix,
                key,
                (run[field].as_i64().unwrap_or(default) as f64 / 60_000.).to_string(),
            );
        }
        input(
            "rounds",
            "tools.longBreakEvery",
            run["long_break_every"].as_i64().unwrap_or(4).to_string(),
        );
    } else {
        input(
            "short",
            "tools.freeRestDuration",
            task["rest_minutes"].as_i64().unwrap_or(5).to_string(),
        );
        input(
            "ratio",
            "tools.freeRestProportion",
            task["rest_ratio"].as_i64().unwrap_or(5).to_string(),
        );
        response.panel.push(Control::Select {
            id: "free-rest-mode".into(),
            label: label(request, "tools.freeRestMode"),
            value: task["rest_mode"].as_str().unwrap_or("fixed").into(),
            choices: [
                ("fixed", "tools.freeRestFixed"),
                ("ratio", "tools.freeRestRatio"),
            ]
            .into_iter()
            .map(|(v, k)| (v.into(), label(request, k)))
            .collect(),
        });
    }
    let submit = editor
        .map(|(id, _)| format!("save-{kind}-{id}"))
        .unwrap_or_else(|| format!("new-{kind}"));
    if editor.is_some() {
        let cancel = format!("cancel-{kind}");
        if matches!(&request.event,Event::Action(a) if a==&cancel) {
            response.state["edit_id"] = Value::Null;
            response.reload = true;
        }
        response.panel.push(Control::Button {
            id: cancel,
            label: label(request, "common.cancel"),
        });
    }
    if let Event::Submit { id, fields } = &request.event
        && id == &submit
    {
        let field = |suffix: &str| {
            fields
                .get(&format!("{kind}-{suffix}"))
                .map(String::as_str)
                .unwrap_or("")
        };
        let number = |s| field(s).trim().parse::<i64>().unwrap_or(0);
        let millis = |s| (field(s).trim().parse::<f64>().unwrap_or(0.) * 60_000.).round() as i64;
        let task_id = editor.map(|(id, _)| id);
        let action = if kind == "pomodoro" {
            json!({"kind":"save","id":task_id,"label":field("name"),"focusMs":millis("duration"),"shortBreakMs":millis("short"),"longBreakMs":millis("long"),"longBreakEvery":number("rounds")})
        } else {
            let mode = field("rest-mode");
            let minutes = number("short");
            let ratio = number("ratio");
            json!({"kind":"save","id":task_id,"label":field("name"),"restMode":mode,
                "restMinutes":if mode == "ratio" && !(1..=120).contains(&minutes) {5} else {minutes},
                "restRatio":if mode == "fixed" && !(1..=20).contains(&ratio) {5} else {ratio}})
        };
        response.command = Some(json!({"kind":kind,"action":action}));
        if editor.is_some() {
            response.state["edit_id"] = Value::Null;
        }
    }
    response.panel.push(Control::Submit {
        id: submit,
        label: label(
            request,
            if editor.is_some() {
                "common.save"
            } else {
                "tools.createReminder"
            },
        ),
    });
}

fn history(request: &Request, response: &mut Response) {
    let data = &request.data;
    let label = |key| label(request, key);
    if let Some(groups) = data["history"].as_array() {
        if groups.is_empty() {
            response
                .panel
                .push(Control::Text(label("tools.focusHistoryEmpty")));
        }
        let visible = page("history-page", groups.len(), request, response);
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
                let duration = if elapsed < 60_000 {
                    label("tools.secondValue").replace("{seconds}", &(elapsed / 1000).to_string())
                } else {
                    label("tools.minuteValue").replace("{minutes}", &(elapsed / 60_000).to_string())
                };
                response
                    .panel
                    .push(Control::Text(format!("{} ･ {duration}", label(status))));
            }
        }
    }

    if data["history"].is_array() {
        if matches!(&request.event,Event::Action(a) if a=="close-history") {
            response.state["history_id"] = Value::Null;
            response.reload = true;
        }
        response.panel.push(Control::Button {
            id: "close-history".into(),
            label: label("common.close"),
        });
    }
}
