use extism_pdk::*;
use patina_plugin_sdk::{
    Event, Request,
    notification::{NoticeChoices, NoticeContent, NoticeTarget},
};
use serde_json::{Value, json};

const DELAYS: [(&str, u32); 3] = [("snooze-5", 5), ("snooze-15", 15), ("snooze-30", 30)];
const EXTENSIONS: [(&str, &str); 3] = [
    ("fifteen_minutes", "tools.usageExtendFifteen"),
    ("one_hour", "tools.usageExtendHour"),
    ("today", "tools.usageExtendToday"),
];

#[plugin_fn]
pub fn notification(Json(request): Json<Request>) -> FnResult<Json<NoticeContent>> {
    let Event::Notification { notice, .. } = &request.event else {
        return Err(Error::msg("Expected notification").into());
    };
    let tr = |key| request.text(key);
    let (detail, label, options, confirm) = match &notice.target {
        NoticeTarget::Reminder(_) => (
            tr("tools.reminderOccurredAt").replace("{value}", &notice.local_time),
            tr("tools.reminderSnooze"),
            DELAYS
                .iter()
                .map(|(action, minutes)| {
                    let duration =
                        tr("tools.minuteValue").replace("{minutes}", &minutes.to_string());
                    (
                        (*action).into(),
                        tr("tools.reminderSnoozeDelay").replace("{value}", &duration),
                    )
                })
                .collect(),
            tr("tools.reminderConfirmComplete"),
        ),
        NoticeTarget::Usage(_) => (
            tr("tools.usageLimitReached"),
            tr("tools.usageExtend"),
            EXTENSIONS
                .iter()
                .map(|(id, key)| ((*id).into(), tr(key)))
                .collect(),
            tr("tools.alertDismiss"),
        ),
        _ => return Err(Error::msg("Unknown reminder notification").into()),
    };
    Ok(Json(NoticeContent {
        title: notice.label.clone(),
        detail,
        actions: vec![("dismiss".into(), confirm)],
        choices: Some(NoticeChoices { label, options }),
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
    match notice.target {
        NoticeTarget::Reminder(id) => {
            let delay = if action == "dismiss" {
                None
            } else {
                Some(DELAYS.iter().find(|(key, _)| key == action)?.1)
            };
            Some(json!({"kind":"confirm", "id":id, "fired_at":notice.at_ms, "delay":delay}))
        }
        NoticeTarget::Usage(id) if EXTENSIONS.iter().any(|(key, _)| key == action) => {
            Some(json!({"kind":"extend", "id":id, "at":notice.at_ms, "extension":action}))
        }
        _ => None,
    }
}
