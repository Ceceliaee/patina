use crate::client::Client;
use gpui_kit::{base::input::InputState, prelude::*, *};
use patina_activity_model::{Rules, text};
use std::rc::Rc;

pub(crate) struct Closed(pub bool);
pub(crate) struct QuickEdit {
    client: Rc<Client>,
    key: String,
    web: bool,
    position: Point<Pixels>,
    focus: FocusHandle,
    rules: Option<Rules>,
    input: Entity<InputState>,
    rename: bool,
    categories: bool,
    busy: bool,
    error: bool,
}
impl EventEmitter<Closed> for QuickEdit {}
impl QuickEdit {
    pub(crate) fn new(
        client: Rc<Client>,
        key: String,
        name: String,
        web: bool,
        position: Point<Pixels>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let focus = cx.focus_handle().tab_stop(true);
        win.focus(&focus, cx);
        let input = cx.new(|cx| {
            InputState::new(win, cx)
                .default_value(name)
                .validate(|s, _| s.encode_utf16().count() <= 80)
        });
        let read = client.rules();
        cx.spawn(async move |view, cx| {
            let result = read.await;
            let _ = view.update(cx, |this, cx| {
                match result {
                    Ok(rules) => this.rules = Some(rules),
                    Err(_) => this.error = true,
                }
                cx.notify();
            });
        })
        .detach();
        Self {
            client,
            key,
            web,
            position,
            focus,
            rules: None,
            input,
            rename: false,
            categories: false,
            busy: false,
            error: false,
        }
    }
    fn save(&mut self, category: Option<String>, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let Some(rules) = &self.rules else {
            return;
        };
        let name = self.input.read(cx).value().trim().to_owned();
        if category.is_none() && name.encode_utf16().count() > 80 {
            return;
        }
        let mut apps = Vec::new();
        let web = if self.web {
            let mut draft = rules.websites.clone();
            let Some(mut rule) = draft.cards().into_iter().find(|r| r.identity == self.key) else {
                return;
            };
            if let Some(category) = category {
                rule.category = category;
            } else {
                rule.name = name;
            }
            draft.assign(&rule);
            Some(draft)
        } else {
            let Some(mut rule) = rules.apps.iter().find(|r| r.exe == self.key).cloned() else {
                return;
            };
            if let Some(category) = category {
                rule.category = category;
            } else {
                rule.name = name;
            }
            apps.push(rule);
            None
        };
        self.busy = true;
        self.error = false;
        let write = self.client.save_rules(apps, web, Vec::new(), Vec::new());
        cx.spawn(async move |view, cx| {
            let result = write.await;
            let _ = view.update(cx, |this, cx| {
                this.busy = false;
                this.error = result.is_err();
                if result.is_ok() {
                    cx.emit(Closed(true));
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}
impl Render for QuickEdit {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let c = self.client.palette(win);
        let locale = self.client.locale.get();
        let tr = |k| text(locale, k);
        let mut panel = quietpro::content_card(c.border, c.panel)
            .id("quick-edit")
            .track_focus(&self.focus)
            .on_mouse_down_out(cx.listener(|this, _, _, cx| {
                if !this.busy {
                    cx.emit(Closed(false));
                }
            }))
            .max_h(px((f32::from(win.viewport_size().height) - 32.).max(100.)))
            .overflow_y_scroll()
            .p(px(12.))
            .w(px(if self.rename { 320. } else { 200. }))
            .flex()
            .flex_col()
            .gap(px(8.))
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, win, cx| {
                if !this.rename {
                    match e.keystroke.key.as_str() {
                        "down" => {
                            win.focus_next(cx);
                            cx.stop_propagation();
                        }
                        "up" => {
                            win.focus_prev(cx);
                            cx.stop_propagation();
                        }
                        _ => {}
                    }
                }
                if e.keystroke.key == "escape" && !this.busy {
                    cx.emit(Closed(false));
                    cx.stop_propagation();
                }
                if e.keystroke.key == "enter" && this.rename {
                    this.save(None, cx);
                    cx.stop_propagation();
                }
            }));
        if self.rename {
            panel = panel
                .child(quietpro::heading(tr("mapping.quickRenameTitle")))
                .child(quietpro::TextInput::new("quick-name", &self.input, c))
                .child(
                    quietpro::text_button(
                        "save-quick-name",
                        tr("common.save"),
                        c,
                        !self.busy && self.rules.is_some(),
                    )
                    .on_click(cx.listener(|this, _, _, cx| this.save(None, cx))),
                );
        } else if self.categories {
            if let Some(rules) = &self.rules {
                for (id, name) in &rules.categories {
                    let id = id.clone();
                    panel = panel.child(
                        quietpro::text_button(
                            SharedString::from(format!("quick-category-{id}")),
                            name.clone(),
                            c,
                            !self.busy,
                        )
                        .on_click(
                            cx.listener(move |this, _, _, cx| this.save(Some(id.clone()), cx)),
                        ),
                    );
                }
            }
        } else {
            panel = panel
                .child(
                    quietpro::text_button(
                        "quick-rename",
                        tr("mapping.quickRenameTitle"),
                        c,
                        self.rules.is_some(),
                    )
                    .on_click(cx.listener(|this, _, win, cx| {
                        this.rename = true;
                        this.input.update(cx, |input, cx| {
                            input.focus(win, cx);
                            input.select_all(win, cx);
                        });
                        cx.notify();
                    })),
                )
                .child(
                    quietpro::text_button(
                        "quick-category",
                        tr("mapping.quickSetCategory"),
                        c,
                        self.rules.is_some(),
                    )
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.categories = true;
                        cx.notify();
                    })),
                );
        }
        if self.error {
            panel = panel.child(super::label(tr("mapping.saveFailed")));
        }
        panel = panel.child(
            quietpro::text_button("close-quick-edit", tr("common.cancel"), c, !self.busy)
                .on_click(cx.listener(|_, _, _, cx| cx.emit(Closed(false)))),
        );
        deferred(
            div().absolute().inset_0().child(
                gpui_kit::base::Positioner::side(Bounds::new(self.position, size(px(1.), px(1.))))
                    .placement(gpui_kit::base::Placement::Bottom)
                    .margin(px(8.))
                    .occlude()
                    .child(panel),
            ),
        )
        .with_priority(gpui_kit::base::POPUP_PRIORITY)
    }
}
