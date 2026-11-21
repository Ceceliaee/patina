use super::*;
use gpui_kit::base::{Dialog, Popover};
use std::cmp::Ordering;
use windows::{
    Win32::Globalization::{
        CSTR_EQUAL, CSTR_GREATER_THAN, CSTR_LESS_THAN, CompareStringEx, NORM_IGNORECASE,
    },
    core::HSTRING,
};

pub(super) fn compare_names(
    locale: patina_activity_model::Locale,
    left: &str,
    right: &str,
) -> Ordering {
    let left_utf16: Vec<_> = left.encode_utf16().collect();
    let right_utf16: Vec<_> = right.encode_utf16().collect();
    match unsafe {
        CompareStringEx(
            &HSTRING::from(locale.tag()),
            NORM_IGNORECASE,
            &left_utf16,
            &right_utf16,
            None,
            None,
            None,
        )
    } {
        CSTR_LESS_THAN => Ordering::Less,
        CSTR_GREATER_THAN => Ordering::Greater,
        CSTR_EQUAL => Ordering::Equal,
        _ => left.to_lowercase().cmp(&right.to_lowercase()),
    }
}

impl Classification {
    pub(super) fn effective_rule(&self, rule: &Card) -> Card {
        let mut rule = rule.clone();
        if let Some(target) = self
            .category_edits
            .get(&rule.category)
            .and_then(|c| c.replacement.as_ref())
        {
            rule.category = target.clone();
        }
        let exists = match self.category_edits.get(&rule.category) {
            Some(edit) => edit.replacement.is_none(),
            None => self
                .rules
                .as_ref()
                .is_some_and(|rules| rules.categories.iter().any(|(id, _)| id == &rule.category)),
        };
        if !exists {
            rule.category = "other".into();
        }
        rule
    }
    pub(super) fn categories(&self) -> Vec<(String, String)> {
        let mut entries: BTreeMap<_, _> = self
            .rules
            .as_ref()
            .map(|r| r.categories.clone())
            .unwrap_or_default()
            .into_iter()
            .collect();
        for edit in self.category_edits.values() {
            if edit.replacement.is_some() {
                entries.remove(&edit.id);
            } else {
                entries.insert(edit.id.clone(), edit.label.clone());
            }
        }
        let mut entries: Vec<_> = entries.into_iter().collect();
        entries.sort_by(|a, b| {
            compare_names(self.client.locale.get(), &a.1, &b.1).then(a.0.cmp(&b.0))
        });
        entries
    }

    pub(super) fn default_category_color(&self, id: &str) -> String {
        self.rules
            .as_ref()
            .and_then(|r| r.category_default_colors.get(id))
            .cloned()
            .unwrap_or_else(|| patina_activity_model::default_category_color(id))
    }

    pub(super) fn category_color(&self, id: &str) -> String {
        if let Some(color) = self.category_edits.get(id).and_then(|c| c.color.as_ref()) {
            return if color.is_empty() {
                self.default_category_color(id)
            } else {
                color.clone()
            };
        }
        self.rules
            .as_ref()
            .and_then(|r| r.category_colors.get(id))
            .cloned()
            .unwrap_or_else(|| self.default_category_color(id))
    }

    fn category_edit(&mut self, id: &str) -> &mut patina_activity_model::CategoryEdit {
        self.category_edits.entry(id.into()).or_insert_with(|| {
            let previous = self
                .rules
                .as_ref()
                .and_then(|r| r.categories.iter().find(|c| c.0 == id))
                .map(|c| c.1.clone());
            patina_activity_model::CategoryEdit {
                id: id.into(),
                label: previous.clone().unwrap_or_default(),
                previous,
                previous_color: self
                    .rules
                    .as_ref()
                    .and_then(|r| r.category_colors.get(id))
                    .cloned(),
                color: None,
                replacement: None,
            }
        })
    }

    fn edit_category_name(&mut self, id: Option<String>, win: &mut Window, cx: &mut Context<Self>) {
        let name = id
            .as_ref()
            .and_then(|id| self.categories().into_iter().find(|c| &c.0 == id))
            .map(|c| c.1)
            .unwrap_or_default();
        self.category_id = id;
        self.category_editing = true;
        self.category_picker = None;
        self.category_name.update(cx, |f, cx| {
            f.set_value(name, win, cx);
            f.set_placeholder(
                text(
                    self.client.locale.get(),
                    "mapping.createCategoryPlaceholder",
                ),
                win,
                cx,
            );
            f.focus(win, cx);
        });
        cx.notify();
    }

    fn valid_category_name(&self, cx: &App) -> bool {
        let value = self.category_name.read(cx).value();
        let name = value.trim();
        !name.is_empty()
            && name.encode_utf16().count() <= 80
            && !self.categories().iter().any(|(id, label)| {
                self.category_id.as_ref() != Some(id)
                    && label.to_lowercase() == name.to_lowercase()
                    && (self.category_id.is_none() || matches!(id.as_str(), "other" | "system"))
            })
    }

    pub(super) fn accept_category_name(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if !self.category_manager || !self.category_editing || !self.valid_category_name(cx) {
            return;
        }
        let name = self
            .category_name
            .read(cx)
            .value()
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if self.category_id.as_ref().is_some_and(|id| {
            self.categories()
                .iter()
                .any(|(key, label)| key == id && label == &name)
        }) {
            self.category_editing = false;
            self.focus_category_name_trigger(win, cx);
            cx.notify();
            return;
        }
        if let Some((target, _)) = self.categories().into_iter().find(|(id, label)| {
            self.category_id.as_ref() != Some(id) && label.to_lowercase() == name.to_lowercase()
        }) {
            if let Some(id) = self.category_id.clone() {
                self.category_confirmation = Some((id, target));
                win.focus(&self.category_cancel_focus, cx);
            }
            cx.notify();
            return;
        }
        let id = self.category_id.clone().unwrap_or_else(|| {
            format!(
                "custom:category_{}",
                chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
            )
        });
        self.category_edit(&id).label = name;
        self.category_editing = false;
        self.focus_category_name_trigger(win, cx);
        cx.notify();
    }

    fn remove_category(
        &mut self,
        id: &str,
        target: &str,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let target_has_override = self
            .category_edits
            .get(target)
            .and_then(|c| c.color.as_ref())
            .map(|color| !color.is_empty())
            .unwrap_or_else(|| {
                self.rules
                    .as_ref()
                    .is_some_and(|r| r.category_color_overrides.contains_key(target))
            });
        if target != "other" && !target_has_override {
            let color = self.category_color(id);
            self.category_edit(target).color = Some(color);
        }
        self.category_edit(id).replacement = Some(target.into());
        for edit in self.category_edits.values_mut() {
            if edit.replacement.as_deref() == Some(id) {
                edit.replacement = Some(target.into());
            }
        }
        for rule in self.pending.values_mut() {
            if rule.category == id {
                rule.category = target.into();
            }
        }
        if self.category_filter.as_deref() == Some(id) {
            self.category_filter = None;
        }
        self.category_confirmation = None;
        self.category_editing = false;
        win.focus(&self.category_title_focus, cx);
        cx.notify();
    }

    fn focus_category_name_trigger(&self, win: &mut Window, cx: &mut Context<Self>) {
        let key = self
            .category_id
            .as_ref()
            .map(|id| format!("rename-{id}"))
            .unwrap_or_else(|| "create".into());
        win.focus(
            self.category_focus
                .get(&key)
                .unwrap_or(&self.category_title_focus),
            cx,
        );
    }

    fn dismiss_category_layer(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if let Some((id, _)) = self.category_confirmation.take() {
            if self.category_editing {
                self.category_name.update(cx, |f, cx| f.focus(win, cx));
            } else if let Some(focus) = self.category_focus.get(&format!("delete-{id}")) {
                win.focus(focus, cx);
            }
        } else if self.category_editing {
            self.category_editing = false;
            self.focus_category_name_trigger(win, cx);
        } else {
            self.category_manager = false;
            self.category_picker = None;
            win.focus(&self.category_trigger_focus, cx);
        }
        cx.notify();
    }

    pub(super) fn render_category_manager(
        &mut self,
        c: quietpro::Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let message = |key, name: String| patina_i18n::format_text(locale, key, &[("label", name)]);
        let categories: Vec<_> = self
            .categories()
            .into_iter()
            .filter(|(id, _)| !matches!(id.as_str(), "other" | "system" | "anonymous"))
            .collect();
        let name_width = categories
            .iter()
            .map(|(_, name)| {
                let mut run = win.text_style().to_run(name.len());
                run.font.weight = FontWeight::MEDIUM;
                f32::from(
                    win.text_system()
                        .shape_line(name.clone().into(), px(14.), &[run], None)
                        .width,
                )
            })
            .fold(0_f32, f32::max);
        let title = tr("mapping.categoryDialogTitle");
        let mut title_run = win.text_style().to_run(title.len());
        title_run.font.weight = FontWeight::BOLD;
        let title_width = f32::from(
            win.text_system()
                .shape_line(title.clone().into(), px(16.), &[title_run], None)
                .width,
        );
        const ITEM_GAP: f32 = 4.;
        const HEADING_GAP: f32 = 8.;
        let frame_width = quietpro::DIALOG_FRAME_INSET * 2.;
        let card_width = name_width
            + quietpro::ICON_CONTROL_SIZE * 3.
            + ITEM_GAP * 2.
            + (quietpro::CONTENT_INSET + 1.) * 2.;
        let available_width =
            ((f32::from(win.viewport_size().width) - quietpro::DIALOG_WINDOW_MARGIN * 2.).max(0.)
                / 4.)
                .floor()
                * 4.;
        let two_columns = card_width * 2. + quietpro::APP_CARD_GAP + frame_width;
        let columns = if two_columns <= available_width { 2 } else { 1 };
        let body_width = if columns == 2 {
            two_columns
        } else {
            card_width + frame_width
        };
        let heading_width =
            title_width + quietpro::ICON_CONTROL_SIZE * 2. + HEADING_GAP + frame_width;
        let width = ((body_width.max(heading_width) / 4.).ceil() * 4.).min(available_width);
        let create_focus = self
            .category_focus
            .entry("create".into())
            .or_insert_with(|| cx.focus_handle())
            .clone();
        let create_view = cx.weak_entity();
        let close_view = create_view.clone();
        let max_height = (win.viewport_size().height - px(230.))
            .max(px(100.))
            .min(px(370.));
        let mut content = quietpro::dialog_surface(c, win.viewport_size())
            .w(px(width))
            .child(
                div()
                    .id("category-manager-heading")
                    .track_focus(&self.category_title_focus)
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(HEADING_GAP))
                    .child(heading(title))
                    .child(
                        quietpro::icon_actions()
                            .child(
                                quietpro::IconControl::new(
                                    "new-category",
                                    tr("mapping.createCategoryAction"),
                                    Icon::TagPlus,
                                )
                                .track_focus(&create_focus)
                                .disabled(
                                    self.category_editing || self.category_confirmation.is_some(),
                                )
                                .action(c, move |_, win, cx| {
                                    let _ = create_view
                                        .update(cx, |t, cx| t.edit_category_name(None, win, cx));
                                }),
                            )
                            .child(
                                quietpro::IconControl::new(
                                    "close-categories",
                                    tr("common.close"),
                                    Icon::X,
                                )
                                .action(c, move |_, win, cx| {
                                    let _ = close_view.update(cx, |t, cx| {
                                        t.category_manager = false;
                                        t.category_editing = false;
                                        t.category_confirmation = None;
                                        t.category_picker = None;
                                        win.focus(&t.category_trigger_focus, cx);
                                        cx.notify();
                                    });
                                }),
                            ),
                    ),
            );
        let mut list = div()
            .id("category-list")
            .grid()
            .grid_cols(columns)
            .gap(px(quietpro::APP_CARD_GAP))
            .max_h(max_height)
            .overflow_y_scroll();
        for (id, name) in categories {
            for action in ["color", "rename", "delete"] {
                self.category_focus
                    .entry(format!("{action}-{id}"))
                    .or_insert_with(|| cx.focus_handle());
            }
            let color_focus = self.category_focus[&format!("color-{id}")].clone();
            let color_bounds = win.use_keyed_state(
                SharedString::from(format!("category-color-bounds-{id}")),
                cx,
                |_, _| Bounds::<Pixels>::default(),
            );
            let bounds = *color_bounds.read(cx);
            let color_anchor = if bounds.top() > win.viewport_size().height - bounds.bottom() {
                Anchor::BottomLeft
            } else {
                Anchor::TopLeft
            };
            let color_id = id.clone();
            let display = color_picker::parse_hex(&self.category_color(&id)).unwrap_or(c.secondary);
            let default =
                color_picker::parse_hex(&self.default_category_color(&id)).unwrap_or(c.secondary);
            let picker = self
                .category_picker
                .as_ref()
                .filter(|(key, _)| key == &id)
                .map(|(_, p)| p.clone());
            let client = self.client.clone();
            let popover = Popover::new(SharedString::from(format!("category-color-{id}")))
                .open(picker.is_some())
                .anchor(color_anchor)
                .offset(px(4.))
                .trigger(
                    quietpro::color_swatch_button(
                        "color",
                        format!("{} ･ {name}", tr("mapping.color")),
                        display,
                        true,
                        c,
                    )
                    .track_focus(&color_focus)
                    .child(
                        canvas(
                            move |bounds, _, cx| {
                                color_bounds.update(cx, |current, cx| {
                                    if *current != bounds {
                                        *current = bounds;
                                        cx.notify();
                                    }
                                });
                            },
                            |_, _, _, _| {},
                        )
                        .absolute()
                        .inset_0()
                        .size_full(),
                    ),
                )
                .on_open_change(cx.listener(move |t, open, win, cx| {
                    if *open {
                        let picker = cx.new(|cx| {
                            color_picker::ColorPicker::new(
                                client.clone(),
                                display,
                                default,
                                t.color_format,
                                win,
                                cx,
                            )
                        });
                        cx.subscribe(&picker, |t, _, format: &color_picker::FormatChanged, _| {
                            t.color_format = format.0;
                        })
                        .detach();
                        let id = color_id.clone();
                        cx.subscribe(&picker, move |t, _, value: &color_picker::Changed, cx| {
                            t.category_edit(&id).color = Some(value.0.clone().unwrap_or_default());
                            cx.notify();
                        })
                        .detach();
                        t.category_picker = Some((color_id.clone(), picker));
                    } else {
                        t.category_picker = None;
                        win.focus(&color_focus, cx);
                    }
                    cx.notify();
                }))
                .content(move |_, _, _| div().children(picker));
            let rename_id = id.clone();
            let delete_id = id.clone();
            let view = cx.weak_entity();
            let delete_view = view.clone();
            let mut danger = c;
            danger.secondary = c.danger;
            list = list.child(
                quietpro::content_card(c.border, c.panel)
                    .id(SharedString::from(id.clone()))
                    .min_w_0()
                    .h(px(quietpro::SETTINGS_ROW_HEIGHT))
                    .flex_row()
                    .items_center()
                    .gap(px(ITEM_GAP))
                    .py_0()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(ITEM_GAP))
                            .flex_1()
                            .min_w_0()
                            .child(
                                div()
                                    .id(SharedString::from(format!("category-name-{id}")))
                                    .role(Role::Label)
                                    .aria_value(name.clone())
                                    .min_w_0()
                                    .text_ellipsis()
                                    .text_size(px(14.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .child(name.clone()),
                            )
                            .child(
                                quietpro::IconControl::new(
                                    "rename",
                                    message("mapping.renameCategory", name.clone()),
                                    Icon::Pencil,
                                )
                                .track_focus(&self.category_focus[&format!("rename-{id}")])
                                .action(c, move |_, win, cx| {
                                    let _ = view.update(cx, |t, cx| {
                                        t.edit_category_name(Some(rename_id.clone()), win, cx)
                                    });
                                }),
                            ),
                    )
                    .child(
                        quietpro::icon_actions().child(popover).child(
                            quietpro::IconControl::new(
                                "delete",
                                message("mapping.deleteCategory", name),
                                Icon::Trash,
                            )
                            .track_focus(&self.category_focus[&format!("delete-{id}")])
                            .action(danger, move |_, win, cx| {
                                let _ = delete_view.update(cx, |t, cx| {
                                    t.category_confirmation =
                                        Some((delete_id.clone(), "other".into()));
                                    t.category_picker = None;
                                    win.focus(&t.category_cancel_focus, cx);
                                    cx.notify();
                                });
                            }),
                        ),
                    ),
            );
        }
        content = content.child(list);
        let view = cx.weak_entity();
        let editing = self.category_editing || self.category_confirmation.is_some();
        quietpro::modal_dialog(
            tr("mapping.categoryDialogTitle"),
            self.category_title_focus.clone(),
            content,
            move |win, cx| {
                let _ = view.update(cx, |t, cx| t.dismiss_category_layer(win, cx));
            },
            cx,
        )
        .layer(0, !editing)
        .close_on_escape(!editing)
    }

    pub(super) fn render_category_confirmation(
        &self,
        id: String,
        target: String,
        c: quietpro::Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let merging = target != "other";
        let title = tr(if merging {
            "mapping.renameCategoryDuplicateTitle"
        } else {
            "mapping.deleteCategoryTitle"
        });
        let label = self
            .categories()
            .into_iter()
            .find(|(key, _)| key == if merging { &target } else { &id })
            .map(|(_, label)| label)
            .unwrap_or_default();
        let detail = patina_i18n::format_text(
            locale,
            if merging {
                "mapping.renameCategoryDuplicateDetail"
            } else {
                "mapping.deleteCategoryDetail"
            },
            &[("label", label)],
        );
        let content = quietpro::dialog_surface(c, win.viewport_size())
            .max_w((win.viewport_size().width - px(48.)).min(px(480.)))
            .child(heading(title.clone()))
            .child(
                div()
                    .text_size(px(14.))
                    .text_color(c.secondary)
                    .child(detail),
            )
            .child(
                quietpro::dialog_actions()
                    .child(
                        text_button("cancel-category-removal", tr("common.cancel"), c, true)
                            .track_focus(&self.category_cancel_focus)
                            .on_click(
                                cx.listener(|t, _, win, cx| t.dismiss_category_layer(win, cx)),
                            ),
                    )
                    .child(
                        text_button(
                            "confirm-category-removal",
                            tr(if merging {
                                "dialog.confirm"
                            } else {
                                "dialog.confirmDanger"
                            }),
                            c,
                            true,
                        )
                        .on_click(cx.listener(move |t, _, win, cx| {
                            t.remove_category(&id, &target, win, cx)
                        })),
                    ),
            );
        let view = cx.weak_entity();
        quietpro::modal_dialog(
            title,
            self.category_editor_focus.clone(),
            content,
            move |win, cx| {
                let _ = view.update(cx, |t, cx| t.dismiss_category_layer(win, cx));
            },
            cx,
        )
        .layer(1, true)
    }

    pub(super) fn render_category_name_dialog(
        &self,
        c: quietpro::Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Dialog {
        let tr = |key| text(self.client.locale.get(), key);
        let title = tr(if self.category_id.is_some() {
            "mapping.renameCategoryTitle"
        } else {
            "mapping.createCategoryTitle"
        });
        let content = quietpro::dialog_surface(c, win.viewport_size())
            .max_w((win.viewport_size().width - px(48.)).min(px(480.)))
            .child(heading(title.clone()))
            .child(
                div()
                    .flex()
                    .flex_none()
                    .h(px(32.))
                    .child(quietpro::TextInput::new(
                        "category-name-input",
                        &self.category_name,
                        c,
                    )),
            )
            .child(
                quietpro::dialog_actions()
                    .child(
                        text_button("cancel-category-name", tr("common.cancel"), c, true).on_click(
                            cx.listener(|t, _, win, cx| t.dismiss_category_layer(win, cx)),
                        ),
                    )
                    .child(
                        text_button(
                            "accept-category",
                            tr("data.applyRange"),
                            c,
                            self.valid_category_name(cx),
                        )
                        .on_click(cx.listener(|t, _, win, cx| t.accept_category_name(win, cx))),
                    ),
            );
        let view = cx.weak_entity();
        quietpro::modal_dialog(
            title,
            self.category_editor_focus.clone(),
            content,
            move |win, cx| {
                let _ = view.update(cx, |t, cx| t.dismiss_category_layer(win, cx));
            },
            cx,
        )
        .layer(1, true)
    }
}

#[cfg(test)]
mod tests {
    use super::compare_names;
    use std::cmp::Ordering;

    #[test]
    fn category_names_follow_locale_alphabetical_order() {
        let mut names = [
            "创作", "办公", "学习", "工具", "开发", "影音", "浏览", "游戏", "社交",
        ];
        let locale = patina_activity_model::Locale::from_tag(Some("zh-CN"));
        names.sort_by(|a, b| compare_names(locale, a, b));
        assert_eq!(
            names,
            [
                "办公", "创作", "工具", "开发", "浏览", "社交", "学习", "影音", "游戏"
            ]
        );
        assert_eq!(compare_names(locale, "阿尔法", "办公"), Ordering::Less);
        let locale = patina_activity_model::Locale::from_tag(Some("en-US"));
        assert_eq!(compare_names(locale, "alpha", "Browser"), Ordering::Less);
        assert_eq!(compare_names(locale, "office", "Office"), Ordering::Equal);
    }
}
