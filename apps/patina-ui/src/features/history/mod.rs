use crate::{client::Client, features::format::duration};
use chrono::Local;
use gpui_kit::base::TestSupportExt;
use gpui_kit::{prelude::*, *};
use patina_activity_model::{HistoryDay, HistoryRecord, Locale, format_text, text};
use quietpro::{CARD_TITLE_GAP, content_card, heading, page as shell, page_title_row};
use quietpro::{HourlyBar, HourlyChart, HourlySegment, Palette};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};

mod cache;
mod calendar;
pub(crate) use cache::HistoryCache;
mod detail;
mod icons;
mod records;
#[cfg(all(test, feature = "test-support"))]
mod tests;
mod timeline;

const HOUR: i64 = 3_600_000;
use crate::features::page_controls::{label, stamp};

#[derive(Clone, Copy, PartialEq)]
enum Overlay {
    Zoom,
    Records,
}
struct HistoryIcon {
    image: Arc<Image>,
    color: Option<u32>,
    source: Option<String>,
}
pub(crate) struct History {
    overlay: Option<(Overlay, FocusHandle, Option<FocusHandle>)>,
    web: bool,
    by_web: bool,
    web_enabled: bool,
    timeline_web: bool,
    web_data: Option<timeline::DisplayDay>,
    web_error: bool,
    favicon_read: Option<Task<()>>,
    by_category: bool,
    timeline_categories: bool,
    modes_ready: bool,
    calendar: Option<calendar::Calendar>,
    date_trigger: calendar::DateTrigger,
    overlay_date_trigger: calendar::DateTrigger,
    distribution_focus: [FocusHandle; 3],

    quick_edit: Option<Entity<crate::features::page_controls::quick_edit::QuickEdit>>,
    client: Rc<Client>,
    date: i64,
    target: Option<(String, String)>,
    data: Option<timeline::DisplayDay>,
    cache: HistoryCache,
    data_has_titles: bool,
    icons: HashMap<String, HistoryIcon>,
    read: Option<Task<()>>,
    error: bool,
    hours: f32,
    zoom_loaded: bool,
    zoom_view: timeline::ZoomState,
    records_view: records::RecordsState,
    offset: Option<i64>,
    plot_bounds: Rc<std::cell::Cell<Bounds<Pixels>>>,
    drag: Option<(Pixels, i64)>,
    minimum: Option<i64>,
    writing_minimum: bool,
    titles: bool,
    detail: Option<Entity<History>>,
    detail_focus: FocusHandle,
    detail_trigger: Option<FocusHandle>,
}
impl History {
    fn title(&self) -> String {
        self.target.as_ref().map_or_else(
            || text(self.client.locale.get(), "history.title"),
            |(_, name)| name.clone(),
        )
    }

    fn open_quick_edit(
        &mut self,
        key: String,
        name: String,
        web: bool,
        position: Point<Pixels>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let trigger = win.focused(cx);
        let edit = cx.new(|cx| {
            crate::features::page_controls::quick_edit::QuickEdit::new(
                self.client.clone(),
                key,
                name,
                web,
                position,
                win,
                cx,
            )
        });
        cx.subscribe_in(
            &edit,
            win,
            move |this, _, event: &crate::features::page_controls::quick_edit::Closed, win, cx| {
                this.quick_edit = None;
                if let Some(trigger) = &trigger {
                    win.focus(trigger, cx);
                }
                if event.0 {
                    this.refresh(cx);
                }
                cx.notify();
            },
        )
        .detach();
        self.quick_edit = Some(edit);
        cx.notify();
    }

    fn hourly_chart(&self, day: &HistoryDay, colors: Palette, dark: bool) -> HourlyChart {
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let anonymous = tr("common.anonymousActivity");
        let active = tr("hourlyActivityChart.activeMinutes");
        let grouped = self.client.navigation.get().hourly_by_category;
        let bars = std::array::from_fn(|hour| {
            let total = day.hours[hour];
            let mut parts = Vec::new();
            if grouped && total > 0 {
                for (name, hours) in &day.category_hours {
                    if hours[hour] > 0 {
                        parts.push((name, hours[hour]));
                    }
                }
                parts.sort_by_key(|(_, ms)| *ms);
            }
            HourlyBar {
                label: format!("{hour:02}:00 ･ {active} {}", duration(total)),
                fraction: total as f32 / HOUR as f32,
                segments: parts
                    .into_iter()
                    .map(|(name, ms)| HourlySegment {
                        label: name.clone(),
                        value: duration(ms),
                        fraction: ms as f32 / total as f32,
                        color: quietpro::activity_display_color(
                            self.source_color(day, name, true),
                            colors.panel,
                            dark,
                        ),
                        dotted: name == &anonymous,
                    })
                    .collect(),
            }
        });
        HourlyChart {
            bars,
            colors,
            total_color: quietpro::activity_display_color(
                u32::from(colors.accent) >> 8,
                colors.panel,
                dark,
            ),
            min_plot_height: px(0.),
            tooltip_id: "history-hour-tooltip",
        }
    }

    fn hourly(
        &self,
        day: Option<&HistoryDay>,
        colors: Palette,
        dark: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        use quietpro::{Icon, IconControl};
        let tr = |key| text(self.client.locale.get(), key);
        let grouped = self.client.navigation.get().hourly_by_category;
        let view = cx.weak_entity();
        content_card(colors.border, colors.panel)
            .min_h_0()
            .flex_1()
            .child(
                div()
                    .flex()
                    .flex_none()
                    .items_center()
                    .child(heading(tr("history.dailyHourlyActivity")).flex_1())
                    .child(
                        IconControl::new(
                            "history-hour-mode",
                            tr(if grouped {
                                "history.showTotalHourlyActivity"
                            } else {
                                "history.showHourlyActivityByCategory"
                            }),
                            Icon::Layers,
                        )
                        .with_tooltip()
                        .toggle(
                            colors,
                            grouped,
                            move |grouped, _, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    this.client.set_hourly_by_category(grouped);
                                    cx.notify();
                                });
                            },
                        ),
                    ),
            )
            .child(
                div()
                    .id("history-hourly-chart")
                    .test_support()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .mt(px(CARD_TITLE_GAP))
                    .children(day.map(|day| {
                        div()
                            .id(SharedString::from(format!("history-hours-{}", day.start)))
                            .flex()
                            .flex_col()
                            .flex_1()
                            .min_h_0()
                            .child(self.hourly_chart(day, colors, dark))
                    })),
            )
    }

    fn open_detail(
        &mut self,
        target: (String, String),
        web: bool,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.read = None;
        self.detail_trigger = win.focused(cx);
        win.focus(&self.detail_focus, cx);
        self.detail = Some(cx.new(|cx| {
            let icon = self
                .icons
                .get(&target.0)
                .map(|icon| (icon.image.clone(), icon.color));
            Self::new_source(
                self.client.clone(),
                self.presented_date(),
                Some(target),
                web,
                win,
                cx,
            )
            .with_target_icon(icon)
        }));
        cx.notify();
    }
    pub(crate) fn new(
        client: Rc<Client>,
        date: i64,
        target: Option<(String, String)>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        Self::new_source(client, date, target, false, win, cx)
    }
    pub(crate) fn new_source(
        client: Rc<Client>,
        date: i64,
        target: Option<(String, String)>,
        web: bool,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let detail = target.is_some();
        let hours = if detail { 24. } else { 4. };
        let zoom_view = timeline::ZoomState::new(hours, cx);
        let mut this = Self {
            quick_edit: None,
            overlay: None,
            web,
            by_web: false,
            web_enabled: false,
            timeline_web: false,
            web_data: None,
            web_error: false,
            favicon_read: None,
            by_category: false,
            timeline_categories: false,
            modes_ready: false,
            calendar: None,
            overlay_date_trigger: calendar::DateTrigger::new(quietpro::ControlSize::Medium, cx),
            date_trigger: calendar::DateTrigger::new(
                if detail {
                    quietpro::ControlSize::Medium
                } else {
                    quietpro::ControlSize::Large
                },
                cx,
            ),
            distribution_focus: std::array::from_fn(|_| cx.focus_handle()),
            client,
            date,
            target,
            data: None,
            cache: HistoryCache::default(),
            data_has_titles: false,
            icons: HashMap::new(),
            read: None,
            error: false,
            hours,
            zoom_loaded: false,
            zoom_view,
            records_view: records::RecordsState::new(cx),
            offset: None,
            plot_bounds: Default::default(),
            drag: None,
            minimum: None,
            writing_minimum: false,
            titles: detail,
            detail: None,
            detail_focus: cx.focus_handle(),
            detail_trigger: None,
        };
        cx.observe_window_activation(win, |this: &mut Self, win, cx| {
            if win.is_window_active() {
                this.refresh(cx);
            } else {
                this.read = None;
                if this.calendar.take().is_some() {
                    cx.notify();
                }
            }
        })
        .detach();
        this.refresh(cx);
        this
    }
    fn open_overlay(&mut self, kind: Overlay, win: &mut Window, cx: &mut Context<Self>) {
        if kind == Overlay::Zoom && self.timeline_data().is_none() {
            return;
        }
        let old = win.focused(cx);
        self.calendar = None;
        let focus = cx.focus_handle();
        win.focus(&focus, cx);
        self.overlay = Some((kind, focus, old));
        if kind == Overlay::Zoom {
            self.reset_zoom_position();
            self.prepare_zoom(cx);
        } else {
            self.records_view.close_details();
            if !self.titles {
                self.titles = true;
                self.refresh(cx);
            }
        }
        cx.notify();
    }
    fn close_overlay(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        self.calendar = None;
        self.drag = None;
        self.records_view.close_details();
        if let Some((kind, _, previous)) = self.overlay.take() {
            if kind == Overlay::Zoom && self.data.is_none() {
                win.focus(&self.date_trigger.focus, cx);
            } else if let Some(previous) = previous {
                win.focus(&previous, cx);
            }
        }
        cx.notify();
    }
    pub(crate) fn refresh(&mut self, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let date = self.date;
        let app = self.target.as_ref().map(|t| t.0.clone());
        let titles = self.titles;
        let web = self.web;
        let load_zoom = !self.zoom_loaded;
        self.read = Some(cx.spawn(async move |view, cx| {
            let modes = client.history_modes(None).await;
            let read_web_overview = !web && app.is_none() && !matches!(modes, Ok((_, false)));
            let _ = view.update(cx, |this, cx| {
                if let Ok((modes, enabled)) = modes {
                    this.web_enabled = enabled;
                    if !this.modes_ready && this.target.is_none() {
                        this.apply_modes(modes, enabled);
                    }
                    if !enabled {
                        this.by_web = false;
                        this.timeline_web = false;
                        this.records_view.web = false;
                        this.web_data = None;
                        this.web_error = false;
                    }
                }
                this.modes_ready = true;
                cx.notify();
            });
            if load_zoom {
                let saved = client.zoom(app.is_some(), None).await;
                let _ = view.update(cx, |this, cx| {
                    if !this.zoom_loaded {
                        if let Ok(hours) = saved {
                            this.hours = hours;
                        }
                        this.zoom_loaded = true;
                        if this.overlay.as_ref().is_some_and(|o| o.0 == Overlay::Zoom) {
                            this.reset_zoom_position();
                        }
                        cx.notify();
                    }
                });
            }
            let mut checked = HashSet::new();
            let mut checked_at = Instant::now();
            loop {
                let version = (client.locale.get(), client.activity_revision.get());
                let app_read = client.history(date, app.clone(), titles, web);
                let web_read = read_web_overview.then(|| client.history(date, None, titles, true));
                let result = app_read.await;
                let mut images = Vec::new();
                if !web && let Ok(day) = &result {
                    if checked_at.elapsed() >= Duration::from_secs(60) {
                        checked.clear();
                        checked_at = Instant::now();
                    }
                    let missing: Vec<_> = day
                        .apps
                        .iter()
                        .filter(|(key, _, _)| {
                            key != "activity:anonymous"
                                && app.as_ref().is_none_or(|target| target == key)
                                && checked.insert(key.clone())
                        })
                        .map(|app| app.0.clone())
                        .collect();
                    if !missing.is_empty() {
                        match client.icons(missing).await {
                            Ok(icons) => images = icons,
                            Err(error) => eprintln!("read History icons: {error}"),
                        }
                    }
                }
                let web_result = match web_read {
                    Some(read) => Some(read.await),
                    None => None,
                };
                let repeat = view.update(cx, |this, cx| {
                    if this.date != date {
                        return false;
                    }
                    if version != (client.locale.get(), client.activity_revision.get()) {
                        this.refresh(cx);
                        return false;
                    }
                    match result {
                        Ok(day) => {
                            let new_day = this
                                .data
                                .as_ref()
                                .is_none_or(|previous| previous.start != day.start);
                            if new_day {
                                this.cache_day();
                                this.offset = None;
                            }
                            if let Some(web_result) = web_result {
                                match web_result {
                                    Ok(day) => {
                                        this.web_data = Some(day.into());
                                        this.web_error = false;
                                    }
                                    Err(_) => {
                                        this.web_data = None;
                                        this.web_error = true;
                                    }
                                }
                            }
                            this.icons.retain(|key, _| {
                                this.target
                                    .as_ref()
                                    .is_some_and(|(target, _)| target == key)
                                    || day.apps.iter().any(|app| &app.0 == key)
                                    || this
                                        .web_data
                                        .as_ref()
                                        .is_some_and(|d| d.apps.iter().any(|app| &app.0 == key))
                            });
                            for (key, bytes) in images {
                                if !this
                                    .icons
                                    .get(&key)
                                    .is_some_and(|icon| icon.image.bytes == bytes)
                                {
                                    this.icons.insert(
                                        key,
                                        HistoryIcon {
                                            source: None,
                                            color: patina_activity_model::icon_color(&bytes),
                                            image: Arc::new(Image::from_bytes(
                                                ImageFormat::Png,
                                                bytes,
                                            )),
                                        },
                                    );
                                }
                            }
                            this.minimum.get_or_insert(day.minimum_seconds);
                            this.cache.set_version(version);
                            this.data_has_titles = titles;
                            this.data = Some(day.into());
                            if new_day
                                && this.overlay.as_ref().is_some_and(|o| o.0 == Overlay::Zoom)
                            {
                                this.prepare_zoom(cx);
                            }
                            if this.target.is_some() && this.offset.is_none() {
                                this.reset_zoom_position();
                            }
                            this.load_favicons(cx);
                            this.error = false;
                        }
                        Err(_) => this.error = true,
                    }
                    cx.notify();
                    this.data
                        .as_ref()
                        .is_some_and(|d| d.end > Local::now().timestamp_millis())
                        && !client.paused()
                        && !this.error
                });
                if !matches!(repeat, Ok(true)) {
                    break;
                }
                cx.background_executor()
                    .timer(Duration::from_secs(15))
                    .await;
            }
        }));
    }
    fn change_day(&mut self, date: i64, cx: &mut Context<Self>) {
        self.date = date;
        self.records_view.close_details();
        self.favicon_read = None;
        self.error = false;
        if self.target.is_some() || self.web {
            self.data = None;
            self.web_data = None;
            self.offset = None;
            self.web_error = false;
        } else if self.restore_day()
            && self.overlay.as_ref().is_some_and(|o| o.0 == Overlay::Zoom)
            && self.timeline_data().is_some()
        {
            self.prepare_zoom(cx);
        }
        self.refresh(cx);
        cx.notify();
    }
    fn presented_date(&self) -> i64 {
        self.data.as_ref().map_or(self.date, |day| day.start)
    }

    pub(crate) fn ready_to_present(&self) -> bool {
        self.data.is_some() || self.error
    }
    fn source_color(&self, day: &HistoryDay, key: &str, category: bool) -> u32 {
        if category {
            day.colors.get(key).copied().unwrap_or(0x8f98a8)
        } else {
            day.app_source_color(key, self.icons.get(key).and_then(|icon| icon.color))
        }
    }
    fn viewport(&self, day: &HistoryDay) -> (i64, i64) {
        let width = ((self.hours * HOUR as f32).round() as i64).min(day.end - day.start);
        let now = Local::now();
        let anchor = chrono::DateTime::from_timestamp_millis(day.start)
            .and_then(|date| {
                date.with_timezone(&Local)
                    .date_naive()
                    .and_time(now.time())
                    .and_local_timezone(Local)
                    .earliest()
            })
            .map_or(day.start, |date| date.timestamp_millis());
        let left = self
            .offset
            .unwrap_or_else(|| timeline::initial_offset(day.start, day.end, self.hours, anchor))
            .clamp(day.start, day.end - width);
        (left, left + width)
    }
    fn zoom(&mut self, delta: f32, ratio: f32, cx: &mut Context<Self>) {
        self.records_view.close_details();
        if let Some(day) = self.timeline_data() {
            let (a, b) = self.viewport(day);
            self.hours = (((self.hours + delta) * 5.).round() / 5.)
                .clamp(1., (day.end - day.start) as f32 / HOUR as f32);
            self.offset = Some(
                a + ((b - a) as f32 * ratio) as i64 - (self.hours * HOUR as f32 * ratio) as i64,
            );
            {
                self.zoom_loaded = true;
                let save = self
                    .client
                    .zoom(self.target.is_some(), Some(self.hours.min(24.)));
                cx.spawn(async move |_, _| {
                    if let Err(error) = save.await {
                        eprintln!("save detail zoom: {error}");
                    }
                })
                .detach();
            }
            cx.notify();
        }
    }
    fn pan(&mut self, dir: i64, cx: &mut Context<Self>) {
        self.records_view.close_details();
        if let Some(day) = self.timeline_data() {
            let (a, b) = self.viewport(day);
            self.offset = Some(a + dir * (b - a) / 2);
            cx.notify();
        }
    }
}
impl History {
    fn day_timeline(
        &self,
        day: Option<&timeline::DisplayDay>,
        colors: Palette,
        dark: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        use quietpro::{Icon, IconControl};
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let (segments, legends) = day
            .map(|day| {
                let color_for = |key: &str| {
                    quietpro::activity_display_color(
                        self.source_color(day, key, self.timeline_categories),
                        colors.canvas,
                        dark,
                    )
                };
                let (start, end) = (day.start, day.end);
                let overview_records = day.overview(self.timeline_categories);
                let segments = overview_records
                    .iter()
                    .map(|r| {
                        let a = r.start.max(start);
                        let b = r.end.min(end);
                        quietpro::TimelineSegment {
                            anonymous: r.key == "activity:anonymous",
                            start_fraction: (a - start) as f32 / (end - start) as f32,
                            end_fraction: (b - start) as f32 / (end - start) as f32,
                            color: color_for(if self.timeline_categories {
                                &r.category
                            } else {
                                &r.key
                            }),
                            description: format!(
                                "{} ･ {}–{} ･ {}",
                                if self.timeline_categories {
                                    &r.category
                                } else {
                                    &r.name
                                },
                                stamp(a, "%H:%M:%S"),
                                stamp(b, "%H:%M:%S"),
                                duration(r.group_duration.min((b - a).max(0))),
                            ),
                        }
                    })
                    .collect();
                let legend: Vec<_> = if self.timeline_categories {
                    day.categories.iter().map(|(key, _)| (key, key)).collect()
                } else {
                    day.apps.iter().map(|(key, name, _)| (key, name)).collect()
                };
                let legends = legend
                    .iter()
                    .copied()
                    .map(|(key, name)| (name.clone(), color_for(key)))
                    .collect();
                (segments, legends)
            })
            .unwrap_or_default();
        let mode_label = self.timeline_mode_label();
        let mut actions = quietpro::icon_actions().child(
            IconControl::new("timeline-mode", mode_label, Icon::Tags)
                .disabled(!self.modes_ready)
                .with_tooltip()
                .action(
                    colors,
                    cx.listener(|this, _, _, cx| {
                        this.cycle_timeline(cx);
                    }),
                ),
        );
        for (id, key, icon, kind) in [
            (
                "zoom",
                "history.openTimelineZoom",
                Icon::ZoomIn,
                Overlay::Zoom,
            ),
            (
                "records",
                "history.openTimeline",
                Icon::Expand,
                Overlay::Records,
            ),
        ] {
            let button = IconControl::new(id, tr(key), icon)
                .disabled(kind == Overlay::Zoom && day.is_none())
                .with_tooltip()
                .action(
                    colors,
                    cx.listener(move |this, _, win, cx| this.open_overlay(kind, win, cx)),
                );
            actions = actions.child(button.when(kind == Overlay::Zoom, |button| {
                button.track_focus(&self.zoom_view.trigger_focus)
            }));
        }
        div().flex_none().child(quietpro::TimelineOverview {
            title: tr("history.timelineAxis"),
            legends,
            segments,
            actions: actions.into_any_element(),
            notice: (self.timeline_web && self.web_error).then(|| tr("destinationDetail.dayError")),
            colors,
        })
    }
}

impl Render for History {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = self.client.palette(win);
        if let Some((key, name)) = &self.target {
            return self.render_detail(key, name, colors, win, cx);
        }
        let dark = self.client.dark(win);
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);

        use quietpro::Icon;
        let mut page = shell(colors);
        let retry = (self.error || self.web_error).then(|| {
            let accessible_name = tr("common.retry");
            quietpro::text_button("retry-history", tr("common.retry"), colors, true)
                .accessibility_label(accessible_name)
                .on_click(cx.listener(|this, _, _, cx| this.refresh(cx)))
        });
        let header = page_title_row(self.title(), Icon::Clock, colors)
            .children(self.requested_date_error().map(label))
            .children(retry)
            .child(self.date_controls(&self.date_trigger, colors, win, cx));
        if self.calendar.is_some() && self.overlay.is_none() {
            page = page.child(self.calendar_popup(colors, win, cx));
        }
        let day = self.data.as_ref();
        page = page.child(header);
        {
            let timeline = self.day_timeline(self.timeline_data(), colors, dark, cx);
            let (total, active, peak) = day
                .map(|day| {
                    let peak = day
                        .hours
                        .iter()
                        .enumerate()
                        .max_by_key(|(h, ms)| (**ms, std::cmp::Reverse(*h)))
                        .unwrap();
                    let active =
                        day.records
                            .iter()
                            .filter(|r| r.end > r.start)
                            .fold(None::<(i64, i64)>, |bounds, r| {
                                Some(bounds.map_or((r.start, r.end), |(a, b)| {
                                    (a.min(r.start), b.max(r.end))
                                }))
                            })
                            .map(|(a, b)| format!("{} - {}", stamp(a, "%H:%M"), stamp(b, "%H:%M")))
                            .unwrap_or_else(|| "—".into());
                    let peak = if *peak.1 == 0 {
                        "—".to_owned()
                    } else {
                        format!("{:02}:00 ･ {}", peak.0, duration(*peak.1))
                    };
                    (duration(day.apps.iter().map(|a| a.2).sum()), active, peak)
                })
                .unwrap_or_default();
            let summary_row = |name: &'static str, value: String| {
                div()
                    .id(name)
                    .test_support()
                    .w_full()
                    .flex()
                    .justify_between()
                    .items_baseline()
                    .gap(px(12.))
                    .child(
                        label(tr(name))
                            .text_size(px(14.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(colors.secondary),
                    )
                    .child(
                        label(value)
                            .text_size(px(14.))
                            .font_weight(FontWeight::MEDIUM),
                    )
            };
            let summary = content_card(colors.border, colors.panel)
                .flex_1()
                .gap(px(CARD_TITLE_GAP))
                .child(heading(tr("history.daySummary")).flex_none())
                .child(
                    div()
                        .flex_1()
                        .min_h_0()
                        .flex()
                        .items_center()
                        .gap(px(16.))
                        .child(
                            div()
                                .w(relative(0.355))
                                .flex()
                                .flex_col()
                                .gap(px(4.))
                                .child(
                                    label(tr("history.summaryDuration"))
                                        .text_size(px(14.))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(colors.secondary),
                                )
                                .child(
                                    label(total)
                                        .min_h(px(28.))
                                        .text_size(px(20.))
                                        .font_weight(FontWeight::BOLD),
                                ),
                        )
                        .child(
                            div()
                                .flex_1()
                                .flex()
                                .flex_col()
                                .gap(px(8.))
                                .child(summary_row("history.activeSpan", active))
                                .child(summary_row("history.peakHour", peak)),
                        ),
                );
            let hourly = self.hourly(self.data.as_deref(), colors, dark, cx);
            let left_col = div()
                .flex_none()
                .w(px(((f32::from(crate::windows::main::page_width(
                    win.viewport_size().width,
                )) - 2. * (quietpro::CONTENT_INSET + 1.)
                    - quietpro::CARD_GAP)
                    * 0.45)
                    .max(260.)))
                .min_h_0()
                .flex()
                .flex_col()
                .gap(px(quietpro::CARD_GAP))
                .child(div().flex_1().flex_grow(2.).min_h_0().flex().child(summary))
                .child(div().flex_1().flex_grow(3.).min_h_0().flex().child(hourly));
            let mut right_col = content_card(colors.border, colors.panel)
                .flex_1()
                .min_w_0()
                .min_h_0()
                .gap(px(CARD_TITLE_GAP))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .child(heading(tr("history.dayDistribution")).flex_1())
                        .child({
                            let view = cx.weak_entity();
                            quietpro::segmented_with_medium_labels(
                                ("distribution-mode", tr("data.destinationMode")),
                                std::array::from_fn::<_, 3, _>(|i| {
                                    let key = [
                                        "data.destinationApp",
                                        "data.destinationCategory",
                                        "data.destinationWeb",
                                    ][i];
                                    (i, tr(key), None, self.distribution_focus[i].clone())
                                })
                                .into_iter()
                                .take(if self.web_enabled { 3 } else { 2 }),
                                if self.by_web {
                                    2
                                } else {
                                    usize::from(self.by_category)
                                },
                                self.modes_ready,
                                colors,
                                quietpro::ControlSize::Medium,
                                move |mode, _, cx| {
                                    let _ = view.update(cx, |this, cx| {
                                        this.by_category = mode == 1;
                                        this.by_web = mode == 2;
                                        this.remember_modes(cx);
                                        cx.notify();
                                    });
                                },
                            )
                        }),
                );
            let mut rows = div()
                .id("history-apps")
                .test_support()
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col();
            let distribution = if self.by_web {
                self.web_data.as_ref()
            } else {
                day
            };
            let distribution_total =
                distribution.map_or(0, |d| d.apps.iter().map(|a| a.2).sum::<i64>());
            let distribution_color = |key: &str, background| {
                quietpro::activity_display_color(
                    distribution.map_or(0x8f98a8, |d| self.source_color(d, key, self.by_category)),
                    background,
                    dark,
                )
            };
            let items: Vec<_> = if self.by_category {
                let mut v: Vec<_> = distribution
                    .into_iter()
                    .flat_map(|d| &d.categories)
                    .map(|(n, t)| (n, n, *t))
                    .collect();
                v.sort_by_key(|v| std::cmp::Reverse(v.2));
                v
            } else {
                distribution
                    .into_iter()
                    .flat_map(|d| d.apps.iter().map(|(k, n, t)| (k, n, *t)))
                    .collect()
            };
            for (key, n, ms) in items {
                let target = (key.clone(), n.clone());
                let open = format_text(locale, "destinationDetail.open", &[("name", n.clone())]);
                let ratio = ms as f32 / distribution_total.max(1) as f32;
                let mark = if !self.by_category && key == "activity:anonymous" {
                    crate::features::page_controls::anonymous::icon(
                        distribution_color(key, colors.panel),
                        n.clone(),
                        quietpro::UNFRAMED_APP_ICON_SIZE,
                    )
                    .into_any_element()
                } else if self.by_category {
                    div()
                        .size(px(quietpro::LEGEND_DOT_SIZE))
                        .flex_none()
                        .rounded_full()
                        .bg(distribution_color(key, colors.panel))
                        .into_any_element()
                } else {
                    quietpro::unframed_app_icon(
                        SharedString::from(format!("history-icon-{key}")),
                        n.clone(),
                        self.icons.get(key).map(|icon| icon.image.clone()),
                        if self.by_web {
                            quietpro::Icon::Globe
                        } else {
                            quietpro::Icon::AppWindow
                        },
                        colors,
                    )
                    .into_any_element()
                };
                let mark = if !self.by_category && key != "activity:anonymous" {
                    let view = cx.entity().downgrade();
                    let accessible_target = target.clone();
                    let web = self.by_web;
                    quietpro::unframed_app_icon_button(
                        SharedString::from(format!("open-history-{key}")),
                        open,
                        colors,
                    )
                    .child(mark)
                    .on_a11y_action(AccessibleAction::Click, move |_, win, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.open_detail(accessible_target.clone(), web, win, cx);
                        });
                    })
                    .on_click(cx.listener(move |this, event: &ClickEvent, win, cx| {
                        if event.is_keyboard() || event.click_count() == 2 {
                            this.open_detail(target.clone(), web, win, cx);
                        }
                    }))
                    .into_any_element()
                } else {
                    mark
                };
                let quick_key = key.to_owned();
                let quick_name = n.clone();
                let quick_web = self.by_web;
                rows = rows.child(
                    quietpro::distribution_row(
                        SharedString::from(format!("dist-{key}")),
                        n.clone(),
                        if !self.by_category && key == "activity:anonymous" {
                            crate::features::page_controls::anonymous::name(colors.text)
                                .into_any_element()
                        } else {
                            label(n.clone()).into_any_element()
                        },
                        quietpro::DistributionValue {
                            duration: duration(ms),
                            ratio,
                            color: distribution_color(
                                key,
                                colors.panel.blend(colors.secondary.opacity(0.05)),
                            ),
                        },
                        mark,
                        colors,
                    )
                    .when(
                        !self.by_category && key != "activity:anonymous",
                        |row| {
                            row.on_mouse_down(
                                MouseButton::Right,
                                cx.listener(move |this, e: &MouseDownEvent, win, cx| {
                                    cx.stop_propagation();
                                    this.open_quick_edit(
                                        quick_key.clone(),
                                        quick_name.clone(),
                                        quick_web,
                                        e.position,
                                        win,
                                        cx,
                                    );
                                }),
                            )
                        },
                    ),
                );
            }
            if distribution.is_none() && (self.error || (self.by_web && self.web_error)) {
                rows = rows.child(label(tr("destinationDetail.dayError")));
            }
            right_col = right_col.child(rows);
            page = page.child(
                div()
                    .id("history-overview")
                    .test_support()
                    .flex_1()
                    .min_h_0()
                    .overflow_hidden()
                    .flex()
                    .flex_col()
                    .gap(px(quietpro::CARD_GAP))
                    .child(timeline)
                    .child(
                        div()
                            .flex_1()
                            .min_h_0()
                            .flex()
                            .gap(px(quietpro::CARD_GAP))
                            .child(left_col)
                            .child(right_col),
                    ),
            );
            page = page.children(self.render_overlay(colors, win, cx));
        }
        if let Some(detail) = &self.detail {
            let view = cx.weak_entity();
            return page.child(Self::detail_dialog(
                detail.clone(),
                &self.detail_focus,
                tr("common.close"),
                colors,
                move |win, cx| {
                    let _ = view.update(cx, |this, cx| {
                        this.detail = None;
                        if let Some(trigger) = this.detail_trigger.take() {
                            win.focus(&trigger, cx);
                        }
                        this.refresh(cx);
                        cx.notify();
                    });
                },
                win,
                cx,
            ));
        }
        page.children(self.quick_edit.clone())
    }
}
impl History {
    fn render_overlay(
        &self,
        colors: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<quietpro::ModalDialog> {
        let view = cx.weak_entity();
        let (kind, focus, _) = self.overlay.as_ref()?;
        let (title, content) = match kind {
            Overlay::Zoom => ("history.timelineZoom", self.zoom_popup(colors, win, cx)),
            Overlay::Records => ("history.timeline", self.records_popup(colors, win, cx)),
        };
        Some(
            quietpro::modal_dialog(
                text(self.client.locale.get(), title),
                focus.clone(),
                content,
                move |win, cx| {
                    let _ = view.update(cx, |this, cx| this.close_overlay(win, cx));
                },
                cx,
            )
            .close_on_escape(self.calendar.is_none())
            .on_ok(|_, _, cx| {
                cx.propagate();
                false
            }),
        )
    }
}
impl History {
    fn timeline_data(&self) -> Option<&timeline::DisplayDay> {
        if self.timeline_web && !self.web {
            self.web_data.as_ref()
        } else {
            self.data.as_ref()
        }
    }
    fn timeline_mode_label(&self) -> String {
        let current = if self.timeline_web || self.web {
            "data.destinationWeb"
        } else if self.timeline_categories {
            "data.destinationCategory"
        } else {
            "data.destinationApp"
        };
        let next = if self.timeline_web || (self.timeline_categories && !self.web_enabled) {
            "data.destinationApp"
        } else if self.timeline_categories && self.web_enabled {
            "data.destinationWeb"
        } else {
            "data.destinationCategory"
        };
        format_text(
            self.client.locale.get(),
            "history.timelineModeSwitch",
            &[
                ("current", text(self.client.locale.get(), current)),
                ("next", text(self.client.locale.get(), next)),
            ],
        )
    }
    fn apply_modes(&mut self, modes: [u8; 2], enabled: bool) {
        self.web_enabled = enabled;
        self.by_category = modes[0] == 1;
        self.by_web = modes[0] == 2 && enabled;
        self.timeline_categories = modes[1] == 1;
        self.timeline_web = modes[1] == 2 && enabled;
    }
    fn modes(&self) -> [u8; 2] {
        [
            if self.by_web {
                2
            } else {
                u8::from(self.by_category)
            },
            if self.timeline_web {
                2
            } else {
                u8::from(self.timeline_categories)
            },
        ]
    }
    fn remember_modes(&self, cx: &mut Context<Self>) {
        let write = self.client.history_modes(Some(self.modes()));
        cx.spawn(async move |_, _| {
            if let Err(error) = write.await {
                eprintln!("history modes: {error}");
            }
        })
        .detach();
    }
    fn cycle_timeline(&mut self, cx: &mut Context<Self>) {
        if let Some(day) = self.timeline_data().or(self.data.as_ref()) {
            self.offset = Some(self.viewport(day).0);
        }
        self.drag = None;
        self.records_view.close_details();
        if self.timeline_web {
            self.timeline_web = false;
            self.timeline_categories = false;
        } else if self.timeline_categories {
            self.timeline_categories = false;
            self.timeline_web = self.web_enabled;
        } else {
            self.timeline_categories = true;
        }
        self.remember_modes(cx);
        cx.notify();
    }
}
