use super::Tools;
use gpui_kit::{prelude::*, *};
use patina_activity_model::{
    NoticeDelivery, NoticePreferences, NoticePreferencesPatch, NoticeSound,
};
use patina_desktop_protocol::tools::{ToolCall, call};
use patina_i18n::text;
use quietpro::{ControlSize, Icon, IconControl};

pub(super) struct SettingsDialog {
    preferences: Option<NoticePreferences>,
    focus: FocusHandle,
    title_focus: FocusHandle,
    delivery_focus: [FocusHandle; 2],
}

impl Tools {
    pub(super) fn open_settings(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        let title_focus = cx.focus_handle();
        win.focus(&title_focus, cx);
        self.settings = Some(SettingsDialog {
            preferences: None,
            focus: cx.focus_handle(),
            title_focus,
            delivery_focus: std::array::from_fn(|_| cx.focus_handle()),
        });
        self.request_preferences(call::preferences(), cx);
    }

    fn request_preferences(
        &mut self,
        request: ToolCall<NoticePreferences>,
        cx: &mut Context<Self>,
    ) {
        self.run(
            request,
            |this, value, _| {
                if let Some(settings) = &mut this.settings {
                    settings.preferences = Some(value);
                }
            },
            cx,
        );
    }

    fn close_settings(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.settings = None;
        self.error = None;
        win.focus(&self.settings_focus, cx);
        if std::mem::take(&mut self.refresh_pending) {
            self.background_refresh(cx);
        }
        cx.notify();
    }

    pub(super) fn settings_dialog(
        &self,
        dialog: &SettingsDialog,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> quietpro::ModalDialog {
        let colors = self.client.palette(win);
        let tr = |key| text(self.client.locale.get(), key);
        let title = tr("tools.settingsTitle");
        let header = quietpro::settings_title(colors, Icon::Settings, title.clone())
            .flex_none()
            .track_focus(&dialog.title_focus)
            .child(
                IconControl::new("close-tool-settings", tr("common.close"), Icon::X)
                    .disabled(self.busy)
                    .action(
                        colors,
                        cx.listener(|t, _, win, cx| t.close_settings(win, cx)),
                    ),
            );
        let mut body = div()
            .id("tool-settings-body")
            .flex()
            .flex_col()
            .min_h_0()
            .overflow_y_scroll()
            .gap(px(quietpro::SUBHEADING_GAP))
            .child(
                quietpro::group_heading(tr("tools.notificationGroup")).text_color(colors.secondary),
            );
        if let Some(p) = &dialog.preferences {
            let options = [
                (NoticeDelivery::Notification, "tools.notificationSoftware"),
                (NoticeDelivery::Dialog, "tools.notificationDialog"),
            ];
            if !self.busy && dialog.title_focus.is_focused(win) {
                let selected = usize::from(p.delivery == NoticeDelivery::Dialog);
                win.focus(&dialog.delivery_focus[selected], cx);
            }
            let row = |name: String| {
                quietpro::settings_row()
                    .gap(px(quietpro::SUBHEADING_GAP))
                    .child(
                        quietpro::settings_row_label(name)
                            .font_weight(FontWeight::BOLD)
                            .min_w_0()
                            .flex_1(),
                    )
            };
            let delivery_label = tr("tools.notificationDelivery");
            let view = cx.weak_entity();
            let delivery =
                row(delivery_label.clone()).child(quietpro::segmented_with_medium_labels(
                    ("notification-delivery", delivery_label),
                    options
                        .into_iter()
                        .zip(&dialog.delivery_focus)
                        .map(|((value, key), focus)| (value, tr(key), None, focus.clone())),
                    p.delivery,
                    !self.busy,
                    colors,
                    ControlSize::Medium,
                    move |value, _, cx| {
                        let _ = view.update(cx, |t, cx| {
                            t.request_preferences(
                                call::save_preferences(NoticePreferencesPatch {
                                    delivery: Some(value),
                                    sound: None,
                                }),
                                cx,
                            )
                        });
                    },
                ));
            let sound_label = tr("tools.notificationSound");
            let view = cx.weak_entity();
            let sound = row(sound_label.clone()).child(
                quietpro::Dropdown::new(
                    "notification-sound",
                    sound_label,
                    [
                        (NoticeSound::Default, tr("tools.notificationSoundDefault")),
                        (NoticeSound::Bell, tr("tools.notificationSoundBell")),
                        (NoticeSound::Clear, tr("tools.notificationSoundClear")),
                        (NoticeSound::None, tr("tools.notificationSoundNone")),
                    ],
                    p.sound,
                    colors,
                    move |value, _, cx| {
                        let _ = view.update(cx, |t, cx| {
                            t.request_preferences(
                                call::save_preferences(NoticePreferencesPatch {
                                    delivery: None,
                                    sound: Some(value),
                                }),
                                cx,
                            )
                        });
                    },
                )
                .trigger_size(ControlSize::Medium)
                .value_typography(px(12.), FontWeight::MEDIUM)
                .selected_option_color(colors.text)
                .disabled(self.busy),
            );
            body = body.child(
                quietpro::settings_rows_card(colors)
                    .child(delivery)
                    .child(quietpro::line_above(sound, colors, 0.)),
            );
        } else if self.busy {
            body = body.child(super::label(tr("common.loading")));
        }
        if let Some(error) = &self.error {
            body = body.child(super::label(error.clone()).role(Role::Alert));
            if dialog.preferences.is_none() {
                let title_focus = dialog.title_focus.clone();
                body = body.child(
                    quietpro::text_button("retry-tool-settings", tr("common.retry"), colors, true)
                        .on_click(cx.listener(move |t, _, win, cx| {
                            win.focus(&title_focus, cx);
                            t.request_preferences(call::preferences(), cx)
                        })),
                );
            }
        }
        let surface = quietpro::dialog_surface(colors, win.viewport_size())
            .w(px(600.))
            .child(header)
            .child(body)
            .on_key_down(cx.listener(|t, e: &KeyDownEvent, win, cx| {
                if e.keystroke.key == "escape" {
                    t.close_settings(win, cx);
                    cx.stop_propagation();
                }
            }));
        let view = cx.weak_entity();
        quietpro::modal_dialog(
            title,
            dialog.focus.clone(),
            surface,
            move |win, cx| {
                let _ = view.update(cx, |t, cx| t.close_settings(win, cx));
            },
            cx,
        )
        .close_on_escape(false)
        .close_on_backdrop_press(!self.busy)
    }
}

#[cfg(all(test, feature = "test-support"))]
mod tests {
    use super::Tools;
    use crate::client::Client;
    use crate::features::tools::tests::next_tool_request;
    use gpui_kit::{AppContext, TestAppContext, WindowOptions, test::TestWindowExt};
    use patina_desktop_protocol::{Reply, RequestError, tools::ToolRequest};

    #[gpui_kit::test]
    fn settings_read_failure_can_be_retried_and_dismissed(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        let (client, requests) = Client::test_connection();
        let (handle, page) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
                cx.new(|cx| Tools::new(client.clone(), None, cx))
            })
            .unwrap()
        });
        let (list, ToolRequest::List) = next_tool_request(&requests) else {
            panic!("expected tool list")
        };
        client.test_answer(list, Reply::Tools((vec![], false, None)));
        cx.run_until_parked();
        for trigger in ["tool-settings", "retry-tool-settings"] {
            cx.update_window(handle, |_, win, cx| {
                win.render_frame(cx);
                win.click(trigger, cx);
            })
            .unwrap();
            let (id, ToolRequest::Preferences) = next_tool_request(&requests) else {
                panic!("expected preferences read")
            };
            client.test_reject(id, RequestError::Disconnected);
            cx.run_until_parked();
        }
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            assert!(win.try_find("retry-tool-settings").is_some());
            win.press("escape", cx);
            win.render_frame(cx);
            assert!(page.read(cx).settings.is_none());
            assert!(page.read(cx).settings_focus.is_focused(win));
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn choosing_default_again_requests_another_sound_preview(cx: &mut TestAppContext) {
        use patina_activity_model::{NoticePreferences, NoticeSound};
        cx.update(gpui_kit::init);
        let (client, requests) = Client::test_connection();
        let (handle, _) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
                cx.new(|cx| Tools::new(client.clone(), None, cx))
            })
            .unwrap()
        });
        let (list, _) = next_tool_request(&requests);
        client.test_answer(list, Reply::Tools((vec![], false, None)));
        cx.run_until_parked();
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            win.click("tool-settings", cx);
        })
        .unwrap();
        let (read, ToolRequest::Preferences) = next_tool_request(&requests) else {
            panic!("expected preferences read")
        };
        let mut saved = NoticePreferences {
            sound: NoticeSound::Bell,
            ..Default::default()
        };
        client.test_answer(read, Reply::NoticePreferences(saved.clone()));
        cx.run_until_parked();
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            win.press("tab", cx);
        })
        .unwrap();
        for _ in 0..2 {
            cx.update_window(handle, |_, win, cx| {
                win.press("enter", cx);
                win.press("home", cx);
                win.press("enter", cx);
            })
            .unwrap();
            let (id, ToolRequest::SavePreferences(patch)) = next_tool_request(&requests) else {
                panic!("expected sound selection")
            };
            assert_eq!(patch.sound, Some(NoticeSound::Default));
            assert_eq!(patch.delivery, None);
            saved.apply(patch);
            client.test_answer(id, Reply::NoticePreferences(saved.clone()));
            cx.run_until_parked();
        }
    }
}
