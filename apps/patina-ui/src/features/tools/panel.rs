use super::{Control, Tools, clock, label, schedule::Picker, task_list_frame};
use gpui_kit::{base::Button, prelude::*, *};
use patina_desktop_protocol::tools::layout::{self, Details, Page, Row, Tab};
use quietpro::{ControlSize, Icon, IconControl, Palette};
use std::{collections::BTreeMap, rc::Rc};

pub(super) type NumberOptions = Rc<[(u32, SharedString)]>;

use super::fields::PanelView;

pub(super) struct State {
    pub tab: Option<String>,
    pub expanded: Option<String>,
    pub picker: Option<Entity<Picker>>,
    pub target_picker: Option<Entity<super::target_picker::TargetPicker>>,
    pub schedule_focus: FocusHandle,
    pub hour_options: Option<(u32, NumberOptions)>,
    handles: BTreeMap<String, FocusHandle>,
    pub opener: Option<FocusHandle>,
    close: FocusHandle,
    dialog: FocusHandle,
}
impl State {
    pub fn new(cx: &App) -> Self {
        Self {
            tab: None,
            expanded: None,
            picker: None,
            target_picker: None,
            schedule_focus: cx.focus_handle(),
            hour_options: None,
            handles: BTreeMap::new(),
            opener: None,
            close: cx.focus_handle(),
            dialog: cx.focus_handle(),
        }
    }
    pub fn field_focus(&mut self, id: &str, cx: &App) -> FocusHandle {
        self.handles
            .entry(id.into())
            .or_insert_with(|| cx.focus_handle())
            .clone()
    }
    pub fn close_picker(&mut self) {
        self.expanded = None;
        self.picker = None;
        self.target_picker = None;
    }
}
pub(super) fn layout(controls: &[Control]) -> Option<&Page> {
    controls.iter().find_map(|c| {
        if let Control::Page(p) = c {
            Some(p.as_ref())
        } else {
            None
        }
    })
}
pub(super) fn action_label<'a>(controls: &'a [Control], key: &str) -> Option<&'a str> {
    controls.iter().find_map(|c| match c {
        Control::Button { id, label } | Control::Submit { id, label } if id == key => {
            Some(label.as_str())
        }
        Control::ListRow { actions, .. } => actions
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, label)| label.as_str()),
        _ => None,
    })
}
pub(super) fn icon(i: layout::Icon) -> Icon {
    use layout::Icon as I;
    match i {
        I::Bell => Icon::Bell,
        I::BellRing => Icon::BellRing,
        I::Clock => Icon::Clock,
        I::AlarmClock => Icon::AlarmClock,
        I::ToolCase => Icon::ToolCase,
        I::Play => Icon::Play,
        I::Pause => Icon::Pause,
        I::Square => Icon::Square,
        I::Pencil => Icon::PencilLine,
        I::Trash => Icon::Trash,
        I::ToggleLeft => Icon::ToggleLeft,
        I::ToggleRight => Icon::ToggleRight,
        I::Check => Icon::Check,
    }
}
impl Tools {
    pub(super) fn render_page(
        &mut self,
        card: Div,
        page: &Page,
        view: PanelView<'_>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let PanelView {
            controls,
            colors: c,
            ready,
            ..
        } = view;
        let selection = page.selected_tab.as_deref().or(self.panel.tab.as_deref());
        let index = page
            .tabs
            .iter()
            .position(|t| Some(t.id.as_str()) == selection)
            .unwrap_or(0);
        let Some(tab) = page.tabs.get(index) else {
            return card;
        };
        if let Some(layout) = &tab.layout {
            let scope = super::composition::Scope::Page { page, index };
            let content = self
                .compose(layout, scope, view, win, cx)
                .min_h_0()
                .flex_1();
            return card.h_full().gap_0().child(content.id("page-layout"));
        }
        let header = quietpro::settings_title(c, icon(page.icon), page.title.clone())
            .flex_none()
            .children(self.page_tabs(page, index, view, cx));
        let mut card = card.h_full().child(header.id("page-header"));
        if let Some(form) = &tab.form {
            card = card.child(
                self.render_form(form, controls, c, ready, win, cx)
                    .id("page-form"),
            );
        }
        let list = self.task_list(tab, view, win, cx);
        card.child(list).when(!tab.navigation.is_empty(), |card| {
            card.child(
                quietpro::page_actions().children(
                    tab.navigation
                        .iter()
                        .filter_map(|k| self.panel_button(k, controls, c, ready, cx)),
                ),
            )
        })
    }

    pub(super) fn page_tabs(
        &mut self,
        page: &Page,
        index: usize,
        view: PanelView<'_>,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        if page.tabs.len() < 2 {
            return None;
        }
        let c = view.colors;
        let ready = view.ready;
        let ids: Vec<_> = page.tabs.iter().map(|t| t.id.clone()).collect();
        let plugin_selects = page.selected_tab.is_some();
        let options = page
            .tabs
            .iter()
            .enumerate()
            .map(|(i, t)| {
                (
                    i,
                    t.label.clone(),
                    None,
                    self.panel.field_focus(&format!("tab:{}", t.id), cx),
                )
            })
            .collect::<Vec<_>>();
        let view = cx.weak_entity();
        Some(
            quietpro::segmented_with_medium_labels(
                ("page-tabs", page.title.clone()),
                options,
                index,
                ready,
                c,
                ControlSize::Medium,
                move |i, _, cx| {
                    let _ = view.update(cx, |t, cx| {
                        t.panel.close_picker();
                        if plugin_selects && let Some(tool) = &t.selected {
                            let request = patina_desktop_protocol::tools::call::select_tab(
                                tool.manifest.id.clone(),
                                tool.generation.clone(),
                                ids[i].clone(),
                            );
                            t.run(request, |t, controls, _| t.update_panel(controls, None), cx);
                            return;
                        }
                        t.panel.tab = Some(ids[i].clone());
                        if let Some(tool) = &t.selected {
                            t.saved_tabs
                                .insert(tool.manifest.id.clone(), ids[i].clone());
                        }
                        t.error = None;
                        cx.notify();
                    });
                },
            )
            .into_any_element(),
        )
    }

    pub(super) fn task_list(
        &self,
        tab: &Tab,
        view: PanelView<'_>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let PanelView {
            controls,
            colors: c,
            ready,
            ..
        } = view;
        let mut list = div()
            .id("page-list")
            .min_h_0()
            .flex_1()
            .flex()
            .flex_col()
            .gap(px(quietpro::SUBHEADING_GAP))
            .overflow_y_scroll();
        for spec in &tab.rows {
            if let Some(row) = controls
                .iter()
                .find(|v| matches!(v,Control::ListRow{id,..} if id==&spec.id))
            {
                list = list.child(self.render_row(spec, row, c, ready, win, cx));
            }
        }
        if tab.rows.is_empty() {
            list = list.items_center().justify_center().child(
                quietpro::caption(tab.empty.clone(), c)
                    .id("page-empty")
                    .role(Role::Label)
                    .aria_value(tab.empty.clone()),
            );
        }
        task_list_frame("page-list-frame", tab.label.clone(), c).child(list)
    }
    fn render_row(
        &self,
        spec: &Row,
        control: &Control,
        c: Palette,
        ready: bool,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let Control::ListRow {
            id,
            title,
            detail,
            actions,
            clock: value,
        } = control
        else {
            return div().id("empty-row");
        };
        let mut row = quietpro::settings_row()
            .gap(px(quietpro::SUBHEADING_GAP))
            .child(
                label(title.clone())
                    .font_weight(FontWeight::MEDIUM)
                    .min_w_0()
                    .truncate(),
            );
        if let Some(value) = value {
            row = row.child(clock::row_clock(id, value, win, cx));
        }
        if let Some(key) = &spec.detail_action
            && let Some((_, caption)) = actions.iter().find(|(a, _)| a == key)
        {
            let key = key.clone();
            let opener = win
                .use_keyed_state(SharedString::from(format!("detail-{key}")), cx, |_, cx| {
                    cx.focus_handle()
                })
                .read(cx)
                .clone();
            let button = Button::new(SharedString::from(key.clone()))
                .track_focus(&opener)
                .accessibility_label(format!("{caption} ･ {title}"))
                .disabled(!ready)
                .flex()
                .items_center()
                .h(px(28.))
                .gap(px(4.))
                .cursor_pointer()
                .text_color(c.secondary)
                .hover(move |s| s.text_color(c.text))
                .focus_visible(move |s| s.bg(c.hover))
                .child(detail.clone())
                .child(quietpro::glyph(Icon::ChevronRight, c.secondary).size(px(12.)))
                .on_click(cx.listener(move |t, _, _, cx| {
                    t.panel.opener = Some(opener.clone());
                    t.load(Some(key.clone()), cx);
                }));
            row = row.child(button).child(div().flex_1());
        } else {
            row = row.child(
                quietpro::caption(detail.clone(), c)
                    .flex_1()
                    .min_w_0()
                    .truncate(),
            );
        }
        let mut buttons = quietpro::icon_actions();
        let task_form = self.is_task_form();
        for (key, i) in &spec.icons {
            if let Some((_, caption)) = actions.iter().find(|(a, _)| a == key) {
                let control = IconControl::new(
                    SharedString::from(key.clone()),
                    format!("{caption} ･ {title}"),
                    icon(*i),
                )
                .disabled(!ready);
                let button = match (task_form, i) {
                    (true, layout::Icon::Trash) => control.button(Palette {
                        secondary: c.danger,
                        ..c
                    }),
                    (true, layout::Icon::Pencil) => control
                        .with_tooltip_text(patina_i18n::messages::common_edit(
                            self.client.locale.get(),
                        ))
                        .button(c),
                    (true, _) => control.with_tooltip_text(caption.clone()).button(c),
                    (false, _) => control.with_tooltip().button(c),
                };
                let key = key.clone();
                buttons = buttons.child(
                    button.on_click(cx.listener(move |t, _, _, cx| t.load(Some(key.clone()), cx))),
                );
            }
        }
        quietpro::settings_rows_card(c)
            .id(SharedString::from(id.clone()))
            .flex_none()
            .child(row.child(buttons))
    }
    pub(super) fn panel_button(
        &self,
        key: &str,
        controls: &[Control],
        c: Palette,
        ready: bool,
        cx: &Context<Self>,
    ) -> Option<Button> {
        let key = key.to_owned();
        let caption = action_label(controls, &key)?.to_owned();
        Some(
            quietpro::text_button(
                SharedString::from(format!("action-{key}")),
                caption,
                c,
                ready,
            )
            .on_click(cx.listener(move |t, _, _, cx| t.load(Some(key.clone()), cx))),
        )
    }
    pub(super) fn details_dialog(
        &self,
        details: &Details,
        controls: &[Control],
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> quietpro::ModalDialog {
        let c = self.client.palette(win);
        let key = details.close.clone();
        let close = move |t: &mut Self, win: &mut Window, cx: &mut Context<Self>| {
            if t.busy {
                return;
            }
            if let Some(f) = t.panel.opener.take() {
                win.focus(&f, cx);
            }
            t.load(Some(key.clone()), cx);
        };
        let button_close = close.clone();
        let header = quietpro::settings_title(c, icon(details.icon), details.title.clone()).child(
            IconControl::new(
                "close-page-dialog",
                action_label(controls, &details.close)
                    .unwrap_or_default()
                    .to_owned(),
                Icon::X,
            )
            .track_focus(&self.panel.close)
            .disabled(self.busy)
            .action(
                c,
                cx.listener(move |t, _, win, cx| button_close(t, win, cx)),
            ),
        );
        let mut body = div()
            .id("page-dialog-body")
            .min_h_0()
            .flex()
            .flex_col()
            .gap(px(quietpro::SUBHEADING_GAP))
            .overflow_y_scroll();
        if let Some(e) = &self.error {
            body = body.child(label(e.clone()).role(Role::Alert));
        } else if self.busy {
            body = body.child(label(patina_i18n::text(
                self.client.locale.get(),
                "common.loading",
            )));
        } else {
            body = body.children(
                details
                    .lines
                    .iter()
                    .enumerate()
                    .map(|(index, line)| label(line.clone()).id(("dialog-line", index))),
            );
        }
        let surface = quietpro::dialog_surface(c, win.viewport_size())
            .w(px(480.))
            .child(header)
            .child(body)
            .when(!details.actions.is_empty(), |d| {
                d.child(
                    quietpro::dialog_actions().children(
                        details
                            .actions
                            .iter()
                            .filter_map(|k| self.panel_button(k, controls, c, !self.busy, cx)),
                    ),
                )
            });
        let view = cx.weak_entity();
        quietpro::modal_dialog(
            details.title.clone(),
            self.panel.dialog.clone(),
            surface,
            move |win, cx| {
                let _ = view.update(cx, |t, cx| close(t, win, cx));
            },
            cx,
        )
    }
    pub(super) fn focus_dialog(&self, win: &mut Window, cx: &mut App) {
        win.focus(&self.panel.close, cx);
    }
}
