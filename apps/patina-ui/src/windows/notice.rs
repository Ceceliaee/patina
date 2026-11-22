use crate::{client::Client, features::page_controls::label};
use gpui_kit::base::{ElementExt, Radio, RadioGroup};
use gpui_kit::{prelude::*, *};
use patina_desktop_protocol::tools::Notice;
use quietpro::content_card as panel;
use std::rc::Rc;

const NOTICE_WIDTH: f32 = 420.;

pub(crate) struct ToolNotice {
    client: Rc<Client>,
    item: Option<Notice>,
    error: Option<String>,
    window: AnyWindowHandle,
    dialog: bool,
    selected: Option<usize>,
    busy: bool,
    refresh_id: u64,
    measured_height: Option<i32>,
    presented: Option<(String, Option<i64>, bool, i64)>,
}

impl ToolNotice {
    pub fn open(client: Rc<Client>, cx: &mut App) -> Result<(AnyWindowHandle, WeakEntity<Self>)> {
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(NOTICE_WIDTH), px(128.)),
                cx,
            ))),
            kind: WindowKind::PopUp,
            focus: false,
            titlebar: None,
            app_id: Some(crate::APP_ID.into()),
            ..Default::default()
        };
        let (handle, entity) = gpui_kit::open_window(options, cx, |win, cx| {
            win.set_window_title("Patina ･ Tools");
            crate::windows::handle_close(win, cx);
            cx.new(|cx| {
                let mut notice = Self {
                    client,
                    item: None,
                    error: None,
                    window: win.window_handle(),
                    dialog: false,
                    selected: None,
                    busy: false,
                    refresh_id: 0,
                    measured_height: None,
                    presented: None,
                };
                notice.refresh(cx);
                notice
            })
        })?;
        let result = handle.update(cx, |_, win, _| {
            crate::windows::placement::place_notification(win, None)
        })?;
        if let Err(error) = result {
            let _ = handle.update(cx, |_, win, _| win.remove_window());
            return Err(std::io::Error::other(error).into());
        }
        Ok((handle, entity.downgrade()))
    }

    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        self.refresh_id += 1;
        let refresh_id = self.refresh_id;
        let task = self
            .client
            .tool(patina_desktop_protocol::tools::call::notices(self.dialog));
        cx.spawn(async move |view, cx| {
            let result = task.await;
            let _ = view.update(cx, |t, cx| {
                if t.refresh_id != refresh_id {
                    return;
                }
                match result {
                    Ok(items) => {
                        let item = items.into_iter().next();
                        if t.item.as_ref().map(identity) != item.as_ref().map(identity) {
                            t.selected = None;
                            t.busy = false;
                            t.presented = None;
                        }
                        t.item = item;
                        t.error = None;
                        if t.item.is_none() && !t.dialog {
                            let hwnd = t.window;
                            cx.defer(move |cx| {
                                let _ = hwnd.update(cx, |_, w, _| w.remove_window());
                            });
                        }
                    }
                    Err(e) => {
                        t.busy = false;
                        t.error = Some(e.to_string());
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }

    pub fn embedded(client: Rc<Client>, win: &Window, cx: &mut Context<Self>) -> Self {
        let mut view = Self {
            client,
            item: None,
            error: None,
            window: win.window_handle(),
            dialog: true,
            selected: None,
            busy: false,
            refresh_id: 0,
            measured_height: None,
            presented: None,
        };
        view.refresh(cx);
        view
    }
}

fn identity(item: &Notice) -> (String, Option<i64>, bool, i64) {
    (item.generation.clone(), item.source, item.usage, item.at_ms)
}

impl ToolNotice {
    fn submit(&mut self, choice: String, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let Some(item) = self.item.clone() else {
            return;
        };
        let current = identity(&item);
        self.busy = true;
        self.error = None;
        cx.notify();
        let task = self
            .client
            .tool(patina_desktop_protocol::tools::call::acknowledge(
                item, choice,
            ));
        cx.spawn(async move |view, cx| {
            let result = task.await;
            let _ = view.update(cx, |view, cx| {
                if view.item.as_ref().map(identity).as_ref() != Some(&current) {
                    return;
                }
                match result {
                    Ok(()) => view.refresh(cx),
                    Err(error) => {
                        view.busy = false;
                        view.error = Some(error.to_string());
                        cx.notify();
                    }
                }
            });
        })
        .detach();
    }
}

impl Render for ToolNotice {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.client.locale.get();
        let tr = |key| patina_i18n::text(locale, key);
        if self.item.is_none() && self.error.is_none() {
            return div().into_any_element();
        }
        let colors = self.client.palette(win);
        let mut body = if self.dialog {
            quietpro::dialog_surface(colors, win.viewport_size()).w(px(NOTICE_WIDTH))
        } else {
            panel(colors.border, colors.panel).w_full().flex_none()
        };
        body = body.gap(px(12.)).text_color(colors.text);
        if let Some(item) = self.item.clone()
            && let Some(content) = &item.content
        {
            let identity = identity(&item);
            if self.presented.as_ref() != Some(&identity) {
                self.presented = Some(identity);
                let client = self.client.clone();
                let shown = item.clone();
                win.on_next_frame(move |_, cx| {
                    let presented =
                        client.tool(patina_desktop_protocol::tools::call::presented(shown));
                    cx.spawn(async move |_| {
                        if let Err(e) = presented.await {
                            eprintln!("Announce tool notification: {e}");
                        }
                    })
                    .detach();
                });
            }
            let choices = content.choices.as_ref();
            let selecting = choices.zip(self.selected);
            let title = selecting
                .map_or(&content.title, |(group, _)| &group.label)
                .clone();
            body = body.child(
                quietpro::heading(title)
                    .aria_level(2)
                    .line_height(px(24.))
                    .text_center(),
            );
            let mut row = quietpro::dialog_actions().flex_nowrap().gap(px(12.));
            if let Some((group, selected)) = selecting {
                let mut list = RadioGroup::new("notification-options")
                    .aria_label(group.label.clone())
                    .axis(Axis::Vertical)
                    .w_full()
                    .flex()
                    .flex_col();
                for (index, (_, label)) in group.options.iter().enumerate() {
                    let checked = index == selected;
                    let view = cx.weak_entity();
                    let option = Radio::new(("notice-option", index))
                        .accessibility_label(label.clone())
                        .set_position(index + 1, group.options.len())
                        .checked(checked)
                        .disabled(self.busy)
                        .h(px(36.))
                        .px(px(12.))
                        .flex()
                        .items_center()
                        .justify_between()
                        .text_size(px(14.))
                        .line_height(px(20.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(if checked { colors.accent } else { colors.text })
                        .when(index > 0, |s| {
                            s.border_t_1().border_color(quietpro::divider_color(colors))
                        })
                        .cursor_pointer()
                        .hover(move |s| s.bg(colors.track.opacity(0.25)))
                        .focus_visible(move |s| s.bg(colors.track.opacity(0.35)))
                        .child(label.clone())
                        .when(checked, |s| {
                            s.child(quietpro::glyph(quietpro::Icon::Check, colors.accent))
                        })
                        .on_change(move |_, _, _, cx| {
                            let _ = view.update(cx, |t, cx| {
                                t.selected = Some(index);
                                cx.notify();
                            });
                        });
                    list = list.child(option);
                }
                body = body.child(
                    quietpro::continuous_frame(px(12.), colors.border, colors.canvas).child(list),
                );
                row = row.child(
                    quietpro::text_button("notice-back", tr("common.cancel"), colors, !self.busy)
                        .flex_1()
                        .on_click(cx.listener(|t, _, _, cx| {
                            t.selected = None;
                            cx.notify();
                        })),
                );
                if let Some((id, _)) = group.options.get(selected) {
                    let id = id.clone();
                    row = row.child(
                        quietpro::text_button(
                            "notice-confirm",
                            tr("common.confirm"),
                            colors,
                            !self.busy,
                        )
                        .flex_1()
                        .on_click(cx.listener(move |t, _, _, cx| t.submit(id.clone(), cx))),
                    );
                }
            } else {
                if !content.detail.is_empty() {
                    body = body.child(
                        div()
                            .text_center()
                            .text_color(colors.secondary)
                            .text_size(px(14.))
                            .line_height(px(20.))
                            .child(content.detail.clone()),
                    );
                }
                if let Some(group) = choices {
                    row = row.child(
                        quietpro::text_button(
                            "notice-choices",
                            group.label.clone(),
                            colors,
                            !self.busy,
                        )
                        .flex_1()
                        .on_click(cx.listener(|t, _, _, cx| {
                            t.selected = Some(0);
                            cx.notify();
                        })),
                    );
                }
                for (index, (id, name)) in content.actions.iter().enumerate() {
                    let id = id.clone();
                    row = row.child(
                        quietpro::text_button(
                            ("notice-action", index),
                            name.clone(),
                            colors,
                            !self.busy,
                        )
                        .flex_1()
                        .on_click(cx.listener(move |t, _, _, cx| t.submit(id.clone(), cx))),
                    );
                }
            }
            body = body.child(row);
        }
        if let Some(error) = &self.error {
            body = body
                .child(label(error.clone()))
                .child(quietpro::dialog_actions().child({
                    let accessible_name = tr("common.retry");
                    quietpro::text_button("notice-retry", tr("common.retry"), colors, true)
                        .accessibility_label(accessible_name)
                        .on_click(cx.listener(|t, _, _, cx| t.refresh(cx)))
                }));
        }
        if self.dialog {
            quietpro::dialog_backdrop()
                .absolute()
                .inset_0()
                .flex()
                .items_center()
                .justify_center()
                .on_any_mouse_down(|_, _, cx| cx.stop_propagation())
                .child(body)
                .into_any_element()
        } else {
            let card = div()
                .absolute()
                .top_0()
                .left_0()
                .right_0()
                .child(body)
                .on_prepaint(cx.processor(|view, bounds: Bounds<Pixels>, win, _| {
                    let height = (f32::from(bounds.size.height) * win.scale_factor()).ceil() as i32;
                    if view.measured_height == Some(height) || height <= 0 {
                        return;
                    }
                    match crate::windows::placement::place_notification(win, Some(height)) {
                        Ok(()) => view.measured_height = Some(height),
                        Err(e) => eprintln!("Resize notification: {e}"),
                    }
                }));
            div().relative().size_full().child(card).into_any_element()
        }
    }
}
