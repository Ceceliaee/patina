use super::{
    links::{main_member_row, member_heading, member_list, member_panel, member_row},
    *,
};
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

    pub(super) fn card_icon(&self, card: &Card) -> Option<&SourceIcon> {
        let key = match &card.source {
            card::Source::Web(site) => site.favicon.as_ref()?,
            card::Source::App(_) => &card.identity,
        };
        self.icons.get(key)?.as_ref()
    }

    pub(super) fn web_members(
        &self,
        site: &WebsiteRule,
        titles_enabled: bool,
        c: quietpro::Palette,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let locale = self.client.locale.get();
        let title = text(locale, "mapping.webLinks");
        let view = cx.weak_entity();
        let mut rows = member_list("web-member-list").child(main_member_row(
            site.domain.clone(),
            "linked-main-website",
            text(locale, "mapping.mainWebDomain"),
            c,
        ));
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
                member_row(domain.clone())
                    .id(SharedString::from(domain.clone()))
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
                        .with_tooltip()
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
                        .with_tooltip()
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
                        .with_tooltip()
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
        member_panel("website-members", title.clone(), c)
            .child(member_heading(title))
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
