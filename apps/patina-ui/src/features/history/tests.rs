use super::{Client, History, HistoryDay};
use gpui_kit::{AppContext, TestAppContext, WindowOptions};
use patina_desktop_protocol::{FromWindow, Reply, WindowRequest};
use std::sync::mpsc::Receiver;

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
                        client.test_answer(id, Reply::HistoryModes(([0; 3], false)))
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
