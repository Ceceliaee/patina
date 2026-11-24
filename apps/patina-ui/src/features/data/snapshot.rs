use super::{
    Client, DataPage, RangeTarget, heatmap::heatmap_range, icons::IconCache, noon,
    range_picker::RangeSelection,
};
use chrono::{Local, NaiveDate};
use gpui_kit::{App, Context};
use patina_activity_model::{Locale, SeriesKind, Trends};
use std::{collections::HashMap, mem, rc::Rc, sync::Arc};

#[derive(Clone, Copy, PartialEq, Eq)]
struct Query {
    range: Option<(i64, i64)>,
    kind: SeriesKind,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) struct PanelRequest {
    pub(super) detailed: bool,
    pub(super) selection: RangeSelection,
    pub(super) year: Option<i32>,
    trend: Query,
    heat: Query,
}

pub(super) struct DataFrame {
    pub(super) request: PanelRequest,
    pub(super) trend: Rc<Trends>,
    pub(super) heat: Rc<Trends>,
    pub(super) heat_day_indices: HashMap<NaiveDate, usize>,
    pub(super) series_totals: Vec<i64>,
    pub(super) total: i64,
    icons: HashMap<String, FrameIcon>,
    revision: u64,
}

pub(super) struct FrameIcon {
    source: Option<String>,
    value: std::cell::OnceCell<Option<super::icons::SourceIcon>>,
}

#[derive(Default)]
pub(crate) struct DataCache {
    version: Option<(NaiveDate, Locale, u64)>,
    entries: Vec<(Query, Rc<Trends>)>,
    pub(super) icons: IconCache,
}

impl DataCache {
    fn get(&self, key: Query) -> Option<Rc<Trends>> {
        self.entries
            .iter()
            .find(|(q, _)| *q == key)
            .map(|(_, data)| data.clone())
    }
    fn store(&mut self, key: Query, data: Rc<Trends>) {
        self.entries.retain(|(q, _)| *q != key);
        self.entries.push((key, data));
        if self.entries.len() > 8 {
            self.entries.remove(0);
        }
    }
}

fn version(client: &Client) -> (NaiveDate, Locale, u64) {
    (
        Local::now().date_naive(),
        client.locale.get(),
        client.activity_revision.get(),
    )
}

impl DataPage {
    pub(super) fn release_frame(&mut self, retained: &HashMap<String, FrameIcon>, cx: &mut App) {
        let Some(frame) = self.frame.take() else {
            return;
        };
        let unused: Vec<_> = frame
            .icons
            .into_iter()
            .filter_map(|(key, icon)| {
                let pixels = &icon.value.get()?.as_ref()?.prepared()?.pixels;
                let keep = retained
                    .get(&key)
                    .and_then(|next| next.value.get()?.as_ref()?.prepared())
                    .is_some_and(|next| Arc::ptr_eq(pixels, &next.pixels));
                (!keep).then(|| pixels.clone())
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

    pub(super) fn icon(&self, key: &str) -> Option<&super::icons::SourceIcon> {
        let entry = self.frame.as_ref()?.icons.get(key)?;
        entry
            .value
            .get_or_init(|| self.cache.icons.site(entry.source.as_deref()?))
            .as_ref()
    }

    pub(crate) fn ready_to_present(&self) -> bool {
        self.frame.is_some() || self.error
    }

    pub(crate) fn take_cache(&mut self) -> DataCache {
        self.cache.icons.trim(self.data_kind);
        mem::take(&mut self.cache)
    }

    fn panel_request(&self, today: NaiveDate) -> Option<PanelRequest> {
        let detailed = self.client.navigation.get().data_detailed;
        let (target, kind, year) = if detailed {
            (
                RangeTarget::Destination,
                self.detail_kind()?,
                self.trend_heat_year,
            )
        } else {
            (RangeTarget::Overview, SeriesKind::App, self.overview_year)
        };
        let selection = self.ranges[target as usize].selection;
        let range = selection
            .bounds(today)
            .and_then(|(a, b)| noon(a).zip(noon(b)));
        let (start, end) = heatmap_range(year, today);
        Some(PanelRequest {
            detailed,
            selection,
            year,
            trend: Query { range, kind },
            heat: Query {
                range: noon(start).zip(noon(end.min(today))),
                kind,
            },
        })
    }

    pub(super) fn load_panel(&mut self, refresh: bool, cx: &mut Context<Self>) {
        let stamp = version(&self.client);
        if self.cache.version != Some(stamp) {
            self.cache = DataCache {
                version: Some(stamp),
                ..Default::default()
            };
            self.read = None;
        }
        let Some(request) = self.panel_request(stamp.0) else {
            self.read = None;
            self.error = self.modes_read.is_none();
            cx.notify();
            return;
        };
        if self
            .read
            .as_ref()
            .is_some_and(|(pending, _)| *pending == request)
        {
            return;
        }
        self.read = None;
        self.error = false;
        let trend = self.cache.get(request.trend);
        let heat = self.cache.get(request.heat);
        if let (Some(trend), Some(heat)) = (&trend, &heat)
            && (!request.detailed || self.cache.icons.ready(request.trend.kind, trend))
        {
            self.present_frame(request, trend.clone(), heat.clone(), cx);
            if !refresh {
                return;
            }
        }
        let client = self.client.clone();
        let fetch = |key: Query, cached: Option<Rc<Trends>>| {
            let read = (refresh || cached.is_none()).then(|| client.trends(key.range, key.kind));
            async move {
                match read {
                    Some(read) => read.await.map(Rc::new),
                    None => Ok(cached.expect("cached trends")),
                }
            }
        };
        let trend = fetch(request.trend, trend);
        let heat = (request.heat != request.trend).then(|| fetch(request.heat, heat));
        self.read = Some((
            request,
            cx.spawn(async move |view, cx| {
                let result = async {
                    let trend = trend.await?;
                    let heat = match heat {
                        Some(read) => read.await?,
                        None => trend.clone(),
                    };
                    if request.detailed
                        && let Ok(Some(read)) = view.update(cx, |this, cx| {
                            this.prepare_icons(request.trend.kind, &trend, cx)
                        })
                    {
                        read.await;
                    }
                    Ok::<_, patina_desktop_protocol::RequestError>((trend, heat))
                }
                .await;
                let _ = view.update(cx, |this, cx| {
                    this.read = None;
                    if version(&client) != stamp {
                        this.load_panel(true, cx);
                        return;
                    }
                    match result {
                        Ok((trend, heat)) => {
                            this.cache.store(request.trend, trend.clone());
                            this.cache.store(request.heat, heat.clone());
                            this.cache.icons.retain_sources(
                                this.cache.entries.iter().map(|(q, t)| (q.kind, t.as_ref())),
                            );
                            this.present_frame(request, trend, heat, cx);
                        }
                        Err(_) => {
                            this.error = true;
                            cx.notify();
                        }
                    }
                });
            }),
        ));
        cx.notify();
    }

    fn present_frame(
        &mut self,
        request: PanelRequest,
        trend: Rc<Trends>,
        heat: Rc<Trends>,
        cx: &mut Context<Self>,
    ) {
        if request.detailed {
            let kind = request.trend.kind;
            if self.data_kind != kind {
                self.selections[self.data_kind as usize] = mem::take(&mut self.selected);
                self.selected = mem::take(&mut self.selections[kind as usize]);
                self.data_kind = kind;
            }
            self.selected
                .retain(|key| trend.series.iter().any(|s| &s.key == key));
            if self.selected.is_empty()
                && let Some(first) = trend.series.first()
            {
                self.selected.insert(first.key.clone());
            }
        }
        let revision = self.client.activity_revision.get();
        let icons = if request.detailed {
            let visible: std::collections::HashSet<_> = self
                .visible_series(request.trend.kind, &trend, cx)
                .into_iter()
                .map(|s| s.key.as_str())
                .collect();
            let previous = self
                .frame
                .as_ref()
                .filter(|f| f.request == request && f.revision == revision);
            trend
                .series
                .iter()
                .map(|s| {
                    let source = (request.trend.kind == SeriesKind::Web)
                        .then(|| s.favicon.clone())
                        .flatten();
                    let previous = previous
                        .and_then(|frame| frame.icons.get(&s.key))
                        .filter(|old| old.source == source)
                        .and_then(|old| old.value.get());
                    let value = match previous {
                        Some(pinned) => std::cell::OnceCell::from(pinned.clone()),
                        None if source.is_some() && !visible.contains(s.key.as_str()) => {
                            std::cell::OnceCell::new()
                        }
                        None => {
                            std::cell::OnceCell::from(self.cache.icons.get(request.trend.kind, s))
                        }
                    };
                    (s.key.clone(), FrameIcon { source, value })
                })
                .collect()
        } else {
            HashMap::new()
        };
        self.release_frame(&icons, cx);
        let series_totals: Vec<i64> = if request.detailed {
            trend
                .series
                .iter()
                .map(|series| series.daily.values().sum())
                .collect()
        } else {
            Vec::new()
        };
        let heat_day_indices = heat
            .days
            .iter()
            .enumerate()
            .filter_map(|(index, &millis)| {
                let date = chrono::DateTime::from_timestamp_millis(millis)?;
                Some((date.with_timezone(&Local).date_naive(), index))
            })
            .collect();
        self.frame = Some(DataFrame {
            total: series_totals.iter().sum(),
            series_totals,
            request,
            trend,
            heat,
            heat_day_indices,
            icons,
            revision,
        });
        cx.notify();
    }
}
