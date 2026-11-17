use quietpro::{APP_CARD_GAP, content_card, heading, page, page_actions, page_title_row};
mod card;
mod category_manager;
use card::Card;
mod color_picker;
mod layout;
mod links;
mod web;

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
    color_format: usize,

    name: Entity<InputState>,
    web: bool,
    web_draft: Option<patina_recorder::WebDraft>,
    web_group: Option<String>,
    web_group_focus: BTreeMap<String, FocusHandle>,
    web_icons: BTreeMap<String, Option<AppIcon>>,
    favicon_read: Option<Task<()>>,
    link_edits: BTreeMap<String, patina_recorder::AppLinkEdit>,
    adding_link: bool,
    link_layout: layout::LinkLayout,
    list_scroll: ScrollHandle,
    link_search: Entity<InputState>,
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
        let link_search = field("mapping.addLinkedApp", win, cx);
        cx.observe(&link_search, |_, _, cx| cx.notify()).detach();
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
            color_format: 0,
            name,
            web: false,
            web_draft: None,
            web_group: None,
            web_group_focus: BTreeMap::new(),
            web_icons: BTreeMap::new(),
            favicon_read: None,
            link_edits: BTreeMap::new(),
            adding_link: false,
            link_layout: layout::LinkLayout::default(),
            list_scroll: ScrollHandle::new(),
            link_search,
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
        this.reload(false, cx);
        this
    }
    fn reload(&mut self, discard_saved_draft: bool, cx: &mut Context<Self>) {
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
                        if discard_saved_draft {
                            this.pending.clear();
                            this.web_draft = None;
                            this.web_group = None;
                            this.link_edits.clear();
                            this.category_edits.clear();
                            this.editing_name = None;
                            this.busy = false;
                        }
                        this.error = false;
                    }
                    Err(_) => {
                        this.error = true;
                        this.busy = false;
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
                .chain(self.websites().into_iter().map(Card::from))
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
        let mut websites = self.website_draft();
        if let Some(key) = &self.editing_name
            && let Some(mut rule) = self.name_rule(key).and_then(|card| card.web_rule())
            && let Some(draft) = &mut websites
        {
            rule.name = self.name.read(cx).value().trim().into();
            draft.assign(&rule);
        }
        websites.is_some_and(|d| d.dirty())
            || !self.link_edits.is_empty()
            || self.rules.as_ref().is_some_and(|rules| {
                rules.apps.iter().any(|saved| {
                    let key = format!("app:{}", saved.exe);
                    let mut draft = self
                        .pending
                        .get(&key)
                        .and_then(Card::app_rule)
                        .unwrap_or_else(|| saved.clone());
                    if self.editing_name.as_ref() == Some(&key) {
                        draft.name = self.name.read(cx).value().trim().into();
                    }
                    draft != *saved
                })
            })
            || self.category_edits.values().any(|e| {
                if e.replacement.is_some() {
                    return e.previous.is_some();
                }
                e.previous.as_ref() != Some(&e.label)
                    || e.color.as_ref().is_some_and(|color| {
                        let before = e
                            .previous_color
                            .clone()
                            .unwrap_or_else(|| self.default_category_color(&e.id));
                        let after = if color.is_empty() {
                            self.default_category_color(&e.id)
                        } else {
                            color.clone()
                        };
                        !before.eq_ignore_ascii_case(&after)
                    })
            })
            || self.busy
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
            self.website_draft(),
            self.link_edits.values().cloned().collect(),
            self.category_edits.values().cloned().collect(),
        ));
        cx.spawn(async move |view, cx| {
            let res = write.await;
            let _ = view.update(cx, |this, cx| {
                this.error = res.is_err();
                if res.is_ok() {
                    this.reload(true, cx);
                    cx.emit(crate::main_window::Saved);
                } else {
                    this.busy = false;
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
                        this.reload(false, cx);
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
        self.load_web_icons(cx);
        let c = self.client.palette(win);
        let locale = self.client.locale.get();
        let tr = |k| text(locale, k);
        let can_apply = self.dirty(cx) && !self.busy;
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
                        t.web_draft = None;
                        t.web_group = None;
                        t.link_edits.clear();
                        t.category_edits.clear();
                        t.editing_name = None;
                        t.color_picker = None;
                        cx.notify();
                    },
                )),
            )
            .child(
                text_button("save", tr("common.save"), c, can_apply)
                    .on_click(cx.listener(|t, _, _, cx| t.save(cx))),
            );
        let view = cx.weak_entity();
        let pointer_events = canvas(
            |_, _, _| (),
            move |_, _, win, _| {
                let down = view.clone();
                win.on_mouse_event(move |_: &MouseDownEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture {
                        let _ = down.update(cx, |t, _| t.link_layout.pointer_down = true);
                    }
                });
                let up = view.clone();
                win.on_mouse_event(move |_: &MouseUpEvent, phase, _, cx| {
                    if phase == DispatchPhase::Capture {
                        let up = up.clone();
                        cx.defer(move |cx| {
                            let _ = up.update(cx, |t, cx| {
                                t.link_layout.pointer_down = false;
                                cx.notify();
                            });
                        });
                    }
                });
            },
        )
        .absolute()
        .inset_0();
        let mut body = page(c)
            .child(pointer_events)
            .child(page_title_row(tr("mapping.title"), Icon::Sparkles, c).child(actions));
        if self.error {
            body = body.child(
                text_button("retry", tr("common.retry"), c, true)
                    .on_click(cx.listener(|t, _, _, cx| t.reload(false, cx))),
            );
        }
        if let Some(rules) = &self.rules
            && (!self.mode_initialized || self.web && !rules.web_enabled)
        {
            self.web = rules.web_mode && rules.web_enabled;
            self.mode_initialized = true;
            let hint = tr(if self.web {
                "mapping.webSearchPlaceholder"
            } else {
                "mapping.appSearchPlaceholder"
            });
            self.search.update(cx, |input, cx| {
                input.set_accessibility(
                    InputAccessibility::new(Some(Role::TextInput))
                        .with_label(Some(hint.clone().into())),
                );
                input.set_placeholder(hint, win, cx);
            });
        }
        let Some(rules) = &self.rules else {
            return body.child(label(tr("common.loading")));
        };
        for app in rules
            .apps
            .iter()
            .cloned()
            .map(Card::from)
            .chain(self.websites().into_iter().map(Card::from))
        {
            self.web_group_focus
                .entry(app.key.clone())
                .or_insert_with(|| cx.focus_handle());
            self.delete_focus
                .entry(app.key.clone())
                .or_insert_with(|| cx.focus_handle());
            self.rename_focus
                .entry(app.key.clone())
                .or_insert_with(|| cx.focus_handle());
            self.color_focus
                .entry(app.key.clone())
                .or_insert_with(|| cx.focus_handle());
        }
        let titles_enabled = rules.titles_enabled;
        let categories = self.categories();
        let apps: Vec<_> = rules
            .apps
            .iter()
            .cloned()
            .map(Card::from)
            .chain(self.websites().into_iter().map(Card::from))
            .filter(|a| {
                a.is_web() == self.web
                    && (a.is_web() || !self.app_links().contains_key(&a.identity))
            })
            .map(|a| {
                self.effective_rule(if a.is_web() {
                    &a
                } else {
                    self.pending.get(&a.key).unwrap_or(&a)
                })
            })
            .collect();
        let total = apps.iter().filter(|a| a.track).count();
        let unclassified = apps
            .iter()
            .filter(|a| a.track && a.category == "other")
            .count();
        let counts = [total, total - unclassified, unclassified];
        let filter_options = [
            ("mapping.filters.all", None),
            ("mapping.filters.classified", None),
            ("mapping.filters.other", None),
            ("mapping.excludeStats", Some(Icon::ListX)),
        ];
        let view = cx.weak_entity();
        let filters = quietpro::segmented(
            "classification-filters",
            tr("mapping.title"),
            std::array::from_fn::<_, 4, _>(|i| {
                let (key, icon) = filter_options[i];
                let label = counts
                    .get(i)
                    .map_or_else(|| tr(key), |count| format!("{} ({count})", tr(key)));
                (i, label, icon, self.filter_focus[i].clone())
            }),
            self.filter,
            true,
            c,
            move |filter, _, cx| {
                let _ = view.update(cx, |t, cx| {
                    t.filter = filter;
                    cx.notify();
                });
            },
        );
        let category_ids: Vec<_> = categories.iter().map(|(id, _)| id.clone()).collect();
        let selected_category = category_ids
            .iter()
            .position(|id| self.category_filter.as_ref() == Some(id))
            .map_or(0, |i| i + 1);
        let options = std::iter::once((0, SharedString::from(tr("mapping.filters.all")))).chain(
            categories
                .iter()
                .enumerate()
                .map(|(i, (_, name))| (i + 1, SharedString::from(name.clone()))),
        );
        let view = cx.weak_entity();
        let category_dropdown = quietpro::Dropdown::new(
            "category-filter",
            tr("mapping.categoryFilter"),
            options,
            selected_category,
            c,
            move |index, _, cx| {
                let _ = view.update(cx, |t, cx| {
                    t.category_filter = index
                        .checked_sub(1)
                        .and_then(|i| category_ids.get(i))
                        .cloned();
                    cx.notify();
                });
            },
        )
        .icon(Icon::Funnel, selected_category != 0);
        let mut tools = div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(8.))
            .child(filters);
        tools = tools.child(
            quietpro::search_input(
                "app-search",
                &self.search,
                tr("mapping.clearSearch"),
                c,
                win,
                cx,
            )
            .w(px(200.))
            .pr(px(4.))
            .child(category_dropdown),
        );
        tools = tools.child(div().flex_1());
        if rules.web_enabled {
            let view = cx.weak_entity();
            tools = tools.child(quietpro::segmented(
                "classification-object-mode",
                tr("mapping.title"),
                [
                    (
                        false,
                        tr("mapping.objectModeApp"),
                        None,
                        self.mode_focus[0].clone(),
                    ),
                    (
                        true,
                        tr("mapping.objectModeWeb"),
                        None,
                        self.mode_focus[1].clone(),
                    ),
                ],
                self.web,
                !self.busy,
                c,
                move |web, win, cx| {
                    let _ = view.update(cx, |t, cx| {
                        t.finish_name(cx);
                        t.color_picker = None;
                        t.web = web;
                        t.web_group = None;
                        let write = t.client.request::<()>(Query::ClassificationMode(web));
                        cx.spawn(async move |_, _| {
                            let _ = write.await;
                        })
                        .detach();
                        let hint = text(
                            t.client.locale.get(),
                            if web {
                                "mapping.webSearchPlaceholder"
                            } else {
                                "mapping.appSearchPlaceholder"
                            },
                        );
                        t.search.update(cx, |input, cx| {
                            input.set_accessibility(
                                InputAccessibility::new(Some(Role::TextInput))
                                    .with_label(Some(hint.clone().into())),
                            );
                            input.set_placeholder(hint, win, cx);
                        });
                        cx.notify();
                    });
                },
            ));
        }
        tools = tools.child(
            text_button(
                "manage-categories",
                tr("mapping.categoryControl"),
                c,
                !self.busy,
            )
            .track_focus(&self.category_trigger_focus)
            .on_click(cx.listener(|t, _, win, cx| {
                t.category_manager = true;
                t.category_editing = false;
                t.category_confirmation = None;
                win.focus(&t.category_title_focus, cx);
                cx.notify();
            })),
        );
        let query = self.search.read(cx).value().to_lowercase();
        let mut grid = div()
            .id("rule-grid")
            .track_scroll(&self.list_scroll)
            .min_h_0()
            .flex_1()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(APP_CARD_GAP));
        let mut visible: Vec<_> = apps
            .into_iter()
            .filter(|a| {
                self.matches_card(a, &query)
                    && self
                        .category_filter
                        .as_ref()
                        .is_none_or(|k| *k == a.category)
                    && (a.track || self.filter == 3)
                    && match self.filter {
                        1 => a.category != "other",
                        2 => a.category == "other",
                        3 => !a.track,
                        _ => true,
                    }
            })
            .collect();
        visible.sort_by(|a, b| {
            category_manager::compare_names(locale, &a.name, &b.name)
                .then(a.identity.cmp(&b.identity))
        });
        if visible.is_empty() {
            grid = grid.child(label(tr(if self.web {
                "mapping.webEmptyState"
            } else {
                "mapping.emptyState"
            })));
        }
        let (slots, focus) = self.link_layout.arrange(
            visible.iter().map(|a| a.key.clone()).collect(),
            self.web_group.as_deref(),
            format!(
                "{}:{}:{:?}:{}:{:?}",
                self.web,
                self.filter,
                self.category_filter,
                query,
                win.viewport_size()
            ),
            &self.list_scroll,
        );
        if let Some(focus) = focus.and_then(|key| self.rename_focus.get(&key)) {
            win.focus(focus, cx);
        }
        for pair in slots.chunks(2) {
            let mut row = div().grid().grid_cols(2).gap(px(APP_CARD_GAP));
            for key in pair {
                let Some(a) = visible.iter().find(|a| &a.key == key) else {
                    row = row.child(div().h(px(92.)));
                    continue;
                };
                let draft = (*a).clone();
                let selected_category = categories
                    .iter()
                    .position(|v| v.0 == a.category)
                    .unwrap_or(0);
                let category_action = draft.clone();
                let category_ids: Vec<_> = categories.iter().map(|(id, _)| id.clone()).collect();
                let view = cx.weak_entity();
                let category_select = quietpro::Dropdown::new(
                    "classify",
                    format!("{} · {}", tr("native.export.field.category"), a.name),
                    categories
                        .iter()
                        .enumerate()
                        .map(|(i, (_, name))| (i, name.clone())),
                    selected_category,
                    c,
                    move |index, _, cx| {
                        let _ = view.update(cx, |t, cx| {
                            let mut rule = t
                                .pending
                                .get(&category_action.key)
                                .unwrap_or(&category_action)
                                .clone();
                            if rule.category != category_ids[index] {
                                rule.category = category_ids[index].clone();
                                t.pending.insert(rule.key.clone(), rule);
                                cx.notify();
                            }
                        });
                    },
                )
                .disabled(self.busy);
                let name_action = draft.clone();
                let color_action = draft.clone();
                let default_color =
                    if let Some(color) = self.card_icon(a).and_then(|icon| icon.color) {
                        rgb(color)
                    } else if a.category == "other" {
                        rgb(patina_recorder::default_app_color(&a.identity))
                    } else {
                        color_picker::parse_hex(&self.category_color(&a.category))
                            .unwrap_or_else(|| rgb(patina_recorder::default_app_color(&a.identity)))
                    };
                let display_color = color_picker::parse_hex(&a.color).unwrap_or(default_color);
                let mut track = draft.clone();
                track.track = !track.track;
                let mut titles = draft.clone();
                titles.titles = !titles.titles;
                let fallback_icon = if a.is_web() {
                    Icon::Globe
                } else {
                    Icon::AppWindow
                };
                let icon =
                    quietpro::app_icon_frame(display_color, c).child(match self.card_icon(a) {
                        Some(image) => div()
                            .id("app-icon")
                            .role(Role::Image)
                            .aria_label(a.name.clone())
                            .size(px(24.))
                            .child(
                                img(image.image.clone())
                                    .size_full()
                                    .object_fit(ObjectFit::Contain)
                                    .with_fallback(move || {
                                        quietpro::glyph(fallback_icon, c.secondary)
                                            .size(px(24.))
                                            .into_any_element()
                                    })
                                    .with_loading(move || {
                                        quietpro::glyph(fallback_icon, c.secondary)
                                            .size(px(24.))
                                            .into_any_element()
                                    }),
                            )
                            .into_any_element(),
                        None => quietpro::glyph(fallback_icon, c.secondary)
                            .size(px(24.))
                            .into_any_element(),
                    });
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
                            .child(if self.editing_name.as_ref() == Some(&a.key) {
                                div()
                                    .flex()
                                    .flex_1()
                                    .min_w_0()
                                    .on_mouse_down_out(cx.listener(|t, _, win, cx| {
                                        t.finish_name(cx);
                                        if t.name.focus_handle(cx).is_focused(win) {
                                            win.blur(cx);
                                        }
                                    }))
                                    .on_action(cx.listener(
                                        |t, _: &gpui_kit::base::input::Escape, win, cx| {
                                            if let Some(exe) = t.editing_name.take() {
                                                t.focus_rename(&exe, win, cx);
                                            }
                                            cx.notify();
                                        },
                                    ))
                                    .child(
                                        quietpro::TextInput::new("app-name-input", &self.name, c)
                                            .disabled(self.busy),
                                    )
                                    .into_any_element()
                            } else {
                                heading(a.name.clone())
                                    .id("app-name")
                                    .truncate()
                                    .into_any_element()
                            })
                            .child(
                                quietpro::IconControl::new(
                                    "rename",
                                    tr(if a.is_web() {
                                        "mapping.editWebDomainName"
                                    } else {
                                        "mapping.editAppName"
                                    }),
                                    Icon::Pencil,
                                )
                                .disabled(self.busy)
                                .track_focus(&self.rename_focus[&a.key])
                                .action(
                                    c,
                                    cx.listener(move |t, _, win, cx| {
                                        t.finish_name(cx);
                                        let name = t
                                            .name_rule(&name_action.key)
                                            .unwrap_or_else(|| name_action.clone())
                                            .name
                                            .clone();
                                        t.editing_name = Some(name_action.key.clone());
                                        let label = text(
                                            t.client.locale.get(),
                                            if name_action.is_web() {
                                                "mapping.editWebDomainName"
                                            } else {
                                                "mapping.editAppName"
                                            },
                                        );
                                        t.name.update(cx, |input, cx| {
                                            input.set_accessibility(
                                                InputAccessibility::new(Some(Role::TextInput))
                                                    .with_label(Some(label.into())),
                                            );
                                            input.set_value(name, win, cx);
                                            input.focus(win, cx);
                                            input.select_all(win, cx);
                                        });
                                        cx.notify();
                                    }),
                                ),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .min_w_0()
                            .gap(px(8.))
                            .child(self.identity_control(a, titles_enabled, c, cx))
                            .when(!a.track && !a.tracking_mixed(), |d| {
                                d.child(
                                    label(tr("mapping.noStats"))
                                        .flex_none()
                                        .text_size(px(12.))
                                        .text_color(c.secondary),
                                )
                            }),
                    );
                let picker = self
                    .color_picker
                    .as_ref()
                    .filter(|(exe, _)| exe == &a.key)
                    .map(|(_, picker)| picker.clone());
                let color_open = picker.is_some();
                let client = self.client.clone();
                let color_focus = self.color_focus[&a.key].clone();
                let color_bounds = win.use_keyed_state(
                    SharedString::from(format!("app-color-bounds-{}", a.key)),
                    cx,
                    |_, _| Bounds::<Pixels>::default(),
                );
                let bounds = *color_bounds.read(cx);
                let color_anchor = if bounds.top() > win.viewport_size().height - bounds.bottom() {
                    Anchor::BottomLeft
                } else {
                    Anchor::TopLeft
                };
                let color_button = gpui_kit::base::Popover::new("color-popup")
                    .open(color_open)
                    .anchor(color_anchor)
                    .offset(px(4.))
                    .trigger(
                        quietpro::color_swatch_button(
                            "color",
                            tr("mapping.color"),
                            display_color,
                            !self.busy && !self.icons_loading,
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
                        if *open && !t.busy && !t.icons_loading {
                            let picker = cx.new(|cx| {
                                color_picker::ColorPicker::new(
                                    client.clone(),
                                    display_color,
                                    default_color,
                                    t.color_format,
                                    win,
                                    cx,
                                )
                            });
                            cx.subscribe(
                                &picker,
                                |t, _, format: &color_picker::FormatChanged, _| {
                                    t.color_format = format.0;
                                },
                            )
                            .detach();
                            let draft = color_action.clone();
                            cx.subscribe(
                                &picker,
                                move |t, _, color: &color_picker::Changed, cx| {
                                    let mut rule =
                                        t.pending.get(&draft.key).unwrap_or(&draft).clone();
                                    rule.color = color.0.clone().unwrap_or_default();
                                    t.pending.insert(rule.key.clone(), rule);
                                    cx.notify();
                                },
                            )
                            .detach();
                            t.color_picker = Some((color_action.key.clone(), picker));
                        } else {
                            t.color_picker = None;
                            win.focus(&color_focus, cx);
                        }
                        cx.notify();
                    }))
                    .content(move |_, _, _| div().children(picker));
                let buttons = div()
                    .flex()
                    .gap(px(0.))
                    .child(color_button)
                    .child(
                        quietpro::IconControl::new(
                            "title-policy",
                            tr(if titles_enabled {
                                "mapping.titleRecorded"
                            } else {
                                "mapping.globalTitleDisabled"
                            }),
                            if a.titles_mixed() {
                                Icon::Minus
                            } else if a.titles {
                                Icon::Captions
                            } else {
                                Icon::CaptionsOff
                            },
                        )
                        .disabled(self.busy || !titles_enabled)
                        .mixed_toggle(c, a.titles, a.titles_mixed(), {
                            let view = cx.weak_entity();
                            move |_, _, _, cx| {
                                let _ = view.update(cx, |t, cx| {
                                    let mut rule =
                                        t.name_rule(&titles.key).unwrap_or_else(|| titles.clone());
                                    rule.titles = titles.titles;
                                    t.pending.insert(rule.key.clone(), rule);
                                    cx.notify();
                                });
                            }
                        }),
                    )
                    .child(
                        quietpro::IconControl::new(
                            "tracking-policy",
                            tr("mapping.excludeStats"),
                            if a.tracking_mixed() {
                                Icon::Minus
                            } else if a.track {
                                Icon::ListX
                            } else {
                                Icon::ListPlus
                            },
                        )
                        .disabled(self.busy)
                        .mixed_toggle(c, !a.track, a.tracking_mixed(), {
                            let view = cx.weak_entity();
                            move |_, _, _, cx| {
                                let _ = view.update(cx, |t, cx| {
                                    let mut rule =
                                        t.name_rule(&track.key).unwrap_or_else(|| track.clone());
                                    rule.track = track.track;
                                    t.pending.insert(rule.key.clone(), rule);
                                    cx.notify();
                                });
                            }
                        }),
                    )
                    .child(self.merge_control(a, c, cx))
                    .child(
                        quietpro::IconControl::new(
                            "delete-records",
                            tr(if a.is_web() {
                                "mapping.deleteWebRecords"
                            } else {
                                "mapping.deleteAppRecords"
                            }),
                            Icon::Trash,
                        )
                        .track_focus(&self.delete_focus[&a.key])
                        .disabled(self.dirty(cx))
                        .action(
                            quietpro::Palette {
                                secondary: c.danger,
                                text: c.danger,
                                disabled_text: c.danger.opacity(0.5),
                                ..c
                            },
                            cx.listener({
                                let target = (*a).clone();
                                move |t, _, win, cx| {
                                    if !t.dirty(cx) {
                                        t.deleting = Some(target.clone());
                                        t.delete_failed = false;
                                        t.delete_impact = None;
                                        t.color_picker = None;
                                        win.focus(&t.delete_cancel, cx);
                                        t.delete_application(false, win, cx);
                                    }
                                }
                            }),
                        ),
                    );
                let card = content_card(c.border, c.canvas)
                    .id(SharedString::from(a.key.clone()))
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
                            .child(category_select)
                            .child(buttons),
                    );
                row = row.child(card);
            }
            grid = grid.child(row);
        }
        body = body
            .child(content_card(c.border, c.panel).flex_none().child(tools))
            .child(content_card(c.border, c.panel).flex_1().child(grid));
        if let Some(target) = &self.deleting {
            let delete_label = if target.is_web() {
                "mapping.deleteWebRecords"
            } else {
                "mapping.deleteAppRecords"
            };
            let mut scope = div()
                .id("deletion-scope")
                .max_h(px(220.))
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(8.));
            if let Some(impact) = &self.delete_impact {
                for (key, items) in [
                    (
                        "mapping.deletionMembers",
                        impact.members.iter().cloned().collect::<Vec<_>>(),
                    ),
                    (
                        "mapping.deletionLinks",
                        impact
                            .links
                            .iter()
                            .map(|(a, b)| format!("{a} → {b}"))
                            .collect(),
                    ),
                    (
                        "mapping.deletionReminders",
                        impact
                            .reminders
                            .iter()
                            .filter(|r| !r.shared)
                            .map(|r| format!("{} · {} (#{})", r.label, r.target, r.id))
                            .collect(),
                    ),
                    (
                        "mapping.deletionSharedReminders",
                        impact
                            .reminders
                            .iter()
                            .filter(|r| r.shared)
                            .map(|r| format!("{} · {} (#{})", r.label, r.target, r.id))
                            .collect(),
                    ),
                ] {
                    if !items.is_empty() {
                        scope = scope
                            .child(heading(tr(key)))
                            .children(items.into_iter().map(label));
                    }
                }
            }
            let dialog = quietpro::dialog_surface(c, win.viewport_size())
                .on_key_down(cx.listener(|t, e: &KeyDownEvent, win, cx| {
                    if e.keystroke.key == "escape" {
                        t.close_delete(win, cx);
                        cx.stop_propagation();
                    }
                }))
                .max_w((win.viewport_size().width - px(48.)).min(px(520.)))
                .gap(px(12.))
                .child(heading(tr(delete_label)))
                .child(label(format!("{} · {}", target.name, target.identity)).text_color(c.text))
                .child(
                    label(patina_recorder::format_text(
                        locale,
                        "mapping.deleteObjectDetail",
                        &[("label", target.name.clone())],
                    ))
                    .text_color(c.secondary),
                )
                .child(scope)
                .when(self.busy, |d| d.child(label(tr("common.loading"))))
                .when(self.delete_failed, |d| {
                    d.child(label(tr("mapping.deleteFailed")).text_color(c.danger))
                })
                .child(
                    quietpro::dialog_actions()
                        .child(
                            text_button("cancel-delete", tr("common.cancel"), c, !self.busy)
                                .track_focus(&self.delete_cancel)
                                .on_click(cx.listener(|t, _, win, cx| t.close_delete(win, cx))),
                        )
                        .when(self.delete_failed, |d| {
                            d.child(
                                text_button(
                                    "retry-delete-preview",
                                    tr("common.retry"),
                                    c,
                                    !self.busy,
                                )
                                .on_click(
                                    cx.listener(|t, _, win, cx| {
                                        t.delete_application(false, win, cx)
                                    }),
                                ),
                            )
                        })
                        .child(
                            text_button(
                                "confirm-delete",
                                tr(delete_label),
                                quietpro::Palette {
                                    secondary: c.danger,
                                    text: c.danger,
                                    ..c
                                },
                                !self.busy && self.delete_impact.is_some(),
                            )
                            .on_click(
                                cx.listener(|t, _, win, cx| t.delete_application(true, win, cx)),
                            ),
                        ),
                );
            let view = cx.weak_entity();
            return body.child(
                base::Dialog::new(cx)
                    .focus_handle(self.focus.clone())
                    .accessibility_label(tr(delete_label))
                    .close_on_escape(false)
                    .close_on_backdrop_press(!self.busy)
                    .on_ok(|_, _, _| false)
                    .backdrop(quietpro::dialog_backdrop())
                    .popup(base::DialogPopup::new().child(dialog))
                    .on_open_change(move |open, _, win, cx| {
                        if !open {
                            let _ = view.update(cx, |t, cx| t.close_delete(win, cx));
                        }
                    }),
            );
        }
        if self.category_manager {
            let dialog = self.render_category_manager(c, win, cx);
            body = body.child(dialog);
            if let Some((id, target)) = self.category_confirmation.clone() {
                body = body.child(self.render_category_confirmation(id, target, c, win, cx));
            } else if self.category_editing {
                body = body.child(self.render_category_name_dialog(c, win, cx));
            }
            return body;
        }
        body
    }
}

impl gpui_kit::EventEmitter<crate::main_window::Saved> for Classification {}
