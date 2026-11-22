use super::{Control, Tools, panel::action_label};
use gpui_kit::{base::Popover, prelude::*, *};
use patina_desktop_protocol::tools::Capability;
use patina_desktop_protocol::tools::layout::{
    Arrangement, Condition, Editor, Field, Form, Summary,
};
use quietpro::{ControlSize, Icon, Palette};

pub(super) fn field_group(title: &str, c: Palette, bold: bool) -> Div {
    div()
        .min_w_0()
        .flex()
        .flex_col()
        .gap(px(quietpro::SUBHEADING_GAP))
        .child(
            quietpro::settings_row_label(title.to_owned())
                .text_color(if bold { c.text } else { c.secondary })
                .when(bold, |label| label.font_weight(FontWeight::BOLD)),
        )
}
fn binding<'a>(controls: &'a [Control], key: &str) -> Option<&'a Control> {
    controls
        .iter()
        .find(|v| matches!(v,Control::Select{id,..}|Control::Input{id,..} if id==key))
}

#[derive(Clone, Copy)]
pub(super) enum FieldSizing {
    Inline,
    Full,
    Declared,
}

fn declared_size<E: Styled + FluentBuilder>(element: E, field: &Field) -> E {
    element
        .when_some(field.width, |e, w| e.w(px(f32::from(w))))
        .when(field.grow, |e| e.flex_grow(1.))
        .when_some(field.weight, |e, w| {
            e.flex_basis(px(0.)).flex_grow(f32::from(w))
        })
}

#[derive(Clone, Copy)]
pub(super) struct PanelView<'a> {
    pub controls: &'a [Control],
    pub colors: Palette,
    pub ready: bool,
    pub in_popover: bool,
}
impl Tools {
    pub(super) fn is_task_form(&self) -> bool {
        self.selected.as_ref().is_some_and(|tool| {
            tool.manifest
                .capabilities
                .iter()
                .any(|capability| matches!(capability, Capability::Reminders | Capability::Focus))
        })
    }

    pub(super) fn form_heading(&self, form: &Form, c: Palette) -> Stateful<Div> {
        quietpro::group_heading(form.heading.clone()).when(self.is_task_form(), |heading| {
            heading.text_color(c.secondary)
        })
    }

    pub(super) fn form_button(
        &self,
        id: impl Into<ElementId>,
        label: impl Into<SharedString>,
        c: Palette,
        enabled: bool,
    ) -> gpui_kit::base::Button {
        if self.is_task_form() {
            quietpro::text_button_with_radius(id, label, c, enabled, px(16.))
        } else {
            quietpro::text_button(id, label, c, enabled)
        }
    }

    pub(super) fn form_value_size(&self) -> Pixels {
        px(if self.is_task_form() { 14. } else { 12. })
    }

    fn field_value(&self, key: &str, controls: &[Control], cx: &App) -> String {
        if let Some(s) = self.inputs.get(key) {
            return s.read(cx).value().to_string();
        }
        if let Some(s) = self.choices.get(key) {
            return s.clone();
        }
        match binding(controls, key) {
            Some(Control::Select { value, .. } | Control::Input { value, .. }) => value.clone(),
            _ => String::new(),
        }
    }
    fn matches_condition(&self, when: &Option<Condition>, controls: &[Control], cx: &App) -> bool {
        when.as_ref()
            .is_none_or(|v| self.field_value(&v.field, controls, cx) == v.equals)
    }
    fn summary(&self, variants: &[Summary], controls: &[Control], cx: &App) -> String {
        let Some(v) = variants
            .iter()
            .find(|s| self.matches_condition(&s.when, controls, cx))
        else {
            return String::new();
        };
        let mut rest = v.template.as_str();
        let mut value = String::new();
        while let Some((prefix, tail)) = rest.split_once('{')
            && let Some((key, suffix)) = tail.split_once('}')
        {
            value.push_str(prefix);
            value.push_str(&self.field_value(key, controls, cx));
            rest = suffix;
        }
        value.push_str(rest);
        value
    }
    pub(super) fn render_form(
        &mut self,
        form: &Form,
        controls: &[Control],
        c: Palette,
        ready: bool,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let view = PanelView {
            controls,
            colors: c,
            ready,
            in_popover: false,
        };
        let mut fields = div()
            .flex()
            .flex_wrap()
            .items_end()
            .gap(px(quietpro::SECTION_GROUP_GAP));
        for field in &form.fields {
            if let Some(element) = self.render_field(field, FieldSizing::Inline, view, win, cx) {
                fields = fields.child(element);
            }
        }
        fields = fields.children(self.submit_button(form, view, cx));
        fields = fields.children(self.cancel_button(form, view, cx));
        quietpro::content_card(c.border, c.canvas)
            .flex_none()
            .gap(px(quietpro::SUBHEADING_GAP))
            .child(self.form_heading(form, c))
            .child(fields)
    }
    pub(super) fn submit_button(
        &self,
        form: &Form,
        view: PanelView<'_>,
        cx: &Context<Self>,
    ) -> Option<gpui_kit::base::Button> {
        let key = form.submit.clone();
        let caption = action_label(view.controls, &key)?;
        let ready = view.ready
            && form.fields.iter().all(|field| {
                !matches!(field.editor, Editor::ActivityTarget)
                    || self
                        .choices
                        .get(&field.id)
                        .is_some_and(|value| !value.is_empty())
            });
        Some(
            self.form_button("page-submit", caption.to_owned(), view.colors, ready)
                .text_size(self.form_value_size())
                .font_weight(FontWeight::MEDIUM)
                .on_click(cx.listener(move |t, _, _, cx| t.submit(&key, cx))),
        )
    }
    pub(super) fn cancel_button(
        &self,
        form: &Form,
        view: PanelView<'_>,
        cx: &Context<Self>,
    ) -> Option<gpui_kit::base::Button> {
        let key = form.cancel.as_ref()?;
        let caption = action_label(view.controls, key)?.to_owned();
        let id = SharedString::from(format!("action-{key}"));
        let button = self
            .form_button(id, caption, view.colors, view.ready)
            .when(self.is_task_form(), |button| {
                button.font_weight(FontWeight::MEDIUM)
            });
        let key = key.clone();
        Some(button.on_click(cx.listener(move |t, _, _, cx| t.load(Some(key.clone()), cx))))
    }
    pub(super) fn render_field(
        &mut self,
        field: &Field,
        sizing: FieldSizing,
        view: PanelView<'_>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let PanelView {
            controls,
            colors: c,
            ready,
            in_popover,
        } = view;
        let task_popover = in_popover && self.is_task_form();
        if !self.matches_condition(&field.visible, controls, cx) {
            return None;
        }
        let key = &field.id;
        if let Editor::Group {
            label,
            arrangement,
            fields,
        } = &field.editor
        {
            let grid = self.field_grid(arrangement, fields, view, win, cx);
            return Some(
                div()
                    .id(SharedString::from(format!("group-{key}")))
                    .flex()
                    .flex_col()
                    .gap(px(quietpro::SUBHEADING_GAP))
                    .when(!label.is_empty(), |d| {
                        d.child(quietpro::group_heading(label.clone()))
                    })
                    .child(grid)
                    .when(matches!(sizing, FieldSizing::Declared), |group| {
                        declared_size(group, field)
                    })
                    .into_any_element(),
            );
        }
        let (title, element) = match (&field.editor, binding(controls, key)) {
            (
                Editor::Popover {
                    label,
                    summaries,
                    arrangement,
                    width,
                    fields,
                },
                _,
            ) => {
                let title = label.clone();
                let summary = self.summary(summaries, controls, cx);
                let focus = self.panel.field_focus(key, cx);
                let open = ready && self.panel.expanded.as_ref() == Some(key);
                let trigger = self
                    .form_button(
                        SharedString::from(format!("open-{key}")),
                        summary.clone(),
                        c,
                        ready,
                    )
                    .role(Role::ComboBox)
                    .accessibility_label(title.clone())
                    .aria_value(summary)
                    .aria_expanded(open)
                    .track_focus(&focus)
                    .w_full()
                    .justify_between()
                    .text_size(self.form_value_size())
                    .font_weight(FontWeight::MEDIUM)
                    .child(
                        quietpro::glyph(
                            if open {
                                Icon::ChevronUp
                            } else {
                                Icon::ChevronDown
                            },
                            c.secondary,
                        )
                        .size(px(12.)),
                    );
                let id = key.clone();
                let mut popup = Popover::new(SharedString::from(format!("popup-{key}")))
                    .open(open)
                    .anchor(Anchor::TopLeft)
                    .offset(px(4.))
                    .trigger(trigger)
                    .on_open_change(cx.listener(move |t, open, win, cx| {
                        if *open {
                            t.panel.expanded = Some(id.clone());
                        } else {
                            t.panel.close_picker();
                            win.focus(&focus, cx);
                            if std::mem::take(&mut t.refresh_pending) {
                                t.background_refresh(cx);
                            }
                        }
                        cx.notify();
                    }));
                if open {
                    let mut width = px(f32::from(*width));
                    if self.is_task_form() {
                        for field in fields {
                            if matches!(field.editor, Editor::Segments)
                                && let Some(Control::Select { choices, .. }) =
                                    binding(controls, &field.id)
                            {
                                let segments = quietpro::medium_segmented_width(
                                    choices.iter().map(|(_, label)| label.as_str()),
                                    self.form_value_size(),
                                    win,
                                );
                                let inset = px(quietpro::CONTENT_INSET);
                                width = width.max(segments + (inset + px(1.)) * 2. + inset);
                            }
                        }
                    }
                    let body = quietpro::content_card(c.border, c.panel)
                        .w(width)
                        .max_w(win.viewport_size().width - px(16.))
                        .child(self.field_grid(
                            arrangement,
                            fields,
                            PanelView {
                                in_popover: true,
                                ..view
                            },
                            win,
                            cx,
                        ))
                        .occlude()
                        .into_any_element();
                    popup = popup.content(move |_, _, _| body);
                }
                (title, popup.into_any_element())
            }
            (
                Editor::Text {
                    placeholder,
                    unit,
                    label_from,
                },
                Some(Control::Input { label, value, .. }),
            ) => {
                let mut title = label.clone();
                if let Some(source) = label_from
                    && let Some(Control::Select { choices, .. }) = binding(controls, source)
                {
                    let selected = self.field_value(source, controls, cx);
                    if let Some((_, name)) = choices.iter().find(|(k, _)| *k == selected) {
                        title = name.clone();
                    }
                }
                let input = self.input(key, &title, value, placeholder, win, cx);
                let editor = quietpro::TextInput::new(
                    SharedString::from(format!("tool-input-{key}")),
                    &input,
                    c,
                )
                .when(task_popover, |e| e.value_weight(FontWeight::MEDIUM))
                .when(!placeholder.is_empty(), |e| {
                    e.placeholder_text_size(px(12.))
                })
                .when(!unit.is_empty(), |e| {
                    e.suffix(
                        quietpro::caption(unit.clone(), c)
                            .when(task_popover, |unit| {
                                unit.text_size(px(14.)).font_weight(FontWeight::MEDIUM)
                            })
                            .pr(px(8.))
                            .whitespace_nowrap(),
                    )
                })
                .disabled(!ready);
                (
                    title,
                    div().w_full().flex().child(editor).into_any_element(),
                )
            }
            (Editor::DateTime, Some(Control::Input { label, value, .. })) => (
                label.clone(),
                self.schedule_fields(key, label, value, c, ready, cx)
                    .into_any_element(),
            ),
            (Editor::ActivityTarget, Some(Control::Input { label, .. })) => (
                label.clone(),
                self.activity_target_field(key, label, view, win, cx),
            ),
            (Editor::Duration { max_minutes }, Some(Control::Input { label, value, .. })) => (
                label.clone(),
                self.interval_field(key, label, value, *max_minutes, view, cx)
                    .into_any_element(),
            ),
            (
                Editor::Select { .. } | Editor::Segments,
                Some(Control::Select {
                    label,
                    value,
                    choices,
                    ..
                }),
            ) => {
                let selected = self
                    .choices
                    .entry(key.clone())
                    .or_insert_with(|| value.clone());
                let index = choices
                    .iter()
                    .position(|(k, _)| k == selected)
                    .unwrap_or_default();
                let keys: Vec<_> = choices.iter().map(|(k, _)| k.clone()).collect();
                let id = key.clone();
                let clear = match &field.editor {
                    Editor::Select {
                        clear_on_change, ..
                    } => clear_on_change.clone(),
                    _ => None,
                };
                let weak = cx.weak_entity();
                let choose = move |i: usize, _: &mut Window, cx: &mut App| {
                    let _ = weak.update(cx, |t, cx| {
                        if t.choices.insert(id.clone(), keys[i].clone()).as_ref() != Some(&keys[i])
                            && let Some(k) = &clear
                        {
                            t.inputs.remove(k);
                            t.choices.remove(k);
                        }
                        cx.notify();
                    });
                };
                let group_id = SharedString::from(format!("choice-{key}"));
                if matches!(field.editor, Editor::Segments) {
                    let opts = choices
                        .iter()
                        .enumerate()
                        .map(|(i, (v, name))| {
                            (
                                i,
                                name.clone(),
                                None,
                                self.panel.field_focus(&format!("segment:{key}:{v}"), cx),
                            )
                        })
                        .collect::<Vec<_>>();
                    let segments = quietpro::segmented_with_medium_labels(
                        (group_id, label.clone()),
                        opts,
                        index,
                        ready,
                        c,
                        ControlSize::Medium,
                        choose,
                    )
                    .text_size(self.form_value_size());
                    return Some(
                        segments
                            .when(matches!(sizing, FieldSizing::Declared), |e| {
                                declared_size(e, field)
                            })
                            .into_any_element(),
                    );
                }
                let subdued = matches!(field.editor, Editor::Select { subdued: true, .. });
                let select = quietpro::Dropdown::new(
                    group_id,
                    label.clone(),
                    choices
                        .iter()
                        .enumerate()
                        .map(|(i, (_, name))| (i, name.clone())),
                    index,
                    c,
                    choose,
                )
                .trigger_size(ControlSize::Large)
                .when(field.weight.is_some(), |select| select.fill_width())
                .selected_option_color(c.text)
                .when(self.is_task_form() || subdued, |select| {
                    select.medium_labels(self.form_value_size())
                })
                .when(subdued, |select| select.subdued_value())
                .disabled(!ready);
                (label.clone(), select.into_any_element())
            }
            _ => return None,
        };
        let group = field_group(&title, c, self.is_task_form() && !in_popover)
            .id(SharedString::from(format!("field-{key}")))
            .child(element);
        let group = match sizing {
            FieldSizing::Full => group.w_full(),
            FieldSizing::Inline if field.grow => group.w(px(184.)).flex_grow(1.),
            FieldSizing::Inline if matches!(field.editor, Editor::Text { .. }) => group.w(px(104.)),
            FieldSizing::Inline => group.items_start(),
            FieldSizing::Declared => declared_size(group, field),
        };
        Some(group.into_any_element())
    }
    fn field_grid(
        &mut self,
        arrangement: &Arrangement,
        fields: &[Field],
        view: PanelView<'_>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let columns = match arrangement {
            Arrangement::Layout(layout) => {
                return self.compose(
                    layout,
                    super::composition::Scope::Fields(fields),
                    view,
                    win,
                    cx,
                );
            }
            Arrangement::Columns(columns) => *columns,
        };
        let mut grid = if columns == 1 {
            div()
                .flex()
                .flex_col()
                .items_start()
                .gap(px(quietpro::SUBHEADING_GAP))
        } else {
            div()
                .grid()
                .grid_cols(u16::from(columns))
                .gap(px(quietpro::SECTION_GROUP_GAP))
        };
        for f in fields {
            if let Some(e) = self.render_field(f, FieldSizing::Full, view, win, cx) {
                grid = grid.child(e);
            }
        }
        grid
    }
}
