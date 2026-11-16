use crate::{
    page_controls::label, tool_service::ToolRequest, window_process::Query, windows_host::Client,
};
use gpui_kit::{prelude::*, *};
use patina_tool_host::Notice;
use quietpro::content_card as panel;
use std::rc::Rc;

pub(super) struct ToolNotice {
    client: Rc<Client>,
    item: Option<Notice>,
    error: Option<String>,
    window: AnyWindowHandle,
    dialog: bool,
    presented: Option<(String, Option<i64>, bool, i64)>,
}

impl ToolNotice {
    pub fn open(client: Rc<Client>, cx: &mut App) -> Result<(AnyWindowHandle, WeakEntity<Self>)> {
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(360.), px(160.)),
                cx,
            ))),
            kind: WindowKind::PopUp,
            focus: false,
            titlebar: None,
            app_id: Some(crate::APP_ID.into()),
            ..Default::default()
        };
        let (handle, entity) = gpui_kit::open_window(options, cx, |win, cx| {
            win.set_window_title("Patina · Tools");
            crate::app_windows::handle_close(win, cx);
            cx.new(|cx| {
                let mut notice = Self {
                    client,
                    item: None,
                    error: None,
                    window: win.window_handle(),
                    dialog: false,
                    presented: None,
                };
                notice.refresh(cx);
                notice
            })
        })?;
        let result = handle.update(cx, |_, win, _| crate::dock::place_notification(win))?;
        if let Err(error) = result {
            let _ = handle.update(cx, |_, win, _| win.remove_window());
            return Err(std::io::Error::other(error).into());
        }
        Ok((handle, entity.downgrade()))
    }

    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        let task = self
            .client
            .request::<Vec<Notice>>(Query::Tools(ToolRequest::Notices(self.dialog)));
        cx.spawn(async move |view, cx| {
            let result = task.await;
            let _ = view.update(cx, |t, cx| {
                match result {
                    Ok(items) => {
                        t.item = items.into_iter().next();
                        t.error = None;
                        if t.item.is_none() && !t.dialog {
                            let hwnd = t.window;
                            cx.defer(move |cx| {
                                let _ = hwnd.update(cx, |_, w, _| w.remove_window());
                            });
                        }
                    }
                    Err(e) => t.error = Some(e),
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
            presented: None,
        };
        view.refresh(cx);
        view
    }
}

impl Render for ToolNotice {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let tr = |key| patina_recorder::text(self.client.locale.get(), key);
        if self.item.is_none() && self.error.is_none() {
            return div().into_any_element();
        }
        let colors = self.client.palette(win);
        let mut body = if self.dialog {
            quietpro::dialog_surface(colors, win.viewport_size())
        } else {
            panel(colors.border, colors.panel).gap(px(quietpro::CARD_TITLE_GAP))
        };
        if let Some(item) = self.item.clone() {
            let identity = (item.generation.clone(), item.source, item.usage, item.at_ms);
            if self.presented.as_ref() != Some(&identity) {
                self.presented = Some(identity);
                let client = self.client.clone();
                let shown = item.clone();
                win.on_next_frame(move |_, cx| {
                    let presented =
                        client.request::<()>(Query::Tools(ToolRequest::Presented(shown)));
                    cx.spawn(async move |_| {
                        if let Err(e) = presented.await {
                            eprintln!("Announce tool notification: {e}");
                        }
                    })
                    .detach();
                });
            }
            let mut actions = vec![("dismiss", tr("common.confirm"))];
            if item.usage {
                actions.extend([
                    ("fifteen_minutes", "+15 min".into()),
                    ("one_hour", "+60 min".into()),
                    ("today", tr("dashboard.title")),
                ]);
            } else if item.source.is_some() {
                actions.extend([
                    ("5", "+5 min".into()),
                    ("15", "+15 min".into()),
                    ("30", "+30 min".into()),
                ]);
            } else if item.focus_task.is_some() {
                actions.push(("start", tr("tools.start")));
            }
            let mut row = div().flex().flex_wrap().gap(px(4.));
            for (choice, name) in actions {
                let item = item.clone();
                row = row.child({
                    let accessible_name = name.clone();
                    quietpro::text_button(choice, name, colors, true)
                        .accessibility_label(accessible_name)
                        .on_click(cx.listener(move |t, _, _, cx| {
                            let task =
                                t.client
                                    .request::<()>(Query::Tools(ToolRequest::Acknowledge(
                                        item.clone(),
                                        choice.into(),
                                    )));
                            cx.spawn(async move |view, cx| {
                                let result = task.await;
                                let _ = view.update(cx, |t, cx| match result {
                                    Err(e) => {
                                        t.error = Some(e);
                                        cx.notify();
                                    }
                                    Ok(()) => t.refresh(cx),
                                });
                            })
                            .detach();
                        }))
                });
            }
            body = body.child(label(item.label.clone())).child(row);
        }
        if let Some(error) = &self.error {
            body = body.child(label(error.clone())).child({
                let accessible_name = tr("common.retry");
                quietpro::text_button("notice-retry", tr("common.retry"), colors, true)
                    .accessibility_label(accessible_name)
                    .on_click(cx.listener(|t, _, _, cx| t.refresh(cx)))
            });
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
            body.into_any_element()
        }
    }
}
