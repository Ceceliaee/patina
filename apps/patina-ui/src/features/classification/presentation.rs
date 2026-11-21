use super::{Classification, ClassificationRules, Client, SourceIcon};
use crate::features::source_icon::cache::{SiteIcons, read_apps};
use chrono::{Local, NaiveDate};
use gpui_kit::{App, Context};
use patina_i18n::Locale;
use std::{
    collections::{BTreeMap, BTreeSet},
    mem,
    rc::Rc,
    sync::Arc,
};

pub(super) type CardIcons = BTreeMap<String, Option<SourceIcon>>;

#[cfg(all(test, feature = "test-support"))]
#[path = "tests.rs"]
mod tests;

#[derive(Default)]
pub(crate) struct ClassificationCache {
    version: Option<(NaiveDate, Locale, u64)>,
    rules: Option<Rc<ClassificationRules>>,
    apps: Rc<CardIcons>,
    apps_verified: bool,
    pub(super) sites: SiteIcons,
    pub(super) web: bool,
}

fn version(client: &Client) -> (NaiveDate, Locale, u64) {
    (
        Local::now().date_naive(),
        client.locale.get(),
        client.activity_revision.get(),
    )
}

impl ClassificationCache {
    pub(super) fn for_client(self, client: &Client) -> Self {
        if self.version == Some(version(client)) {
            self
        } else {
            Self::default()
        }
    }
}

impl Classification {
    pub(crate) fn ready_to_present(&self) -> bool {
        self.rules.is_some() || self.error
    }

    pub(crate) fn take_cache(&mut self) -> ClassificationCache {
        let mut cache = mem::take(&mut self.cache);
        let mut budget = crate::features::source_icon::cache::RetainedIcons::default();
        if self.web {
            cache.sites.trim(&mut budget);
        }
        let evicted: Vec<_> = cache
            .apps
            .iter()
            .filter(|(key, icon)| !budget.admit(key, icon.as_ref()))
            .map(|(key, _)| key.clone())
            .collect();
        if !evicted.is_empty() {
            let entries = Rc::make_mut(&mut cache.apps);
            for key in evicted {
                entries.remove(&key);
            }
            cache.apps_verified = false;
        }
        if !self.web {
            cache.sites.trim(&mut budget);
        }
        if !self
            .rules
            .as_ref()
            .zip(cache.rules.as_ref())
            .is_some_and(|(shown, loaded)| Rc::ptr_eq(shown, loaded))
        {
            cache.rules = None;
        }
        cache
    }

    pub(super) fn reload(&mut self, cx: &mut Context<Self>) {
        let stamp = version(&self.client);
        let read = self.client.load_classification_rules();
        self.read = Some(cx.spawn(async move |view, cx| {
            let result = read.await;
            let _ = view.update(cx, |this, cx| {
                this.read = None;
                if stamp != version(&this.client) {
                    this.reload(cx);
                    return;
                }
                match result {
                    Ok(rules) => {
                        if !this.rename_focus.is_empty() {
                            let keys: std::collections::HashSet<_> = rules
                                .apps
                                .iter()
                                .map(|a| format!("app:{}", a.exe))
                                .chain(
                                    rules
                                        .websites
                                        .cards()
                                        .iter()
                                        .map(|s| format!("web:{}", s.identity)),
                                )
                                .chain(this.pending.keys().cloned())
                                .collect();
                            for focus in [
                                &mut this.rename_focus,
                                &mut this.color_focus,
                                &mut this.delete_focus,
                                &mut this.web_group_focus,
                            ] {
                                focus.retain(|key, _| keys.contains(key));
                            }
                        }
                        this.cache.web =
                            this.requested_web.unwrap_or(rules.web_mode) && rules.web_enabled;
                        let sources: BTreeSet<_> = rules
                            .websites
                            .favicons
                            .values()
                            .map(String::as_str)
                            .collect();
                        this.cache.sites.retain(|source| sources.contains(source));
                        this.cache.apps_verified = false;
                        if this.cache.version != Some(stamp) {
                            this.cache.apps = Rc::default();
                        } else {
                            let keys: BTreeSet<_> =
                                rules.apps.iter().map(|r| r.exe.as_str()).collect();
                            Rc::make_mut(&mut this.cache.apps)
                                .retain(|key, _| keys.contains(key.as_str()));
                        }
                        this.cache.version = Some(stamp);
                        this.cache.rules = Some(Rc::new(rules));
                        this.error = false;
                        this.prepare_panel(cx);
                    }
                    Err(_) => {
                        this.error = true;
                        this.busy = this.saved_reload;
                        cx.notify();
                    }
                }
            });
        }));
    }

    pub(super) fn prepare_panel(&mut self, cx: &mut Context<Self>) {
        self.preparing = None;
        let Some(rules) = self.cache.rules.clone() else {
            return;
        };
        let renderer = cx.svg_renderer();
        let executor = cx.background_executor().clone();
        let query = self.search.read(cx).value().to_lowercase();
        let row_height = 92. + quietpro::APP_CARD_GAP;
        let row = (-f32::from(self.list_scroll.offset().y) / row_height) as usize;
        let start = row.saturating_sub(1) * 2;
        let count = 2 * ((f32::from(self.viewport_height) / row_height).ceil() as usize + 2);
        if self.cache.web {
            let sources: BTreeSet<_> = rules
                .websites
                .favicons
                .values()
                .filter(|s| !s.is_empty())
                .map(String::as_str)
                .collect();
            if sources.iter().all(|s| self.cache.sites.ready(s)) {
                self.present_web(rules, None, cx);
                return;
            }
            let mut cards = rules.websites.cards();
            let locale = self.client.locale.get();
            cards.sort_by(|a, b| {
                super::category_manager::compare_names(locale, &a.name, &b.name)
                    .then(a.domain.cmp(&b.domain))
            });
            let visible = cards
                .iter()
                .filter(|site| {
                    (query.is_empty()
                        || site.name.to_lowercase().contains(&query)
                        || site.domain.contains(&query)
                        || site.members.iter().any(|member| member.contains(&query)))
                        && self.accepts_category(site.track, &site.category)
                })
                .skip(start)
                .take(count)
                .filter_map(|site| site.favicon.as_deref())
                .collect();
            let read = self
                .cache
                .sites
                .prepare(sources.into_iter(), &visible, &executor, renderer);
            let visible: std::collections::HashSet<String> =
                visible.into_iter().map(str::to_owned).collect();
            self.preparing = Some(cx.spawn(async move |view, cx| {
                read.await;
                let _ = view.update(cx, |this, cx| this.present_web(rules, Some(&visible), cx));
            }));
        } else {
            if self.cache.apps_verified || rules.apps.is_empty() {
                self.present(rules, false, self.cache.apps.clone(), cx);
                return;
            }
            let mut ordered: Vec<_> = rules
                .apps
                .iter()
                .filter(|app| !rules.app_links.contains_key(&app.exe))
                .collect();
            let locale = self.client.locale.get();
            ordered.sort_by(|a, b| {
                super::category_manager::compare_names(locale, &a.name, &b.name)
                    .then(a.exe.cmp(&b.exe))
            });
            let first_screen = ordered
                .into_iter()
                .filter(|app| {
                    (query.is_empty()
                        || app.name.to_lowercase().contains(&query)
                        || app.exe.to_lowercase().contains(&query))
                        && self.accepts_category(app.track, &app.category)
                })
                .skip(start)
                .take(count)
                .map(|app| app.exe.to_lowercase())
                .collect();
            let read = read_apps(
                self.client.clone(),
                rules.apps.iter().map(|r| r.exe.clone()).collect(),
                first_screen,
                self.cache.apps.values().flatten().cloned().collect(),
                executor,
                renderer,
            );
            self.preparing = Some(cx.spawn(async move |view, cx| {
                let result = read.await;
                let _ = view.update(cx, |this, cx| {
                    if let Ok(icons) = result {
                        this.cache.apps = Rc::new(icons.into_iter().collect());
                        this.cache.apps_verified = true;
                    }
                    this.present(rules, false, this.cache.apps.clone(), cx);
                });
            }));
        }
    }

    pub(super) fn color_ready(&self) -> bool {
        !self.busy && self.read.is_none() && self.preparing.is_none()
    }

    fn present_web(
        &mut self,
        rules: Rc<ClassificationRules>,
        visible: Option<&std::collections::HashSet<String>>,
        cx: &mut Context<Self>,
    ) {
        let icons = rules
            .websites
            .favicons
            .values()
            .filter(|s| !s.is_empty())
            .filter_map(|source| {
                if self.web
                    && let Some(icon) = self.icons.get(source)
                {
                    return Some((source.clone(), icon.clone()));
                }
                (self.cache.sites.ready(source) || visible.is_some_and(|set| set.contains(source)))
                    .then(|| (source.clone(), self.cache.sites.get(source)))
            })
            .collect();
        self.present(rules, true, Rc::new(icons), cx);
    }

    fn present(
        &mut self,
        rules: Rc<ClassificationRules>,
        web: bool,
        icons: Rc<CardIcons>,
        cx: &mut Context<Self>,
    ) {
        self.preparing = None;
        if self.cache.version != Some(version(&self.client)) {
            self.reload(cx);
            return;
        }
        self.rules = Some(rules);
        self.web = web;
        self.replace_icons(icons, cx);
        if self.saved_reload {
            self.pending.clear();
            self.web_draft = None;
            self.web_group = None;
            self.link_edits.clear();
            self.category_edits.clear();
            self.editing_name = None;
            self.saved_reload = false;
            self.busy = false;
        }
        cx.notify();
    }

    pub(super) fn replace_icons(&mut self, icons: Rc<CardIcons>, cx: &mut App) {
        let previous = mem::replace(&mut self.icons, icons);
        if Rc::ptr_eq(&previous, &self.icons) {
            return;
        }
        let unused: Vec<_> = previous
            .iter()
            .filter_map(|(key, icon)| {
                let image = &icon.as_ref()?.prepared()?.pixels;
                let retained = self
                    .icons
                    .get(key)
                    .and_then(Option::as_ref)
                    .and_then(|next| next.prepared())
                    .is_some_and(|next| Arc::ptr_eq(image, &next.pixels));
                (!retained).then(|| image.clone())
            })
            .collect();
        if !unused.is_empty() {
            cx.defer(move |cx| {
                for image in unused {
                    cx.drop_image(image, None);
                }
            });
        }
    }
}
