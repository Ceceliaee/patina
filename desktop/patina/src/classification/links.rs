use super::*;
use gpui_kit::base::Button;

impl Classification {
    pub(super) fn matches_card(&self, card: &Card, query: &str) -> bool {
        card.matches_query(query)
            || (!card.is_web()
                && self.app_links().iter().any(|(member, parent)| {
                    parent == &card.identity
                        && self
                            .name_rule(&format!("app:{member}"))
                            .is_some_and(|m| m.matches_query(query))
                }))
    }
    pub(super) fn app_links(&self) -> BTreeMap<String, String> {
        let mut links = self
            .rules
            .as_ref()
            .map(|r| r.app_links.clone())
            .unwrap_or_default();
        for (member, edit) in &self.link_edits {
            if let Some(parent) = &edit.parent {
                links.insert(member.clone(), parent.clone());
            } else {
                links.remove(member);
            }
        }
        links
    }

    fn set_app_link(&mut self, member: &str, parent: Option<&str>, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.finish_name(cx);
        let links = self.app_links();
        if parent.is_some_and(|p| {
            p == member || links.contains_key(p) || links.values().any(|v| v == member)
        }) {
            return;
        }
        let original = self
            .rules
            .as_ref()
            .and_then(|r| r.app_links.get(member))
            .cloned();
        if original.as_deref() == parent {
            self.link_edits.remove(member);
        } else {
            self.link_edits.insert(
                member.into(),
                patina_recorder::AppLinkEdit {
                    member: member.into(),
                    parent: parent.map(str::to_owned),
                    original,
                },
            );
        }
        if let Some(parent) = parent {
            let key = format!("app:{parent}");
            if !self.pending.contains_key(&key)
                && let Some(card) = self.name_rule(&key)
            {
                // Persist the observed root name so child records cannot rename the group.
                self.pending.insert(key, card);
            }
        }
        let next = self.app_links();
        for root in links.values() {
            if next.values().any(|p| p == root) {
                continue;
            }
            let key = format!("app:{root}");
            if self
                .pending
                .get(&key)
                .and_then(Card::app_rule)
                .is_some_and(|draft| self.rules.as_ref().is_some_and(|r| r.apps.contains(&draft)))
            {
                self.pending.remove(&key);
            }
        }
        cx.notify();
    }

    fn app_member_policy(&mut self, exe: &str, title: bool, enabled: bool, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        if let Some(mut card) = self.name_rule(&format!("app:{exe}")) {
            if title {
                card.titles = enabled;
            } else {
                card.track = enabled;
            }
            self.pending.insert(card.key.clone(), card);
            cx.notify();
        }
    }

    pub(super) fn app_identity_control(
        &self,
        card: &Card,
        titles_enabled: bool,
        c: quietpro::Palette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let locale = self.client.locale.get();
        let title = text(locale, "mapping.linkedApps");
        let key = card.key.clone();
        let parent = card.identity.clone();
        let focus = self.web_group_focus.get(&key).cloned();
        let view = cx.weak_entity();
        gpui_kit::base::Popover::new("app-links-popup")
            .open(self.web_group.as_ref() == Some(&key))
            .anchor(Anchor::TopLeft)
            .offset(px(4.))
            .trigger(
                Button::new("app-filename")
                    .accessibility_label(format!("{title}: {parent}"))
                    .when_some(focus.clone(), |b, f| b.track_focus(&f))
                    .disabled(self.busy)
                    .min_w_0()
                    .flex()
                    .items_center()
                    .justify_start()
                    .gap(px(4.))
                    .text_size(px(12.))
                    .line_height(px(18.))
                    .cursor_pointer()
                    .focus_visible(move |b| b.bg(c.track))
                    .child(label(parent.clone()).truncate())
                    .when(self.app_links().values().any(|p| p == &parent), |b| {
                        b.child(quietpro::glyph(Icon::ChevronDown, c.secondary).size(px(12.)))
                    }),
            )
            .on_open_change(cx.listener(move |t, open: &bool, win, cx| {
                t.finish_name(cx);
                t.color_picker = None;
                t.web_group = open.then(|| key.clone());
                t.adding_link = false;
                t.link_search
                    .update(cx, |input, cx| input.set_value("", win, cx));
                if !open
                    && !t.link_layout.pointer_down
                    && let Some(focus) = &focus
                {
                    win.focus(focus, cx);
                }
                cx.notify();
            }))
            .content(move |_, win, cx| {
                view.update(cx, |t, cx| {
                    t.app_members(&parent, titles_enabled, c, win, cx)
                })
                .unwrap_or_else(|_| div().into_any_element())
            })
            .into_any_element()
    }

    fn app_members(
        &self,
        parent: &str,
        titles_enabled: bool,
        c: quietpro::Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let locale = self.client.locale.get();
        let links = self.app_links();
        self.link_search.update(cx, |input, cx| {
            input.set_placeholder(text(locale, "mapping.appSearchPlaceholder"), win, cx);
            input.set_disabled(self.busy, cx);
        });
        let query = self.link_search.read(cx).value().trim().to_lowercase();
        let mut body = content_card(c.border, c.panel)
            .id("app-link-members")
            .role(Role::Group)
            .aria_label(text(locale, "mapping.linkedApps"))
            .w(px(280.))
            .max_w_full()
            .gap(px(12.));
        let mut rows = div()
            .id("app-members-list")
            .max_h(px(240.))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(4.));
        if self.adding_link {
            body = body.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        quietpro::IconControl::new(
                            "back-link-search",
                            text(locale, "mapping.backToLinkedApps"),
                            Icon::ChevronLeft,
                        )
                        .disabled(self.busy)
                        .action(
                            c,
                            cx.listener(|t, _, win, cx| {
                                win.focus(&t.focus, cx);
                                t.adding_link = false;
                                t.link_search
                                    .update(cx, |input, cx| input.set_value("", win, cx));
                                cx.notify();
                            }),
                        ),
                    )
                    .child(
                        quietpro::search_input(
                            "app-link-search",
                            &self.link_search,
                            text(locale, "mapping.clearSearch"),
                            c,
                            win,
                            cx,
                        )
                        .flex_1()
                        .min_w_0(),
                    ),
            );
            let mut count = 0;
            for app in self.rules.iter().flat_map(|r| &r.apps) {
                let card = self
                    .name_rule(&format!("app:{}", app.exe))
                    .unwrap_or_else(|| Card::from(app.clone()));
                if app.exe == parent
                    || links.values().any(|p| p == &app.exe)
                    || links.get(&app.exe).is_some_and(|p| p != parent)
                    || !card.matches_query(&query)
                {
                    continue;
                }
                count += 1;
                let member = app.exe.clone();
                let target = parent.to_owned();
                let linked = links.contains_key(&member);
                let icon = quietpro::unframed_app_icon(
                    SharedString::from(format!("link-icon-{member}")),
                    member.clone(),
                    self.icons.get(&member).map(|i| i.image.clone()),
                    Icon::AppWindow,
                    c,
                );
                rows = rows.child(
                    Button::new(SharedString::from(member.clone()))
                        .accessibility_label(member.clone())
                        .disabled(self.busy || linked)
                        .line_height(px(18.))
                        .flex()
                        .items_center()
                        .gap(px(8.))
                        .h(px(32.))
                        .flex_none()
                        .cursor_pointer()
                        .child(icon)
                        .child(
                            label(member.clone())
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .text_size(px(12.)),
                        )
                        .child(
                            quietpro::glyph(
                                if linked { Icon::Check } else { Icon::Plus },
                                c.secondary,
                            )
                            .size(px(16.)),
                        )
                        .on_click(cx.listener(move |t, _, win, cx| {
                            t.set_app_link(&member, Some(&target), cx);
                            t.link_search.update(cx, |input, cx| input.focus(win, cx));
                        })),
                );
            }
            if count == 0 {
                rows = rows.child(
                    label(text(locale, "mapping.searchNoResults"))
                        .text_size(px(12.))
                        .text_color(c.secondary),
                );
            }
            body.child(rows).into_any_element()
        } else {
            body = body.child(
                div()
                    .flex()
                    .items_center()
                    .child(
                        heading(text(locale, "mapping.linkedApps"))
                            .flex_1()
                            .text_size(px(14.))
                            .line_height(px(20.)),
                    )
                    .child(
                        quietpro::IconControl::new(
                            "add-link",
                            text(locale, "mapping.addLinkedApp"),
                            Icon::Plus,
                        )
                        .disabled(self.busy)
                        .action(
                            c,
                            cx.listener(|t, _, win, cx| {
                                t.adding_link = true;
                                t.link_search.update(cx, |input, cx| input.focus(win, cx));
                                cx.notify();
                            }),
                        ),
                    ),
            );
            rows = rows.child(
                div()
                    .flex()
                    .h(px(32.))
                    .flex_none()
                    .items_center()
                    .gap(px(8.))
                    .child(
                        label(parent.to_owned())
                            .min_w_0()
                            .flex_1()
                            .truncate()
                            .text_size(px(12.)),
                    )
                    .child(
                        label(text(locale, "mapping.mainApp"))
                            .text_size(px(10.))
                            .flex_none()
                            .text_color(c.secondary),
                    ),
            );
            for (member, _) in links.iter().filter(|(_, p)| *p == parent) {
                let Some(card) = self.name_rule(&format!("app:{member}")) else {
                    continue;
                };
                let title_member = member.clone();
                let track_member = member.clone();
                let unlink_member = member.clone();
                let view = cx.weak_entity();
                let title_view = view.clone();
                let track_view = view.clone();
                rows = rows.child(
                    div()
                        .id(SharedString::from(member.clone()))
                        .flex()
                        .h(px(32.))
                        .flex_none()
                        .items_center()
                        .gap_0()
                        .child(
                            label(member.clone())
                                .mr(px(8.))
                                .min_w_0()
                                .flex_1()
                                .truncate()
                                .text_size(px(12.)),
                        )
                        .child(
                            quietpro::IconControl::new(
                                "title",
                                format!(
                                    "{}: {member}",
                                    text(
                                        locale,
                                        if titles_enabled {
                                            "mapping.titleRecorded"
                                        } else {
                                            "mapping.globalTitleDisabled"
                                        }
                                    )
                                ),
                                if card.titles {
                                    Icon::Captions
                                } else {
                                    Icon::CaptionsOff
                                },
                            )
                            .disabled(self.busy || !titles_enabled)
                            .toggle(
                                c,
                                card.titles,
                                move |enabled, _, _, cx| {
                                    let _ = title_view.update(cx, |t, cx| {
                                        t.app_member_policy(&title_member, true, enabled, cx)
                                    });
                                },
                            ),
                        )
                        .child(
                            quietpro::IconControl::new(
                                "track",
                                format!("{}: {member}", text(locale, "mapping.excludeStats")),
                                if card.track {
                                    Icon::ListX
                                } else {
                                    Icon::ListPlus
                                },
                            )
                            .disabled(self.busy)
                            .toggle(
                                c,
                                !card.track,
                                move |excluded, _, _, cx| {
                                    let _ = track_view.update(cx, |t, cx| {
                                        t.app_member_policy(&track_member, false, !excluded, cx)
                                    });
                                },
                            ),
                        )
                        .child(
                            quietpro::IconControl::new(
                                "unlink",
                                format!("{}: {member}", text(locale, "mapping.unlinkApp")),
                                Icon::X,
                            )
                            .disabled(self.busy)
                            .action(c, move |_, win, cx| {
                                let _ = view.update(cx, |t, cx| {
                                    if let Some(source) = t.web_group.clone() {
                                        t.link_layout.regroup(
                                            &source,
                                            format!("app:{unlink_member}"),
                                            &t.list_scroll,
                                        );
                                    }
                                    t.set_app_link(&unlink_member, None, cx);
                                    t.web_group = None;
                                    win.focus(&t.focus, cx);
                                });
                            }),
                        ),
                );
            }
            body.child(rows).into_any_element()
        }
    }
}
