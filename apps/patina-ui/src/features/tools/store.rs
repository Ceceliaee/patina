use super::{Confirm, Tools, tool_name};
use gpui_kit::{prelude::*, *};
use patina_desktop_protocol::tools::call;
use patina_i18n::text;
use quietpro::{ButtonSizeExt, ControlSize, Icon, IconControl};

pub(super) struct StoreFocus {
    modal: FocusHandle,
    title: FocusHandle,
    install: FocusHandle,
}

impl Tools {
    fn close_store(&mut self, cx: &mut Context<Self>) {
        if self.busy || self.pending.is_some() {
            return;
        }
        self.manager = false;
        self.error = None;
        if std::mem::take(&mut self.refresh_pending) {
            self.background_refresh(cx);
        }
        cx.notify();
    }

    pub(super) fn focus_store_install(&self, win: &mut Window, cx: &mut Context<Self>) {
        if let Some(focus) = &self.store_focus {
            win.focus(&focus.install, cx);
        }
    }

    pub(super) fn cancel_store_confirmation(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        match self.pending.take() {
            Some(Confirm::Remove(_, _, opener)) => win.focus(&opener, cx),
            Some(Confirm::Install(..)) => self.focus_store_install(win, cx),
            None => (),
        }
        cx.notify();
    }

    pub(super) fn store_dialog(
        &mut self,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> quietpro::ModalDialog {
        let colors = self.client.palette(win);
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let title = tr("tools.manager");
        let topmost = self.pending.is_none();
        let ready = !self.busy && topmost;
        let focus = self.store_focus.get_or_insert_with(|| {
            let title = cx.focus_handle();
            win.focus(&title, cx);
            StoreFocus {
                modal: cx.focus_handle(),
                title,
                install: cx.focus_handle(),
            }
        });
        let header = quietpro::settings_title(colors, Icon::Store, title.clone())
            .flex_none()
            .track_focus(&focus.title)
            .child(
                quietpro::icon_actions()
                    .child(
                        IconControl::new("install-tool", tr("tools.install"), Icon::FolderDown)
                            .track_focus(&focus.install)
                            .with_tooltip()
                            .disabled(!ready)
                            .action(colors, cx.listener(|t, _, _, cx| t.choose(cx))),
                    )
                    .child(
                        IconControl::new("close-store", tr("common.close"), Icon::X)
                            .disabled(!ready)
                            .action(colors, cx.listener(|t, _, _, cx| t.close_store(cx))),
                    ),
            );
        let mut body = div()
            .id("store-body")
            .flex()
            .flex_col()
            .min_h_0()
            .overflow_y_scroll()
            .gap(px(quietpro::SECTION_GROUP_GAP));
        if self.tools.is_empty() && !self.busy {
            body = body.child(super::label(tr("tools.empty")));
        }
        let mut rows = quietpro::settings_rows_card(colors);
        for (index, tool) in self.tools.iter().enumerate() {
            let name = tool_name(tool, locale);
            let id = SharedString::from(format!("remove-{}", tool.manifest.id));
            let opener = win
                .use_keyed_state(id.clone(), cx, |_, cx| cx.focus_handle())
                .read(cx)
                .clone();
            let selected = tool.clone();
            let remove = quietpro::text_button(id, tr("tools.uninstall"), colors, ready)
                .control_size(ControlSize::Medium)
                .accessibility_label(format!("{} {name}", tr("tools.uninstall")))
                .track_focus(&opener)
                .on_click(cx.listener(move |t, _, _, cx| {
                    let selected = selected.clone();
                    let opener = opener.clone();
                    t.run(
                        call::stopping(selected.manifest.id.clone(), selected.generation.clone()),
                        move |t, labels, _| {
                            t.pending = Some(Confirm::Remove(selected, labels, opener))
                        },
                        cx,
                    );
                }));
            let row = quietpro::settings_row()
                .gap(px(quietpro::SUBHEADING_GAP))
                .child(
                    quietpro::settings_row_label(name)
                        .min_w_0()
                        .flex_1()
                        .truncate(),
                )
                .child(remove);
            let row = if index == 0 {
                row
            } else {
                quietpro::line_above(row, colors, 0.)
            };
            rows = rows.child(row.id(SharedString::from(format!(
                "store-row-{}",
                tool.manifest.id
            ))));
        }
        if !self.tools.is_empty() {
            body = body.child(rows);
        }
        if let Some(error) = &self.error {
            body = body
                .child(super::label(error.clone()).role(Role::Alert))
                .child(
                    quietpro::text_button("retry-store", tr("common.retry"), colors, ready)
                        .on_click(cx.listener(|t, _, _, cx| t.list(call::list(), cx))),
                );
        }
        let surface = quietpro::dialog_surface(colors, win.viewport_size())
            .w(px(600.))
            .child(header)
            .child(body)
            .on_key_down(cx.listener(|t, e: &KeyDownEvent, _, cx| {
                if e.keystroke.key == "escape" && t.pending.is_none() {
                    t.close_store(cx);
                    cx.stop_propagation();
                }
            }));
        let view = cx.weak_entity();
        quietpro::modal_dialog(
            title,
            focus.modal.clone(),
            surface,
            move |_, cx| {
                let _ = view.update(cx, |t, cx| t.close_store(cx));
            },
            cx,
        )
        .layer(0, topmost)
        .close_on_escape(false)
        .close_on_backdrop_press(ready)
    }
}
