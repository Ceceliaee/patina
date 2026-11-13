use super::*;
use gpui_kit::base::{
    Dialog, Input,
    input::{InputAccessibility, InputEvent, InputState},
};
use patina_recorder::AppEdit;

pub(super) struct Popup {
    pub(super) key: String,
    classify: bool,
    detail: Option<Entity<crate::history::History>>,
    name: Option<Entity<InputState>>,
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
            classify,
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
            trigger,
            focus,
        });
        cx.notify();
    }

    fn dismiss(&mut self, window: &mut Window, cx: &mut Context<Self>) {
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
        let write = self.client.edit_app(popup.key.clone(), AppEdit::Name(name));
        self.dismiss(win, cx);
        self.save(write, win, cx);
    }

    pub(super) fn row(
        &self,
        app: &AppUsage,
        total: i64,
        colors: Palette,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let key = app.key.clone();
        let pointer = key.clone();
        let keyboard = key.clone();
        let accessible_key = key.clone();
        let view = cx.weak_entity();
        let share = (100. * app.duration as f64 / total as f64).round();
        let face = div()
            .flex()
            .items_center()
            .justify_center()
            .size(px(40.))
            .rounded(px(8.))
            .border_1()
            .border_color(colors.border)
            .bg(colors.panel)
            .child(match self.icons.get(&key) {
                Some(image) => img(image.clone()).size(px(24.)).into_any_element(),
                None => glyph(Icon::AppWindow, rgb(app.color)).into_any_element(),
            });
        let icon = if app.anonymous {
            face.into_any_element()
        } else {
            Button::new(SharedString::from(format!("app-{key}")))
                .accessibility_label(format_text(
                    self.client.locale.get(),
                    "destinationDetail.open",
                    &[("name", app.name.clone())],
                ))
                .focus_visible(move |s| s.border_1().border_color(colors.accent))
                .child(face)
                .on_a11y_action(AccessibleAction::Click, move |_, win, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.show(&accessible_key, false, win, cx);
                    });
                })
                .on_mouse_down(
                    MouseButton::Right,
                    cx.listener(move |this, _, win, cx| this.show(&pointer, true, win, cx)),
                )
                .on_key_down(cx.listener(move |this, e: &KeyDownEvent, win, cx| {
                    if e.keystroke.key == "contextmenu"
                        || (e.keystroke.key == "f10" && e.keystroke.modifiers.shift)
                    {
                        this.show(&keyboard, true, win, cx);
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
            .py(px(12.) + px(1.))
            .child(icon)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .child(value(app.name.clone()).truncate())
                    .when(app.category == "other", |s| {
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
                            .h(px(6.))
                            .bg(colors.track)
                            .rounded_full()
                            .child(
                                div()
                                    .h_full()
                                    .w(relative(share as f32 / 100.))
                                    .rounded_full()
                                    .bg(rgb(app.color)),
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
                cx,
            )
            .into_any_element();
        }
        let mut content = panel(colors)
            .on_any_mouse_down(|_, _, cx| cx.stop_propagation())
            .w(px(420.))
            .max_h(px(480.))
            .gap(px(12.))
            .child(
                div()
                    .flex()
                    .justify_between()
                    .child(title(app.name.clone()))
                    .child(
                        IconControl::new("dismiss", self.label("common.close"), Icon::X).action(
                            colors,
                            cx.listener(|this, _, win, cx| this.dismiss(win, cx)),
                        ),
                    ),
            );
        if let Some(input) = &popup.name {
            content = content.child(Input::new(input)).child(
                Button::new("save-name")
                    .disabled(self.writing || input.read(cx).value().trim() == app.name)
                    .accessibility_label(self.label("mapping.quickSave"))
                    .child(self.label("mapping.quickSave"))
                    .on_click(cx.listener(|this, _, win, cx| this.save_name(win, cx))),
            );
        } else if popup.classify {
            let name = app.name.clone();
            let placeholder = self.label("mapping.quickRenamePlaceholder");
            content = content
                .child(
                    Button::new("rename")
                        .accessibility_label(self.label("mapping.quickRename"))
                        .child(self.label("mapping.quickRename"))
                        .on_click(cx.listener(move |this, _, win, cx| {
                            cx.stop_propagation();

                            let input = cx.new(|cx| {
                                InputState::new(win, cx)
                                    .default_value(name.clone())
                                    .placeholder(placeholder.clone())
                                    .validate(|s, _| s.encode_utf16().count() <= 80)
                            });
                            input.update(cx, |v, cx| {
                                v.set_accessibility(
                                    InputAccessibility::new(Some(Role::TextInput))
                                        .with_label(Some(placeholder.clone().into())),
                                );
                                v.focus(win, cx);
                                v.select_all(win, cx);
                            });
                            cx.subscribe_in(&input, win, |this, _, event: &InputEvent, win, cx| {
                                match event {
                                    InputEvent::PressEnter { .. } => this.save_name(win, cx),
                                    InputEvent::Change => cx.notify(),
                                    _ => (),
                                }
                            })
                            .detach();
                            if let Some(p) = &mut this.popup {
                                p.name = Some(input);
                            }
                            cx.notify();
                        })),
                )
                .child(caption(
                    self.label("mapping.quickCategoryMenuLabel"),
                    colors,
                ));
            let choices = data.choices.iter().map(|(id, label)| {
                let exe = app.key.clone();
                let category = id.clone();
                Button::new(SharedString::from(format!("category-{id}")))
                    .accessibility_label(label.clone())
                    .px(px(8.))
                    .py(px(4.))
                    .when(app.category == *id, |s| s.bg(colors.hover))
                    .focus_visible(move |s| s.border_1().border_color(colors.accent))
                    .child(label.clone())
                    .on_click(cx.listener(move |this, _, win, cx| {
                        if this.writing {
                            return;
                        }
                        let write = this
                            .client
                            .edit_app(exe.clone(), AppEdit::Category(category.clone()));
                        this.dismiss(win, cx);
                        this.save(write, win, cx);
                    }))
            });
            content = content.child(
                div()
                    .id("categories")
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .children(choices),
            );
        }
        let view = cx.weak_entity();
        Dialog::new(cx)
            .accessibility_label(if popup.name.is_some() {
                self.label("mapping.quickRenameTitle")
            } else if popup.classify {
                format_text(
                    self.client.locale.get(),
                    "mapping.quickMenuLabel",
                    &[("label", app.name.clone())],
                )
            } else {
                app.name.clone()
            })
            .close_on_backdrop_press(popup.name.is_none())
            .on_ok(|_, _, _| false)
            .focus_handle(popup.focus.clone())
            .backdrop(div().size_full().bg(rgba(0x00000055)))
            .popup(gpui_kit::base::DialogPopup::new().child(content))
            .on_open_change(move |open, _, win, cx| {
                if !open {
                    let _ = view.update(cx, |this, cx| this.dismiss(win, cx));
                }
            })
            .into_any_element()
    }
}
