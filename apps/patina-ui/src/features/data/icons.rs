use super::{DataPage, HashMap, SeriesKind, Trends};
use crate::features::source_icon::cache::SiteIcons;
pub(super) use crate::features::source_icon::cache::SourceIcon;
use gpui_kit::{Context, Task};
use patina_activity_model::Series;

#[cfg(all(test, feature = "test-support"))]
#[path = "tests/icons.rs"]
mod tests;

#[derive(Default)]
pub(super) struct IconCache {
    apps: HashMap<String, Option<SourceIcon>>,
    sites: SiteIcons,
}

fn site_source(series: &Series) -> Option<&str> {
    series
        .favicon
        .as_deref()
        .filter(|source| !source.is_empty())
}

impl IconCache {
    pub(super) fn trim(&mut self, kind: SeriesKind) {
        let mut budget = crate::features::source_icon::cache::RetainedIcons::default();
        if kind == SeriesKind::Web {
            self.sites.trim(&mut budget);
        }
        self.apps
            .retain(|key, icon| budget.admit(key, icon.as_ref()));
        if kind != SeriesKind::Web {
            self.sites.trim(&mut budget);
        }
    }
    pub(super) fn site(&self, source: &str) -> Option<SourceIcon> {
        self.sites.get(source)
    }
    pub(super) fn ready(&self, kind: SeriesKind, trend: &Trends) -> bool {
        trend.series.iter().all(|s| {
            s.key == "activity:anonymous"
                || match kind {
                    SeriesKind::Category => true,
                    SeriesKind::App => self.apps.contains_key(&s.key),
                    SeriesKind::Web => site_source(s).is_none_or(|src| self.sites.ready(src)),
                }
        })
    }

    pub(super) fn get(&self, kind: SeriesKind, s: &Series) -> Option<SourceIcon> {
        match kind {
            SeriesKind::Category => None,
            SeriesKind::App => self.apps.get(&s.key)?.clone(),
            SeriesKind::Web => self.sites.get(site_source(s)?),
        }
    }

    pub(super) fn retain_sources<'a>(
        &mut self,
        trends: impl Iterator<Item = (SeriesKind, &'a Trends)>,
    ) {
        let mut apps = std::collections::HashSet::new();
        let mut sites = std::collections::HashSet::new();
        for (kind, trend) in trends {
            match kind {
                SeriesKind::App => apps.extend(trend.series.iter().map(|s| s.key.as_str())),
                SeriesKind::Web => sites.extend(trend.series.iter().filter_map(site_source)),
                SeriesKind::Category => {}
            }
        }
        self.apps.retain(|key, _| apps.contains(key.as_str()));
        self.sites.retain(|source| sites.contains(source));
    }
}

impl DataPage {
    pub(super) fn visible_series<'a>(
        &self,
        kind: SeriesKind,
        data: &'a Trends,
        cx: &Context<Self>,
    ) -> Vec<&'a Series> {
        let scroll = &self.rank_scroll.0.borrow().base_handle;
        let height = f32::from(scroll.bounds().size.height);
        let count = ((if height > 0. {
            height
        } else {
            f32::from(self.viewport_height)
        }) / 44.)
            .ceil() as usize
            + 2;
        let start = (-f32::from(scroll.offset().y) / 44.) as usize;
        let search = self.searches[kind as usize]
            .read(cx)
            .value()
            .trim()
            .to_lowercase();
        let chosen = if kind == self.data_kind {
            &self.selected
        } else {
            &self.selections[kind as usize]
        };
        let mut items: Vec<_> = data
            .series
            .iter()
            .filter(|s| {
                search.is_empty()
                    || s.name.to_lowercase().contains(&search)
                    || s.key.to_lowercase().contains(&search)
            })
            .skip(start.saturating_sub(1))
            .take(count)
            .collect();
        items.extend(data.series.iter().filter(|s| chosen.contains(&s.key)));
        if let Some(first) = data.series.first() {
            items.push(first);
        }
        items
    }

    pub(super) fn prepare_icons(
        &mut self,
        kind: SeriesKind,
        trend: &Trends,
        cx: &mut Context<Self>,
    ) -> Option<Task<()>> {
        if self.cache.icons.ready(kind, trend) {
            return None;
        }
        let executor = cx.background_executor().clone();
        let renderer = cx.svg_renderer();
        if kind == SeriesKind::Web {
            let visible = self
                .visible_series(kind, trend, cx)
                .into_iter()
                .filter_map(site_source)
                .collect();
            return Some(
                self.cache.icons.sites.prepare(
                    trend
                        .series
                        .iter()
                        .filter(|s| s.key != "activity:anonymous")
                        .filter_map(site_source),
                    &visible,
                    &executor,
                    renderer,
                ),
            );
        }
        let keys: Vec<_> = trend
            .series
            .iter()
            .filter(|s| {
                s.key != "activity:anonymous" && !self.cache.icons.apps.contains_key(&s.key)
            })
            .map(|s| s.key.clone())
            .collect();
        let read = crate::features::source_icon::cache::read_apps(
            self.client.clone(),
            keys,
            self.visible_series(kind, trend, cx)
                .iter()
                .map(|s| s.key.to_lowercase())
                .collect(),
            self.cache.icons.apps.values().flatten().cloned().collect(),
            executor,
            renderer,
        );
        Some(cx.spawn(async move |view, cx| {
            if let Ok(icons) = read.await {
                let _ = view.update(cx, |this, _| this.cache.icons.apps.extend(icons));
            }
        }))
    }
}
