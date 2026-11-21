use super::*;
use gpui_kit::base::Dialog;
use quietpro::{Palette, ThemePreset};

const COLUMNS: usize = 4;
const GRID_GAP: f32 = 8.;

pub(super) struct Picker {
    dark: bool,
    selected: &'static str,
    focus: FocusHandle,
    options: Vec<FocusHandle>,
    scroll: ScrollHandle,
    saving: bool,
    failed: bool,
}

fn library_key(dark: bool) -> &'static str {
    if dark {
        "settings.themeLibraryOptions.dark"
    } else {
        "settings.themeLibraryOptions.light"
    }
}

impl Settings {
    pub(super) fn scheme_row(&self, c: Palette, win: &Window, cx: &mut Context<Self>) -> Div {
        let tr = |key| text(self.client.locale.get(), key);
        let active_dark = self
            .picker
            .as_ref()
            .map_or_else(|| self.client.dark(win), |picker| picker.dark);
        let mut row = settings_row().gap(px(8.)).child(
            settings_row_label(tr("settings.colorSchemeLabel"))
                .font_weight(FontWeight::BOLD)
                .flex_1(),
        );
        for dark in [false, true] {
            let key = library_key(dark);
            let label_color = if dark == active_dark {
                c.text
            } else {
                c.secondary
            };
            row = row.child(
                quietpro::inline_choice_entry(key, tr(key), !self.busy(), c, label_color)
                    .text_size(px(12.))
                    .control_size(ControlSize::Medium)
                    .track_focus(&self.scheme_triggers[usize::from(dark)])
                    .on_click(cx.listener(move |s, _, win, cx| s.open_schemes(dark, win, cx))),
            );
        }
        row
    }

    fn open_schemes(&mut self, dark: bool, win: &mut Window, cx: &mut Context<Self>) {
        let Some(p) = self.saved.as_ref() else { return };
        let entries: Vec<_> = ThemePreset::options(dark).collect();
        let index = entries
            .iter()
            .position(|(id, _)| *id == p.schemes[usize::from(dark)])
            .unwrap_or(0);
        let options: Vec<_> = entries.iter().map(|_| cx.focus_handle()).collect();
        win.focus(&options[index], cx);
        let selected = entries[index].0;
        let scroll = ScrollHandle::new();
        scroll.scroll_to_item(index / COLUMNS);
        self.picker = Some(Picker {
            dark,
            selected,
            options,
            scroll,
            focus: cx.focus_handle(),
            saving: false,
            failed: false,
        });
        self.preview_scheme(dark, selected, win, cx);
    }

    fn preview_scheme(
        &mut self,
        dark: bool,
        id: &'static str,
        win: &Window,
        cx: &mut Context<Self>,
    ) {
        self.client
            .scheme_preview
            .set(Some((win.window_handle().window_id(), dark, id)));
        cx.refresh_windows();
    }

    fn close_schemes(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if self.picker.as_ref().is_some_and(|p| p.saving) {
            return;
        }
        if let Some(picker) = self.picker.take() {
            self.client.scheme_preview.set(None);
            win.focus(&self.scheme_triggers[usize::from(picker.dark)], cx);
            cx.refresh_windows();
        }
    }

    fn confirm_scheme(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        let (Some(picker), Some(saved)) = (&mut self.picker, &self.saved) else {
            return;
        };
        if picker.saving {
            return;
        }
        let index = usize::from(picker.dark);
        let id = picker.selected;
        if saved.schemes[index] == id {
            self.close_schemes(win, cx);
            return;
        }
        picker.saving = true;
        picker.failed = false;
        let mut next = saved.clone();
        next.schemes[index] = id.into();
        let write = self.client.save_preferences(saved.clone(), next);
        cx.spawn_in(win, async move |view, cx| {
            let result = write.await;
            let _ = view.update_in(cx, |s, win, cx| {
                let Some(picker) = &mut s.picker else { return };
                picker.saving = false;
                if result.is_ok() {
                    for p in [&mut s.saved, &mut s.draft].into_iter().flatten() {
                        p.schemes[index] = id.into();
                    }
                    s.client.schemes.borrow_mut()[index] = id.into();
                    s.close_schemes(win, cx);
                } else {
                    picker.failed = true;
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    pub(super) fn scheme_dialog(
        &self,
        picker: &Picker,
        c: Palette,
        win: &Window,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let tr = |key| text(self.client.locale.get(), key);
        let dark = picker.dark;
        let title = tr(library_key(dark));
        let entries: Vec<_> = ThemePreset::options(dark).collect();
        let item_width = entries
            .iter()
            .map(|(_, preset)| {
                let name = preset.label.clone().unwrap_or_else(|| tr("common.default"));
                let mut run = win.text_style().to_run(name.len());
                run.font.weight = FontWeight::MEDIUM;
                let label_width = f32::from(
                    win.text_system()
                        .shape_line(name.into(), px(14.), &[run], None)
                        .width,
                );
                let swatches_width = preset.swatches().len() as f32 * 16. - 4.;
                label_width.max(swatches_width) + quietpro::CONTENT_INSET * 2.
            })
            .fold(0_f32, f32::max);
        let width = ((item_width * COLUMNS as f32
            + GRID_GAP * (COLUMNS - 1) as f32
            + 2. * quietpro::DIALOG_FRAME_INSET)
            / 4.)
            .ceil()
            * 4.;
        let mut list = div()
            .id("scheme-options")
            .min_h_0()
            .overflow_y_scroll()
            .track_scroll(&picker.scroll)
            .flex()
            .flex_col()
            .gap(px(GRID_GAP));
        for (row_index, group) in entries.chunks(COLUMNS).enumerate() {
            let mut row = div()
                .grid()
                .grid_cols(COLUMNS as u16)
                .gap(px(GRID_GAP))
                .flex_none();
            for (offset, &(id, preset)) in group.iter().enumerate() {
                let name = preset.label.clone().unwrap_or_else(|| tr("common.default"));
                let selected = id == picker.selected;
                row = row.child(
                    choice_card(id, name.clone(), selected, !picker.saving, c)
                        .track_focus(&picker.options[row_index * COLUMNS + offset])
                        .aria_toggled(if selected {
                            Toggled::True
                        } else {
                            Toggled::False
                        })
                        .child(quietpro::choice_swatches(
                            name,
                            preset.swatches(),
                            !picker.saving,
                            c,
                        ))
                        .on_click(cx.listener(move |s, _, win, cx| {
                            if let Some(picker) = &mut s.picker
                                && !picker.saving
                            {
                                picker.selected = id;
                                picker.failed = false;
                                s.preview_scheme(dark, id, win, cx);
                            }
                        })),
                );
            }
            list = list.child(row);
        }
        let content = quietpro::dialog_surface(c, win.viewport_size())
            .on_key_down(cx.listener(|s, e: &KeyDownEvent, win, cx| {
                if e.keystroke.key == "escape" {
                    s.close_schemes(win, cx);
                    cx.stop_propagation();
                }
            }))
            .w(px(width)
                .min(win.viewport_size().width - px(48.))
                .min(px(572.)))
            .child(heading(title.clone()).flex_none())
            .child(list)
            .when(picker.failed, |d| d.child(label(tr("settings.saveFailed"))))
            .child(
                quietpro::dialog_actions()
                    .child(
                        text_button("scheme-cancel", tr("common.cancel"), c, !picker.saving)
                            .on_click(cx.listener(|s, _, win, cx| s.close_schemes(win, cx))),
                    )
                    .child(
                        text_button(
                            "scheme-confirm",
                            tr(if picker.saving {
                                "settings.colorSchemeSaving"
                            } else {
                                "common.confirm"
                            }),
                            c,
                            !picker.saving,
                        )
                        .on_click(cx.listener(|s, _, win, cx| s.confirm_scheme(win, cx))),
                    ),
            );
        let view = cx.weak_entity();
        quietpro::modal_dialog(
            title,
            picker.focus.clone(),
            content,
            move |win, cx| {
                let _ = view.update(cx, |s, cx| s.close_schemes(win, cx));
            },
            cx,
        )
        // Enter activates the focused swatch or footer button.
        .close_on_escape(false)
        .close_on_backdrop_press(!picker.saving)
    }
}
