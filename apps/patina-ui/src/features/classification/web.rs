use super::*;
use gpui_kit::base::Button;
use patina_activity_model::{WebsiteRule, WebsiteRuleDraft};

impl Classification {
    pub(super) fn website_draft(&self) -> Option<WebsiteRuleDraft> {
        let mut draft = self
            .web_draft
            .clone()
            .or_else(|| self.rules.as_ref().map(|r| r.websites.clone()))?;
        for card in self.pending.values() {
            if let Some(rule) = self.effective_rule(card).web_rule() {
                draft.assign(&rule);
            }
        }
        Some(draft)
    }

    pub(super) fn websites(&self) -> Vec<WebsiteRule> {
        self.website_draft().map(|d| d.cards()).unwrap_or_default()
    }

    fn edit_website(&mut self, edit: impl FnOnce(&mut WebsiteRuleDraft), cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        self.finish_name(cx);
        if let Some(mut draft) = self.website_draft() {
            edit(&mut draft);
            self.web_draft = Some(draft);
            self.pending.retain(|_, card| !card.is_web());
        }
        self.color_picker = None;
        cx.notify();
    }

    pub(super) fn card_icon(&self, card: &Card) -> Option<&AppIcon> {
        if let card::Source::Web(site) = &card.source {
            site.favicon
                .as_ref()
                .and_then(|url| self.web_icons.get(url))
                .and_then(Option::as_ref)
        } else {
            self.icons.get(&card.identity)
        }
    }

    pub(super) fn load_web_icons(&mut self, cx: &mut Context<Self>) {
        if self.favicon_read.is_some() || !self.web {
            return;
        }
        let sources: std::collections::BTreeSet<_> = self
            .websites()
            .into_iter()
            .filter_map(|s| s.favicon)
            .filter(|s| !self.web_icons.contains_key(s))
            .collect();
        if sources.is_empty() {
            return;
        }
        let renderer = cx.svg_renderer();
        self.favicon_read = Some(cx.spawn(async move |view, cx| {
            for source in sources {
                let url = source.clone();
                let executor = cx.background_executor().clone();
                let renderer = renderer.clone();
                let icon = cx
                    .background_executor()
                    .spawn(async move {
                        crate::features::source_icon::favicon(&url, &executor, renderer)
                            .await
                            .map(|bytes| AppIcon {
                                color: patina_activity_model::icon_color(&bytes),
                                image: Arc::new(Image::from_bytes(ImageFormat::Png, bytes)),
                            })
                    })
                    .await;
                if view
                    .update(cx, |this, cx| {
                        this.web_icons.insert(source, icon);
                        cx.notify();
                    })
                    .is_err()
                {
                    return;
                }
            }
            let _ = view.update(cx, |this, cx| {
                this.favicon_read = None;
                cx.notify();
            });
        }));
    }

    pub(super) fn identity_control(
        &self,
        card: &Card,
        titles_enabled: bool,
        c: quietpro::Palette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let card::Source::Web(site) = &card.source else {
            return self.app_identity_control(card, titles_enabled, c, cx);
        };
        if site.identity == site.domain {
            return label(card.identity.clone())
                .id("app-filename")
                .text_size(px(12.))
                .into_any_element();
        }
        let locale = self.client.locale.get();
        let key = card.key.clone();
        let title = text(locale, "mapping.webLinks");
        let focus = self.web_group_focus.get(&key).cloned();
        let view = cx.weak_entity();
        let source = site.clone();
        gpui_kit::base::Popover::new("web-members-popup")
            .open(self.web_group.as_ref() == Some(&key))
            .anchor(Anchor::TopLeft)
            .offset(px(4.))
            .trigger(
                Button::new("app-filename")
                    .accessibility_label(format!("{title}: {}", site.domain))
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
                    .child(label(site.domain.clone()).truncate())
                    .child(quietpro::glyph(Icon::ChevronDown, c.secondary).size(px(12.))),
            )
            .on_open_change(cx.listener(move |t, open: &bool, win, cx| {
                t.finish_name(cx);
                t.color_picker = None;
                t.web_group = open.then(|| key.clone());
                if !open
                    && !t.link_layout.pointer_down
                    && let Some(focus) = &focus
                {
                    win.focus(focus, cx);
                }
                cx.notify();
            }))
            .content(move |_, _, cx| {
                view.update(cx, |t, cx| t.web_members(&source, titles_enabled, c, cx))
                    .unwrap_or_else(|_| div().into_any_element())
            })
            .into_any_element()
    }

    fn web_members(
        &self,
        site: &WebsiteRule,
        titles_enabled: bool,
        c: quietpro::Palette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let locale = self.client.locale.get();
        let title = text(locale, "mapping.webLinks");
        let view = cx.weak_entity();
        let mut rows = div()
            .id("web-member-list")
            .max_h(px(240.))
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(4.));
        rows = rows.child(
            div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(label(site.domain.clone()).flex_1().min_w_0().truncate())
                .child(
                    label(text(locale, "mapping.mainWebDomain"))
                        .text_size(px(12.))
                        .text_color(c.secondary),
                ),
        );
        for member in &site.member_rules {
            let domain = member.domain.clone();
            let member_title = member.titles;
            let member_track = member.track;
            let title_view = view.clone();
            let track_view = view.clone();
            let unlink_view = view.clone();
            let title_domain = domain.clone();
            let track_domain = domain.clone();
            let unlink_domain = domain.clone();
            rows = rows.child(
                div()
                    .id(SharedString::from(domain.clone()))
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .child(
                        label(domain.clone())
                            .min_w_0()
                            .flex_1()
                            .truncate()
                            .text_size(px(12.)),
                    )
                    .child(
                        quietpro::IconControl::new(
                            "title",
                            format!(
                                "{}: {domain}",
                                text(
                                    locale,
                                    if titles_enabled {
                                        "mapping.titleRecorded"
                                    } else {
                                        "mapping.globalTitleDisabled"
                                    }
                                )
                            ),
                            if member_title {
                                Icon::Captions
                            } else {
                                Icon::CaptionsOff
                            },
                        )
                        .disabled(self.busy || !titles_enabled)
                        .toggle(c, member_title, move |_, _, _, cx| {
                            let _ = title_view.update(cx, |t, cx| {
                                t.edit_website(
                                    |d| d.set_member(&title_domain, true, !member_title),
                                    cx,
                                )
                            });
                        }),
                    )
                    .child(
                        quietpro::IconControl::new(
                            "track",
                            format!("{}: {domain}", text(locale, "mapping.excludeStats")),
                            if member_track {
                                Icon::ListX
                            } else {
                                Icon::ListPlus
                            },
                        )
                        .disabled(self.busy)
                        .toggle(c, !member_track, move |_, _, _, cx| {
                            let _ = track_view.update(cx, |t, cx| {
                                t.edit_website(
                                    |d| d.set_member(&track_domain, false, !member_track),
                                    cx,
                                )
                            });
                        }),
                    )
                    .child(
                        quietpro::IconControl::new(
                            "unlink",
                            format!("{}: {domain}", text(locale, "mapping.webIndependent")),
                            Icon::X,
                        )
                        .disabled(self.busy)
                        .action(c, move |_, win, cx| {
                            let _ = unlink_view.update(cx, |t, cx| {
                                if let Some(source) = t.web_group.clone() {
                                    t.link_layout.regroup(
                                        &source,
                                        format!("web:{unlink_domain}"),
                                        &t.list_scroll,
                                    );
                                }
                                t.edit_website(|d| d.set_independent(&unlink_domain, true), cx);
                                t.web_group = None;
                                win.focus(&t.focus, cx);
                            });
                        }),
                    ),
            );
        }
        content_card(c.border, c.panel)
            .id("website-members")
            .role(Role::Group)
            .aria_label(title.clone())
            .w(px(350.))
            .max_w_full()
            .gap(px(8.))
            .child(heading(title.clone()))
            .child(rows)
            .into_any_element()
    }

    pub(super) fn merge_control(
        &self,
        card: &Card,
        c: quietpro::Palette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let card::Source::Web(site) = &card.source else {
            return div().into_any_element();
        };
        let Some(root) = site.root.clone().filter(|_| site.identity == site.domain) else {
            return div().into_any_element();
        };
        let domain = site.domain.clone();
        quietpro::IconControl::new(
            "merge-web",
            patina_i18n::format_text(
                self.client.locale.get(),
                "mapping.mergeWebDomain",
                &[("domain", root.clone())],
            ),
            Icon::Plus,
        )
        .disabled(self.busy)
        .action(
            c,
            cx.listener(move |t, _, win, cx| {
                t.edit_website(|d| d.set_independent(&domain, false), cx);
                if let Some(target) = t
                    .websites()
                    .into_iter()
                    .find(|site| site.domain == root && site.identity != site.domain)
                {
                    t.link_layout.regroup(
                        &format!("web:{domain}"),
                        Card::from(target).key,
                        &t.list_scroll,
                    );
                }
                t.web_group = None;
                win.focus(&t.focus, cx);
            }),
        )
        .into_any_element()
    }
}
