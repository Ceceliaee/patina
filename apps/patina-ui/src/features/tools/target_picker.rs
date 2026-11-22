use super::{Tools, fields::PanelView};
use crate::{client::Client, features::source_icon::cache::SiteIcons};
use gpui_kit::{
    base::{
        Align, Button, POPUP_PRIORITY, Placement, Positioner,
        input::{InputAccessibility, InputEvent, InputState},
    },
    prelude::*,
    *,
};
use patina_activity_model::ClassificationRules;
use patina_desktop_protocol::tools::layout::{
    ActivityTargetKind as Kind, SelectedActivityTarget as Target,
};
use patina_i18n::text;
use quietpro::{Icon, Palette};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::Arc,
};

const OPTION_HEIGHT: f32 = 28.;
const SEARCH_TEXT_SIZE: f32 = 14.;

struct OptionRow {
    target: Target,
    kind_label: String,
    search: String,
    color: Option<Rgba>,
    favicon: Option<String>,
}

fn catalog(rules: ClassificationRules, locale: patina_i18n::Locale) -> Vec<OptionRow> {
    let mut rows = Vec::new();
    let mut add = |kind, value: String, label: String, color: Option<Rgba>, favicon| {
        let kind_label = text(
            locale,
            match kind {
                Kind::App => "destinationDetail.objectTypeApp",
                Kind::Category => "export.fields.category.label",
                Kind::Web => "destinationDetail.objectTypeWeb",
            },
        );
        rows.push(OptionRow {
            search: format!("{label} {value} {kind_label}").to_lowercase(),
            target: Target { kind, value, label },
            kind_label,
            color,
            favicon,
        });
    };
    for app in rules.apps.into_iter().filter(|app| app.track) {
        add(Kind::App, app.exe, app.name, None, None);
    }
    for (id, name) in rules.categories {
        if id != "system" {
            let color = rules
                .category_colors
                .get(&id)
                .and_then(|hex| Rgba::try_from(hex.as_str()).ok());
            add(Kind::Category, id, name, color, None);
        }
    }
    if rules.web_enabled {
        for site in rules.websites.cards() {
            for member in site.member_rules {
                if member.track && rules.websites.totals.contains_key(&member.domain) {
                    let label = if member.domain == site.domain {
                        site.name.clone()
                    } else {
                        member.domain.clone()
                    };
                    let favicon = rules
                        .websites
                        .favicons
                        .get(&member.domain)
                        .filter(|url| !url.trim().is_empty())
                        .or(site.favicon.as_ref())
                        .cloned();
                    add(Kind::Web, member.domain, label, None, favicon);
                }
            }
        }
    }
    rows
}

enum PickerEvent {
    Choose(Target),
    Dismiss { restore_focus: bool },
}

pub(super) struct TargetPicker {
    client: Rc<Client>,
    title: String,
    search: Entity<InputState>,
    options: Vec<OptionRow>,
    filtered: Vec<usize>,
    selected: Option<Target>,
    active: usize,
    bounds: Bounds<Pixels>,
    scroll: UniformListScrollHandle,
    status: Option<&'static str>,
    icons: HashMap<String, Option<Arc<Image>>>,
    sites: SiteIcons,
    site_read: Option<Task<()>>,
    _load: Task<()>,
}

impl EventEmitter<PickerEvent> for TargetPicker {}

impl Tools {
    pub(super) fn activity_target_field(
        &mut self,
        key: &str,
        title: &str,
        view: PanelView<'_>,
        win: &Window,
        cx: &Context<Self>,
    ) -> AnyElement {
        if self.panel.expanded.as_deref() == Some(key)
            && let Some(picker) = &self.panel.target_picker
        {
            return picker.clone().into_any_element();
        }
        let selected = self
            .choices
            .get(key)
            .and_then(|s| serde_json::from_str::<Target>(s).ok());
        let placeholder = text(
            self.client.locale.get(),
            "tools.activityReminderTargetPlaceholder",
        );
        let value = selected.as_ref().map(|t| t.label.clone());
        let focus = self.panel.field_focus(key, cx);
        let title = title.to_owned();
        let key = key.to_owned();
        let c = view.colors;
        let label_color = if !view.ready {
            c.disabled_text
        } else if value.is_some() {
            c.text
        } else {
            c.secondary
        };
        Button::new(SharedString::from(format!("target-{key}")))
            .disabled(!view.ready)
            .child(
                quietpro::search_input_frame("target-face", c, focus.is_focused(win), false)
                    .w_full()
                    .text_size(px(SEARCH_TEXT_SIZE))
                    .child(
                        div()
                            .min_w_0()
                            .flex_1()
                            .truncate()
                            .text_color(label_color)
                            .child(value.clone().unwrap_or(placeholder)),
                    ),
            )
            .role(Role::ComboBox)
            .accessibility_label(title.clone())
            .aria_value(value.unwrap_or_default())
            .aria_expanded(false)
            .track_focus(&focus)
            .w_full()
            .justify_start()
            .on_click(cx.listener(move |this, _, win, cx| {
                this.panel.close_picker();
                let picker = cx.new(|cx| {
                    TargetPicker::new(
                        this.client.clone(),
                        title.clone(),
                        selected.clone(),
                        win,
                        cx,
                    )
                });
                this.panel.expanded = Some(key.clone());
                let key = key.clone();
                let trigger = focus.clone();
                cx.subscribe_in(
                    &picker,
                    win,
                    move |this, _, event: &PickerEvent, win, cx| {
                        if let PickerEvent::Choose(target) = event {
                            this.choices.insert(
                                key.clone(),
                                serde_json::to_string(target).expect("serializable target"),
                            );
                        }
                        this.panel.close_picker();
                        if !matches!(
                            event,
                            PickerEvent::Dismiss {
                                restore_focus: false
                            }
                        ) {
                            win.focus(&trigger, cx);
                        }
                        if std::mem::take(&mut this.refresh_pending) {
                            this.background_refresh(cx);
                        }
                        cx.notify();
                    },
                )
                .detach();
                this.panel.target_picker = Some(picker);
                cx.notify();
            }))
            .into_any_element()
    }
}

impl TargetPicker {
    fn new(
        client: Rc<Client>,
        title: String,
        selected: Option<Target>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let locale = client.locale.get();
        let search = cx.new(|cx| {
            let mut input = InputState::new(win, cx)
                .placeholder(text(locale, "tools.activityReminderTargetPlaceholder"));
            input.set_accessibility(
                InputAccessibility::new(Some(Role::TextInput))
                    .with_label(Some(title.clone().into())),
            );
            input.focus(win, cx);
            input
        });
        cx.subscribe(&search, |this, _, event, cx| {
            if matches!(event, InputEvent::Change) {
                this.filter(cx);
            }
        })
        .detach();
        let read = client.load_classification_rules();
        let load = cx.spawn(async move |picker, cx| {
            let result = read.await;
            let _ = picker.update(cx, |this, cx| match result {
                Ok(rules) => {
                    this.options = catalog(rules, locale);
                    this.status = None;
                    this.filter(cx);
                }
                Err(_) => {
                    this.status = Some("tools.activityReminderCandidatesLoadFailed");
                    cx.notify();
                }
            });
        });
        Self {
            client,
            title,
            search,
            options: Vec::new(),
            filtered: Vec::new(),
            selected,
            active: 0,
            bounds: Bounds::default(),
            scroll: UniformListScrollHandle::new(),
            status: Some("common.loading"),
            icons: HashMap::new(),
            sites: SiteIcons::default(),
            site_read: None,
            _load: load,
        }
    }

    fn filter(&mut self, cx: &mut Context<Self>) {
        let query = self.search.read(cx).value().trim().to_lowercase();
        self.filtered.clear();
        if !query.is_empty() {
            self.filtered.extend(
                self.options
                    .iter()
                    .enumerate()
                    .filter(|(_, r)| r.search.contains(&query))
                    .map(|(i, _)| i),
            );
        }
        self.active = 0;
        self.scroll.scroll_to_item(0, ScrollStrategy::Top);
        cx.notify();
    }

    fn choose(&self, index: usize, cx: &mut Context<Self>) {
        if let Some(&i) = self.filtered.get(index) {
            cx.emit(PickerEvent::Choose(self.options[i].target.clone()));
        }
    }

    fn load_visible_icons(&mut self, range: std::ops::Range<usize>, cx: &mut Context<Self>) {
        let mut keys = Vec::new();
        let mut sources = HashSet::new();
        for i in range {
            let option = &self.options[self.filtered[i]];
            if let Some(src) = &option.favicon {
                sources.insert(src.as_str());
            }
            let target = &option.target;
            if target.kind == Kind::App
                && let std::collections::hash_map::Entry::Vacant(entry) =
                    self.icons.entry(target.value.clone())
            {
                keys.push(entry.key().clone());
                entry.insert(None);
            }
        }
        if self.site_read.is_none() && sources.iter().any(|src| !self.sites.ready(src)) {
            let read = self.sites.prepare(
                sources.iter().copied(),
                &sources,
                cx.background_executor(),
                cx.svg_renderer(),
            );
            self.site_read = Some(cx.spawn(async move |picker, cx| {
                read.await;
                let _ = picker.update(cx, |this, cx| {
                    this.site_read = None;
                    cx.notify();
                });
            }));
        }
        if keys.is_empty() {
            return;
        }
        let read = self.client.icons(keys);
        cx.spawn(async move |picker, cx| {
            if let Ok(icons) = read.await {
                let _ = picker.update(cx, |this, cx| {
                    for (key, bytes) in icons {
                        this.icons.insert(
                            key,
                            Some(Arc::new(Image::from_bytes(ImageFormat::Png, bytes))),
                        );
                    }
                    cx.notify();
                });
            }
        })
        .detach();
    }

    fn option(&self, index: usize, c: Palette, cx: &Context<Self>) -> Stateful<Div> {
        let option = &self.options[self.filtered[index]];
        let target = &option.target;
        let icon = match target.kind {
            Kind::App => Icon::AppWindow,
            Kind::Category => Icon::Tags,
            Kind::Web => Icon::Globe,
        };
        let image = match target.kind {
            Kind::App => self.icons.get(&target.value).and_then(Clone::clone),
            Kind::Web => option
                .favicon
                .as_ref()
                .and_then(|src| self.sites.get(src))
                .map(|icon| icon.image),
            Kind::Category => None,
        };
        let glyph = match image {
            Some(image) => div()
                .id("target-icon")
                .role(Role::Image)
                .aria_label(target.label.clone())
                .size(px(16.))
                .flex_none()
                .child(img(image).size_full().object_fit(ObjectFit::Contain))
                .into_any_element(),
            None => quietpro::glyph(icon, option.color.unwrap_or(c.secondary))
                .size(px(16.))
                .flex_none()
                .into_any_element(),
        };
        let weak = cx.weak_entity();
        let selected = self.selected.as_ref() == Some(target);
        quietpro::menu_item_frame(("target-option", index), index == self.active, selected, c)
            .role(Role::ListBoxOption)
            .aria_label(format!("{} · {}", target.label, option.kind_label))
            .aria_selected(selected)
            .w_full()
            .h(px(OPTION_HEIGHT))
            .child(glyph)
            .child(
                div()
                    .min_w_0()
                    .flex_1()
                    .truncate()
                    .text_color(c.text)
                    .text_size(px(14.))
                    .line_height(px(20.))
                    .font_weight(FontWeight::NORMAL)
                    .child(target.label.clone()),
            )
            .child(
                quietpro::caption(option.kind_label.clone(), c)
                    .flex_none()
                    .whitespace_nowrap(),
            )
            .on_mouse_down(MouseButton::Left, |_, win, _| win.prevent_default())
            .on_click(cx.listener(move |this, _, _, cx| {
                this.choose(index, cx);
                cx.stop_propagation();
            }))
            .on_a11y_action(AccessibleAction::Click, move |_, _, cx| {
                let _ = weak.update(cx, |this, cx| this.choose(index, cx));
            })
    }
}

impl Render for TargetPicker {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let c = self.client.palette(win);
        let locale = self.client.locale.get();
        let count = self.filtered.len();
        let weak = cx.weak_entity();
        let has_query = !self.search.read(cx).value().trim().is_empty();
        let list = quietpro::menu_surface(
            "activity-targets",
            self.title.clone(),
            self.bounds.size.width,
            c,
        )
        .role(Role::ListBox)
        .on_mouse_down_out(cx.listener(|this, event: &MouseDownEvent, _, cx| {
            if !this.bounds.contains(&event.position) {
                cx.emit(PickerEvent::Dismiss {
                    restore_focus: false,
                });
            }
        }));
        let list = if count == 0 {
            list.child(
                div().p(px(8.)).child(quietpro::caption(
                    text(
                        locale,
                        self.status
                            .unwrap_or("tools.activityReminderNoMatchingTargets"),
                    ),
                    c,
                )),
            )
        } else {
            let rows = uniform_list(
                "activity-target-list",
                count,
                cx.processor(move |this, range: std::ops::Range<usize>, _, cx| {
                    this.load_visible_icons(range.clone(), cx);
                    range.map(|i| this.option(i, c, cx)).collect()
                }),
            )
            .h(px(OPTION_HEIGHT * count.min(7) as f32))
            .w_full()
            .track_scroll(&self.scroll);
            list.child(rows)
        };
        div()
            .id("activity-target-editor")
            .relative()
            .w_full()
            .when(!has_query, |field| {
                field.on_mouse_down_out(cx.listener(|_, _, _, cx| {
                    cx.emit(PickerEvent::Dismiss {
                        restore_focus: false,
                    });
                }))
            })
            .capture_key_down(cx.listener(move |this, event: &KeyDownEvent, win, cx| {
                if event.keystroke.modifiers.modified() {
                    return;
                }
                match event.keystroke.key.as_str() {
                    "escape" => cx.emit(PickerEvent::Dismiss {
                        restore_focus: true,
                    }),
                    "enter" => this.choose(this.active, cx),
                    "down" | "up" if count > 0 => {
                        this.active = if event.keystroke.key == "down" {
                            (this.active + 1).min(count - 1)
                        } else {
                            this.active.saturating_sub(1)
                        };
                        this.scroll
                            .scroll_to_item(this.active, ScrollStrategy::Nearest);
                        cx.notify();
                    }
                    "tab" => {
                        cx.emit(PickerEvent::Dismiss {
                            restore_focus: false,
                        });
                        return;
                    }
                    _ => return,
                }
                win.prevent_default();
                cx.stop_propagation();
            }))
            .child(
                quietpro::search_input(
                    "search",
                    &self.search,
                    text(locale, "mapping.clearSearch"),
                    c,
                    win,
                    cx,
                )
                .text_size(px(SEARCH_TEXT_SIZE)),
            )
            .child(
                canvas(
                    move |bounds, _, cx| {
                        let _ = weak.update(cx, |this, cx| {
                            if this.bounds != bounds {
                                this.bounds = bounds;
                                cx.notify();
                            }
                        });
                    },
                    |_, _, _, _| {},
                )
                .absolute()
                .inset_0()
                .size_full(),
            )
            .when(has_query && self.bounds.size.width > px(0.), |d| {
                d.child(
                    deferred(
                        Positioner::side(self.bounds)
                            .placement(Placement::Bottom)
                            .align(Align::Start)
                            .offset(px(4.))
                            .margin(px(8.))
                            .occlude()
                            .child(list),
                    )
                    .with_priority(POPUP_PRIORITY),
                )
            })
    }
}
