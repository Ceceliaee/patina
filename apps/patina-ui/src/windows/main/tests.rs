use super::{MainWindow, Page, Section};
use gpui_kit::test::TestWindowExt;
use gpui_kit::{AppContext, TestAppContext};
use patina_activity_model::{AppPreferences, Theme};
use patina_desktop_protocol::{FromWindow, Reply, WindowRequest};
use patina_updater::{Request as UpdateRequest, Snapshot};

fn about_status_request(requests: &std::sync::mpsc::Receiver<FromWindow>) -> u64 {
    requests
        .try_iter()
        .find_map(|message| match message {
            FromWindow::Request(id, query)
                if matches!(*query, WindowRequest::Update(UpdateRequest::Status)) =>
            {
                Some(id)
            }
            _ => None,
        })
        .expect("expected local updater status request")
}

#[gpui_kit::test]
fn cold_resume_builds_only_the_saved_page_and_normal_reopen_keeps_it(cx: &mut TestAppContext) {
    use patina_desktop_protocol::{MainNavigation, MainTarget};
    cx.update(gpui_kit::init);
    let (client, messages) = crate::client::Client::test_connection();
    client.navigation.set(MainNavigation {
        section: Section::About,
        ..Default::default()
    });
    let (handle, main) =
        cx.update(|cx| MainWindow::open_at(cx, client.clone(), MainTarget::Resume).unwrap());
    cx.run_until_parked();
    let mut status = None;
    for message in messages.try_iter() {
        match message {
            FromWindow::Request(id, query) => match *query {
                WindowRequest::Update(UpdateRequest::Status) => status = Some(id),
                WindowRequest::Today | WindowRequest::Recent => {
                    panic!("opened Today during resume")
                }
                _ => {}
            },
            FromWindow::Navigation(_) => panic!("remembered a page before it was ready"),
            _ => {}
        }
    }
    let reopen = |cx: &mut TestAppContext, target| {
        cx.update_window(handle, |_, win, cx| {
            main.update(cx, |main, cx| main.reopen(target, win, cx))
                .unwrap();
        })
        .unwrap();
        cx.run_until_parked();
    };
    reopen(cx, MainTarget::Resume);
    client.test_answer(status.unwrap(), Reply::Update(Snapshot::idle("1.0.0")));
    cx.run_until_parked();
    assert!(
        messages
            .try_iter()
            .any(|m| matches!(m, FromWindow::Navigation(n) if n.section == Section::About))
    );
    reopen(cx, MainTarget::Resume);
    assert!(messages.try_iter().next().is_none());
    cx.update(|cx| {
        assert_eq!(
            main.upgrade().unwrap().read(cx).page.section(),
            Section::About
        )
    });
    reopen(cx, MainTarget::Today);
    cx.update(|cx| {
        assert_eq!(
            main.upgrade().unwrap().read(cx).page.section(),
            Section::About
        )
    });
    crate::features::today::tests::answer_empty_today(cx, &client, &messages);
    cx.update(|cx| {
        assert_eq!(
            main.upgrade().unwrap().read(cx).page.section(),
            Section::Today
        )
    });
}

#[gpui_kit::test]
fn tools_waits_for_the_installed_list_and_discards_a_cancelled_entry(cx: &mut TestAppContext) {
    use patina_desktop_protocol::tools::{Installed, Manifest, ToolRequest};

    cx.update(gpui_kit::init);
    let (client, requests) = crate::client::Client::test_connection();
    let (handle, main) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    crate::features::today::tests::answer_empty_today(cx, &client, &requests);
    let click = |cx: &mut TestAppContext, id: &'static str| {
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            win.click(id, cx);
        })
        .unwrap();
        cx.run_until_parked();
    };
    let tool_request = || {
        requests
            .try_iter()
            .find_map(|message| {
                if let FromWindow::Request(id, request) = message
                    && let WindowRequest::Tools(query) = *request
                {
                    return Some((id, query));
                }
                None
            })
            .expect("expected tool request")
    };
    let visible =
        |cx: &mut TestAppContext| cx.update(|cx| main.upgrade().unwrap().read(cx).page.section());
    let tool = Installed {
        manifest: Manifest {
            presentation: None,
            id: "fixture".into(),
            name: "Fixture".into(),
            version: "1".into(),
            api: 1,
            entry: "fixture.wasm".into(),
            capabilities: vec![],
        },
        generation: "first".into(),
    };
    for cancel in [true, false] {
        click(cx, "tools.title");
        let (list, ToolRequest::List) = tool_request() else {
            panic!("expected list")
        };
        assert!(visible(cx) == Section::Today);
        if cancel {
            click(cx, "dashboard.title");
        }
        client.test_answer(list, Reply::Tools((vec![tool.clone()], false, None)));
        cx.run_until_parked();
        assert!(
            visible(cx)
                == if cancel {
                    Section::Today
                } else {
                    Section::Tools
                }
        );
    }
    click(cx, "dashboard.title");
    click(cx, "tools.title");
    let (list, _) = tool_request();
    client.test_answer(
        list,
        Reply::Tools((vec![tool], false, Some("fixture".into()))),
    );
    cx.run_until_parked();
    assert_eq!(visible(cx), Section::Today);
    let (panel, ToolRequest::Panel { id, .. }) = tool_request() else {
        panic!("expected the saved plugin panel")
    };
    assert_eq!(id, "fixture");
    client.test_answer(panel, Reply::Panel(vec![]));
    cx.run_until_parked();
    assert_eq!(visible(cx), Section::Tools);
    click(cx, "dashboard.title");
    click(cx, "tools.title");
    let (list, _) = tool_request();
    client.test_reject(list, patina_desktop_protocol::RequestError::Disconnected);
    cx.run_until_parked();
    assert!(visible(cx) == Section::Tools);
}

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
        window_scale: 100,
        schemes: Default::default(),
    }
}

fn available_update() -> Snapshot {
    use patina_updater::{Phase, Release, Target};
    let mut snapshot = Snapshot::idle("1.0.0");
    snapshot.phase = Phase::Available;
    snapshot.release = Some(Release {
        version: "1.1.0".into(),
        notes: String::new(),
        target: Target::current().unwrap(),
        url: "https://example.invalid/update".into(),
        signature: String::new(),
        size: 1024,
    });
    snapshot
}

#[gpui_kit::test]
fn settings_press_reads_once_and_first_frame_uses_the_saved_values(cx: &mut TestAppContext) {
    use gpui_kit::{MouseButton, test::TestEventExt};

    cx.update(gpui_kit::init);
    let (client, requests) = crate::client::Client::test_connection();
    let (handle, weak) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    let preferences_request = || {
        requests.try_iter().find_map(|message| match message {
            FromWindow::Request(id, query) if matches!(*query, WindowRequest::Preferences) => {
                Some(id)
            }
            _ => None,
        })
    };
    cx.update(|cx| {
        handle
            .update(cx, |_, win, cx| {
                win.render_frame(cx);
                let target = win.find("settings.title").bounds().center();
                let outside = win.find("dashboard.title").bounds().center();
                win.pointer_move(target, None, cx);
                win.pointer_down(target, MouseButton::Left, cx);
                let abandoned = preferences_request().unwrap();
                win.pointer_move(outside, Some(MouseButton::Left), cx);
                win.pointer_up(outside, MouseButton::Left, cx);
                assert!(
                    weak.upgrade()
                        .unwrap()
                        .read(cx)
                        .pressed_settings_read
                        .is_none()
                );
                client.test_answer(abandoned, Reply::Preferences(preferences()));
                win.pointer_move(target, None, cx);
                win.pointer_down(target, MouseButton::Left, cx);
                let id = preferences_request().expect("mouse down starts reading preferences");
                let mut saved = preferences();
                saved.timeline_merge_gap_secs = 300;
                client.test_answer(id, Reply::Preferences(saved));
                assert!(matches!(
                    weak.upgrade().unwrap().read(cx).page,
                    Page::Today(_)
                ));
                win.pointer_up(target, MouseButton::Left, cx);
                assert!(matches!(
                    weak.upgrade().unwrap().read(cx).page,
                    Page::Settings(_)
                ));
                assert_eq!(
                    win.find("settings.timelineMergeGapLabel-1").disabled(),
                    Some(true)
                );
                assert_eq!(win.find("save").disabled(), Some(true));
                assert!(
                    preferences_request().is_none(),
                    "click reuses the read from mouse down"
                );
            })
            .unwrap()
    });
}

#[gpui_kit::test]
fn slow_settings_read_can_be_cancelled_and_failed_reads_can_be_retried(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, requests) = crate::client::Client::test_connection();
    let (handle, weak) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
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
    let request = || {
        requests
            .try_iter()
            .find_map(|message| match message {
                FromWindow::Request(id, query) if matches!(*query, WindowRequest::Preferences) => {
                    Some(id)
                }
                _ => None,
            })
            .expect("settings request")
    };

    click(cx, "settings.title");
    let abandoned = request();
    cx.update(|cx| {
        let main = weak.upgrade().unwrap();
        assert!(matches!(main.read(cx).page, Page::Today(_)));
        assert!(matches!(
            main.read(cx).opening_page,
            Some((Page::Settings(_), _))
        ));
    });
    click(cx, "about.title");
    client.test_answer(
        about_status_request(&requests),
        Reply::Update(Snapshot::idle("1.0.0")),
    );
    client.test_answer(abandoned, Reply::Preferences(preferences()));
    cx.run_until_parked();
    cx.update(|cx| {
        assert!(matches!(
            weak.upgrade().unwrap().read(cx).page,
            Page::About(_)
        ))
    });

    click(cx, "settings.title");
    client.test_reject(
        request(),
        patina_desktop_protocol::RequestError::Disconnected,
    );
    cx.run_until_parked();
    click(cx, "retry");
    client.test_answer(request(), Reply::Preferences(preferences()));
    cx.run_until_parked();
    cx.update(|cx| {
        handle
            .update(cx, |_, win, cx| {
                win.render_frame(cx);
                assert!(win.try_find("retry").is_none());
                win.click("settings.timelineMergeGapLabel-1", cx);
                assert!(weak.upgrade().unwrap().read(cx).dirty(cx));
            })
            .unwrap()
    });
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
                assert!(main.read(cx).pending.is_none());
                assert!(matches!(
                    main.read(cx).opening_page,
                    Some((Page::History(_), _))
                ));
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
    cx.update(|cx| assert!(weak.upgrade().unwrap().read(cx).save_toast.is_none()));
    click(cx, "settings.timelineMergeGapLabel-1");
    cx.update(|cx| {
        assert_eq!(
            weak.upgrade()
                .unwrap()
                .read(cx)
                .save_toast
                .as_ref()
                .unwrap()
                .message,
            "settings.unsaved"
        )
    });
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(30));
    cx.run_until_parked();
    click(cx, "settings.timelineMergeGapLabel-1");
    cx.update(|cx| assert!(weak.upgrade().unwrap().read(cx).save_toast.is_some()));
    click(cx, "cancel");
    cx.update(|cx| assert!(weak.upgrade().unwrap().read(cx).save_toast.is_none()));
    click(cx, "settings.timelineMergeGapLabel-1");
    cx.update(|cx| {
        assert_eq!(
            weak.upgrade()
                .unwrap()
                .read(cx)
                .save_toast
                .as_ref()
                .unwrap()
                .message,
            "settings.unsaved"
        )
    });
    click(cx, "save");
    let (id, WindowRequest::SavePreferences(old, draft)) = request() else {
        panic!("expected save")
    };
    assert!(old == initial && old != draft);
    client.test_reject(id, RequestError::Rejected("disk unavailable".into()));
    cx.run_until_parked();
    cx.update(|cx| {
        assert!(
            weak.upgrade()
                .unwrap()
                .read(cx)
                .save_toast
                .as_ref()
                .is_none_or(|toast| toast.message != "common.saved")
        )
    });
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
    cx.update(|cx| {
        handle
            .update(cx, |_, win, cx| {
                win.render_frame(cx);
                assert_eq!(
                    win.find("settings.timelineMergeGapLabel-1").disabled(),
                    Some(true)
                );
                assert_eq!(win.find("save").disabled(), Some(true));
            })
            .unwrap()
    });
    let mut latest = initial;
    latest.timeline_merge_gap_secs = 60;
    client.test_answer(id, Reply::Preferences(latest.clone()));
    cx.run_until_parked();
    click(cx, "settings.timelineMergeGapLabel-1");
    click(cx, "save");
    let (id, WindowRequest::SavePreferences(base, edit)) = request() else {
        panic!("expected saving against the reloaded values")
    };
    assert!(base == latest && edit.timeline_merge_gap_secs == 120);
    client.test_answer(id, Reply::Done);
    cx.run_until_parked();
    cx.update(|cx| {
        assert_eq!(
            weak.upgrade()
                .unwrap()
                .read(cx)
                .save_toast
                .as_ref()
                .unwrap()
                .message,
            "common.saved"
        )
    });
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(3));
    cx.run_until_parked();
    cx.update(|cx| assert!(weak.upgrade().unwrap().read(cx).save_toast.is_none()));
}

#[gpui_kit::test]
fn about_shows_the_actual_update_actions_on_first_frame_and_reentry(cx: &mut TestAppContext) {
    use patina_desktop_protocol::RequestError;
    use patina_updater::Phase;

    cx.update(gpui_kit::init);
    let (client, requests) = crate::client::Client::test_connection();
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
    let has = |cx: &mut TestAppContext, id: &'static str| {
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            win.try_find(id).is_some()
        })
        .unwrap()
    };
    click(cx, "about.title");
    let abandoned = about_status_request(&requests);
    assert!(has(cx, "today-ranking-panel"));
    assert!(!has(cx, "about-update-card"));
    click(cx, "dashboard.title");
    client.test_answer(abandoned, Reply::Update(Snapshot::idle("1.0.0")));
    cx.run_until_parked();
    assert!(has(cx, "today-ranking-panel"));
    click(cx, "about.title");
    let mut status = available_update();
    status.phase = Phase::Ready;
    client.test_answer(
        about_status_request(&requests),
        Reply::Update(status.clone()),
    );
    cx.run_until_parked();
    assert!(has(cx, "install-update"));
    click(cx, "dashboard.title");
    click(cx, "about.title");
    assert!(has(cx, "install-update"));
    client.test_reject(about_status_request(&requests), RequestError::Busy);
    cx.run_until_parked();
    assert!(has(cx, "install-update"));
    click(cx, "dashboard.title");
    click(cx, "about.title");
    status.phase = Phase::Downloading;
    client.test_answer(about_status_request(&requests), Reply::Update(status));
    cx.run_until_parked();
    assert!(has(cx, "update-progress"));
    click(cx, "dashboard.title");
    click(cx, "about.title");
    assert!(has(cx, "today-ranking-panel"));
    client.test_reject(about_status_request(&requests), RequestError::Disconnected);
    cx.run_until_parked();
    assert!(has(cx, "downloads"));
    assert!(!has(cx, "update-progress"));
}

#[gpui_kit::test]
fn update_progress_moves_to_the_card_after_later(cx: &mut TestAppContext) {
    use patina_updater::Request;

    cx.update(gpui_kit::init);
    let (client, requests) = crate::client::Client::test_connection();
    let (handle, _) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    let dismiss_and_check_progress = |win: &mut gpui_kit::Window, cx: &mut gpui_kit::App| {
        for in_card in [false, true] {
            if in_card {
                win.click("later-update", cx);
            }
            win.render_frame(cx);
            assert_eq!(win.find_all("update-progress").len(), 1);
            let card = win.within("about-update-card");
            assert_eq!(card.try_find("update-progress").is_some(), in_card);
        }
    };
    cx.update_window(handle, |_, win, cx| win.click("about.title", cx))
        .unwrap();
    client.test_answer(
        about_status_request(&requests),
        Reply::Update(Snapshot::idle("1.0.0")),
    );
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        win.click("check-updates", cx);
        dismiss_and_check_progress(win, cx);
    })
    .unwrap();
    cx.run_until_parked();
    let check = requests
        .try_iter()
        .find_map(|message| match message {
            FromWindow::Request(id, request)
                if matches!(*request, WindowRequest::Update(Request::Check)) =>
            {
                Some(id)
            }
            _ => None,
        })
        .expect("update check request");
    client.test_answer(check, Reply::Update(available_update()));
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.click("download-update", cx);
        win.click("download-detail", cx);
        dismiss_and_check_progress(win, cx);
    })
    .unwrap();
}

#[gpui_kit::test]
fn feedback_link_failure_shows_toast_and_allows_retry(cx: &mut TestAppContext) {
    use patina_desktop_protocol::RequestError;

    cx.update(gpui_kit::init);
    let (client, requests) = crate::client::Client::test_connection();
    let (handle, main) = cx.update(|cx| MainWindow::open(cx, client.clone()).unwrap());
    let click = |cx: &mut TestAppContext, id: &'static str| {
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            win.click(id, cx);
        })
        .unwrap();
        cx.run_until_parked();
    };
    let issues_request = || {
        requests
            .try_iter()
            .find_map(|message| match message {
                FromWindow::Request(id, request)
                    if matches!(*request, WindowRequest::OpenExternal(_)) =>
                {
                    Some(id)
                }
                _ => None,
            })
            .expect("GitHub Issues link request")
    };

    click(cx, "about.title");
    client.test_answer(
        about_status_request(&requests),
        Reply::Update(Snapshot::idle("1.0.0")),
    );
    cx.run_until_parked();
    click(cx, "feedback");
    click(cx, "external");
    let first = issues_request();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        let link = win.find("external");
        assert_eq!(link.label(), Some("GitHub Issues"));
        assert_eq!(link.disabled(), Some(true));
    })
    .unwrap();
    client.test_reject(first, RequestError::Rejected("no URL handler".into()));
    cx.run_until_parked();
    cx.update(|cx| assert!(main.upgrade().unwrap().read(cx).save_toast.is_some()));
    click(cx, "external");
    client.test_answer(issues_request(), Reply::Done);
    cx.run_until_parked();
    cx.update_window(handle, |_, win, cx| {
        win.render_frame(cx);
        assert!(win.try_find("close-about").is_none());
    })
    .unwrap();
}

#[gpui_kit::test]
fn repeated_save_feedback_restarts_expiry(cx: &mut TestAppContext) {
    use std::time::Duration;
    cx.update(gpui_kit::init);
    let (client, _requests) = crate::client::Client::test_connection();
    let (_, weak) = cx.update(|cx| MainWindow::open(cx, client).unwrap());
    let show = |cx: &mut TestAppContext| {
        cx.update(|cx| {
            weak.update(cx, |main, cx| main.show_save_toast(cx))
                .unwrap()
        });
        cx.run_until_parked();
    };
    show(cx);
    cx.executor().advance_clock(Duration::from_secs(2));
    show(cx);
    cx.executor().advance_clock(Duration::from_secs(2));
    cx.run_until_parked();
    cx.update(|cx| assert!(weak.upgrade().unwrap().read(cx).save_toast.is_some()));
    cx.executor().advance_clock(Duration::from_secs(1));
    cx.run_until_parked();
    cx.update(|cx| assert!(weak.upgrade().unwrap().read(cx).save_toast.is_none()));
}

#[gpui_kit::test]
fn transient_feedback_restores_the_unsaved_reminder(cx: &mut TestAppContext) {
    cx.update(gpui_kit::init);
    let (client, _requests) = crate::client::Client::test_connection();
    let (_, weak) = cx.update(|cx| MainWindow::open(cx, client).unwrap());
    cx.update(|cx| {
        weak.update(cx, |main, cx| {
            main.update_edit_toast(true, cx);
            main.show_feedback("settings.storage.storageSnapshotRefreshed", cx);
        })
        .unwrap()
    });
    cx.run_until_parked();
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(3));
    cx.run_until_parked();
    cx.update(|cx| {
        assert_eq!(
            weak.upgrade()
                .unwrap()
                .read(cx)
                .save_toast
                .as_ref()
                .unwrap()
                .message,
            "settings.unsaved"
        )
    });
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(30));
    cx.run_until_parked();
    cx.update(|cx| {
        assert_eq!(
            weak.upgrade()
                .unwrap()
                .read(cx)
                .save_toast
                .as_ref()
                .unwrap()
                .message,
            "settings.unsaved"
        )
    });
}
