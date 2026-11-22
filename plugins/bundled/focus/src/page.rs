use patina_plugin_sdk::{Control, Response, layout::*};

pub fn layout(response: &Response, request: &patina_plugin_sdk::Request) -> Page {
    let tr = |key| request.text(key);
    let mut dialog = None;
    let mut tabs = Vec::new();
    let panel = &response.panel;
    for kind in ["pomodoro", "free"] {
        let pomodoro = kind == "pomodoro";
        let mut rows = Vec::new();
        let mut navigation = Vec::new();
        for c in panel {
            match c {
                Control::ListRow {
                    id, title, actions, ..
                } if id.split('-').next() == Some(kind) => {
                    let mut row = Row {
                        id: id.clone(),
                        icons: Vec::new(),
                        detail_action: None,
                    };
                    let history_id = response.state["history_id"].as_i64();
                    let viewing = response.state["history_kind"] == kind
                        && history_id.is_some_and(|n| *id == format!("{kind}-{n}"))
                        && panel
                            .iter()
                            .any(|c| matches!(c,Control::Button{id,..} if id=="close-history"));
                    for (action, _) in actions {
                        let icon = match action.split('-').next() {
                            Some("resume") => Icon::Play,
                            Some("pause") => Icon::Pause,
                            Some("finish") => Icon::Square,
                            Some("edit") => Icon::Pencil,
                            Some("delete") => Icon::Trash,
                            Some("history") => {
                                row.detail_action = Some(action.clone());
                                continue;
                            }
                            _ => continue,
                        };
                        row.icons.push((action.clone(), icon));
                    }
                    if viewing {
                        let lines = panel
                            .iter()
                            .filter_map(|c| match c {
                                Control::Text(s) => Some(s.clone()),
                                _ => None,
                            })
                            .collect();
                        let mut buttons = panel
                            .iter()
                            .filter_map(|c| match c {
                                Control::Button { id, .. } if id.ends_with("-history-page") => {
                                    Some(id.clone())
                                }
                                _ => None,
                            })
                            .collect::<Vec<_>>();
                        buttons.extend(
                            actions
                                .iter()
                                .filter(|(id, _)| id.starts_with("reset-"))
                                .map(|(id, _)| id.clone()),
                        );
                        dialog = Some(Details {
                            title: format!("{} ･ {title}", tr("tools.focusDetails")),
                            icon: Icon::Clock,
                            close: "close-history".into(),
                            lines,
                            actions: buttons,
                        });
                    }
                    rows.push(row);
                }
                Control::Button { id, .. } if id.ends_with(&format!("-{kind}-page")) => {
                    navigation.push(id.clone())
                }
                _ => {}
            }
        }
        let submit = panel
            .iter()
            .find_map(|c| match c {
                Control::Submit { id, .. } if id.split('-').nth(1) == Some(kind) => {
                    Some(id.clone())
                }
                _ => None,
            })
            .expect("focus form submit");
        let editing = submit.starts_with("save-");
        let config = if pomodoro {
            let template = tr("tools.pomodoroTimingSummary")
                .replace("{minutes}", "{pomodoro-duration}")
                .replace("{rounds}", "{pomodoro-rounds}");
            Editor::Popover {
                label: tr("tools.pomodoroTimingSettings"),
                width: 320,
                arrangement: Arrangement::Layout(Container::new(
                    Flow::Grid(2),
                    12,
                    ["duration", "short", "long", "rounds"]
                        .map(|id| Node::Field(format!("pomodoro-{id}"))),
                )),
                summaries: vec![Summary {
                    when: None,
                    template,
                }],
                fields: ["duration", "short", "long", "rounds"]
                    .map(|key| {
                        Field::new(
                            format!("pomodoro-{key}"),
                            Editor::text(
                                "",
                                &tr(if key == "rounds" {
                                    "tools.pomodoroRoundUnit"
                                } else {
                                    "time.minutes"
                                }),
                            ),
                        )
                    })
                    .into(),
            }
        } else {
            Editor::Popover {
                label: tr("tools.freeRestMode"),
                width: 264,
                arrangement: Arrangement::Layout(Container::new(
                    Flow::Column,
                    8,
                    [
                        Container::new(Flow::Row, 0, [Node::Field("free-rest-mode".into())]).into(),
                        Node::Field("free-short".into()),
                        Node::Field("free-ratio".into()),
                    ],
                )),
                summaries: vec![
                    Summary {
                        when: Some(Condition {
                            field: "free-rest-mode".into(),
                            equals: "ratio".into(),
                        }),
                        template: "{free-ratio}:1".into(),
                    },
                    Summary {
                        when: None,
                        template: tr("tools.minuteValue").replace("{minutes}", "{free-short}"),
                    },
                ],
                fields: vec![
                    Field::new("free-rest-mode", Editor::Segments),
                    Field::new("free-short", Editor::text("", "")).when("free-rest-mode", "fixed"),
                    Field::new("free-ratio", Editor::text("", "")).when("free-rest-mode", "ratio"),
                ],
            }
        };
        let form = Form {
            heading: tr(if !editing {
                "tools.pomodoroTaskCreate"
            } else if pomodoro {
                "tools.pomodoroTaskEdit"
            } else {
                "tools.freeFocusEdit"
            }),
            fields: vec![
                Field::new(
                    format!("{kind}-name"),
                    Editor::text(&tr("tools.pomodoroTaskPlaceholder"), ""),
                )
                .width(184)
                .flexible(),
                Field::new(format!("{kind}-settings"), config)
                    .width(184)
                    .flexible(),
            ],
            submit,
            cancel: editing.then(|| format!("cancel-{kind}")),
        };
        let fields = form
            .fields
            .iter()
            .map(|field| Node::Field(field.id.clone()));
        let header = Container::new(Flow::Row, 8, [Node::Title, Node::Tabs])
            .aligned(Align::Center)
            .justified(Justify::Between)
            .surface(Surface::Ruled);
        let editors = Container::new(Flow::Row, 12, fields.chain([Node::Submit, Node::Cancel]))
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
        tabs.push(Tab {
            layout: Some(Container::new(Flow::Column, 12, content)),
            id: kind.into(),
            label: tr(if pomodoro {
                "tools.focusModePomodoro"
            } else {
                "tools.focusModeFree"
            }),
            form: Some(form),
            empty: tr(if pomodoro {
                "tools.pomodoroTaskEmpty"
            } else {
                "tools.freeFocusEmpty"
            }),
            rows,
            navigation,
        });
    }
    Page {
        title: tr("plugin.name"),
        icon: Icon::AlarmClock,
        selected_tab: None,
        tabs,
        dialog,
    }
}
