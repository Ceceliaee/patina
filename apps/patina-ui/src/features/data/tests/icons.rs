use super::*;
use crate::{
    client::Client,
    features::data::tests::{reads, trends},
};
use base64::Engine;
use gpui_kit::{
    AppContext, Modifiers, TestAppContext, WindowOptions,
    test::{ClickOptions, TestWindowExt},
};
use patina_desktop_protocol::{FromWindow, Reply, WindowRequest};
use std::{sync::Arc, time::Duration};

const PNG: &str =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQCeoBAAGgAQNhYOe6AAAAAElFTkSuQmCC";

#[gpui_kit::test]
fn detail_icons_are_drawable_on_entry_and_late_sites_wait_for_reentry(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let (window, view) = cx.update(|cx| {
        gpui_kit::open_window(WindowOptions::default(), cx, |win, cx| {
            cx.new(|cx| DataPage::new(client.clone(), Default::default(), win, cx))
        })
        .unwrap()
    });
    let click = |cx: &mut TestAppContext, group: &'static str, index| {
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            win.within(group).click(("segment", index), cx);
        })
        .unwrap();
        cx.run_until_parked();
    };
    cx.run_until_parked();
    for id in reads(&client, &requests) {
        client.test_answer(id, trends("Editor"));
    }
    cx.run_until_parked();
    click(cx, "data-view", 1usize);
    cx.update(|cx| assert!(!view.read(cx).frame.as_ref().unwrap().request.detailed));
    let icon_request = requests
        .try_iter()
        .find_map(|message| match message {
            FromWindow::Request(id, req) if matches!(*req, WindowRequest::Icons(_)) => Some(id),
            _ => None,
        })
        .unwrap();
    client.test_answer(
        icon_request,
        Reply::Icons(vec![("Editor".into(), PNG.into())]),
    );
    cx.run_until_parked();
    let app_icon = cx.update(|cx| {
        view.read(cx)
            .icon("Editor")
            .unwrap()
            .prepared()
            .unwrap()
            .pixels
            .clone()
    });
    assert!(app_icon.as_bytes(0).is_some());

    let slow = "https://slow.example/icon.png";
    let send = cx.update(|cx| view.update(cx, |page, _| page.cache.icons.sites.pending(slow)));
    click(cx, "destination-mode", SeriesKind::Web as usize);
    let web_data = || {
        let Reply::Trends(mut data) = trends("local.example") else {
            unreachable!()
        };
        data.series[0].favicon = Some(format!("data:image/png;base64,{PNG}"));
        let Reply::Trends(mut slow_data) = trends("slow.example") else {
            unreachable!()
        };
        slow_data.series[0].favicon = Some(slow.into());
        data.series.append(&mut slow_data.series);
        Reply::Trends(data)
    };
    for id in reads(&client, &requests) {
        client.test_answer(id, web_data());
    }
    cx.run_until_parked();
    cx.update(|cx| assert!(view.read(cx).data_kind == SeriesKind::App));
    cx.executor().advance_clock(Duration::from_millis(151));
    cx.run_until_parked();
    cx.update(|cx| {
        let page = view.read(cx);
        assert!(page.data_kind == SeriesKind::Web);
        assert!(
            page.icon("local.example")
                .unwrap()
                .prepared()
                .unwrap()
                .pixels
                .as_bytes(0)
                .is_some()
        );
        assert!(page.icon("slow.example").is_none());
        assert!(page.icon("Editor").is_none());
    });
    let icon = cx.update(|cx| {
        SourceIcon::from_png(
            base64::engine::general_purpose::STANDARD
                .decode(PNG)
                .unwrap(),
            cx.svg_renderer(),
        )
        .unwrap()
    });
    assert!(send.send(Some(icon)).is_ok());
    cx.update(|cx| view.update(cx, |page, cx| page.refresh(cx)));
    for id in reads(&client, &requests) {
        client.test_answer(id, web_data());
    }
    cx.run_until_parked();
    cx.update(|cx| assert!(view.read(cx).icon("slow.example").is_none()));
    click(cx, "destination-mode", SeriesKind::App as usize);
    cx.update(|cx| {
        assert!(Arc::ptr_eq(
            &app_icon,
            &view
                .read(cx)
                .icon("Editor")
                .unwrap()
                .prepared()
                .unwrap()
                .pixels
        ))
    });
    click(cx, "destination-mode", SeriesKind::Web as usize);
    cx.update(|cx| {
        assert!(
            view.read(cx)
                .icon("slow.example")
                .unwrap()
                .prepared()
                .unwrap()
                .pixels
                .as_bytes(0)
                .is_some()
        )
    });
    for kind in [SeriesKind::App, SeriesKind::Web] {
        assert!(matches!(
            requests.try_recv(),
            Ok(FromWindow::Navigation(nav)) if nav.data_detailed && nav.data_kind == kind
        ));
    }
    assert!(
        requests.try_recv().is_err(),
        "cached icons triggered another request"
    );
    cx.update_window(window, |_, win, cx| {
        win.render_frame(cx);
        win.click("series-local.example", cx);
        let pixels = view
            .read(cx)
            .icon("slow.example")
            .unwrap()
            .prepared()
            .unwrap()
            .pixels
            .clone();
        for expected in [2, 1] {
            win.render_frame(cx);
            win.click_with_options(
                "trend-open-slow.example",
                ClickOptions::default().with_modifiers(Modifiers {
                    control: true,
                    ..Default::default()
                }),
                cx,
            );
            let page = view.read(cx);
            assert_eq!(page.selected.len(), expected);
            assert!(page.selected.contains("local.example"));
            assert!(Arc::ptr_eq(
                &pixels,
                &page
                    .icon("slow.example")
                    .unwrap()
                    .prepared()
                    .unwrap()
                    .pixels
            ));
        }
    })
    .unwrap();
}
