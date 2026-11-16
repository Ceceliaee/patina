use crate::{format::duration, windows_host::Client};
use chrono::Local;
use gpui_kit::{prelude::*, *};
use patina_recorder::{HistoryDay, HistoryRecord, Locale, format_text, text};
use quietpro::{CARD_TITLE_GAP, content_card, heading, page as shell, page_title_row};
use quietpro::{
    HOURLY_AXIS_FONT_SIZE, HOURLY_AXIS_GAP, HOURLY_BAR_TOP_RADIUS, HOURLY_BAR_WIDTH,
    HOURLY_PLOT_MIN_HEIGHT, Palette,
};
use std::{
    collections::{HashMap, HashSet},
    rc::Rc,
    sync::Arc,
    time::{Duration, Instant},
};

mod calendar;
mod icons;
mod records;
mod timeline;

const HOUR: i64 = 3_600_000;
use crate::page_controls::{label, stamp};

fn detail_record(r: &HistoryRecord, index: usize, titles: bool, colors: Palette) -> Stateful<Div> {
    let range = format!(
        "{}–{}",
        stamp(r.start, "%H:%M:%S"),
        stamp(r.end, "%H:%M:%S")
    );
    let elapsed = if r.end - r.start < 60_000 {
        format!("{}s", (r.end - r.start) / 1000)
    } else {
        duration(r.end - r.start)
    };
    let mut record = div()
        .id(("detail-record", index))
        .role(Role::Group)
        .aria_label(format!("{range}  {}  {elapsed}", r.name))
        .flex_none()
        .flex()
        .flex_col()
        .gap(px(8.))
        .py(px(8.))
        .border_b_1()
        .border_color(colors.border)
        .child(
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap(px(16.))
                .child(label(range))
                .child(label(elapsed).flex_none()),
        );
    if titles {
        for (a, b, title) in &r.titles {
            record = record.child(
                label(format!(
                    "{}–{}  {title}",
                    stamp(*a, "%H:%M:%S"),
                    stamp(*b, "%H:%M:%S")
                ))
                .pl(px(12.))
                .text_color(colors.secondary)
                .text_size(px(12.)),
            );
        }
    }
    record
}

fn detail_timeline(
    total: i64,
    locale: Locale,
    colors: Palette,
    tools: Stateful<Div>,
    strip: Stateful<Div>,
    range: String,
) -> Div {
    div()
        .flex_none()
        .flex()
        .flex_col()
        .gap(px(12.))
        .pb(px(16.))
        .border_b_1()
        .border_color(colors.border)
        .child(
            div()
                .flex()
                .items_baseline()
                .gap(px(8.))
                .child(
                    label(text(locale, "history.activeDuration"))
                        .text_color(colors.secondary)
                        .text_size(px(12.)),
                )
                .child(
                    label(duration(total))
                        .text_size(px(20.))
                        .font_weight(FontWeight::SEMIBOLD),
                ),
        )
        .child(tools)
        .child(strip.h(px(40.)))
        .child(label(range).text_color(colors.secondary).text_size(px(12.)))
}

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
pub(super) struct History {
    overlay: Option<(Overlay, FocusHandle, Option<FocusHandle>)>,
    web: bool,
    by_web: bool,
    timeline_web: bool,
    web_data: Option<HistoryDay>,
    web_error: bool,
    favicon_read: Option<Task<()>>,
    by_category: bool,
    timeline_categories: bool,
    grouped_hours: bool,
    hour_focus: [FocusHandle; 24],
    active_hour: Option<usize>,
    calendar: Option<calendar::Calendar>,
    date_focus: FocusHandle,
    distribution_focus: [FocusHandle; 3],
    date_bounds: Rc<std::cell::Cell<Bounds<Pixels>>>,

    client: Rc<Client>,
    date: i64,
    target: Option<(String, String)>,
    data: Option<HistoryDay>,
    icons: HashMap<String, HistoryIcon>,
    read: Option<Task<()>>,
    error: bool,
    hours: f32,
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
    fn hourly(&self, day: &HistoryDay, colors: Palette, dark: bool, cx: &mut Context<Self>) -> Div {
        use quietpro::{Icon, IconControl};
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let color_for = |key: &str, category: bool, background: Rgba| {
            quietpro::activity_display_color(
                self.source_color(day, key, category),
                background,
                dark,
            )
        };
        let mut tooltip = None;
        let mut bars = div()
            .relative()
            .flex()
            .items_end()
            .flex_1()
            .w_full()
            .min_h(px(HOURLY_PLOT_MIN_HEIGHT))
            .border_b_1()
            .border_color(colors.track);
        for (h, &ms) in day.hours.iter().enumerate() {
            let mut tip = format!(
                "{h:02}:00 · {} {}",
                tr("hourlyActivityChart.activeMinutes"),
                duration(ms)
            );
            let mut bar = div()
                .w(px(HOURLY_BAR_WIDTH))
                .rounded_t(px(HOURLY_BAR_TOP_RADIUS))
                .h(relative((ms as f32 / HOUR as f32).min(1.)))
                .bg(quietpro::activity_display_color(
                    u32::from(colors.accent) >> 8,
                    colors.panel,
                    dark,
                ))
                .flex()
                .flex_col_reverse();
            if self.grouped_hours && ms > 0 {
                let mut segments: Vec<_> = day
                    .category_hours
                    .iter()
                    .filter(|(_, hours)| hours[h] > 0)
                    .collect();
                segments.sort_by_key(|(_, hours)| hours[h]);
                for (name, hours) in segments.iter().rev() {
                    tip.push_str(&format!("\n{name} {}", duration(hours[h])));
                }
                let top_segment = segments.len().saturating_sub(1);
                for (index, (name, hours)) in segments.into_iter().enumerate() {
                    bar = bar.child(
                        div()
                            .w_full()
                            .h(relative(hours[h] as f32 / ms as f32))
                            .when(index == top_segment, |s| {
                                s.rounded_t(px(HOURLY_BAR_TOP_RADIUS))
                            })
                            .bg(color_for(name, true, colors.panel)),
                    );
                }
            }
            if ms > 0 && self.active_hour == Some(h) {
                tooltip = Some(
                    content_card(colors.border, colors.panel)
                        .id("history-hour-tooltip")
                        .role(Role::Tooltip)
                        .aria_label(tip.clone())
                        .absolute()
                        .bottom(px(4.))
                        .when_else(h < 12, |s| s.right_0(), |s| s.left_0())
                        .p(px(8.))
                        .text_size(px(12.))
                        .text_color(colors.text)
                        .child(tip.clone()),
                );
            }
            bars = bars.child(
                div()
                    .id(("history-hour", h))
                    .role(Role::Label)
                    .aria_value(tip)
                    .h_full()
                    .flex_1()
                    .flex()
                    .items_end()
                    .justify_center()
                    .when(ms > 0, |s| {
                        s.hover(move |s| s.bg(colors.hover))
                            .track_focus(&self.hour_focus[h])
                            .focus_visible(move |s| s.border_1().border_color(colors.secondary))
                            .on_hover(cx.listener(move |this, over, _, cx| {
                                this.show_hour(h, *over, cx);
                            }))
                            .on_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| {
                                if e.keystroke.key == "escape" && this.active_hour.take().is_some()
                                {
                                    cx.notify();
                                    cx.stop_propagation();
                                }
                            }))
                    })
                    .child(bar),
            );
        }
        let hourly = content_card(colors.border, colors.panel)
            .min_h_0()
            .flex_1()
            .child(
                div()
                    .flex()
                    .items_center()
                    .child(heading(tr("history.dailyHourlyActivity")).flex_1())
                    .child(
                        IconControl::new(
                            "history-hour-mode",
                            tr(if self.grouped_hours {
                                "history.showTotalHourlyActivity"
                            } else {
                                "history.showHourlyActivityByCategory"
                            }),
                            Icon::Layers,
                        )
                        .action(
                            colors,
                            cx.listener(|this, _, _, cx| {
                                this.grouped_hours = !this.grouped_hours;
                                cx.notify();
                            }),
                        ),
                    ),
            )
            .child(bars.children(tooltip).mt(px(CARD_TITLE_GAP)))
            .child(axis().mt(px(HOURLY_AXIS_GAP)).text_color(colors.secondary));
        hourly
    }

    fn show_hour(&mut self, hour: usize, visible: bool, cx: &mut Context<Self>) {
        if visible || self.active_hour == Some(hour) {
            let next = visible.then_some(hour);
            if self.active_hour != next {
                self.active_hour = next;
                cx.notify();
            }
        }
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
            Self::new_source(self.client.clone(), self.date, Some(target), web, win, cx)
        }));
        cx.notify();
    }
    pub(super) fn new(
        client: Rc<Client>,
        date: i64,
        target: Option<(String, String)>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        Self::new_source(client, date, target, false, win, cx)
    }
    pub(super) fn new_source(
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
        let hour_focus = std::array::from_fn(|hour| {
            let focus = cx.focus_handle().tab_stop(true);
            cx.on_focus(&focus, win, move |_, win, cx| {
                cx.defer_in(win, move |this, _, cx| this.show_hour(hour, true, cx));
            })
            .detach();
            cx.on_blur(&focus, win, move |_, win, cx| {
                cx.defer_in(win, move |this, _, cx| this.show_hour(hour, false, cx));
            })
            .detach();
            focus
        });
        let mut this = Self {
            overlay: None,
            web,
            by_web: false,
            timeline_web: false,
            web_data: None,
            web_error: false,
            favicon_read: None,
            by_category: false,
            timeline_categories: false,
            grouped_hours: false,
            hour_focus,
            active_hour: None,
            calendar: None,
            date_focus: cx.focus_handle(),
            distribution_focus: std::array::from_fn(|_| cx.focus_handle()),
            date_bounds: Default::default(),
            client,
            date,
            target,
            data: None,
            icons: HashMap::new(),
            read: None,
            error: false,
            hours,
            zoom_view,
            records_view: records::RecordsState::new(cx),
            offset: None,
            plot_bounds: Default::default(),
            drag: None,
            minimum: None,
            writing_minimum: false,
            titles: false,
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
        let focus = cx.focus_handle();
        win.focus(&focus, cx);
        self.overlay = Some((kind, focus, old));
        if kind == Overlay::Zoom {
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
        self.drag = None;
        self.records_view.close_details();
        if let Some((_, _, Some(old))) = self.overlay.take() {
            win.focus(&old, cx);
        }
        cx.notify();
    }
    pub(super) fn refresh(&mut self, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let date = self.date;
        let app = self.target.as_ref().map(|t| t.0.clone());
        let titles = self.titles;
        let web = self.web;
        self.read = Some(cx.spawn(async move |view, cx| {
            let mut checked = HashSet::new();
            let mut checked_at = Instant::now();
            loop {
                let result = client.history(date, app.clone(), titles, web).await;
                let web_result = if !web && app.is_none() {
                    Some(client.history(date, None, titles, true).await)
                } else {
                    None
                };
                let mut images = Vec::new();
                if !web && let Ok(day) = &result {
                    if checked_at.elapsed() >= Duration::from_secs(60) {
                        checked.clear();
                        checked_at = Instant::now();
                    }
                    let missing: Vec<_> = day
                        .apps
                        .iter()
                        .filter(|app| {
                            app.0 != "activity:anonymous" && checked.insert(app.0.clone())
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
                let repeat = view.update(cx, |this, cx| {
                    if let Some(web_result) = web_result {
                        match web_result {
                            Ok(day) => {
                                this.web_data = Some(day);
                                this.web_error = false;
                            }
                            Err(_) => {
                                this.web_data = None;
                                this.web_error = true;
                            }
                        }
                    }
                    match result {
                        Ok(day) => {
                            this.icons.retain(|key, _| {
                                day.apps.iter().any(|app| &app.0 == key)
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
                                            color: patina_recorder::icon_color(&bytes),
                                            image: Arc::new(Image::from_bytes(
                                                ImageFormat::Png,
                                                bytes,
                                            )),
                                        },
                                    );
                                }
                            }
                            this.minimum.get_or_insert(day.minimum_seconds);
                            this.data = Some(day);
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
        self.active_hour = None;
        self.date = date;
        self.records_view.close_details();
        self.data = None;
        self.web_data = None;
        self.web_error = false;
        self.favicon_read = None;
        self.offset = None;
        self.error = false;
        self.refresh(cx);
        cx.notify();
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
        let anchor = day.records.first().map_or(day.start, |r| r.start);
        let left = self
            .offset
            .unwrap_or(anchor - width / 2)
            .clamp(day.start, day.end - width);
        (left, left + width)
    }
    fn zoom(&mut self, delta: f32, ratio: f32, cx: &mut Context<Self>) {
        if let Some(day) = self.timeline_data() {
            let (a, b) = self.viewport(day);
            self.hours = (((self.hours + delta) * 5.).round() / 5.)
                .clamp(1., (day.end - day.start) as f32 / HOUR as f32);
            self.offset = Some(
                a + ((b - a) as f32 * ratio) as i64 - (self.hours * HOUR as f32 * ratio) as i64,
            );
            cx.notify();
        }
    }
    fn pan(&mut self, dir: i64, cx: &mut Context<Self>) {
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
        day: &HistoryDay,
        colors: Palette,
        dark: bool,
        cx: &mut Context<Self>,
    ) -> Div {
        use quietpro::{Icon, IconControl};
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let color_for = |key: &str| {
            quietpro::activity_display_color(
                self.source_color(day, key, self.timeline_categories),
                colors.canvas,
                dark,
            )
        };
        let (start, end) = (day.start, day.end);
        let mut full = div()
            .relative()
            .w_full()
            .flex_1()
            .min_h(px(24.))
            .border_1()
            .border_color(colors.border.opacity(0.65))
            .bg(colors.canvas)
            .rounded(px(6.))
            .overflow_hidden();
        for r in day
            .records
            .iter()
            .filter(|_| !self.timeline_web || self.web_data.is_some())
        {
            full = full.child(
                div()
                    .absolute()
                    .top(px(5.))
                    .bottom(px(5.))
                    .rounded(px(3.))
                    .left(relative((r.start - start) as f32 / (end - start) as f32))
                    .w(relative((r.end - r.start) as f32 / (end - start) as f32))
                    .bg(color_for(if self.timeline_categories {
                        &r.category
                    } else {
                        &r.key
                    })),
            );
        }
        let mut toolbar = div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(heading(tr("history.timelineAxis")).flex_1());
        let legend: Vec<_> = if self.timeline_web && self.web_data.is_none() {
            Vec::new()
        } else if self.timeline_categories {
            day.categories.iter().map(|(key, _)| (key, key)).collect()
        } else {
            day.apps.iter().map(|(key, name, _)| (key, name)).collect()
        };
        for (key, name) in legend.iter().copied().take(7) {
            toolbar = toolbar.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(4.))
                    .child(div().size(px(6.)).rounded_full().bg(color_for(key)))
                    .child(name.clone())
                    .text_size(px(11.)),
            );
        }
        let mode_label = self.timeline_mode_label();
        let mut actions = quietpro::icon_actions().child(
            IconControl::new("timeline-mode", mode_label, Icon::Tags).action(
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
            actions = actions.child(IconControl::new(id, tr(key), icon).action(
                colors,
                cx.listener(move |this, _, win, cx| this.open_overlay(kind, win, cx)),
            ));
        }
        div().flex_1().min_h(px(120.)).flex().child(
            content_card(colors.border, colors.panel)
                .flex_1()
                .gap(px(8.))
                .child(toolbar.child(actions))
                .child(full)
                .when(self.timeline_web && self.web_error, |card| {
                    card.child(label(tr("destinationDetail.dayError")))
                })
                .child(
                    div()
                        .w_full()
                        .flex()
                        .justify_between()
                        .text_color(colors.secondary)
                        .text_size(px(11.))
                        .children(["00:00", "06:00", "12:00", "18:00", "24:00"]),
                ),
        )
    }
}

impl Render for History {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = self.client.palette(win);
        let dark = self.client.dark(win);
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);

        use quietpro::Icon;
        let detail = self.target.is_some();
        let mut page = shell(colors).when(detail, |page| page.p_0().min_h_0());
        let name = self
            .target
            .as_ref()
            .map_or_else(|| tr("history.title"), |t| t.1.clone());
        let header = if detail {
            div()
                .flex()
                .flex_none()
                .items_center()
                .h(px(32.))
                .gap(px(16.))
                .pr(px(44.))
                .child(heading(name).flex_1().min_w_0().truncate())
        } else {
            page_title_row(name, Icon::Clock, colors)
        }
        .child(self.date_controls(colors, win, cx));
        let retry = (self.error || self.web_error).then(|| {
            let accessible_name = tr("common.retry");
            quietpro::text_button("retry-history", tr("common.retry"), colors, true)
                .accessibility_label(accessible_name)
                .on_click(cx.listener(|this, _, _, cx| this.refresh(cx)))
        });
        if self.calendar.is_some() {
            page = page.child(self.calendar_popup(colors, win, cx));
        }
        let Some(day) = &self.data else {
            let page = page
                .child(header)
                .children(retry)
                .child(label(tr(if self.error {
                    "destinationDetail.dayError"
                } else {
                    "common.loading"
                })));
            if self
                .overlay
                .as_ref()
                .is_some_and(|o| o.0 == Overlay::Records)
            {
                let popup = self.records_popup(colors, win, cx);
                return page.child(self.modal(popup, colors, cx));
            }
            return page;
        };
        let timeline_day = self.timeline_data().unwrap_or(day);
        let (start, end) = (day.start, day.end);
        let total = if self.target.is_some() {
            day.records.iter().map(|r| r.end - r.start).sum()
        } else {
            day.apps.iter().map(|a| a.2).sum()
        };
        page = page.child(header).children(retry);
        let min = self.minimum.unwrap_or(60);
        let (left, right) = self.viewport(timeline_day);
        let zoom_tools = div()
            .flex_none()
            .flex()
            .items_center()
            .gap(px(4.))
            .child(label(tr("history.timelineZoom")))
            .child({
                let accessible_name = tr("history.timelineDecreaseHours");
                quietpro::IconControl::new("zoom-in", accessible_name, quietpro::Icon::Minus)
                    .disabled(self.hours <= 1.)
                    .button(colors)
                    .on_click(cx.listener(|this, _, _, cx| this.zoom(-1., 0.5, cx)))
            })
            .child(label(format!("{:.1} h", self.hours)))
            .child(
                quietpro::icon_actions()
                    .child({
                        let accessible_name = tr("history.timelineIncreaseHours");
                        quietpro::IconControl::new(
                            "zoom-out",
                            accessible_name,
                            quietpro::Icon::Plus,
                        )
                        .disabled(right - left >= end - start)
                        .button(colors)
                        .on_click(cx.listener(|this, _, _, cx| this.zoom(1., 0.5, cx)))
                    })
                    .child({
                        let accessible_name = format!("← {}", tr("history.timeline"));
                        quietpro::IconControl::new(
                            "pan-earlier",
                            accessible_name,
                            quietpro::Icon::ChevronLeft,
                        )
                        .disabled(left <= start)
                        .button(colors)
                        .on_click(cx.listener(|this, _, _, cx| this.pan(-1, cx)))
                    })
                    .child({
                        let accessible_name = format!("→ {}", tr("history.timeline"));
                        quietpro::IconControl::new(
                            "pan-later",
                            accessible_name,
                            quietpro::Icon::ChevronRight,
                        )
                        .disabled(right >= end)
                        .button(colors)
                        .on_click(cx.listener(|this, _, _, cx| this.pan(1, cx)))
                    }),
            );
        let mut filter_tools = div()
            .flex_none()
            .flex()
            .items_center()
            .gap(px(4.))
            .child(label(tr("destinationDetail.minimumDuration")));
        for (dir, id, key, icon) in [
            (
                -1,
                "less",
                "accessibility.history.decreaseMinDuration",
                quietpro::Icon::Minus,
            ),
            (
                1,
                "more",
                "accessibility.history.increaseMinDuration",
                quietpro::Icon::Plus,
            ),
        ] {
            filter_tools = filter_tools.child({
                let accessible_name = tr(key);
                quietpro::IconControl::new(id, accessible_name, icon)
                    .disabled(self.writing_minimum || !(0..=600).contains(&(min + 60 * dir)))
                    .button(colors)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.change_minimum((min + 60 * dir).clamp(0, 600), cx);
                    }))
            });
            if dir < 0 {
                filter_tools = filter_tools.child(label(format!("{} min", min / 60)));
            }
        }
        filter_tools = filter_tools.child({
            let accessible_name = tr("history.titleDetails");
            quietpro::text_button(
                "titles",
                format!(
                    "{} {}",
                    if self.titles { "☑" } else { "☐" },
                    tr("history.titleDetails")
                ),
                colors,
                true,
            )
            .accessibility_label(accessible_name)
            .on_click(cx.listener(|this, _, _, cx| {
                this.titles = !this.titles;
                this.refresh(cx);
                cx.notify();
            }))
        });
        let tools = div()
            .id("history-timeline-controls")
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(12.))
            .text_size(px(12.))
            .child(zoom_tools)
            .child(filter_tools);
        let range_label = format!(
            "{} – {}",
            stamp(left, "%H:%M"),
            if right == end {
                "24:00".into()
            } else {
                stamp(right, "%H:%M")
            }
        );
        let mut strip = self.interactive_timeline(
            div()
                .id("timeline-strip")
                .relative()
                .w_full()
                .h(px(32.))
                .flex_none()
                .rounded(px(4.))
                .bg(colors.track)
                .overflow_hidden(),
            left,
            right,
            cx,
        );
        let mut list = div()
            .id("history-records")
            .min_h_0()
            .flex_1()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(4.));
        let mut count = 0_usize;
        for r in &timeline_day.records {
            if r.group_duration < min * 1000 || r.end <= left || r.start >= right {
                continue;
            }
            let a = r.start.max(left);
            let b = r.end.min(right);
            strip = strip.child(
                div()
                    .absolute()
                    .h_full()
                    .left(relative((a - left) as f32 / (right - left) as f32))
                    .w(relative((b - a) as f32 / (right - left) as f32))
                    .border_r_1()
                    .border_color(colors.panel)
                    .bg(quietpro::activity_display_color(
                        self.source_color(
                            timeline_day,
                            if self.timeline_categories {
                                &r.category
                            } else {
                                &r.key
                            },
                            self.timeline_categories,
                        ),
                        colors.track,
                        dark,
                    )),
            );
            if detail {
                list = list.child(detail_record(r, count, self.titles, colors));
            } else {
                list = list.child(label(format!(
                    "{}–{}  {}  {}",
                    stamp(r.start, "%H:%M:%S"),
                    stamp(r.end, "%H:%M:%S"),
                    r.name,
                    duration(r.end - r.start)
                )));
            }
            if self.titles && !detail {
                for (a, b, title) in &r.titles {
                    list = list.child(label(format!(
                        "{}–{}  {title}",
                        stamp(*a, "%H:%M:%S"),
                        stamp(*b, "%H:%M:%S")
                    )));
                }
            }
            count += 1;
        }
        if count == 0 {
            list = list.child(label(tr("history.emptyTimelineWindow")));
        }
        if self.target.is_some() {
            page = page
                .child(detail_timeline(
                    total,
                    locale,
                    colors,
                    tools,
                    strip,
                    range_label,
                ))
                .child(
                    div()
                        .flex_1()
                        .min_h_0()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .child(heading(tr("destinationDetail.records")))
                        .child(list.text_size(px(14.))),
                );
        } else {
            let timeline = self.day_timeline(timeline_day, colors, dark, cx);
            let peak = day
                .hours
                .iter()
                .enumerate()
                .max_by_key(|(h, ms)| (**ms, std::cmp::Reverse(*h)))
                .unwrap();
            let mut spans = day.records.iter().filter(|r| r.end - r.start >= 60000);
            let active = spans
                .next()
                .map(|first| {
                    format!(
                        "{} - {}",
                        stamp(first.start, "%H:%M"),
                        stamp(spans.next_back().unwrap_or(first).end, "%H:%M")
                    )
                })
                .unwrap_or_else(|| "—".into());
            let summary_row = |name: &'static str, value: String| {
                div()
                    .id(name)
                    .w_full()
                    .flex()
                    .justify_between()
                    .items_baseline()
                    .gap(px(12.))
                    .child(
                        label(tr(name))
                            .text_size(px(12.))
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
                .child(heading(tr("history.daySummary")))
                .child(
                    div()
                        .flex_1()
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
                                    label(tr("history.activeDuration"))
                                        .text_size(px(12.))
                                        .text_color(colors.secondary),
                                )
                                .child(
                                    label(duration(total))
                                        .text_size(px(20.))
                                        .font_weight(FontWeight::SEMIBOLD),
                                ),
                        )
                        .child(
                            div()
                                .flex_1()
                                .flex()
                                .flex_col()
                                .gap(px(8.))
                                .child(summary_row("history.activeSpan", active))
                                .child(summary_row(
                                    "history.peakHour",
                                    if *peak.1 == 0 {
                                        "—".to_string()
                                    } else {
                                        format!("{:02}:00 · {}", peak.0, duration(*peak.1))
                                    },
                                )),
                        ),
                );
            let hourly = self.hourly(day, colors, dark, cx);
            let left_col = div()
                .flex_none()
                .w(px(((f32::from(crate::main_window::page_width(
                    win.viewport_size().width,
                )) - 2. * (quietpro::CONTENT_INSET + 1.)
                    - quietpro::CARD_GAP)
                    * 0.45)
                    .max(260.)))
                .min_h_0()
                .flex()
                .flex_col()
                .gap(px(quietpro::CARD_GAP))
                .child(div().flex_1().min_h_0().flex().child(summary))
                .child(div().flex_1().flex_grow(2.).min_h_0().flex().child(hourly));
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
                            quietpro::segmented(
                                "distribution-mode",
                                tr("data.destinationMode"),
                                std::array::from_fn::<_, 3, _>(|i| {
                                    let key = [
                                        "data.destinationApp",
                                        "data.destinationCategory",
                                        "data.destinationWeb",
                                    ][i];
                                    (i, tr(key), None, self.distribution_focus[i].clone())
                                }),
                                if self.by_web {
                                    2
                                } else {
                                    usize::from(self.by_category)
                                },
                                true,
                                colors,
                                move |mode, _, cx| {
                                    let _ = view.update(cx, |this, cx| {
                                        this.by_category = mode == 1;
                                        this.by_web = mode == 2;
                                        cx.notify();
                                    });
                                },
                            )
                        }),
                );
            let mut rows = div()
                .id("history-apps")
                .overflow_y_scroll()
                .flex()
                .flex_col();
            let distribution = if self.by_web {
                self.web_data.as_ref()
            } else {
                Some(day)
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
                let mut v: Vec<_> = day.categories.iter().map(|(n, t)| (n, n, *t)).collect();
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
                let mark = if self.by_category || key == "activity:anonymous" {
                    div()
                        .size(px(8.))
                        .rounded_full()
                        .bg(distribution_color(key, colors.panel))
                        .into_any_element()
                } else if let Some(icon) = self.icons.get(key) {
                    div()
                        .id(SharedString::from(format!("history-icon-{key}")))
                        .role(Role::Image)
                        .aria_label(n.clone())
                        .size(px(16.))
                        .child(img(icon.image.clone()).size(px(16.)))
                        .into_any_element()
                } else {
                    quietpro::glyph(
                        if self.by_web {
                            quietpro::Icon::Globe
                        } else {
                            quietpro::Icon::AppWindow
                        },
                        colors.secondary,
                    )
                    .size(px(16.))
                    .into_any_element()
                };
                let mark = if !self.by_category && key != "activity:anonymous" {
                    let view = cx.entity().downgrade();
                    let accessible_target = target.clone();
                    let web = self.by_web;
                    gpui_kit::base::Button::new(SharedString::from(format!("open-history-{key}")))
                        .accessibility_label(open)
                        .size(px(20.))
                        .flex_none()
                        .flex()
                        .items_center()
                        .justify_center()
                        .cursor_pointer()
                        .rounded(px(4.))
                        .focus_visible(move |s| s.border_1().border_color(colors.secondary))
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
                rows = rows.child(quietpro::distribution_row(
                    SharedString::from(format!("dist-{key}")),
                    n.clone(),
                    format!("{} · {:.0}%", duration(ms), ratio * 100.),
                    ratio,
                    distribution_color(key, colors.panel.blend(colors.secondary.opacity(0.05))),
                    mark,
                    colors,
                ));
            }
            if distribution.is_none() {
                rows = rows.child(label(tr(if self.web_error {
                    "destinationDetail.dayError"
                } else {
                    "common.loading"
                })));
            }
            right_col = right_col.child(rows);
            page = page.child(
                div()
                    .id("history-overview")
                    .flex_1()
                    .min_h_0()
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap(px(quietpro::CARD_GAP))
                    .child(timeline)
                    .child(
                        div()
                            .flex_1()
                            .flex_grow(3.)
                            .min_h(px(376.))
                            .flex()
                            .gap(px(quietpro::CARD_GAP))
                            .child(left_col)
                            .child(right_col),
                    ),
            );
            if let Some((kind, ..)) = &self.overlay {
                let zoom = *kind == Overlay::Zoom;
                let popup = if !zoom {
                    self.records_popup(colors, win, cx)
                } else if self.timeline_data().is_none() {
                    quietpro::dialog_surface(colors, win.viewport_size())
                        .child(label(tr("destinationDetail.dayError")))
                } else {
                    self.zoom_popup(timeline_day, colors, win, cx)
                };
                page = page.child(self.modal(popup, colors, cx));
            }
        }
        if let Some(detail) = &self.detail {
            let view = cx.weak_entity();
            return page.child(crate::page_controls::detail_dialog(
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
        page
    }
}
impl History {
    fn modal(
        &self,
        content: Div,
        _colors: Palette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let view = cx.weak_entity();
        let focus = self.overlay.as_ref().unwrap().1.clone();
        gpui_kit::base::Dialog::new(cx)
            .focus_handle(focus)
            .accessibility_label(text(self.client.locale.get(), "history.title"))
            .on_ok(|_, _, _| false)
            .backdrop(quietpro::dialog_backdrop())
            .popup(gpui_kit::base::DialogPopup::new().child(content))
            .on_open_change(move |open, _, win, cx| {
                if !open {
                    let _ = view.update(cx, |this, cx| this.close_overlay(win, cx));
                }
            })
    }
}
fn axis() -> Div {
    div()
        .w_full()
        .flex()
        .justify_between()
        .text_size(px(HOURLY_AXIS_FONT_SIZE))
        .children(["00:00", "06:00", "12:00", "18:00"].map(|h| div().w(relative(0.25)).child(h)))
}

impl History {
    fn timeline_data(&self) -> Option<&HistoryDay> {
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
        let next = if self.timeline_web {
            "data.destinationApp"
        } else if self.timeline_categories {
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
    fn cycle_timeline(&mut self, cx: &mut Context<Self>) {
        if self.timeline_web {
            self.timeline_web = false;
            self.timeline_categories = false;
        } else if self.timeline_categories {
            self.timeline_categories = false;
            self.timeline_web = true;
        } else {
            self.timeline_categories = true;
        }
        self.offset = None;
        cx.notify();
    }
}
