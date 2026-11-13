use crate::{
    page_controls::{
        APP_CARD_GAP, action, content_card, heading, label, page, page_actions, page_title_row,
        panel, save_status,
    },
    window_process::Query,
    windows_host::Client,
};
use gpui_kit::{
    base::{
        Input,
        input::{InputAccessibility, InputState},
    },
    prelude::*,
    *,
};
use patina_recorder::{AppRule, Rules, text};
use quietpro::{Icon, text_button};
use std::{collections::BTreeMap, rc::Rc};
pub(super) struct Classification {
    focus: FocusHandle,
    client: Rc<Client>,
    rules: Option<Rules>,
    pending: BTreeMap<String, AppRule>,
    search: Entity<InputState>,
    active: Option<String>,
    category_edits: BTreeMap<String, patina_recorder::CategoryEdit>,
    category_manager: bool,
    category_id: Option<String>,
    category_name: Entity<InputState>,
    category_filter: Option<String>,
    filter_menu: bool,

    name: Entity<InputState>,
    color: Entity<InputState>,
    filter: u8,
    busy: bool,
    error: bool,
}
impl Classification {
    pub(super) fn new(client: Rc<Client>, win: &mut Window, cx: &mut Context<Self>) -> Self {
        let field = |key: &str, win: &mut Window, cx: &mut Context<Self>| {
            let label = text(client.locale.get(), key);
            cx.new(|cx| {
                let mut f = InputState::new(win, cx);
                f.set_accessibility(
                    InputAccessibility::new(Some(Role::TextInput)).with_label(Some(label.into())),
                );
                f
            })
        };
        let category_name = field("mapping.renameCategoryPlaceholder", win, cx);
        let search = field("mapping.appSearchPlaceholder", win, cx);
        let name = field("mapping.editAppName", win, cx);
        let color = field("mapping.color", win, cx);
        cx.observe(&search, |_, _, cx| cx.notify()).detach();
        let mut this = Self {
            focus: cx.focus_handle(),
            client,
            rules: None,
            pending: BTreeMap::new(),
            search,
            active: None,
            category_name,
            category_manager: false,
            category_id: None,
            category_edits: BTreeMap::new(),
            category_filter: None,
            filter_menu: false,
            name,
            color,
            filter: 0,
            busy: false,
            error: false,
        };
        this.reload(cx);
        this
    }
    fn reload(&mut self, cx: &mut Context<Self>) {
        let read = self.client.request::<Rules>(Query::Rules);
        cx.spawn(async move |view, cx| {
            let res = read.await;
            let _ = view.update(cx, |this, cx| {
                match res {
                    Ok(r) => {
                        this.rules = Some(r);
                        this.error = false;
                    }
                    Err(_) => this.error = true,
                }
                cx.notify();
            });
        })
        .detach();
    }
    pub(super) fn dirty(&self) -> bool {
        !self.pending.is_empty() || !self.category_edits.is_empty() || self.busy
    }
    pub(super) fn save(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.busy = true;
        let write = self.client.request::<()>(Query::SaveRules(
            self.pending.values().cloned().collect(),
            self.category_edits.values().cloned().collect(),
        ));
        cx.spawn(async move |view, cx| {
            let res = write.await;
            let _ = view.update(cx, |this, cx| {
                this.busy = false;
                this.error = res.is_err();
                if res.is_ok() {
                    this.pending.clear();
                    this.category_edits.clear();
                    this.active = None;
                    this.reload(cx);
                    cx.emit(crate::main_window::Saved);
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
}
impl Render for Classification {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let c = self.client.palette(win);
        let locale = self.client.locale.get();
        let tr = |k| text(locale, k);
        let can_apply = self.dirty() && !self.busy;
        let actions = page_actions()
            .when(self.rules.is_some(), |row| {
                row.child(save_status(
                    tr(if self.busy {
                        "common.saving"
                    } else if can_apply {
                        "mapping.unsaved"
                    } else {
                        "common.saved"
                    }),
                    c,
                ))
            })
            .child(
                text_button("cancel", tr("common.cancel"), c, can_apply).on_click(cx.listener(
                    |t, _, _, cx| {
                        t.pending.clear();
                        t.category_edits.clear();
                        t.active = None;
                        cx.notify();
                    },
                )),
            )
            .child(
                text_button("save", tr("common.save"), c, can_apply)
                    .on_click(cx.listener(|t, _, _, cx| t.save(cx))),
            );
        let mut body =
            page(c).child(page_title_row(tr("mapping.title"), Icon::Sparkles, c).child(actions));
        if self.error {
            body = body.child(action(
                "retry",
                tr("common.retry"),
                tr("common.retry"),
                true,
                cx.listener(|t, _, _, cx| t.reload(cx)),
            ));
        }
        let Some(rules) = &self.rules else {
            return body.child(label(tr("common.loading")));
        };
        let mut categories = rules.categories.clone();
        for change in self.category_edits.values() {
            if let Some(c) = categories.iter_mut().find(|c| c.0 == change.id) {
                c.1 = change.label.clone();
            } else {
                categories.push((change.id.clone(), change.label.clone()));
            }
        }
        let mut tools = div().flex().items_center().gap(px(6.));
        for (i, key) in [
            "mapping.filters.all",
            "mapping.filters.classified",
            "mapping.filters.other",
            "mapping.excludeStats",
        ]
        .iter()
        .enumerate()
        {
            let k = *key;
            tools = tools.child(action(
                k,
                tr(k),
                tr(k),
                self.filter != i as u8,
                cx.listener(move |t, _, _, cx| {
                    t.filter = i as u8;
                    cx.notify();
                }),
            ));
        }
        tools = tools.child(div().w(px(200.)).h(px(32.)).child(Input::new(&self.search)));
        tools = tools.child(div().flex_1()).child(action(
            "manage-categories",
            tr("mapping.categoryDialogTitle"),
            tr("mapping.categoryDialogTitle"),
            !self.busy,
            cx.listener(|t, _, win, cx| {
                t.category_manager = true;
                t.category_id = None;
                t.category_name.update(cx, |f, cx| f.set_value("", win, cx));
                win.focus(&t.focus, cx);
                cx.notify();
            }),
        ));
        tools = tools.child(
            quietpro::IconControl::new(
                "category-filter",
                tr("mapping.categoryFilter"),
                Icon::Layers,
            )
            .action(
                c,
                cx.listener(|t, _, _, cx| {
                    t.filter_menu = !t.filter_menu;
                    cx.notify();
                }),
            ),
        );
        if self.filter_menu {
            let mut choices = div().flex().flex_wrap().gap(px(3.)).child(action(
                "all-categories",
                tr("mapping.filters.all"),
                tr("mapping.filters.all"),
                true,
                cx.listener(|t, _, _, cx| {
                    t.category_filter = None;
                    t.filter_menu = false;
                    cx.notify();
                }),
            ));
            for (id, n) in &categories {
                let k = id.clone();
                choices = choices.child(action(
                    SharedString::from(format!("filter-{id}")),
                    n.clone(),
                    n.clone(),
                    true,
                    cx.listener(move |t, _, _, cx| {
                        t.category_filter = Some(k.clone());
                        t.filter_menu = false;
                        cx.notify();
                    }),
                ));
            }
            body = body.child(choices);
        }
        let query = self.search.read(cx).value().to_lowercase();
        let mut grid = div()
            .id("rule-grid")
            .min_h_0()
            .flex_1()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(APP_CARD_GAP));
        let visible: Vec<_> = rules
            .apps
            .iter()
            .map(|a| self.pending.get(&a.exe).unwrap_or(a))
            .filter(|a| {
                (a.name.to_lowercase().contains(&query) || a.exe.contains(&query))
                    && self
                        .category_filter
                        .as_ref()
                        .is_none_or(|k| *k == a.category)
                    && match self.filter {
                        1 => a.category != "other",
                        2 => a.category == "other",
                        3 => !a.track,
                        _ => true,
                    }
            })
            .collect();
        for pair in visible.chunks(2) {
            let mut row = div().grid().grid_cols(2).gap(px(APP_CARD_GAP));
            for a in pair {
                let draft = (*a).clone();
                let category = categories
                    .iter()
                    .find(|v| v.0 == a.category)
                    .map_or(a.category.as_str(), |v| &v.1);
                let edit = |t: &mut Self, win: &mut Window, cx: &mut Context<Self>, v: &AppRule| {
                    t.name
                        .update(cx, |f, cx| f.set_value(v.name.clone(), win, cx));
                    t.color
                        .update(cx, |f, cx| f.set_value(v.color.clone(), win, cx));
                    t.active = Some(v.exe.clone());
                    win.focus(&t.focus, cx);
                    cx.notify();
                };
                let identity = draft.clone();
                let name_action = draft.clone();
                let color_action = draft.clone();
                let mut track = draft.clone();
                track.track = !track.track;
                let mut titles = draft.clone();
                titles.titles = !titles.titles;
                let icon = div()
                    .size(px(40.))
                    .rounded(px(8.))
                    .border_1()
                    .border_color(c.border)
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(
                        label(a.name.chars().next().unwrap_or('·').to_string()).id("app-initial"),
                    );
                let details = div()
                    .min_w_0()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .gap(px(4.))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .child(heading(a.name.clone()).id("app-name").truncate())
                            .child(
                                quietpro::IconControl::new(
                                    "rename",
                                    tr("mapping.editAppName"),
                                    Icon::Pencil,
                                )
                                .action(
                                    c,
                                    cx.listener(move |t, _, w, cx| edit(t, w, cx, &name_action)),
                                ),
                            ),
                    )
                    .child(label(a.exe.clone()).id("app-filename").text_size(px(12.)));
                let buttons = div()
                    .flex()
                    .gap(px(4.))
                    .child(
                        quietpro::IconControl::new("color", tr("mapping.color"), Icon::Palette)
                            .action(
                                c,
                                cx.listener(move |t, _, w, cx| edit(t, w, cx, &color_action)),
                            ),
                    )
                    .child(
                        quietpro::IconControl::new(
                            "title-policy",
                            tr("mapping.titleRecorded"),
                            Icon::Type,
                        )
                        .action(
                            c,
                            cx.listener(move |t, _, _, cx| {
                                t.pending.insert(titles.exe.clone(), titles.clone());
                                cx.notify();
                            }),
                        ),
                    )
                    .child(
                        quietpro::IconControl::new(
                            "tracking-policy",
                            tr("mapping.excludeStats"),
                            Icon::EyeOff,
                        )
                        .action(
                            c,
                            cx.listener(move |t, _, _, cx| {
                                t.pending.insert(track.exe.clone(), track.clone());
                                cx.notify();
                            }),
                        ),
                    );
                let card = content_card(c.border, c.canvas)
                    .id(SharedString::from(a.exe.clone()))
                    .h(px(92.))
                    .py(px(12.) + px(1.))
                    .flex_row()
                    .items_center()
                    .gap(px(12.))
                    .child(icon)
                    .child(details)
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .items_end()
                            .gap(px(5.))
                            .child(action(
                                "classify",
                                format!("{} · {}", tr("native.export.field.category"), a.name),
                                category.to_owned(),
                                !self.busy,
                                cx.listener(move |t, _, w, cx| edit(t, w, cx, &identity)),
                            ))
                            .child(buttons),
                    );
                row = row.child(card);
            }
            grid = grid.child(row);
        }
        body = body
            .child(content_card(c.border, c.panel).flex_none().child(tools))
            .child(content_card(c.border, c.panel).flex_1().child(grid));
        if self.category_manager {
            let mut dialog = panel(c)
                .w(px(510.))
                .gap(px(10.))
                .child(heading(tr("mapping.categoryDialogTitle")));
            let mut choices = div().flex().flex_wrap().gap(px(4.));
            for (id, name) in &categories {
                let key = id.clone();
                let n = name.clone();
                choices = choices.child(action(
                    SharedString::from(format!("catalog-{id}")),
                    name.clone(),
                    name.clone(),
                    id != "other",
                    cx.listener(move |t, _, win, cx| {
                        t.category_id = Some(key.clone());
                        t.category_name
                            .update(cx, |f, cx| f.set_value(n.clone(), win, cx));
                        cx.notify();
                    }),
                ));
            }
            dialog = dialog
                .child(choices)
                .child(div().h(px(34.)).child(Input::new(&self.category_name)))
                .child(
                    div()
                        .flex()
                        .gap(px(6.))
                        .child(action(
                            "new-category",
                            tr("mapping.createCategoryAction"),
                            tr("mapping.createCategoryAction"),
                            true,
                            cx.listener(|t, _, win, cx| {
                                t.category_id = None;
                                t.category_name.update(cx, |f, cx| {
                                    f.set_value("", win, cx);
                                    f.focus(win, cx);
                                });
                                cx.notify();
                            }),
                        ))
                        .child(action(
                            "accept-category",
                            tr("data.applyRange"),
                            tr("data.applyRange"),
                            true,
                            cx.listener(|t, _, _, cx| {
                                let n = t.category_name.read(cx).value().trim().to_owned();
                                if n.is_empty() || n.encode_utf16().count() > 80 {
                                    return;
                                }
                                let id = t.category_id.clone().unwrap_or_else(|| {
                                    format!(
                                        "custom:category_{}",
                                        chrono::Utc::now()
                                            .timestamp_nanos_opt()
                                            .unwrap_or_default()
                                    )
                                });
                                let previous = t
                                    .rules
                                    .as_ref()
                                    .and_then(|r| r.categories.iter().find(|c| c.0 == id))
                                    .map(|c| c.1.clone());
                                t.category_edits.insert(
                                    id.clone(),
                                    patina_recorder::CategoryEdit {
                                        id,
                                        previous,
                                        label: n,
                                    },
                                );
                                t.category_manager = false;
                                cx.notify();
                            }),
                        ))
                        .child(action(
                            "close-categories",
                            tr("common.close"),
                            tr("common.close"),
                            true,
                            cx.listener(|t, _, _, cx| {
                                t.category_manager = false;
                                cx.notify();
                            }),
                        )),
                );
            let view = cx.weak_entity();
            return body.child(
                gpui_kit::base::Dialog::new(cx)
                    .focus_handle(self.focus.clone())
                    .accessibility_label(tr("mapping.categoryDialogTitle"))
                    .backdrop(div().size_full().bg(rgba(0x00000055)))
                    .popup(gpui_kit::base::DialogPopup::new().child(dialog))
                    .on_ok(|_, _, _| false)
                    .on_open_change(move |open, _, _, cx| {
                        if !open {
                            let _ = view.update(cx, |t, cx| {
                                t.category_manager = false;
                                cx.notify();
                            });
                        }
                    }),
            );
        }
        if let Some(a) = self.active.as_ref().and_then(|k| {
            self.pending
                .get(k)
                .or_else(|| rules.apps.iter().find(|a| &a.exe == k))
        }) {
            let draft = a.clone();
            let mut choices = div().flex().flex_wrap().gap(px(4.));
            for (id, n) in &categories {
                let mut draft = a.clone();
                draft.category = id.clone();
                choices = choices.child(action(
                    SharedString::from(id.clone()),
                    n.clone(),
                    n.clone(),
                    a.category != *id,
                    cx.listener(move |t, _, _, cx| {
                        t.pending.insert(draft.exe.clone(), draft.clone());
                        cx.notify();
                    }),
                ));
            }
            let mut editor = panel(c)
                .on_any_mouse_down(|_, _, cx| cx.stop_propagation())
                .w(px(490.))
                .gap(px(10.))
                .child(heading(a.name.clone()).id("edited-app-name"))
                .child(label(tr("mapping.editAppName")))
                .child(div().h(px(32.)).flex_none().child(Input::new(&self.name)))
                .child(label(tr("mapping.color")))
                .child(div().h(px(32.)).flex_none().child(Input::new(&self.color)))
                .child(choices);
            for (k, on) in [
                ("mapping.excludeStats", !a.track),
                ("mapping.titleRecorded", a.titles),
            ] {
                let mut v = a.clone();
                if k == "mapping.excludeStats" {
                    v.track = !v.track;
                } else {
                    v.titles = !v.titles;
                }
                editor = editor.child(action(
                    k,
                    tr(k),
                    format!("{} {}", if on { "☑" } else { "☐" }, tr(k)),
                    true,
                    cx.listener(move |t, _, _, cx| {
                        t.pending.insert(v.exe.clone(), v.clone());
                        cx.notify();
                    }),
                ));
            }
            editor = editor.child(action(
                "apply-rule",
                tr("data.applyRange"),
                tr("data.applyRange"),
                true,
                cx.listener(move |t, _, _, cx| {
                    let mut v = t.pending.get(&draft.exe).unwrap_or(&draft).clone();
                    v.name = t.name.read(cx).value().trim().to_owned();
                    v.color = t.color.read(cx).value().trim().to_owned();
                    t.pending.insert(v.exe.clone(), v);
                    t.active = None;
                    cx.notify();
                }),
            ));
            let view = cx.weak_entity();
            body = body.child(
                gpui_kit::base::Dialog::new(cx)
                    .focus_handle(self.focus.clone())
                    .accessibility_label(tr("mapping.editAppName"))
                    .backdrop(div().size_full().bg(rgba(0x00000055)))
                    .popup(gpui_kit::base::DialogPopup::new().child(editor))
                    .on_ok(|_, _, _| false)
                    .on_open_change(move |open, _, _, cx| {
                        if !open {
                            let _ = view.update(cx, |t, cx| {
                                t.active = None;
                                cx.notify();
                            });
                        }
                    }),
            );
        }
        body
    }
}

impl gpui_kit::EventEmitter<crate::main_window::Saved> for Classification {}
