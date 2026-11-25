use super::*;
use crate::windows::main::MainWindow;
use gpui_kit::{
    AppContext, ScrollDelta, SharedString, TestAppContext, WindowOptions, point, px, size,
    test::TestWindowExt,
};
use patina_activity_model::{AppRule, WebsiteRuleDraft};
use patina_desktop_protocol::{FromWindow, Reply, RequestError, WindowRequest};
use std::{sync::mpsc::Receiver, time::Duration};

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQCeoBAAGgAQNhYOe6AAAAAElFTkSuQmCC";

fn rules(web: bool) -> Reply {
    let mut websites = WebsiteRuleDraft::default();
    websites
        .domains
        .extend(["fast.example".into(), "slow.example".into()]);
    websites.favicons.insert(
        "fast.example".into(),
        format!("data:image/png;base64,{PNG}"),
    );
    websites.favicons.insert(
        "slow.example".into(),
        "https://slow.example/icon.png".into(),
    );
    Reply::Rules(ClassificationRules {
        web_enabled: true,
        web_mode: web,
        websites,
        titles_enabled: true,
        category_default_colors: Default::default(),
        category_color_overrides: Default::default(),
        apps: vec![AppRule {
            exe: "Editor.EXE".into(),
            name: "Editor".into(),
            category: "other".into(),
            color: String::new(),
            track: true,
            titles: true,
            original: None,
        }],
        app_links: Default::default(),
        categories: vec![("other".into(), "Other".into())],
        category_colors: Default::default(),
    })
}

fn request(rx: &Receiver<FromWindow>, matches: impl Fn(&WindowRequest) -> bool) -> u64 {
    rx.try_iter()
        .find_map(|message| match message {
            FromWindow::Request(id, query) if matches(&query) => Some(id),
            _ => None,
        })
        .expect("expected classification request")
}

fn icons() -> Reply {
    Reply::Icons(vec![("editor.exe".into(), PNG.into())])
}

#[gpui_kit::test]
fn edit_controls_show_their_action_on_hover(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    client.locale.set(patina_activity_model::Locale::ZhCn);
    let (window, _) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    cx.update_window(window, |_, win, cx| win.click("mapping.title", cx))
        .unwrap();
    cx.run_until_parked();
    let Reply::Rules(mut data) = rules(false) else {
        unreachable!()
    };
    data.categories.push(("office".into(), "Office".into()));
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::Rules)),
        Reply::Rules(data),
    );
    cx.run_until_parked();
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::Icons(_))),
        icons(),
    );
    cx.run_until_parked();

    let tips = crate::test_support::observe_tooltips(cx);
    for (scope, button, key) in [
        ("app:Editor.EXE", "rename", "mapping.editAppName"),
        (
            "category-manager-heading",
            "new-category",
            "mapping.createCategoryAction",
        ),
        ("office", "rename", "mapping.renameCategoryTitle"),
    ] {
        cx.update_window(window, |_, win, cx| {
            if button == "new-category" {
                win.click("manage-categories", cx);
            }
            win.within(scope).hover(button, cx);
        })
        .unwrap();
        crate::test_support::assert_tooltip(
            cx,
            &tips,
            Some(&patina_i18n::text(client.locale.get(), key)),
        );
    }
}

#[gpui_kit::test]
fn app_and_website_cards_fill_two_aligned_columns(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let (window, _) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    cx.update_window(window, |_, win, cx| {
        win.render_frame(cx);
        win.click("mapping.title", cx);
    })
    .unwrap();
    cx.run_until_parked();

    let Reply::Rules(mut data) = rules(false) else {
        unreachable!()
    };
    let names = ["a", "b-with-a-long-display-name", "c", "dd", "e"];
    let example = data.apps.pop().unwrap();
    data.apps = names
        .map(|name| AppRule {
            exe: format!("{name}.exe"),
            name: name.into(),
            ..example.clone()
        })
        .into();
    data.websites = WebsiteRuleDraft {
        domains: names.map(|name| format!("{name}.com")).into(),
        ..Default::default()
    };
    let app_keys: Vec<_> = data
        .apps
        .iter()
        .map(|app| format!("app:{}", app.exe))
        .collect();
    let mut sites = data.websites.cards();
    sites.sort_by(|a, b| a.name.cmp(&b.name));
    let web_keys: Vec<_> = sites
        .iter()
        .map(|site| format!("web:{}", site.identity))
        .collect();
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::Rules)),
        Reply::Rules(data),
    );
    cx.run_until_parked();
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::Icons(_))),
        Reply::Icons(vec![]),
    );
    cx.run_until_parked();

    for (mode, keys) in [app_keys, web_keys].iter().enumerate() {
        if mode == 1 {
            cx.update_window(window, |_, win, cx| {
                win.render_frame(cx);
                win.within("classification-object-mode")
                    .click(("segment", 1usize), cx);
            })
            .unwrap();
            cx.run_until_parked();
        }
        for width in [1080., 900.] {
            cx.simulate_window_resize(window, size(px(width), px(720.)));
            cx.update_window(window, |_, win, cx| {
                win.render_frame(cx);
                let list = win.find("rule-grid").bounds();
                let half = (list.size.width - px(quietpro::APP_CARD_GAP)) / 2.;
                for (i, key) in keys.iter().enumerate() {
                    let card = win.find(SharedString::from(key.clone())).bounds();
                    let left = if i % 2 == 0 {
                        list.left()
                    } else {
                        list.right() - half
                    };
                    assert!((card.left() - left).abs() <= px(1.), "{key}: left edge");
                    assert!(
                        (card.size.width - half).abs() <= px(1.),
                        "{key}: column width"
                    );
                }
            })
            .unwrap();
            cx.simulate_window_resize(window, size(px(width), px(450.)));
            cx.update_window(window, |_, win, cx| {
                win.scroll(
                    "rule-grid",
                    ScrollDelta::Pixels(point(px(0.), px(-1000.))),
                    cx,
                );
                let list = win.find("rule-grid").bounds();
                let last = win.find(SharedString::from(keys[4].clone())).bounds();
                let previous = win.find(SharedString::from(keys[2].clone())).bounds();
                assert_eq!(last.top() - previous.bottom(), px(quietpro::APP_CARD_GAP));
                assert_eq!(
                    list.bottom() - last.bottom(),
                    px(0.),
                    "gap after {}",
                    keys[4]
                );
            })
            .unwrap();
        }
    }
}

#[gpui_kit::test]
fn large_catalog_only_builds_visible_cards_and_keeps_a_rename(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    struct Catalog(gpui_kit::Entity<Classification>);
    impl gpui_kit::Render for Catalog {
        fn render(
            &mut self,
            _: &mut gpui_kit::Window,
            _: &mut gpui_kit::Context<Self>,
        ) -> impl gpui_kit::IntoElement {
            use gpui_kit::prelude::*;
            gpui_kit::div()
                .size_full()
                .flex()
                .flex_col()
                .child(self.0.clone())
        }
    }
    let (window, view) = cx.update(|cx| {
        let (win, catalog) = gpui_kit::open_window(WindowOptions::default(), cx, |win, cx| {
            let page =
                cx.new(|cx| Classification::new(client.clone(), Default::default(), win, cx));
            cx.new(|_| Catalog(page))
        })
        .unwrap();
        (win, catalog.read(cx).0.clone())
    });
    cx.run_until_parked();
    let Reply::Rules(mut data) = rules(false) else {
        unreachable!()
    };
    let sample = data.apps.pop().unwrap();
    for n in 0..256 {
        let mut app = sample.clone();
        app.exe = format!("editor-{n:03}.exe");
        app.name = format!("Editor {n:03}");
        data.apps.push(app);
    }
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::Rules)),
        Reply::Rules(data),
    );
    cx.run_until_parked();
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::Icons(_))),
        Reply::Icons(vec![
            ("editor-000.exe".into(), PNG.into()),
            (
                "editor-200.exe".into(),
                base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    patina_activity_model::icon_png_from_bgra(&[192, 96, 32, 255], 1, 1).unwrap(),
                ),
            ),
        ]),
    );
    cx.run_until_parked();
    cx.update_window(window, |_, win, cx| {
        win.render_frame(cx);
        let count = view.read(cx).rename_focus.len();
        assert!((2..32).contains(&count), "built {count} of 256 cards");
        assert!(
            view.read(cx).icons["editor-000.exe"]
                .as_ref()
                .unwrap()
                .prepared()
                .is_some()
        );
        assert!(
            view.read(cx).icons["editor-200.exe"]
                .as_ref()
                .unwrap()
                .prepared()
                .is_none()
        );
        let edge = format!("app:editor-{:03}.exe", count.saturating_sub(3));
        win.focus(&view.read(cx).delete_focus[&edge].clone(), cx);
        for _ in 0..18 {
            win.press("tab", cx);
            win.render_frame(cx);
            if view.read(cx).rename_focus.len() > count {
                break;
            }
        }
        assert!(
            view.read(cx).rename_focus.len() > count,
            "Tab reached the next screen"
        );
        let top = ((-f32::from(view.read(cx).list_scroll.offset().y))
            / (92. + quietpro::APP_CARD_GAP))
            .ceil() as usize
            * 2;
        let key = format!("app:editor-{top:03}.exe");
        win.focus(&view.read(cx).rename_focus[&key].clone(), cx);
        for _ in 0..18 {
            win.press("shift-tab", cx);
            win.render_frame(cx);
            if f32::from(view.read(cx).list_scroll.offset().y) == 0. {
                break;
            }
        }
        assert_eq!(
            f32::from(view.read(cx).list_scroll.offset().y),
            0.,
            "Shift+Tab returned to the first screen"
        );
        win.within("app:editor-000.exe").click("rename", cx);
        view.update(cx, |p, cx| {
            p.name
                .update(cx, |input, cx| input.set_value("Uncommitted", win, cx));
            p.virtual_scroll
                .scroll_to_item(100, gpui_kit::ScrollStrategy::Top);
            cx.notify();
        });
        win.render_frame(cx);
        assert!(
            view.read(cx)
                .rename_focus
                .contains_key("app:editor-200.exe")
        );
        assert_eq!(
            view.read(cx).icons["editor-200.exe"]
                .as_ref()
                .unwrap()
                .prepared()
                .unwrap()
                .color,
            Some(0x2060c0)
        );
        view.update(cx, |p, cx| {
            p.virtual_scroll
                .scroll_to_item(0, gpui_kit::ScrollStrategy::Top);
            cx.notify();
        });
        win.render_frame(cx);
        assert_eq!(
            view.read(cx).editing_name.as_deref(),
            Some("app:editor-000.exe")
        );
        assert_eq!(view.read(cx).name.read(cx).value().as_ref(), "Uncommitted");
    })
    .unwrap();
}

#[gpui_kit::test]
fn cold_entry_waits_for_icons_and_cached_cards_survive_refresh_and_retry(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let (window, _) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    crate::features::today::tests::answer_empty_today(cx, &client, &requests);
    let click = |cx: &mut TestAppContext, id: &'static str| {
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            win.click(id, cx);
        })
        .unwrap();
        cx.run_until_parked();
    };
    let has = |cx: &mut TestAppContext, id: &'static str| {
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            win.try_find(id).is_some()
        })
        .unwrap()
    };
    let rules_read = || request(&requests, |r| matches!(r, WindowRequest::Rules));
    let icon_read = || request(&requests, |r| matches!(r, WindowRequest::Icons(_)));
    click(cx, "mapping.title");
    client.test_answer(rules_read(), rules(false));
    cx.run_until_parked();
    let canceled = icon_read();
    assert!(has(cx, "today-ranking-panel"));
    click(cx, "dashboard.title");
    client.test_answer(canceled, icons());
    cx.run_until_parked();
    assert!(!has(cx, "manage-categories"));
    click(cx, "mapping.title");
    client.test_answer(rules_read(), rules(false));
    cx.run_until_parked();
    assert!(has(cx, "today-ranking-panel"));
    client.test_answer(icon_read(), icons());
    cx.run_until_parked();
    assert!(has(cx, "manage-categories"));
    click(cx, "dashboard.title");
    click(cx, "mapping.title");
    assert!(has(cx, "manage-categories"));
    client.test_reject(rules_read(), RequestError::Busy);
    cx.run_until_parked();
    assert!(has(cx, "manage-categories") && has(cx, "retry"));
    click(cx, "retry");
    client.test_answer(rules_read(), rules(false));
    cx.run_until_parked();
    client.test_answer(icon_read(), icons());
    cx.run_until_parked();
    assert!(has(cx, "manage-categories") && !has(cx, "retry"));

    click(cx, "title-policy");
    click(cx, "data.title");
    assert!(has(cx, "save-before-switch"));
    click(cx, "save-before-switch");
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::SaveRules(..))),
        Reply::Done,
    );
    cx.run_until_parked();
    for _ in 0..2 {
        let id = request(&requests, |r| matches!(r, WindowRequest::Trends(..)));
        client.test_answer(
            id,
            Reply::Trends(patina_activity_model::Trends {
                days: vec![],
                series: vec![],
                earliest: None,
            }),
        );
    }
    cx.run_until_parked();
    assert!(has(cx, "open-range"));
}

#[gpui_kit::test]
fn classification_switch_publishes_prepared_icons_and_pins_late_web_results(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let (window, view) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |win, cx| {
            cx.new(|cx| Classification::new(client.clone(), Default::default(), win, cx))
        })
        .unwrap()
    });
    let switch = |cx: &mut TestAppContext, index: usize| {
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            win.within("classification-object-mode")
                .click(("segment", index), cx);
        })
        .unwrap();
        cx.run_until_parked();
        client.test_answer(
            request(&requests, |r| {
                matches!(r, WindowRequest::ClassificationMode(_))
            }),
            Reply::Done,
        );
    };
    cx.run_until_parked();
    let slow = "https://slow.example/icon.png";
    let send = cx.update(|cx| view.update(cx, |p, _| p.cache.sites.pending(slow)));
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::Rules)),
        rules(false),
    );
    cx.run_until_parked();
    cx.update(|cx| assert!(!view.read(cx).ready_to_present()));
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::Icons(_))),
        icons(),
    );
    cx.run_until_parked();
    let app = cx.update(|cx| view.read(cx).icons["Editor.EXE"].clone().unwrap());
    assert!(app.prepared().unwrap().pixels.as_bytes(0).is_some());
    switch(cx, 1);
    cx.update(|cx| assert!(!view.read(cx).web));
    switch(cx, 0);
    cx.executor().advance_clock(Duration::from_millis(151));
    cx.run_until_parked();
    cx.update(|cx| assert!(!view.read(cx).web));
    switch(cx, 1);
    cx.executor().advance_clock(Duration::from_millis(151));
    cx.run_until_parked();
    cx.update(|cx| {
        let page = view.read(cx);
        assert!(page.web && page.icons[slow].is_none());
        assert!(
            page.icons.values().flatten().any(|i| i
                .prepared()
                .unwrap()
                .pixels
                .as_bytes(0)
                .is_some())
        );
    });
    assert!(send.send(Some(app.clone())).is_ok());
    cx.update(|cx| view.update(cx, |p, cx| p.reload(cx)));
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::Rules)),
        rules(true),
    );
    cx.run_until_parked();
    cx.update(|cx| assert!(view.read(cx).icons[slow].is_none()));
    switch(cx, 0);
    client.test_answer(
        request(&requests, |r| matches!(r, WindowRequest::Icons(_))),
        icons(),
    );
    cx.run_until_parked();
    cx.update(|cx| {
        assert!(Arc::ptr_eq(
            &view.read(cx).icons["Editor.EXE"]
                .as_ref()
                .unwrap()
                .prepared()
                .unwrap()
                .pixels,
            &app.prepared().unwrap().pixels
        ))
    });
    switch(cx, 1);
    cx.update(|cx| {
        assert!(Arc::ptr_eq(
            &view.read(cx).icons[slow]
                .as_ref()
                .unwrap()
                .prepared()
                .unwrap()
                .pixels,
            &app.prepared().unwrap().pixels
        ))
    });
}
