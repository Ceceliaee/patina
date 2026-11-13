use extism_pdk::*;
use patina_plugin_sdk::{Control, Event, Request, Response};

#[plugin_fn]
pub fn panel(Json(request): Json<Request>) -> FnResult<Json<Response>> {
    let mut count = request.state.as_u64().unwrap_or_default();
    if matches!(request.event, Event::Action(ref id) if id == "increment") {
        count = count.saturating_add(1);
    }
    let label = match request.locale.as_str() {
        "zh-CN" => "加一",
        "ru-RU" => "Прибавить один",
        "es" => "Sumar uno",
        _ => "Add one",
    };
    Ok(Json(Response {
        timer: None,
        command: None,
        reload: false,
        state: count.into(),
        panel: vec![
            Control::Text(count.to_string()),
            Control::Button {
                id: "increment".into(),
                label: label.into(),
            },
        ],
    }))
}
