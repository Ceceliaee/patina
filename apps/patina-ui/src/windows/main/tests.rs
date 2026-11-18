use super::{MainWindow, Page, Section};
use gpui_kit::TestAppContext;
use gpui_kit::test::TestWindowExt;
use patina_activity_model::{Theme, TrackingPreferences};
use patina_desktop_protocol::{FromWindow, Query, Reply};

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
        if let FromWindow::Query(id, query) = msg
            && matches!(*query, Query::Preferences)
        {
            let prefs = TrackingPreferences {
                web: Default::default(),
                remote: Default::default(),
                desktop: Default::default(),
                gap: 180,
                idle: 900,
                minimum: 0,
                refresh: 1,
                paused: false,
                titles: false,
                locale: patina_i18n::Locale::EnUs,
                theme: Theme::System,
                schemes: Default::default(),
            };
            client.test_answer(id, Reply::Preferences(prefs));
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
