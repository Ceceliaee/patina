use extism_pdk::*;
use patina_plugin_sdk::{
    Event, Request,
    notification::{NoticeContent, NoticeTarget},
};
use serde_json::{Value, json};

#[plugin_fn]
pub fn notification(Json(request): Json<Request>) -> FnResult<Json<NoticeContent>> {
    let Event::Notification { notice, .. } = &request.event else {
        return Err(Error::msg("Expected notification").into());
    };
    let NoticeTarget::Focus { kind, id, .. } = &notice.target else {
        return Err(Error::msg("Expected focus task").into());
    };
    let pomodoro = kind == "pomodoro";
    let (task, run) = request.data[kind]
        .as_array()
        .into_iter()
        .flatten()
        .map(|task| (task, if pomodoro { &task["run"] } else { task }))
        .find(|(_, run)| run["id"].as_i64() == Some(*id))
        .ok_or_else(|| Error::msg("Focus task changed"))?;
    let tr = |key| request.text(key);
    let completed = pomodoro && run["status"] == "completed";
    let (phase_key, duration_key, start_key) = match run["phase"].as_str() {
        Some("break") => (
            "tools.freeFocusRest",
            "rest_remaining_ms",
            "tools.pomodoroStartBreak",
        ),
        Some("short_break") => (
            "tools.pomodoroPhase.shortBreak",
            "short_break_ms",
            "tools.pomodoroStartBreak",
        ),
        Some("long_break") => (
            "tools.pomodoroPhase.longBreak",
            "long_break_ms",
            "tools.pomodoroStartBreak",
        ),
        _ => (
            "tools.pomodoroPhase.focus",
            "focus_ms",
            "tools.pomodoroStartFocus",
        ),
    };
    let detail = if completed {
        tr("tools.pomodoroGroupSummary")
            .replace("{rounds}", &run["long_break_every"].to_string())
            .replace("{groups}", &task["completed_groups"].to_string())
    } else if !pomodoro && run["phase"] == "focus" {
        tr("tools.freeFocusRestart")
    } else {
        let seconds = (run[duration_key].as_i64().unwrap_or_default() + 999) / 1000;
        let duration = if seconds < 60 {
            tr("tools.secondValue").replace("{seconds}", &seconds.to_string())
        } else {
            tr("tools.minuteValue").replace("{minutes}", &(seconds / 60).to_string())
        };
        tr("tools.pomodoroNextPhase")
            .replace("{phase}", &tr(phase_key))
            .replace("{duration}", &duration)
    };
    Ok(Json(NoticeContent {
        title: notice.label.clone(),
        detail,
        actions: vec![
            (
                "dismiss".into(),
                tr(if completed {
                    "tools.reminderConfirmComplete"
                } else {
                    "tools.pomodoroStartLater"
                }),
            ),
            (
                "start".into(),
                tr(if completed {
                    "tools.pomodoroStartNextGroup"
                } else {
                    start_key
                }),
            ),
        ],
        choices: None,
    }))
}

pub fn command(event: &Event) -> Option<Value> {
    let Event::Notification {
        notice,
        action: Some(action),
    } = event
    else {
        return None;
    };
    let NoticeTarget::Focus { kind, id, revision } = &notice.target else {
        return None;
    };
    (action == "start").then(
        || json!({"kind":kind,"action":{"kind":"start_next","id":id,"expectedUpdatedAt":revision}}),
    )
}
