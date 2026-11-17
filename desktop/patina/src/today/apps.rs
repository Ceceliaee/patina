use super::*;
use gpui_kit::base::{
    Dialog,
    input::{InputAccessibility, InputEvent, InputState},
};
use patina_recorder::AppEdit;
mod menu;

pub(super) struct Popup {
    pub(super) key: String,
    menu: Option<menu::Menu>,
    detail: Option<Entity<crate::history::History>>,
    name: Option<Entity<InputState>>,
    rename_error: bool,
    trigger: Option<FocusHandle>,
    focus: FocusHandle,
}

impl Today {
    fn show(&mut self, key: &str, classify: bool, window: &mut Window, cx: &mut Context<Self>) {
        let trigger = window.focused(cx);
        let focus = cx.focus_handle();
        window.focus(&focus, cx);
        self.popup = Some(Popup {
            key: key.into(),
            menu: None,
            detail: (!classify).then(|| {
                cx.new(|cx| {
                    crate::history::History::new(
                        self.client.clone(),
                        chrono::Local::now().timestamp_millis(),
                        Some((
                            key.to_owned(),
                            self.data
                                .as_ref()
                                .and_then(|d| d.apps.iter().find(|a| a.key == key))
                                .map_or_else(|| key.to_owned(), |a| a.name.clone()),
                        )),
                        window,
                        cx,
                    )
                })
            }),
            name: None,
            rename_error: false,
            trigger,
            focus,
        });
        cx.notify();
    }

    fn dismiss(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.writing && self.popup.as_ref().is_some_and(|p| p.name.is_some()) {
            return;
        }
        if let Some(trigger) = self.popup.take().and_then(|p| p.trigger) {
            window.focus(&trigger, cx);
        }
        cx.notify();
    }

    fn save_name(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        let Some(popup) = self.popup.as_ref() else {
            return;
        };
        let Some(input) = &popup.name else {
            return;
        };
        if self.writing {
            return;
        }
        let name = input.read(cx).value().trim().to_owned();
        if name.encode_utf16().count() > 80
            || self.data.as_ref().is_some_and(|data| {
                data.apps
                    .iter()
                    .any(|app| app.key == popup.key && app.name == name)
            })
        {
            return;
        }
        let write = self.client.edit_app(popup.key.clone(), AppEdit::Name(name));
        self.popup.as_mut().unwrap().rename_error = false;
        self.writing = true;
        self.read = None;
        cx.notify();
        cx.spawn_in(win, async move |view, cx| {
            let result = write.await;
            let _ = view.update_in(cx, |this, win, cx| {
                this.writing = false;
                match result {
                    Ok(()) => {
                        this.dismiss(win, cx);
                        this.refresh(win.is_window_active(), cx);
                    }
                    Err(error) => {
                        eprintln!("rename Today app: {error}");
                        if let Some(popup) = &mut this.popup {
                            popup.rename_error = true;
                            if let Some(input) = &popup.name {
                                input.update(cx, |input, cx| input.focus(win, cx));
                            }
                        }
                        this.refresh(win.is_window_active(), cx);
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    pub(super) fn row(
        &self,
        app: &AppUsage,
        total: i64,
        colors: Palette,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let key = app.key.clone();
        let source_color = app.source_color(self.icons.get(&key).and_then(|icon| icon.color));
        let bar_color =
            quietpro::activity_display_color(source_color, colors.track, self.client.dark(window));
        let pointer = key.clone();
        let keyboard = key.clone();
        let accessible_key = key.clone();
        let view = cx.weak_entity();
        let anchor = window.use_keyed_state(
            SharedString::from(format!("menu-anchor-{key}")),
            cx,
            |_, cx| {
                (
                    cx.focus_handle().tab_stop(true),
                    Rc::new(std::cell::Cell::new(Bounds::<Pixels>::default())),
                )
            },
        );
        let (trigger, bounds) = anchor.read(cx).clone();
        let pointer_focus = trigger.clone();
        let keyboard_focus = trigger.clone();
        let keyboard_bounds = bounds.clone();
        let share = (100. * app.duration as f64 / total as f64).round();
        let face = quietpro::app_icon_frame(rgb(source_color), colors).child(if app.anonymous {
            super::anonymous::icon(rgb(source_color), app.name.clone(), 24.).into_any_element()
        } else {
            match self.icons.get(&key) {
                Some(icon) => img(icon.image.clone()).size(px(24.)).into_any_element(),
                None => glyph(Icon::AppWindow, rgb(source_color))
                    .size(px(24.))
                    .into_any_element(),
            }
        });
        let icon = if app.anonymous {
            face.into_any_element()
        } else {
            Button::new(SharedString::from(format!("app-{key}")))
                .track_focus(&trigger)
                .relative()
                .accessibility_label(format_text(
                    self.client.locale.get(),
                    "destinationDetail.open",
                    &[("name", app.name.clone())],
                ))
                .focus_visible(move |s| s.border_1().border_color(colors.secondary))
                .child(face)
                .child(
                    canvas(move |rect, _, _| bounds.set(rect), |_, _, _, _| {})
                        .absolute()
                        .inset_0(),
                )
                .on_a11y_action(AccessibleAction::Click, move |_, win, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.show(&accessible_key, false, win, cx);
                    });
                })
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(move |this, e: &MouseDownEvent, win, cx| {
                        win.focus(&pointer_focus, cx);
                        this.show_menu(&pointer, e.position, win, cx);
                        cx.stop_propagation();
                    }),
                )
                .on_key_down(cx.listener(move |this, e: &KeyDownEvent, win, cx| {
                    if matches!(e.keystroke.key.as_str(), "menu" | "contextmenu")
                        || (e.keystroke.key == "f10" && e.keystroke.modifiers.shift)
                    {
                        win.focus(&keyboard_focus, cx);
                        this.show_menu(&keyboard, keyboard_bounds.get().bottom_left(), win, cx);
                        cx.stop_propagation();
                    }
                }))
                .on_click(cx.listener(move |this, e: &ClickEvent, win, cx| {
                    if e.is_keyboard() || e.click_count() == 2 {
                        this.show(&key, false, win, cx);
                    }
                }))
                .into_any_element()
        };
        content_card(colors.border, colors.canvas)
            .id(SharedString::from(format!("row-{}", app.key)))
            .flex_row()
            .flex_none()
            .items_center()
            .gap(px(16.))
            .h(px(64.))
            .py(px(8.))
            .child(icon)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .when_else(
                        app.anonymous,
                        |s| s.child(super::anonymous::name(colors.text)),
                        |s| s.child(value(app.name.clone()).truncate()),
                    )
                    .when(!app.anonymous && app.category == "other", |s| {
                        s.child(caption(self.label("mapping.quickUnclassified"), colors))
                    }),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .items_end()
                    .gap(px(8.))
                    .child(value(format!("{} · {share}%", duration(app.duration))))
                    .child(
                        div()
                            .w(px(100.))
                            .h(px(4.))
                            .bg(colors.track)
                            .rounded_full()
                            .child(
                                div()
                                    .relative()
                                    .overflow_hidden()
                                    .h_full()
                                    .w(relative(share as f32 / 100.))
                                    .rounded_full()
                                    .bg(bar_color)
                                    .when(app.anonymous, |s| {
                                        s.child(quietpro::dot_pattern(colors.secondary))
                                    }),
                            ),
                    ),
            )
    }

    pub(super) fn dialog(
        &self,
        popup: &Popup,
        app: &AppUsage,
        data: &DaySummary,
        colors: Palette,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        if let Some(detail) = &popup.detail {
            let view = cx.weak_entity();
            return crate::page_controls::detail_dialog(
                detail.clone(),
                &popup.focus,
                self.label("common.close"),
                colors,
                move |win, cx| {
                    let _ = view.update(cx, |t, cx| t.dismiss(win, cx));
                },
                window,
                cx,
            )
            .into_any_element();
        }
        if let Some(menu) = self.context_menu(popup, app, data, colors, window, cx) {
            return menu.into_any_element();
        }
        let measure = |label: &str, size: f32, weight| {
            let mut run = window.text_style().to_run(label.len());
            run.font.weight = weight;
            f32::from(
                window
                    .text_system()
                    .shape_line(label.to_owned().into(), px(size), &[run], None)
                    .width,
            )
        };
        let heading = self.label("mapping.quickRenameTitle");
        let action_width =
            measure(&self.label("common.cancel"), 14., FontWeight::SEMIBOLD)
                + measure(&self.label("mapping.quickSave"), 14., FontWeight::SEMIBOLD).max(
                    measure(&self.label("common.saving"), 14., FontWeight::SEMIBOLD),
                )
                + 2. * (24. + 2.)
                + 8.;
        // Size from the original value, not the live draft, so typing cannot resize the dialog.
        let width = measure(&app.name, 14., FontWeight::NORMAL).ceil() + 24. + 2.;
        let width = width
            .max(measure(&heading, 16., FontWeight::SEMIBOLD))
            .max(action_width)
            + 2. * (CONTENT_INSET + 1.);
        let mut content = quietpro::dialog_surface(colors, window.viewport_size())
            .gap_0()
            .id("quick-rename-dialog")
            .role(Role::Group)
            .accessibility_id("quick-rename-dialog")
            .on_any_mouse_down(|_, _, cx| cx.stop_propagation())
            .w(px((width / 4.).ceil() * 4.))
            .max_w((window.viewport_size().width - px(48.)).max(px(0.)))
            .max_h((window.viewport_size().height - px(48.)).max(px(0.)))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .justify_between()
                    .mb(px(CARD_TITLE_GAP))
                    .child(title(heading).line_height(px(24.)))
                    .when(popup.name.is_none(), |header| {
                        header.child(
                            IconControl::new("dismiss", self.label("common.close"), Icon::X)
                                .disabled(self.writing)
                                .action(
                                    colors,
                                    cx.listener(|this, _, win, cx| this.dismiss(win, cx)),
                                ),
                        )
                    }),
            );
        if let Some(input) = &popup.name {
            let body = div()
                .id("quick-rename-body")
                .flex()
                .flex_col()
                .min_h_0()
                .gap(px(8.))
                .overflow_y_scroll()
                .child(
                    div().flex().flex_none().h(px(32.)).child(
                        quietpro::TextInput::new("quick-rename-input", input, colors)
                            .disabled(self.writing),
                    ),
                )
                .when(popup.rename_error, |content| {
                    content.child(
                        div()
                            .id("rename-error")
                            .role(Role::Alert)
                            .aria_label(self.label("mapping.quickSaveFailed"))
                            .text_size(px(12.))
                            .text_color(colors.danger)
                            .child(self.label("mapping.quickSaveFailed")),
                    )
                });
            content = content.child(body).child(
                div()
                    .flex()
                    .flex_none()
                    .mt(px(16.))
                    .justify_end()
                    .gap(px(8.))
                    .child(
                        quietpro::text_button(
                            "cancel-name",
                            self.label("common.cancel"),
                            colors,
                            !self.writing,
                        )
                        .on_click(cx.listener(|this, _, win, cx| this.dismiss(win, cx))),
                    )
                    .child(
                        quietpro::text_button(
                            "save-name",
                            self.label(if self.writing {
                                "common.saving"
                            } else {
                                "mapping.quickSave"
                            }),
                            colors,
                            !self.writing && input.read(cx).value().trim() != app.name,
                        )
                        .on_click(cx.listener(|this, _, win, cx| this.save_name(win, cx))),
                    ),
            );
        }
        let view = cx.weak_entity();
        Dialog::new(cx)
            .accessibility_label(if popup.name.is_some() {
                self.label("mapping.quickRenameTitle")
            } else {
                app.name.clone()
            })
            .close_on_backdrop_press(!self.writing)
            .close_on_escape(!self.writing)
            .on_ok(|_, _, _| false)
            .focus_handle(popup.focus.clone())
            .backdrop(quietpro::dialog_backdrop())
            .popup(gpui_kit::base::DialogPopup::new().child(content))
            .on_open_change(move |open, _, win, cx| {
                if !open {
                    let _ = view.update(cx, |this, cx| this.dismiss(win, cx));
                }
            })
            .into_any_element()
    }
}
