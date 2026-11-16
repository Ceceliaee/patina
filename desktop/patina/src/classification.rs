use quietpro::{APP_CARD_GAP, content_card, heading, page, page_actions, page_title_row};
mod card;
mod category_manager;
use card::Card;
mod color_picker;

use crate::{
    page_controls::{label, save_status},
    window_process::Query,
    windows_host::Client,
};
use gpui_kit::{
    base::input::{InputAccessibility, InputEvent, InputState},
    prelude::*,
    *,
};
use patina_recorder::{Rules, text};
use quietpro::{Icon, text_button};
use std::{collections::BTreeMap, rc::Rc, sync::Arc};
#[derive(Clone)]
struct AppIcon {
    image: Arc<Image>,
    color: Option<u32>,
}
pub(super) struct Classification {
    focus: FocusHandle,
    client: Rc<Client>,
    rules: Option<Rules>,
    read: Option<Task<()>>,
    icons: BTreeMap<String, AppIcon>,
    icons_loading: bool,
    pending: BTreeMap<String, Card>,
    search: Entity<InputState>,
    editing_name: Option<String>,
    rename_focus: BTreeMap<String, FocusHandle>,
    category_edits: BTreeMap<String, patina_recorder::CategoryEdit>,
    category_manager: bool,
    category_editing: bool,
    category_confirmation: Option<(String, String)>,
    category_picker: Option<(String, Entity<color_picker::ColorPicker>)>,
    category_focus: BTreeMap<String, FocusHandle>,
    category_title_focus: FocusHandle,
    category_editor_focus: FocusHandle,
    category_trigger_focus: FocusHandle,
    category_cancel_focus: FocusHandle,
    category_id: Option<String>,
    category_name: Entity<InputState>,
    category_filter: Option<String>,
    color_picker: Option<(String, Entity<color_picker::ColorPicker>)>,
    color_focus: BTreeMap<String, FocusHandle>,

    name: Entity<InputState>,
    web: bool,
    mode_initialized: bool,
    mode_focus: [FocusHandle; 2],
    filter: usize,
    filter_focus: [FocusHandle; 4],
    busy: bool,
    error: bool,
    deleting: Option<Card>,
    delete_failed: bool,
    delete_impact: Option<patina_recorder::DeletionImpact>,
    delete_cancel: FocusHandle,
    delete_focus: BTreeMap<String, FocusHandle>,
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
        search.update(cx, |input, cx| {
            input.set_placeholder(
                text(client.locale.get(), "mapping.appSearchPlaceholder"),
                win,
                cx,
            );
        });
        cx.observe(&category_name, |_, _, cx| cx.notify()).detach();
        cx.subscribe_in(&category_name, win, |this, _, event, win, cx| {
            if matches!(event, InputEvent::PressEnter { .. }) {
                this.accept_category_name(win, cx);
            }
        })
        .detach();
        let name = field("mapping.editAppName", win, cx);
        for input in [&name, &category_name] {
            cx.subscribe(input, |_, _, event, cx| {
                if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                    cx.notify();
                }
            })
            .detach();
        }
        name.update(cx, |input, cx| {
            input.set_validator(|value, _| value.trim().encode_utf16().count() <= 80, cx)
        });
        cx.observe(&name, |_, _, cx| cx.notify()).detach();
        cx.subscribe_in(&name, win, |this, input, event, win, cx| match event {
            InputEvent::PressEnter { .. } => {
                if let Some(exe) = this.finish_name(cx) {
                    this.focus_rename(&exe, win, cx);
                }
            }
            InputEvent::Blur if !input.read(cx).focus_handle(cx).is_focused(win) => {
                this.finish_name(cx);
            }
            _ => {}
        })
        .detach();
        cx.observe(&search, |_, _, cx| cx.notify()).detach();
        cx.subscribe(&search, |_, _, event, cx| {
            if matches!(
                event,
                gpui_kit::base::input::InputEvent::Focus | gpui_kit::base::input::InputEvent::Blur
            ) {
                cx.notify();
            }
        })
        .detach();
        let mut this = Self {
            focus: cx.focus_handle(),
            client,
            rules: None,
            read: None,
            icons: BTreeMap::new(),
            icons_loading: true,
            pending: BTreeMap::new(),
            search,
            editing_name: None,
            rename_focus: BTreeMap::new(),
            category_name,
            category_manager: false,
            category_editing: false,
            category_confirmation: None,
            category_picker: None,
            category_focus: BTreeMap::new(),
            category_title_focus: cx.focus_handle(),
            category_editor_focus: cx.focus_handle(),
            category_trigger_focus: cx.focus_handle(),
            category_cancel_focus: cx.focus_handle(),
            category_id: None,
            category_edits: BTreeMap::new(),
            category_filter: None,
            color_picker: None,
            color_focus: BTreeMap::new(),
            name,
            web: false,
            mode_initialized: false,
            mode_focus: std::array::from_fn(|_| cx.focus_handle()),
            filter: 0,
            filter_focus: std::array::from_fn(|_| cx.focus_handle()),
            busy: false,
            error: false,
            deleting: None,
            delete_failed: false,
            delete_impact: None,
            delete_cancel: cx.focus_handle(),
            delete_focus: BTreeMap::new(),
        };
        this.reload(cx);
        this
    }
    fn reload(&mut self, cx: &mut Context<Self>) {
        self.icons_loading = true;
        let read = self.client.request::<Rules>(Query::Rules);
        let client = self.client.clone();
        self.read = Some(cx.spawn(async move |view, cx| {
            let res = read.await;
            let keys = res
                .as_ref()
                .ok()
                .map(|r| r.apps.iter().map(|a| a.exe.clone()).collect::<Vec<_>>());
            let _ = view.update(cx, |this, cx| {
                match res {
                    Ok(r) => {
                        this.icons
                            .retain(|key, _| r.apps.iter().any(|a| &a.exe == key));
                        this.rules = Some(r);
                        this.error = false;
                    }
                    Err(_) => {
                        this.error = true;
                        this.icons_loading = false;
                    }
                }
                cx.notify();
            });
            let Some(keys) = keys else { return };
            match client.icons(keys).await {
                Ok(images) => {
                    let Ok(mut cached) = view.update(cx, |this, _| {
                        this.icons.values().cloned().collect::<Vec<_>>()
                    }) else {
                        return;
                    };
                    let icons = cx
                        .background_executor()
                        .spawn(async move {
                            let mut resolved = BTreeMap::new();
                            for (key, bytes) in images {
                                let icon = if let Some(icon) =
                                    cached.iter().find(|icon| icon.image.bytes == bytes)
                                {
                                    icon.clone()
                                } else {
                                    let icon = AppIcon {
                                        color: patina_recorder::icon_color(&bytes),
                                        image: Arc::new(Image::from_bytes(ImageFormat::Png, bytes)),
                                    };
                                    cached.push(icon.clone());
                                    icon
                                };
                                resolved.insert(key, icon);
                            }
                            resolved
                        })
                        .await;
                    let _ = view.update(cx, |this, cx| {
                        this.icons = icons;
                        this.icons_loading = false;
                        cx.notify();
                    });
                }
                Err(error) => {
                    eprintln!("read classification icons: {error}");
                    let _ = view.update(cx, |this, cx| {
                        this.icons_loading = false;
                        cx.notify();
                    });
                }
            }
        }));
    }
    fn name_rule(&self, key: &str) -> Option<Card> {
        self.pending.get(key).cloned().or_else(|| {
            let rules = self.rules.as_ref()?;
            rules
                .apps
                .iter()
                .cloned()
                .map(Card::from)
                .chain(rules.websites.iter().cloned().map(Card::from))
                .find(|card| card.key == key)
        })
    }
    fn finish_name(&mut self, cx: &mut Context<Self>) -> Option<String> {
        let exe = self.editing_name.take()?;
        let name = self.name.read(cx).value().trim().to_owned();
        if let Some(mut rule) = self.name_rule(&exe)
            && rule.name != name
        {
            rule.name = name;
            self.pending.insert(exe.clone(), rule);
        }
        cx.notify();
        Some(exe)
    }
    fn focus_rename(&self, exe: &str, win: &mut Window, cx: &mut Context<Self>) {
        let query = self.search.read(cx).value().to_lowercase();
        if self.name_rule(exe).is_some_and(|a| a.matches_query(&query)) {
            if let Some(focus) = self.rename_focus.get(exe) {
                win.focus(focus, cx);
            }
        } else {
            self.search.update(cx, |input, cx| input.focus(win, cx));
        }
    }
    pub(super) fn dirty(&self, cx: &App) -> bool {
        !self.pending.is_empty()
            || !self.category_edits.is_empty()
            || self.busy
            || self
                .editing_name
                .as_ref()
                .and_then(|exe| self.name_rule(exe))
                .is_some_and(|rule| self.name.read(cx).value().trim() != rule.name)
    }
    pub(super) fn save(&mut self, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.finish_name(cx);
        self.color_picker = None;
        self.busy = true;
        let write = self.client.request::<()>(Query::SaveRules(
            self.pending
                .values()
                .map(|a| self.effective_rule(a))
                .filter_map(|a| a.app_rule())
                .collect(),
            self.pending
                .values()
                .map(|a| self.effective_rule(a))
                .filter_map(|a| a.web_rule())
                .collect(),
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
                    this.editing_name = None;
                    this.reload(cx);
                    cx.emit(crate::main_window::Saved);
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    fn close_delete(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        if let Some(rule) = self.deleting.take()
            && let Some(focus) = self.delete_focus.get(&rule.key)
        {
            win.focus(focus, cx);
        }
        self.delete_failed = false;
        self.delete_impact = None;
        cx.notify();
    }
    fn delete_application(&mut self, apply: bool, win: &mut Window, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        let Some(rule) = self.deleting.as_ref() else {
            return;
        };
        if apply && self.delete_impact.is_none() {
            return;
        }
        let confirmed = if apply {
            self.delete_impact.take()
        } else {
            None
        };
        let query = match &rule.source {
            card::Source::App(app) => Query::DeleteApplication(app.exe.clone(), confirmed),
            card::Source::Web(site) => Query::DeleteWebsite(site.identity.clone(), confirmed),
        };
        let request = self
            .client
            .request::<patina_recorder::DeletionImpact>(query);
        self.busy = true;
        self.delete_failed = false;
        cx.spawn_in(win, async move |view, cx| {
            let result = request.await;
            let _ = view.update_in(cx, |this, win, cx| {
                this.busy = false;
                this.delete_failed = result.is_err();
                if let Ok(impact) = result {
                    if apply {
                        this.deleting = None;
                        this.search.update(cx, |input, cx| input.focus(win, cx));
                        this.reload(cx);
                        cx.emit(crate::main_window::Saved);
                    } else {
                        this.delete_impact = Some(impact);
                    }
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
