use extism_pdk::*;
use patina_plugin_sdk::{Control, Event, Request, Response, layout::*};

#[plugin_fn]
pub fn panel(Json(request): Json<Request>) -> FnResult<Json<Response>> {
    let mut count = request.state.as_u64().unwrap_or_default();
    if matches!(&request.event, Event::Action(id) if id == "increment") {
        count = count.saturating_add(1);
    }
    let controls = Container::new(
        Flow::Row,
        12,
        [
            Node::Text(count.to_string()),
            Node::Action("increment".into()),
        ],
    )
    .aligned(Align::Center)
    .justified(Justify::End)
    .surface(Surface::Card);
    let layout = Container::new(Flow::Column, 16, [Node::Title, controls.into()]);
    let page = Page {
        selected_tab: None,
        title: "Layout Counter".into(),
        icon: Icon::ToolCase,
        tabs: vec![Tab {
            id: "counter".into(),
            label: "Counter".into(),
            layout: Some(layout),
            form: None,
            rows: vec![],
            empty: String::new(),
            navigation: vec![],
        }],
        dialog: None,
    };
    Ok(Json(Response {
        state: count.into(),
        panel: vec![
            Control::Button {
                id: "increment".into(),
                label: "Add one".into(),
            },
            Control::Page(Box::new(page)),
        ],
        command: None,
        timer: None,
        reload: false,
    }))
}
