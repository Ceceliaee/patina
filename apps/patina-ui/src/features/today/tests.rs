use super::{AppUsage, DaySummary, Locale, TodaySnapshot};
use crate::{client::Client, windows::main::MainWindow};
use gpui_kit::{
    AppContext, TestAppContext, px,
    test::{ClickOptions, TestWindowExt},
};
use patina_activity_model::HistoryDay;
use patina_desktop_protocol::{FromWindow, Reply, RequestError, WindowRequest};
use std::{collections::HashMap, sync::mpsc::Receiver, time::Duration};

fn next_request(requests: &Receiver<FromWindow>, matches: fn(&WindowRequest) -> bool) -> u64 {
    requests
        .try_iter()
        .find_map(|msg| match msg {
            FromWindow::Request(id, req) if matches(&req) => Some(id),
            _ => None,
        })
        .expect("expected page request")
}

fn summary() -> DaySummary {
    let tomorrow = chrono::Local::now().date_naive().succ_opt().unwrap();
    let end = tomorrow
        .and_hms_opt(0, 0, 0)
        .unwrap()
        .and_local_timezone(chrono::Local)
        .earliest()
        .unwrap()
        .timestamp_millis();
    DaySummary {
        day_end_ms: end,
        apps: vec![AppUsage {
            key: "editor.exe".into(),
            name: "Editor".into(),
            category: "other".into(),
            color: 0x4285aa,
            custom_color: None,
            anonymous: false,
            hourly_duration_ms: [0; 24],
            duration_ms: 60_000,
        }],
        categories: vec![],
        category_choices: vec![],
        total_duration_ms: 60_000,
        yesterday_duration_ms: 0,
        refresh_seconds: 60,
    }
}

#[gpui_kit::test]
fn cold_and_cached_navigation_keep_the_same_cards_while_requests_are_pending(
    cx: &mut TestAppContext,
) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let (handle, _) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    let request = |matches| next_request(&requests, matches);
    let click = |cx: &mut TestAppContext, id: &'static str| {
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            win.click(id, cx);
        })
        .unwrap();
        cx.run_until_parked();
    };
    let panels = |cx: &mut TestAppContext, has_app: bool| {
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            assert_eq!(win.try_find("app-editor.exe").is_some(), has_app);
            [
                "today-focus-panel",
                "today-activity-panel",
                "today-ranking-panel",
            ]
            .map(|id| win.find(id).bounds())
        })
        .unwrap()
    };

    let leave_today = |cx: &mut TestAppContext| {
        click(cx, "tools.title");
        let list = request(|r| {
            matches!(
                r,
                WindowRequest::Tools(patina_desktop_protocol::tools::ToolRequest::List)
            )
        });
        client.test_answer(list, Reply::Tools((vec![], false, None)));
        cx.run_until_parked();
    };
    cx.run_until_parked();
    let first = request(|r| matches!(r, WindowRequest::Today));
    let cold = panels(cx, false);
    assert!(
        cold.iter()
            .all(|card| card.size.width > px(0.) && card.size.height > px(0.))
    );
    cx.executor().advance_clock(Duration::from_secs(2));
    assert_eq!(panels(cx, false), cold);
    leave_today(cx);
    click(cx, "dashboard.title");
    let today = request(|r| matches!(r, WindowRequest::Today));
    client.test_answer(first, Reply::Today(summary()));
    cx.run_until_parked();
    assert_eq!(panels(cx, false), cold);
    client.test_answer(today, Reply::Today(summary()));
    cx.run_until_parked();
    let icons = request(|r| matches!(r, WindowRequest::Icons(keys) if keys == &["editor.exe"]));
    assert_eq!(panels(cx, false), cold);
    let icon_png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQCeoBAAGgAQNhYOe6AAAAAElFTkSuQmCC";
    client.test_answer(
        icons,
        Reply::Icons(vec![("editor.exe".into(), icon_png.into())]),
    );
    cx.run_until_parked();
    assert_eq!(panels(cx, true), cold);
    leave_today(cx);
    click(cx, "dashboard.title");
    let refresh = request(|r| matches!(r, WindowRequest::Today));
    assert_eq!(panels(cx, true), cold);
    client.test_reject(refresh, RequestError::Busy);
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        win.find("app-editor.exe");
        win.find("retry");
    })
    .unwrap();
    click(cx, "retry");
    let retry = request(|r| matches!(r, WindowRequest::Today));
    let mut empty = summary();
    empty.apps.clear();
    empty.total_duration_ms = 0;
    client.test_answer(retry, Reply::Today(empty));
    cx.run_until_parked();
    assert_eq!(panels(cx, false), cold);
}

#[test]
fn cached_summary_requires_the_same_day_language_and_unmodified_data() {
    let (client, _requests) = Client::test_connection();
    let mut snapshot = TodaySnapshot {
        summary: summary(),
        icons: HashMap::new(),
        locale: client.locale.get(),
        revision: client.activity_revision.get(),
    };
    assert!(snapshot.reusable(&client));
    let day_end = snapshot.summary.day_end_ms;
    snapshot.summary.day_end_ms = chrono::Local::now().timestamp_millis() - 1;
    assert!(!snapshot.reusable(&client));
    snapshot.summary.day_end_ms = day_end;
    client.locale.set(Locale::ZhCn);
    assert!(!snapshot.reusable(&client));
    client.locale.set(snapshot.locale);
    drop(client.edit_app(
        "editor.exe".into(),
        patina_activity_model::AppEdit::Name("Updated".into()),
    ));
    assert!(!snapshot.reusable(&client));
}

#[gpui_kit::test]
fn double_click_keeps_detail_geometry_through_read_retry_and_date_change(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let (handle, _) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    let request = |matches| next_request(&requests, matches);
    cx.run_until_parked();
    let data = summary();
    let end = data.day_end_ms;
    client.test_answer(
        request(|r| matches!(r, WindowRequest::Today)),
        Reply::Today(data),
    );
    cx.run_until_parked();
    client.test_answer(
        request(|r| matches!(r, WindowRequest::Icons(_))),
        Reply::Icons(vec![]),
    );
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        win.click_with_options("app-editor.exe", ClickOptions::default().with_count(2), cx);
    })
    .unwrap();
    let bounds = |cx: &mut TestAppContext, ready: bool| {
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            assert_eq!(win.try_find("zoom-more").is_some(), ready);
            [
                "app-detail-popup",
                "close-detail",
                "date-picker",
                "detail-timeline-track",
                "detail-record-list",
            ]
            .map(|id| win.find(id).bounds())
        })
        .unwrap()
    };
    let initial = bounds(cx, false);
    assert!(initial[4].size.height > px(0.));
    cx.run_until_parked();
    client.test_answer(
        request(|r| matches!(r, WindowRequest::HistoryModes(None))),
        Reply::HistoryModes(([0; 2], false)),
    );
    cx.run_until_parked();
    client.test_answer(
        request(|r| matches!(r, WindowRequest::DetailZoom(None))),
        Reply::Zoom(24.),
    );
    cx.run_until_parked();
    let read = request(
        |r| matches!(r, WindowRequest::History {app: Some(key), ..} if key == "editor.exe"),
    );
    cx.executor().advance_clock(Duration::from_secs(2));
    assert_eq!(bounds(cx, false), initial);
    client.test_reject(read, RequestError::Busy);
    cx.run_until_parked();
    assert_eq!(bounds(cx, false), initial);
    cx.update_window(handle, |_, win, cx| win.click("detail-retry", cx))
        .unwrap();
    cx.run_until_parked();
    client.test_answer(
        request(|r| matches!(r, WindowRequest::HistoryModes(None))),
        Reply::HistoryModes(([0; 2], false)),
    );
    cx.run_until_parked();
    client.test_answer(
        request(|r| matches!(r, WindowRequest::History { .. })),
        Reply::History(HistoryDay {
            start: end - 86_400_000,
            end,
            records: vec![],
            apps: vec![],
            minimum_seconds: 60,
            timeline_merge_gap_ms: 0,
            colors: Default::default(),
            custom_colors: Default::default(),
            favicons: Default::default(),
            hours: [0; 24],
            category_hours: Default::default(),
            categories: vec![],
        }),
    );
    cx.run_until_parked();
    assert_eq!(bounds(cx, true), initial);
    cx.update_window(handle, |_, win, cx| win.click("prev-date", cx))
        .unwrap();
    assert_eq!(bounds(cx, false), initial);
    cx.update_window(handle, |_, win, cx| {
        win.click("close-detail", cx);
        win.render_frame(cx);
        assert!(win.try_find("app-detail-popup").is_none());
    })
    .unwrap();
}
