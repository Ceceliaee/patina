use super::{Confirm, Tools};
use crate::client::Client;
use gpui_kit::{AppContext, AssetSource, TestAppContext, WindowOptions, test::TestWindowExt};
use patina_desktop_protocol::{
    FromWindow, Reply, WindowRequest,
    tools::{Control, Installed, Manifest, ToolRequest},
};
use std::sync::mpsc::Receiver;

pub(super) fn next_tool_request(requests: &Receiver<FromWindow>) -> (u64, ToolRequest) {
    requests
        .try_iter()
        .find_map(|message| {
            if let FromWindow::Request(id, query) = message
                && let WindowRequest::Tools(request) = *query
            {
                return Some((id, request));
            }
            None
        })
        .expect("expected tool request")
}

#[gpui_kit::test]
fn plugin_home_centers_the_empty_message_and_wraps_installed_cards(cx: &mut TestAppContext) {
    use gpui_kit::{
        Bounds, Context, Entity, Window, WindowBounds, div, point, prelude::*, px, size,
    };

    struct PageFrame(Entity<Tools>);
    impl Render for PageFrame {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            div().size_full().flex().flex_col().child(self.0.clone())
        }
    }

    cx.update(gpui_kit::init);
    for (width, height, columns) in [
        (1080., 720., 4),
        (760., 540., 3),
        (600., 680., 2),
        (480., 900., 1),
    ] {
        let (client, requests) = Client::test_connection();
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::new(
                point(px(0.), px(0.)),
                size(px(width), px(height)),
            ))),
            ..Default::default()
        };
        let (window, _) = cx.update(|cx| {
            gpui_kit::open_window(options, cx, |_, cx| {
                let page = cx.new(|cx| Tools::new(client.clone(), None, cx));
                cx.new(|_| PageFrame(page))
            })
            .unwrap()
        });
        let tools: Vec<_> = (0..5)
            .map(|i| Installed {
                manifest: Manifest {
                    id: format!("test.plugin{i}"),
                    name: format!("Plugin {i}"),
                    version: "1".into(),
                    api: 1,
                    entry: "panel.wasm".into(),
                    capabilities: vec![],
                    presentation: None,
                },
                generation: "first".into(),
            })
            .collect();
        let (id, ToolRequest::List) = next_tool_request(&requests) else {
            panic!("expected the installed plugins")
        };
        client.test_answer(id, Reply::Tools((vec![], false, None)));
        cx.run_until_parked();
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            let area = win.find("tool-panel").bounds();
            let message = win.find("No tools installed").bounds();
            assert!(area.size.height > px(height / 2.));
            assert!(message.size.width < area.size.width);
            assert!((message.center().x - area.center().x).abs() <= px(1.));
            assert!((message.center().y - area.center().y).abs() <= px(1.));
            win.click("plugin-home", cx);
        })
        .unwrap();
        let (id, ToolRequest::OpenHome) = next_tool_request(&requests) else {
            panic!("expected refreshed installations")
        };
        client.test_answer(id, Reply::Tools((tools.clone(), false, None)));
        cx.run_until_parked();
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            assert!(requests.try_recv().is_err());
            let cards: Vec<_> = (0..5)
                .map(|i| win.find(format!("plugin-card-test.plugin{i}")).bounds())
                .collect();
            let gap = px(quietpro::APP_CARD_GAP);
            for (i, card) in cards.iter().enumerate() {
                assert_eq!(card.size.height, px(128.));
                assert!((card.size.width - cards[0].size.width).abs() <= px(1.));
                assert_eq!(card.left(), cards[i % columns].left());
                if i % columns != 0 {
                    assert_eq!(card.top(), cards[i - 1].top());
                    assert!((card.left() - cards[i - 1].right() - gap).abs() <= px(1.));
                }
                if i >= columns {
                    assert_eq!(card.top() - cards[i - columns].bottom(), gap);
                }
            }
            win.click("plugin-card-test.plugin4", cx);
        })
        .unwrap();
        let (request, panel) = next_tool_request(&requests);
        assert!(
            matches!(panel, ToolRequest::Panel { id, generation, remember: true, .. }
            if id == "test.plugin4" && generation == "first")
        );
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            assert!(win.try_find("plugin-card-test.plugin4").is_some());
            win.click("plugin-card-test.plugin4", cx);
            assert!(requests.try_recv().is_err());
        })
        .unwrap();
        client.test_reject(request, patina_desktop_protocol::RequestError::Busy);
        cx.run_until_parked();
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            win.click("retry-tools", cx);
        })
        .unwrap();
        let (list, ToolRequest::List) = next_tool_request(&requests) else {
            panic!("retry must recheck the current installation");
        };
        client.test_answer(list, Reply::Tools((tools, false, None)));
        cx.run_until_parked();
        let (request, panel) = next_tool_request(&requests);
        assert!(matches!(panel, ToolRequest::Panel { id, .. } if id == "test.plugin4"));
        client.test_answer(
            request,
            Reply::Panel(vec![Control::Button {
                id: "start".into(),
                label: "Start".into(),
            }]),
        );
        cx.run_until_parked();
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            assert!(win.try_find("plugin-card-test.plugin4").is_none());
            assert!(win.try_find("plugin-action-start").is_some());
        })
        .unwrap();
    }
}

#[gpui_kit::test]
fn store_preserves_tool_draft_and_restores_focus(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let (handle, page) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|cx| Tools::new(client.clone(), None, cx))
        })
        .unwrap()
    });
    let tool = Installed {
        manifest: Manifest {
            presentation: None,
            id: "example".into(),
            name: "Example".into(),
            version: "1.0.0".into(),
            api: 1,
            entry: "panel.wasm".into(),
            capabilities: vec![],
        },
        generation: "one".into(),
    };
    let answer_list = || {
        let (id, ToolRequest::List) = next_tool_request(&requests) else {
            panic!("expected tool list")
        };
        client.test_answer(id, Reply::Tools((vec![tool.clone()], false, None)));
    };
    answer_list();
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        win.click("plugin-card-example", cx);
    })
    .unwrap();
    let (id, ToolRequest::Panel { .. }) = next_tool_request(&requests) else {
        panic!("expected tool panel")
    };
    client.test_answer(
        id,
        Reply::Panel(vec![Control::Input {
            id: "draft".into(),
            label: "Draft".into(),
            value: String::new(),
        }]),
    );
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        let input = page.read(cx).inputs["draft"].clone();
        input.update(cx, |input, cx| input.set_value("unfinished", win, cx));
        win.click("tool-manager", cx);
    })
    .unwrap();
    answer_list();
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        assert!(win.try_find("store-row-patina.focus").is_none());
        assert!(win.try_find("store-row-patina.reminders").is_none());
        win.click("remove-example", cx);
    })
    .unwrap();
    let (id, ToolRequest::Stopping(..)) = next_tool_request(&requests) else {
        panic!("expected uninstall preview before reloading the panel")
    };
    client.test_answer(id, Reply::Stopping(vec![]));
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        let Some(Confirm::Remove(_, _, opener)) = page.read(cx).pending.clone() else {
            panic!("expected uninstall confirmation")
        };
        assert!(page.read(cx).cancel_focus.is_focused(win));
        win.press("escape", cx);
        win.render_frame(cx);
        assert!(page.read(cx).pending.is_none());
        assert!(page.read(cx).manager && opener.is_focused(win));
        win.press("escape", cx);
        win.render_frame(cx);
        assert!(!page.read(cx).manager);
        assert!(page.read(cx).manager_focus.is_focused(win));
        assert_eq!(
            page.read(cx).inputs["draft"].read(cx).value().as_str(),
            "unfinished"
        );
        win.click("tool-manager", cx);
    })
    .unwrap();
    let (id, ToolRequest::List) = next_tool_request(&requests) else {
        panic!("expected current installations when reopening the store")
    };
    client.test_answer(id, Reply::Tools((vec![], false, None)));
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        assert!(page.read(cx).manager, "market is open");
        assert!(page.read(cx).tools.is_empty(), "the registry is empty");
        assert!(!page.read(cx).busy, "the market finished loading");
        let install = win.find("install-tool").bounds();
        let close = win.find("close-store").bounds();
        assert_eq!(install.size, close.size);
        assert_eq!(install.top(), close.top());
        assert_eq!(install.right(), close.left());
        assert!(
            quietpro::QuietProAssets
                .load(&quietpro::Icon::FolderDown.path())
                .unwrap()
                .is_some()
        );
        for id in [
            "store-row-example",
            "store-row-patina.focus",
            "store-row-patina.reminders",
        ] {
            assert!(win.try_find(id).is_none());
        }
        win.press("escape", cx);
        win.render_frame(cx);
        for id in ["plugin-home", "tool-manager", "tool-settings"] {
            let button = win.find(id).bounds();
            let glyph = win.within(id).find("glyph").bounds();
            assert_eq!(
                button.size,
                gpui_kit::size(gpui_kit::px(32.), gpui_kit::px(32.))
            );
            assert_eq!(
                glyph.size,
                gpui_kit::size(gpui_kit::px(20.), gpui_kit::px(20.))
            );
        }
        assert!(
            quietpro::QuietProAssets
                .load(&quietpro::Icon::HousePlug.path())
                .unwrap()
                .is_some()
        );
        win.click("plugin-home", cx);
    })
    .unwrap();
    let (id, ToolRequest::OpenHome) = next_tool_request(&requests) else {
        panic!("expected to remember the plugin home")
    };
    client.test_answer(id, Reply::Tools((vec![tool.clone()], false, None)));
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        assert!(page.read(cx).showing_home);
        assert!(
            requests.try_recv().is_err(),
            "listing a plugin should not open it"
        );
        win.click("plugin-card-example", cx);
    })
    .unwrap();
    assert!(matches!(next_tool_request(&requests).1,
        ToolRequest::Panel { id, generation, remember: true, .. }
            if id == "example" && generation == "one"));
}

#[gpui_kit::test]
fn custom_page_submits_only_its_declared_fields(cx: &mut TestAppContext) {
    use patina_desktop_protocol::tools::layout::{
        Container, Editor, Field, Flow, Form, Icon, Justify, Node, Page, Tab,
    };
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let (window, view) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
            cx.new(|cx| Tools::new(client.clone(), None, cx))
        })
        .unwrap()
    });
    let tool = Installed {
        manifest: Manifest {
            id: "example.notes".into(),
            name: "Notebook".into(),
            version: "1".into(),
            api: 3,
            entry: "panel".into(),
            capabilities: vec![],
            presentation: None,
        },
        generation: "test-installation".into(),
    };
    let (id, ToolRequest::List) = next_tool_request(&requests) else {
        panic!("expected list")
    };
    client.test_answer(id, Reply::Tools((vec![tool], false, None)));
    cx.run_until_parked();
    cx.update_window(window, |_, win, cx| {
        win.render_frame(cx);
        win.click("plugin-card-example.notes", cx);
    })
    .unwrap();
    let (id, ToolRequest::Panel { .. }) = next_tool_request(&requests) else {
        panic!("expected panel")
    };
    let tab = |key: &str| Tab {
        layout: (key == "drafts").then(|| {
            Container::new(
                Flow::Column,
                13,
                [
                    Node::Tabs,
                    Container::new(
                        Flow::Row,
                        19,
                        [Node::Action("first".into()), Node::Action("second".into())],
                    )
                    .justified(Justify::End)
                    .into(),
                    Node::Submit,
                    Node::Field(format!("{key}-text")),
                ],
            )
        }),
        id: key.into(),
        label: key.into(),
        empty: "No entries".into(),
        rows: vec![],
        navigation: vec![],
        form: Some(Form {
            heading: "Add an entry".into(),
            fields: vec![
                Field::new(format!("{key}-text"), Editor::text("Write here", "")).flexible(),
            ],
            submit: format!("save-{key}"),
            cancel: None,
        }),
    };
    let mut controls: Vec<_> = ["first", "second"]
        .map(|key| Control::Button {
            id: key.into(),
            label: key.into(),
        })
        .into();
    for key in ["notes", "drafts"] {
        controls.push(Control::Input {
            id: format!("{key}-text"),
            label: "Entry".into(),
            value: "Original".into(),
        });
        controls.push(Control::Submit {
            id: format!("save-{key}"),
            label: "Save".into(),
        });
    }
    controls.push(Control::Page(Box::new(Page {
        selected_tab: None,
        title: "Notebook".into(),
        icon: Icon::ToolCase,
        tabs: vec![tab("notes"), tab("drafts")],
        dialog: None,
    })));
    client.test_answer(id, Reply::Panel(controls));
    cx.run_until_parked();
    cx.update_window(window, |_, win, cx| {
        win.render_frame(cx);
        let note = view.read(cx).inputs["notes-text"].clone();
        note.update(cx, |state, cx| state.set_value("Keep this draft", win, cx));
        win.click(("segment", 1usize), cx);
        win.render_frame(cx);
        let first = win.find("action-first").bounds();
        let second = win.find("action-second").bounds();
        let submit = win.find("page-submit").bounds();
        assert_eq!(second.left() - first.right(), gpui_kit::px(19.));
        assert_eq!(second.right(), submit.right());
        assert_eq!(submit.top() - second.bottom(), gpui_kit::px(13.));
        let draft = view.read(cx).inputs["drafts-text"].clone();
        draft.update(cx, |state, cx| state.set_value("Publish this", win, cx));
        win.click("page-submit", cx);
    })
    .unwrap();
    let (
        _,
        ToolRequest::Submit {
            id, button, fields, ..
        },
    ) = next_tool_request(&requests)
    else {
        panic!("expected submit")
    };
    assert_eq!(id, "example.notes");
    assert_eq!(button, "save-drafts");
    assert_eq!(
        fields,
        [("drafts-text".into(), "Publish this".into())]
            .into_iter()
            .collect()
    );
}
