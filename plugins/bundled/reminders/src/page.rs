use patina_plugin_sdk::{Control, layout::*};

const MAX_DURATION_MINUTES: u32 = 23 * 60 + 59;
const TIMED_COLUMN_WIDTH: u16 = 284;

fn duration_field(id: &str) -> Field {
    Field::new(
        id,
        Editor::Duration {
            max_minutes: MAX_DURATION_MINUTES,
        },
    )
}

pub fn layout(panel: &[Control], request: &patina_plugin_sdk::Request) -> Page {
    let tr = |key| request.text(key);
    let tab = |timed| {
        let submit = panel
            .iter()
            .find_map(|c| match c {
                Control::Submit { id, .. }
                    if (id == "new-reminder" || id.starts_with("save-reminder-")) == timed =>
                {
                    Some(id.clone())
                }
                _ => None,
            })
            .expect("reminder form submit");
        let cancel = if timed {
            "cancel-edit"
        } else {
            "cancel-rule-edit"
        };
        let editing = panel
            .iter()
            .any(|c| matches!(c, Control::Button{id,..} if id == cancel));
        let fields = if timed {
            vec![
                Field::new(
                    "name",
                    Editor::text(&tr("tools.reminderLabelPlaceholder"), ""),
                )
                .width(TIMED_COLUMN_WIDTH)
                .flexible(),
                Field::new(
                    "schedule",
                    Editor::Group {
                        label: String::new(),
                        arrangement: Arrangement::Layout(Container::new(
                            Flow::Row,
                            12,
                            [Node::Field("local".into()), Node::Field("repeat".into())],
                        )),
                        fields: vec![
                            Field::new("local", Editor::DateTime).weighted(3),
                            Field::new(
                                "repeat",
                                Editor::Select {
                                    subdued: true,
                                    clear_on_change: None,
                                },
                            )
                            .weighted(2),
                        ],
                    },
                )
                .width(TIMED_COLUMN_WIDTH)
                .flexible(),
                duration_field("interval").when("repeat", "interval"),
            ]
        } else if editing {
            vec![duration_field("limit")]
        } else {
            vec![
                Field::new("target", Editor::ActivityTarget)
                    .width(184)
                    .flexible(),
                duration_field("limit").width(184).flexible(),
            ]
        };
        let mut rows = Vec::new();
        let mut navigation = Vec::new();
        for c in panel {
            match c {
                Control::ListRow { id, actions, .. }
                    if id.starts_with(if timed { "reminder-" } else { "rule-" }) =>
                {
                    let icons = actions
                        .iter()
                        .map(|(action, _)| {
                            let icon = match action.split('-').next() {
                                Some("pause") => Icon::ToggleRight,
                                Some("enable") => Icon::ToggleLeft,
                                Some("edit") => Icon::Pencil,
                                Some("delete") => Icon::Trash,
                                Some("later") => Icon::Clock,
                                Some("confirm") => Icon::Check,
                                _ => Icon::Bell,
                            };
                            (action.clone(), icon)
                        })
                        .collect();
                    rows.push(Row {
                        id: id.clone(),
                        icons,
                        detail_action: None,
                    });
                }
                Control::Button { id, .. }
                    if id.ends_with(if timed {
                        "-reminder-page"
                    } else {
                        "-rule-page"
                    }) =>
                {
                    navigation.push(id.clone())
                }
                _ => {}
            }
        }
        let field_nodes = fields.iter().map(|field| Node::Field(field.id.clone()));
        let header = Container::new(Flow::Row, 8, [Node::Title, Node::Tabs])
            .aligned(Align::Center)
            .justified(Justify::Between)
            .surface(Surface::Ruled);
        let editors = Container::new(
            Flow::Row,
            12,
            field_nodes.chain([Node::Submit, Node::Cancel]),
        )
        .aligned(Align::End)
        .wrapping();
        let card = Container::new(Flow::Column, 8, [Node::FormHeading, editors.into()])
            .surface(Surface::Card);
        let mut content = vec![header.into(), card.into(), Node::List];
        if !navigation.is_empty() {
            content.push(
                Container::new(Flow::Row, 8, navigation.iter().cloned().map(Node::Action)).into(),
            );
        }
        Tab {
            layout: Some(Container::new(Flow::Column, 12, content)),
            id: if timed { "timed" } else { "usage" }.into(),
            label: tr(if timed {
                "tools.reminderModeEvent"
            } else {
                "tools.reminderModeUsage"
            }),
            form: Some(Form {
                heading: tr(match (timed, editing) {
                    (_, false) => "tools.newReminder",
                    (true, true) => "tools.reminderEditTitle",
                    _ => "tools.activityReminderEditTitle",
                }),
                fields,
                submit,
                cancel: editing.then(|| cancel.into()),
            }),
            empty: tr(if timed {
                "tools.reminderEmpty"
            } else {
                "tools.activityReminderEmpty"
            }),
            rows,
            navigation,
        }
    };
    Page {
        title: tr("plugin.name"),
        icon: Icon::BellRing,
        selected_tab: None,
        tabs: vec![tab(true), tab(false)],
        dialog: None,
    }
}
