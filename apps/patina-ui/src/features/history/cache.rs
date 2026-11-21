use super::{History, HistoryDay, HistoryIcon, Locale};
use std::{collections::HashMap, mem};

struct CachedDay {
    day: HistoryDay,
    web: Option<HistoryDay>,
    icons: HashMap<String, HistoryIcon>,
    titles: bool,
}

#[derive(Default)]
pub(crate) struct HistoryCache {
    version: Option<(Locale, u64)>,
    days: Vec<CachedDay>,
    modes: Option<([u8; 2], bool)>,
}

impl HistoryCache {
    pub(super) fn set_version(&mut self, version: (Locale, u64)) {
        if self.version != Some(version) {
            self.days.clear();
            self.modes = None;
            self.version = Some(version);
        }
    }
}

impl History {
    pub(crate) fn with_cache(mut self, cache: HistoryCache) -> Self {
        self.cache = cache;
        self.restore_day();
        if let Some((modes, enabled)) = self.cache.modes {
            self.apply_modes(modes, enabled);
            self.modes_ready = true;
        }
        self
    }

    pub(crate) fn take_cache(&mut self) -> HistoryCache {
        self.cache_day();
        if self.modes_ready && self.cache.version == Some(self.cache_version()) {
            self.cache.modes = Some((self.modes(), self.web_enabled));
        }
        mem::take(&mut self.cache)
    }

    fn cache_version(&self) -> (Locale, u64) {
        (
            self.client.locale.get(),
            self.client.activity_revision.get(),
        )
    }

    pub(super) fn cache_day(&mut self) {
        if self.target.is_some()
            || self.web
            || self.error
            || self.web_error
            || self.cache.version != Some(self.cache_version())
        {
            return;
        }
        if let Some(day) = self.data.take() {
            self.cache.days.push(CachedDay {
                day: day.day,
                web: self.web_data.take().map(|day| day.day),
                icons: mem::take(&mut self.icons),
                titles: self.data_has_titles,
            });
            if self.cache.days.len() > 2 {
                self.cache.days.remove(0);
            }
        }
    }

    pub(super) fn restore_day(&mut self) -> bool {
        let version = self.cache_version();
        if self.cache.version != Some(version) {
            self.data = None;
            self.web_data = None;
            self.icons.clear();
            self.cache.set_version(version);
        }
        if let Some(index) = self
            .cache
            .days
            .iter()
            .position(|cached| (cached.day.start..cached.day.end).contains(&self.date))
        {
            let cached = self.cache.days.remove(index);
            self.cache_day();
            self.offset = None;
            self.web_error = false;
            self.data_has_titles = cached.titles;
            self.data = Some(cached.day.into());
            self.web_data = cached.web.map(Into::into);
            self.icons = cached.icons;
            return true;
        }
        false
    }
}
