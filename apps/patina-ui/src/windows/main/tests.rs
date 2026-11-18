use super::{MainWindow, Page, Section};
use gpui_kit::TestAppContext;
use gpui_kit::test::TestWindowExt;
use patina_activity_model::{AppPreferences, Theme};
use patina_desktop_protocol::{FromWindow, Reply, WindowRequest};

fn preferences() -> AppPreferences {
    AppPreferences {
        web: Default::default(),
        remote: Default::default(),
        desktop: Default::default(),
        timeline_merge_gap_secs: 180,
        idle_timeout_secs: 900,
        min_session_secs: 0,
        refresh_interval_secs: 1,
        paused: false,
        titles: false,
        locale: patina_i18n::Locale::EnUs,
        theme: Theme::System,
        schemes: Default::default(),
    }
}

#[gpui_kit::test]
fn keeping_a_settings_draft_restores_focus_and_cancel_discards_changes(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = crate::client::Client::test_connection();
    let (handle, weak) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    cx.update(|cx| {
        handle
            .update(cx, |_, win, cx| {
                weak.update(cx, |main, cx| main.select(Section::Settings, win, cx))
                    .unwrap();
            })
            .unwrap()
    });
    cx.run_until_parked();
    let mut delivered = false;
    for msg in requests.try_iter() {
        if let FromWindow::Request(id, request) = msg
            && matches!(*request, WindowRequest::Preferences)
        {
            client.test_answer(id, Reply::Preferences(preferences()));
            delivered = true;
        }
    }
    assert!(delivered);
    cx.run_until_parked();
    cx.update(|cx| {
        handle
            .update(cx, |_, win, cx| {
                win.render_frame(cx);
                win.click("settings.timelineMergeGapLabel-1", cx);
                let main = weak.upgrade().unwrap();
                let Page::Settings(settings) = &main.read(cx).page else {
                    panic!("expected settings")
                };
                let settings = settings.clone();
                assert!(settings.read(cx).dirty());

                let previous = win.focused(cx).unwrap_or_else(|| cx.focus_handle());
                win.focus(&previous, cx);
                main.update(cx, |main, cx| main.select(Section::History, win, cx));
                assert!(main.read(cx).pending.is_some());
                win.render_frame(cx);
                win.click("keep-editing", cx);
                assert!(main.read(cx).pending.is_none());
                assert!(settings.read(cx).dirty());
                assert!(previous.is_focused(win));
                win.render_frame(cx);
                win.click("cancel", cx);
                assert!(!settings.read(cx).dirty());
                main.update(cx, |main, cx| main.select(Section::History, win, cx));
                assert!(matches!(main.read(cx).page, Page::History(_)));
            })
            .unwrap()
    });
}

#[gpui_kit::test]
fn failed_save_retries_the_same_draft_and_conflict_cancel_loads_latest(cx: &mut TestAppContext) {
    use patina_desktop_protocol::RequestError;

    cx.update(gpui_kit::init);
    let (client, requests) = crate::client::Client::test_connection();
    let (handle, weak) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    cx.update(|cx| {
        handle
            .update(cx, |_, win, cx| {
                weak.update(cx, |main, cx| main.select(Section::Settings, win, cx))
                    .unwrap();
            })
            .unwrap()
    });
    let request = || {
        requests
            .try_iter()
            .find_map(|message| match message {
                FromWindow::Request(id, query)
                    if matches!(
                        query.as_ref(),
                        WindowRequest::SavePreferences(..) | WindowRequest::Preferences
                    ) =>
                {
                    Some((id, *query))
                }
                _ => None,
            })
            .expect("expected settings request")
    };
    let click = |cx: &mut TestAppContext, id: &'static str| {
        cx.update(|cx| {
            handle
                .update(cx, |_, win, cx| {
                    win.render_frame(cx);
                    win.click(id, cx);
                })
                .unwrap()
        });
        cx.run_until_parked();
    };
    cx.run_until_parked();
    let (id, WindowRequest::Preferences) = request() else {
        panic!("expected initial load")
    };
    let initial = preferences();
    client.test_answer(id, Reply::Preferences(initial.clone()));
    cx.run_until_parked();
    click(cx, "settings.timelineMergeGapLabel-1");
    click(cx, "save");
    let (id, WindowRequest::SavePreferences(old, draft)) = request() else {
        panic!("expected save")
    };
    assert!(old == initial && old != draft);
    client.test_reject(id, RequestError::Rejected("disk unavailable".into()));
    cx.run_until_parked();
    click(cx, "retry");
    let (id, WindowRequest::SavePreferences(retried_old, retried_draft)) = request() else {
        panic!("Retry must resend the edited draft")
    };
    assert!(old == retried_old && draft == retried_draft);
    client.test_reject(id, RequestError::Conflict("concurrent edit".into()));
    cx.run_until_parked();
    cx.update(|cx| {
        let main = weak.upgrade().unwrap();
        let Page::Settings(s) = &main.read(cx).page else {
            panic!("expected Settings")
        };
        assert!(s.read(cx).dirty());
    });
    click(cx, "cancel");
    let (id, WindowRequest::Preferences) = request() else {
        panic!("Cancel must reload committed values after a conflict")
    };
    let mut latest = initial;
    latest.timeline_merge_gap_secs = 60;
    client.test_answer(id, Reply::Preferences(latest.clone()));
    cx.run_until_parked();
    click(cx, "settings.timelineMergeGapLabel-1");
    click(cx, "save");
    let (_, WindowRequest::SavePreferences(base, edit)) = request() else {
        panic!("expected saving against the reloaded values")
    };
    assert!(base == latest && edit.timeline_merge_gap_secs == 120);
}
