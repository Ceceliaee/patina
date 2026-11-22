use crate::{client::Client, windows::main::MainWindow};
use chrono::{Days, Local};
use gpui_kit::{AppContext, SharedString, TestAppContext, px, test::TestWindowExt};
use patina_activity_model::{Series, SeriesKind, Trends};
use patina_desktop_protocol::{FromWindow, Reply, RequestError, WindowRequest};
use std::sync::mpsc::Receiver;

pub(super) fn reads(client: &Client, requests: &Receiver<FromWindow>) -> Vec<u64> {
    let mut reads = Vec::new();
    for message in requests.try_iter() {
        if let FromWindow::Request(id, request) = message {
            match *request {
                WindowRequest::Trends(_, _) => reads.push(id),
                WindowRequest::HistoryModes(None) => {
                    client.test_answer(id, Reply::HistoryModes(([0; 2], true)))
                }
                WindowRequest::Icons(_) => client.test_answer(id, Reply::Icons(vec![])),
                _ => {}
            }
        }
    }
    reads
}

pub(super) fn trends(name: &str) -> Reply {
    let today = Local::now().timestamp_millis();
    Reply::Trends(Trends {
        days: vec![today],
        earliest: Some(today),
        series: vec![Series {
            key: name.into(),
            name: name.into(),
            daily: [(0, 60_000)].into(),
            color: 0x4285aa,
            custom_color: None,
            favicon: None,
        }],
    })
}

#[gpui_kit::test]
fn saved_web_detail_checks_availability_before_its_first_query(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    for (enabled, expected) in [(true, SeriesKind::Web), (false, SeriesKind::App)] {
        let (client, messages) = Client::test_connection();
        client.navigation.set(super::MainNavigation {
            data_detailed: true,
            data_kind: SeriesKind::Web,
            ..Default::default()
        });
        let (handle, page) = cx.update(|cx| {
            gpui_kit::open_window(Default::default(), cx, |win, cx| {
                cx.new(|cx| super::DataPage::new(client.clone(), Default::default(), win, cx))
            })
            .unwrap()
        });
        let mode_request = || {
            let mut mode = None;
            for message in messages.try_iter() {
                if let FromWindow::Request(id, query) = message {
                    match *query {
                        WindowRequest::HistoryModes(None) => mode = Some(id),
                        WindowRequest::Trends(..) => {
                            panic!("requested trends before checking web availability")
                        }
                        _ => {}
                    }
                }
            }
            mode.unwrap()
        };
        cx.run_until_parked();
        client.test_reject(mode_request(), RequestError::Busy);
        cx.run_until_parked();
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            win.click("retry", cx);
        })
        .unwrap();
        cx.run_until_parked();
        client.test_answer(mode_request(), Reply::HistoryModes(([0; 2], enabled)));
        cx.run_until_parked();
        let mut queries = 0;
        for message in messages.try_iter() {
            if let FromWindow::Request(id, query) = message
                && let WindowRequest::Trends(_, kind) = *query
            {
                assert_eq!(kind, expected);
                client.test_answer(id, trends("Fixture"));
                queries += 1;
            }
        }
        assert_eq!(queries, 2);
        cx.run_until_parked();
        assert!(reads(&client, &messages).is_empty());
        cx.run_until_parked();
        cx.update(|cx| {
            assert!(page.read(cx).frame.as_ref().unwrap().request.detailed);
            assert_eq!(page.read(cx).data_kind, expected);
        });
        assert_eq!(client.navigation.get().data_kind, SeriesKind::Web);
    }
}

#[gpui_kit::test]
fn data_presents_complete_frames_and_lays_out_the_year_on_entry(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = Client::test_connection();
    let (handle, _) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    crate::features::today::tests::answer_empty_today(cx, &client, &requests);
    let click = |cx: &mut TestAppContext, id: &'static str| {
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            win.click(id, cx);
        })
        .unwrap();
        cx.run_until_parked();
    };
    let segment = |cx: &mut TestAppContext, group: &'static str, index: usize| {
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            win.within(group).click(("segment", index), cx);
        })
        .unwrap();
        cx.run_until_parked();
    };
    let has = |cx: &mut TestAppContext, id: &'static str| {
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            win.try_find(id).is_some()
        })
        .unwrap()
    };
    click(cx, "data.title");
    let pending = reads(&client, &requests);
    assert_eq!(pending.len(), 2);
    let Reply::Trends(mut data) = trends("Editor") else {
        unreachable!()
    };
    data.series.push(Series {
        key: "Browser".into(),
        name: "用于查看长名称的浏览器 Browser With A Long Display Name".into(),
        daily: [(0, 2_000)].into(),
        color: 0xd48e21,
        custom_color: None,
        favicon: None,
    });
    client.test_answer(pending[0], Reply::Trends(data));
    cx.run_until_parked();
    assert!(has(cx, "today-ranking-panel"));
    assert!(!has(cx, "open-range"));
    client.test_answer(pending[1], trends("Editor"));
    cx.run_until_parked();
    assert!(has(cx, "open-range"));
    segment(cx, "data-view", 1);
    assert!(client.navigation.get().data_detailed);
    assert!(!has(cx, "trend-open-Editor"));
    assert!(reads(&client, &requests).is_empty());
    cx.run_until_parked();
    assert!(has(cx, "trend-open-Editor"));
    cx.update_window(handle, |_, win, cx| {
        win.click_with_modifiers("series-Browser", gpui_kit::Modifiers { control: true, ..Default::default() }, cx);
        let date = Local::now().date_naive();
        win.hover(SharedString::from(format!("selection-trend-{date}")), cx);
        win.render_frame(cx);
        let scale = win.scale_factor();
        let tip = win.find("trend-tooltip").bounds().scale(scale);
        assert_eq!(tip.size.width, px(144.).scale(scale));
        let quads = win.painted_quads();
        let dots = quads.iter().filter(|quad| {
            quad.bounds.size.width == px(6.).scale(scale)
                && quad.bounds.size.height == quad.bounds.size.width
        });
        let legend: Vec<_> = dots.clone().filter(|q| tip.contains(&q.bounds.center())).collect();
        assert_eq!(legend.len(), 2);
        assert_ne!(legend[0].background, legend[1].background);
        for marker in legend {
            assert!(dots.clone().any(|q| !tip.contains(&q.bounds.center()) && q.background == marker.background));
        }
        let rows = [0_usize, 1].map(|i| (
            win.within("trend-tooltip").find(("series-name", i)).bounds(),
            win.within("trend-tooltip").find(("series-time", i)).bounds(),
        ));
        assert_eq!(rows[0].0.left(), rows[1].0.left());
        assert_eq!(rows[0].1.right(), rows[1].1.right());
        assert!(rows.iter().all(|(name, time)| name.size.height == time.size.height));
        assert!(rows.iter().all(|(name, value)| name.right() < value.left()));
    })
    .unwrap();
    for (width, height) in [(1080., 720.), (810., 540.), (1080., 720.)] {
        cx.simulate_window_resize(handle, gpui_kit::size(px(width), px(height)));
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            let metrics = [0usize, 1, 2, 3].map(|i| win.find(("metric", i)).bounds());
            assert!(
                metrics
                    .windows(2)
                    .all(|pair| pair[0].origin.y == pair[1].origin.y
                        && pair[0].right() <= pair[1].origin.x)
            );
            let date = Local::now().date_naive();
            let cell = |days| {
                win.find(SharedString::from(format!(
                    "trend-heat-{}",
                    date - Days::new(days)
                )))
                .bounds()
            };
            let first = cell(350);
            let last = cell(0);
            let neighbor = cell(343);
            assert!(
                first.size.width > px(3.) && first.size.height > px(3.),
                "{first:?}"
            );
            assert!((first.size.width - first.size.height).abs() < px(1.));
            assert!(
                last.origin.x - first.origin.x > px(300.),
                "{first:?} {last:?}"
            );
            assert!(neighbor.origin.x >= first.right() && neighbor.origin.y == first.origin.y);
            let mut rows = (7..14).map(|days| cell(days).origin.y).collect::<Vec<_>>();
            rows.sort();
            rows.dedup();
            assert_eq!(rows.len(), 7);
        })
        .unwrap();
    }

    segment(cx, "destination-mode", SeriesKind::Category as usize);
    let pending = reads(&client, &requests);
    assert_eq!(pending.len(), 2);
    client.test_answer(pending[0], trends("Work"));
    cx.run_until_parked();
    assert!(has(cx, "trend-open-Editor"));
    segment(cx, "destination-mode", SeriesKind::App as usize);
    client.test_answer(pending[1], trends("Work"));
    cx.run_until_parked();
    assert!(has(cx, "trend-open-Editor"));
    click(cx, "range-next");
    let pending = reads(&client, &requests);
    assert_eq!(pending.len(), 1);
    client.test_reject(pending[0], RequestError::Busy);
    cx.run_until_parked();
    assert!(has(cx, "trend-open-Editor"));
    assert!(has(cx, "retry"));
    click(cx, "retry");
    for id in reads(&client, &requests) {
        client.test_answer(id, trends("Writer"));
    }
    cx.run_until_parked();
    assert!(reads(&client, &requests).is_empty());
    cx.run_until_parked();
    assert!(has(cx, "trend-open-Writer"));
    click(cx, "dashboard.title");
    click(cx, "data.title");
    for id in reads(&client, &requests) {
        client.test_answer(id, trends("Editor"));
    }
    cx.run_until_parked();
    assert!(reads(&client, &requests).is_empty());
    cx.run_until_parked();
    assert!(has(cx, "trend-open-Editor"));
    segment(cx, "data-view", 0);
    assert!(!client.navigation.get().data_detailed);
    click(cx, "dashboard.title");
    click(cx, "data.title");
    assert!(has(cx, "open-range"));
    assert!(!has(cx, "trend-open-Editor"));
    click(cx, "dashboard.title");
    drop(client.edit_app(
        "Editor".into(),
        patina_activity_model::AppEdit::Name("Updated".into()),
    ));
    click(cx, "data.title");
    assert!(!has(cx, "open-range"));
    click(cx, "dashboard.title");
    for id in reads(&client, &requests) {
        client.test_answer(id, trends("Late"));
    }
    cx.run_until_parked();
    assert!(!has(cx, "open-range"));
}
