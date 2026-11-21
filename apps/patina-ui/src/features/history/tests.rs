use super::{Client, History, HistoryDay};
use gpui_kit::{AppContext, TestAppContext, WindowOptions};
use patina_desktop_protocol::{FromWindow, Reply, WindowRequest};
use std::sync::mpsc::Receiver;

use crate::windows::main::MainWindow;
use gpui_kit::{px, test::TestWindowExt};
use patina_desktop_protocol::RequestError;

fn day(start: i64) -> HistoryDay {
    HistoryDay {
        start,
        end: start + 86_400_000,
        apps: vec![],
        records: vec![],
        minimum_seconds: 0,
        timeline_merge_gap_ms: 0,
        colors: Default::default(),
        custom_colors: Default::default(),
        favicons: Default::default(),
        hours: [0; 24],
        category_hours: Default::default(),
        categories: vec![],
    }
}

fn wait_for_day(
    cx: &TestAppContext,
    client: &Client,
    requests: &Receiver<FromWindow>,
    expected: i64,
) -> u64 {
    for _ in 0..8 {
        cx.run_until_parked();
        for msg in requests.try_iter() {
            if let FromWindow::Request(id, request) = msg {
                match *request {
                    WindowRequest::HistoryModes(None) => {
                        client.test_answer(id, Reply::HistoryModes(([0; 2], false)))
                    }
                    WindowRequest::HistoryZoom(None) | WindowRequest::DetailZoom(None) => {
                        client.test_answer(id, Reply::Zoom(4.))
                    }
                    WindowRequest::History { day, .. } if day == expected => return id,
                    _ => panic!("unexpected request during history load"),
                }
            }
        }
    }
    panic!("history did not request date {expected}");
}

#[gpui_kit::test]
fn late_history_response_cannot_replace_the_selected_day(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let first = 86_400_000;
    let second = 2 * first;
    let open = |cx: &TestAppContext, date: i64| {
        cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |window, cx| {
                cx.new(|cx| {
                    History::new(
                        client.clone(),
                        date,
                        Some(("example".into(), "Example".into())),
                        window,
                        cx,
                    )
                })
            })
            .unwrap()
        })
    };
    let (window, view) = open(cx, first);
    let old = wait_for_day(cx, &client, &requests, first);
    cx.update(|cx| view.update(cx, |history, cx| history.change_day(second, cx)));
    let current = wait_for_day(cx, &client, &requests, second);
    client.test_answer(current, Reply::History(day(second)));
    cx.run_until_parked();
    client.test_answer(old, Reply::History(day(first)));
    cx.run_until_parked();
    cx.update(|cx| {
        assert_eq!(view.read(cx).date, second);
        assert_eq!(view.read(cx).data.as_ref().unwrap().start, second);
    });

    cx.update(|cx| view.update(cx, |history, cx| history.change_day(first, cx)));
    let closing = wait_for_day(cx, &client, &requests, first);
    let weak = view.downgrade();
    drop(view);
    cx.update_window(window, |_, window, _| window.remove_window())
        .unwrap();
    cx.run_until_parked();
    assert!(cx.update(|_| weak.upgrade().is_none()));
    let (_, reopened) = open(cx, second);
    let fresh = wait_for_day(cx, &client, &requests, second);
    client.test_answer(closing, Reply::History(day(first)));
    cx.run_until_parked();
    cx.update(|cx| assert!(reopened.read(cx).data.is_none()));
    client.test_answer(fresh, Reply::History(day(second)));
    cx.run_until_parked();
    cx.update(|cx| assert_eq!(reopened.read(cx).data.as_ref().unwrap().start, second));
}

#[gpui_kit::test]
fn overview_keeps_its_layout_and_only_restores_the_selected_day(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let (window, _) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    let click = |cx: &mut TestAppContext, id: &'static str| {
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            win.click(id, cx);
        })
        .unwrap();
        cx.run_until_parked();
    };
    let layout = |cx: &mut TestAppContext, editor: bool| {
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            assert_eq!(win.try_find("open-history-editor.exe").is_some(), editor);
            [
                "history-overview",
                "timeline-mode",
                "history.activeSpan",
                "history-hourly-chart",
                "history-apps",
            ]
            .map(|id| win.find(id).bounds())
        })
        .unwrap()
    };
    let next_read = |cx: &TestAppContext| {
        for _ in 0..8 {
            cx.run_until_parked();
            for message in requests.try_iter() {
                if let FromWindow::Request(id, request) = message {
                    match *request {
                        WindowRequest::HistoryModes(None) => {
                            client.test_answer(id, Reply::HistoryModes(([0; 2], false)))
                        }
                        WindowRequest::HistoryZoom(None) => client.test_answer(id, Reply::Zoom(4.)),
                        WindowRequest::History {
                            day,
                            app: None,
                            web: false,
                            ..
                        } => return (id, day),
                        WindowRequest::History { .. } => panic!("unexpected history source"),
                        _ => {}
                    }
                }
            }
        }
        panic!("missing overview request");
    };
    let waiting_on_previous_page = |cx: &mut TestAppContext| {
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            assert!(win.try_find("history-overview").is_none());
            assert!(win.try_find("date-picker").is_none());
        })
        .unwrap();
    };
    let populated_day = |date| {
        let local = chrono::DateTime::from_timestamp_millis(date)
            .unwrap()
            .with_timezone(&chrono::Local);
        let mut data = day(local
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_local_timezone(chrono::Local)
            .earliest()
            .unwrap()
            .timestamp_millis());
        data.apps
            .push(("editor.exe".into(), "Editor".into(), 60_000));
        data.hours[8] = 60_000;
        data
    };
    click(cx, "history.title");
    let (first, date) = next_read(cx);
    waiting_on_previous_page(cx);
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(2));
    waiting_on_previous_page(cx);
    client.test_answer(first, Reply::History(populated_day(date)));
    cx.run_until_parked();
    let icons = requests
        .try_iter()
        .find_map(|m| match m {
            FromWindow::Request(id, request) if matches!(*request, WindowRequest::Icons(_)) => {
                Some(id)
            }
            _ => None,
        })
        .unwrap();
    waiting_on_previous_page(cx);
    client.test_answer(icons, Reply::Icons(vec![]));
    cx.run_until_parked();
    let ready = layout(cx, true);
    assert!(
        ready
            .iter()
            .all(|b| b.size.height > px(0.) && b.size.width > px(0.))
    );
    let caption = |cx: &mut TestAppContext| {
        cx.update_window(window, |_, win, cx| {
            win.render_frame(cx);
            win.find("date-picker").label().unwrap().to_owned()
        })
        .unwrap()
    };
    let today_caption = caption(cx);

    click(cx, "prev-date");
    let (previous, yesterday) = next_read(cx);
    assert!(yesterday < date);
    assert_eq!(layout(cx, true), ready);
    assert_eq!(caption(cx), today_caption);
    click(cx, "prev-date");
    let (earlier, earlier_date) = next_read(cx);
    assert!(earlier_date < yesterday);
    client.test_answer(previous, Reply::History(day(yesterday)));
    cx.run_until_parked();
    assert_eq!(layout(cx, true), ready);
    assert_eq!(caption(cx), today_caption);
    let start = populated_day(earlier_date).start;
    client.test_answer(earlier, Reply::History(day(start)));
    cx.run_until_parked();
    assert_eq!(layout(cx, false), ready);
    assert_ne!(caption(cx), today_caption);
    click(cx, "next-date");
    let _previous = next_read(cx);
    click(cx, "next-date");
    assert_eq!(layout(cx, true), ready);
    assert_eq!(caption(cx), today_caption);

    click(cx, "dashboard.title");
    click(cx, "history.title");
    assert_eq!(layout(cx, true), ready);
    let (refresh, _) = next_read(cx);
    client.test_reject(refresh, RequestError::Busy);
    cx.run_until_parked();
    assert_eq!(layout(cx, true), ready);
    click(cx, "retry-history");
    let (retry, _) = next_read(cx);
    client.test_answer(retry, Reply::History(populated_day(date)));
    cx.run_until_parked();
    for message in requests.try_iter() {
        if let FromWindow::Request(id, req) = message
            && matches!(*req, WindowRequest::Icons(_))
        {
            client.test_answer(id, Reply::Icons(vec![]));
        }
    }
    cx.run_until_parked();
    click(cx, "dashboard.title");
    drop(client.edit_app(
        "editor.exe".into(),
        patina_activity_model::AppEdit::Name("Changed".into()),
    ));
    click(cx, "history.title");
    waiting_on_previous_page(cx);
    let (abandoned, selected) = next_read(cx);
    click(cx, "dashboard.title");
    client.test_answer(
        abandoned,
        Reply::History(day(populated_day(selected).start)),
    );
    cx.run_until_parked();
    waiting_on_previous_page(cx);
    click(cx, "history.title");
    let (failed, _) = next_read(cx);
    client.test_reject(failed, RequestError::Busy);
    cx.run_until_parked();
    cx.update_window(window, |_, win, cx| {
        win.render_frame(cx);
        win.find("retry-history");
        win.find("history-overview");
    })
    .unwrap();
}
