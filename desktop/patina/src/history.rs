use crate::{format::duration, windows_host::Client};
use chrono::Local;
use gpui_kit::{prelude::*, *};
use patina_recorder::{HistoryDay, format_text, text};
use quietpro::Palette;
use std::{rc::Rc, time::Duration};

const HOUR: i64 = 3_600_000;
use crate::page_controls::{action, label, stamp};
#[derive(Clone, Copy, PartialEq)]
enum Overlay {
    Zoom,
    Records,
    Calendar,
}
pub(super) struct History {
    overlay: Option<(Overlay, FocusHandle, Option<FocusHandle>)>,
    by_category: bool,
    timeline_categories: bool,
    grouped_hours: bool,
    month: chrono::NaiveDate,

    client: Rc<Client>,
    date: i64,
    target: Option<(String, String)>,
    data: Option<HistoryDay>,
    read: Option<Task<()>>,
    error: bool,
    hours: f32,
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
    pub(super) fn new(
        client: Rc<Client>,
        date: i64,
        target: Option<(String, String)>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let detail = target.is_some();
        let mut this = Self {
            overlay: None,
            by_category: false,
            timeline_categories: false,
            grouped_hours: false,
            month: Local::now().date_naive(),
            client,
            date,
            target,
            data: None,
            read: None,
            error: false,
            hours: if detail { 24. } else { 4. },
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
            }
        })
        .detach();
        this.refresh(cx);
        this
    }
    fn open_overlay(&mut self, kind: Overlay, win: &mut Window, cx: &mut Context<Self>) {
        let old = win.focused(cx);
        let focus = cx.focus_handle();
        win.focus(&focus, cx);
        self.overlay = Some((kind, focus, old));
        cx.notify();
    }
    fn close_overlay(&mut self, win: &mut Window, cx: &mut Context<Self>) {
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
        self.read = Some(cx.spawn(async move |view, cx| {
            loop {
                let result = client.history(date, app.clone(), titles).await;
                let repeat = view.update(cx, |this, cx| {
                    match result {
                        Ok(day) => {
                            this.minimum.get_or_insert(day.minimum_seconds);
                            this.data = Some(day);
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
        self.data = None;
        self.offset = None;
        self.error = false;
        self.refresh(cx);
        cx.notify();
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
        if let Some(day) = &self.data {
            let (a, b) = self.viewport(day);
            self.hours = (self.hours + delta).clamp(1., (day.end - day.start) as f32 / HOUR as f32);
            self.offset = Some(
                a + ((b - a) as f32 * ratio) as i64 - (self.hours * HOUR as f32 * ratio) as i64,
            );
            cx.notify();
        }
    }
    fn pan(&mut self, dir: i64, cx: &mut Context<Self>) {
        if let Some(day) = &self.data {
            let (a, b) = self.viewport(day);
            self.offset = Some(a + dir * (b - a) / 2);
            cx.notify();
        }
    }
}
impl Render for History {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let colors = self.client.palette(win);
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);

        use crate::page_controls::{
            content_card, heading, page as shell, page_actions, page_title_row, panel,
        };
        use chrono::{Datelike, Days, Months, TimeZone};
        use quietpro::{Icon, IconControl, text_button};
        let mut page = shell(colors).when(self.target.is_some(), |page| {
            page.rounded(px(12.))
                .px(px(20.))
                .border_1()
                .border_color(colors.border)
                .bg(colors.canvas)
        });
        let name = self
            .target
            .as_ref()
            .map_or_else(|| tr("history.title"), |t| t.1.clone());
        let header = page_title_row(name, Icon::Clock, colors);
        let retry = self.error.then(|| {
            action(
                "retry-history",
                tr("common.retry"),
                tr("common.retry"),
                true,
                cx.listener(|this, _, _, cx| this.refresh(cx)),
            )
        });
        let Some(day) = &self.data else {
            return page
                .child(header)
                .children(retry)
                .child(label(tr(if self.error {
                    "destinationDetail.dayError"
                } else {
                    "common.loading"
                })));
        };
        let color_for = |key: &str| rgb(day.colors.get(key).copied().unwrap_or(0x8f98a8));
        let today = Local::now().timestamp_millis();
        let (start, end) = (day.start, day.end);
        let date_row = page_actions()
            .child(
                text_button("prev-date", "‹", colors, true)
                    .accessibility_label(tr("destinationDetail.previousDay"))
                    .on_click(cx.listener(move |this, _, _, cx| this.change_day(start - 1, cx))),
            )
            .child(
                text_button(
                    "date-picker",
                    if end > today {
                        tr("date.today")
                    } else {
                        stamp(start, "%Y-%m-%d")
                    },
                    colors,
                    true,
                )
                .accessibility_label(stamp(start, "%Y-%m-%d"))
                .on_click(cx.listener(move |this, _, win, cx| {
                    this.month = Local
                        .timestamp_millis_opt(start)
                        .single()
                        .unwrap()
                        .date_naive()
                        .with_day(1)
                        .unwrap();
                    this.open_overlay(Overlay::Calendar, win, cx);
                })),
            )
            .child(
                text_button("next-date", "›", colors, end <= today)
                    .accessibility_label(tr("destinationDetail.nextDay"))
                    .on_click(cx.listener(move |this, _, _, cx| this.change_day(end, cx))),
            );
        let total = if self.target.is_some() {
            day.records.iter().map(|r| r.end - r.start).sum()
        } else {
            day.apps.iter().map(|a| a.2).sum()
        };
        page = page.child(header.child(date_row)).children(retry);
        let min = self.minimum.unwrap_or(60);
        let (left, right) = self.viewport(day);
        let mut tools = div()
            .id("history-timeline-controls")
            .flex()
            .items_center()
            .gap(px(4.))
            .child(label(tr("history.timelineZoom")))
            .child(action(
                "zoom-in",
                tr("history.timelineDecreaseHours"),
                "−".into(),
                self.hours > 1.,
                cx.listener(|this, _, _, cx| this.zoom(-1., 0.5, cx)),
            ))
            .child(label(format!("{:.1} h", self.hours)))
            .child(action(
                "zoom-out",
                tr("history.timelineIncreaseHours"),
                "+".into(),
                right - left < end - start,
                cx.listener(|this, _, _, cx| this.zoom(1., 0.5, cx)),
            ))
            .child(action(
                "pan-earlier",
                format!("← {}", tr("history.timeline")),
                "←".into(),
                left > start,
                cx.listener(|this, _, _, cx| this.pan(-1, cx)),
            ))
            .child(action(
                "pan-later",
                format!("→ {}", tr("history.timeline")),
                "→".into(),
                right < end,
                cx.listener(|this, _, _, cx| this.pan(1, cx)),
            ))
            .child(label(tr("destinationDetail.minimumDuration")));
        for (dir, id, key, face) in [
            (-1, "less", "accessibility.history.decreaseMinDuration", "−"),
            (1, "more", "accessibility.history.increaseMinDuration", "+"),
        ] {
            tools = tools.child(action(
                id,
                tr(key),
                face.into(),
                !self.writing_minimum && (0..=600).contains(&(min + 60 * dir)),
                cx.listener(move |this, _, _, cx| {
                    if this.writing_minimum {
                        return;
                    }
                    let next = (min + 60 * dir).clamp(0, 600);
                    this.writing_minimum = true;
                    let write =
                        this.client
                            .request::<()>(crate::window_process::Query::HistoryMinimum(
                                this.target.is_some(),
                                next,
                            ));
                    cx.spawn(async move |view, cx| {
                        let result = write.await;
                        let _ = view.update(cx, |t, cx| {
                            t.writing_minimum = false;
                            if result.is_ok() {
                                t.minimum = Some(next);
                            } else {
                                t.error = true;
                            }
                            cx.notify();
                        });
                    })
                    .detach();
                    cx.notify();
                }),
            ));
            if dir < 0 {
                tools = tools.child(label(format!("{} min", min / 60)));
            }
        }
        tools = tools.child(action(
            "titles",
            tr("history.titleDetails"),
            format!(
                "{} {}",
                if self.titles { "☑" } else { "☐" },
                tr("history.titleDetails")
            ),
            true,
            cx.listener(|this, _, _, cx| {
                this.titles = !this.titles;
                this.refresh(cx);
                cx.notify();
            }),
        ));
        let range_label = format!("{} – {}", stamp(left, "%H:%M"), stamp(right, "%H:%M"));
        let bounds = self.plot_bounds.clone();
        let mut strip = div()
            .id("timeline-strip")
            .relative()
            .w_full()
            .h(px(32.))
            .flex_none()
            .bg(colors.track)
            .overflow_hidden()
            .child(
                canvas(move |b, _, _| bounds.set(b), |_, _, _, _| ())
                    .absolute()
                    .inset_0()
                    .size_full(),
            )
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(move |this, e: &MouseDownEvent, _, _| {
                    this.drag = Some((e.position.x, left));
                }),
            )
            .on_mouse_up(
                MouseButton::Left,
                cx.listener(|this, _, _, _| this.drag = None),
            )
            .on_mouse_up_out(
                MouseButton::Left,
                cx.listener(|this, _, _, _| this.drag = None),
            )
            .on_mouse_move(cx.listener(move |this, e: &MouseMoveEvent, _, cx| {
                if let Some((x, start)) = this.drag
                    && e.pressed_button == Some(MouseButton::Left)
                {
                    let width = f32::from(this.plot_bounds.get().size.width).max(1.);
                    this.offset = Some(
                        start
                            - (f32::from(e.position.x - x) / width * (right - left) as f32) as i64,
                    );
                    cx.notify();
                }
            }))
            .on_scroll(cx.listener(|this, e: &ScrollEvent, _, cx| {
                let d = e.delta.pixel_delta(px(16.));
                if d.x.abs() > d.y.abs() {
                    this.pan(if d.x > px(0.) { -1 } else { 1 }, cx);
                } else {
                    let b = this.plot_bounds.get();
                    let ratio = (f32::from(e.position.x - b.origin.x)
                        / f32::from(b.size.width).max(1.))
                    .clamp(0., 1.);
                    this.zoom(if d.y > px(0.) { -0.2 } else { 0.2 }, ratio, cx);
                }
                cx.stop_propagation();
            }));
        let mut list = div()
            .id("history-records")
            .min_h_0()
            .flex_1()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(4.));
        let mut count = 0;
        for r in &day.records {
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
                    .bg(color_for(if self.timeline_categories {
                        &r.category
                    } else {
                        &r.key
                    })),
            );
            list = list.child(label(format!(
                "{}–{}  {}  {}",
                stamp(r.start, "%H:%M:%S"),
                stamp(r.end, "%H:%M:%S"),
                r.name,
                duration(r.end - r.start)
            )));
            if self.titles {
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
                .child(label(format!(
                    "{} · {}",
                    tr("history.activeDuration"),
                    duration(total)
                )))
                .child(tools)
                .child(label(range_label))
                .child(strip)
                .child(list);
        } else {
            let mut full = div()
                .relative()
                .w_full()
                .h(px(48.))
                .border_1()
                .border_color(colors.border.opacity(0.65))
                .bg(colors.canvas)
                .rounded(px(6.))
                .overflow_hidden();
            for r in &day.records {
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
                .gap(px(6.))
                .child(heading(tr("history.timelineAxis")).flex_1());
            let legend: Vec<_> = if self.timeline_categories {
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
            let app_mode = tr("data.destinationApp");
            let category_mode = tr("data.destinationCategory");
            let (current, next) = if self.timeline_categories {
                (category_mode, app_mode)
            } else {
                (app_mode, category_mode)
            };
            let mode_label = format_text(
                locale,
                "history.timelineModeSwitch",
                &[("current", current), ("next", next)],
            );
            toolbar = toolbar.child(
                IconControl::new("timeline-mode", mode_label, Icon::Tags).action(
                    colors,
                    cx.listener(|this, _, _, cx| {
                        this.timeline_categories = !this.timeline_categories;
                        cx.notify();
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
                toolbar = toolbar.child(IconControl::new(id, tr(key), icon).action(
                    colors,
                    cx.listener(move |this, _, win, cx| this.open_overlay(kind, win, cx)),
                ));
            }
            page = page.child(
                content_card(colors.border, colors.panel)
                    .h(px(148.))
                    .flex_none()
                    .gap(px(12.))
                    .child(toolbar)
                    .child(full)
                    .child(
                        div()
                            .w_full()
                            .flex()
                            .justify_between()
                            .text_color(colors.secondary)
                            .text_size(px(11.))
                            .children(["00:00", "06:00", "12:00", "18:00", "24:00"]),
                    ),
            );
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
                    .border_t_1()
                    .border_color(colors.border.opacity(0.68))
                    .pt(px(9.))
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
                .h(px(155.))
                .gap(px(18.))
                .child(heading(tr("history.daySummary")))
                .child(
                    div()
                        .flex()
                        .items_end()
                        .gap(px(18.))
                        .child(
                            div()
                                .w(relative(0.355))
                                .flex()
                                .flex_col()
                                .gap(px(6.))
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
                                .gap(px(10.))
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
            let mut bars = div().flex().items_end().flex_1().w_full().min_h(px(74.));
            for (h, &ms) in day.hours.iter().enumerate() {
                let mut bar = div()
                    .w(px(8.))
                    .rounded_t(px(3.))
                    .h(relative((ms as f32 / HOUR as f32).min(1.)))
                    .bg(colors.accent)
                    .flex()
                    .flex_col_reverse();
                if self.grouped_hours && ms > 0 {
                    for (name, hours) in &day.category_hours {
                        if hours[h] > 0 {
                            bar = bar.child(
                                div()
                                    .w_full()
                                    .h(relative(hours[h] as f32 / ms as f32))
                                    .bg(color_for(name)),
                            );
                        }
                    }
                }
                bars = bars.child(
                    div()
                        .id(("history-hour", h))
                        .role(Role::Label)
                        .aria_value(format!(
                            "{h:02}:00 · {} {}",
                            tr("hourlyActivityChart.activeMinutes"),
                            duration(ms)
                        ))
                        .h_full()
                        .flex_1()
                        .flex()
                        .items_end()
                        .justify_center()
                        .child(bar),
                );
            }
            let hourly = content_card(colors.border, colors.panel)
                .min_h_0()
                .flex_1()
                .gap(px(10.))
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
                .child(bars)
                .child(axis());
            let left_col = div()
                .w(relative(5. / 12.))
                .min_h_0()
                .flex()
                .flex_col()
                .gap(px(crate::page_controls::CARD_GAP))
                .child(summary)
                .child(hourly);
            let mut right_col = content_card(colors.border, colors.panel)
                .flex_1()
                .min_h_0()
                .gap(px(14.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .child(heading(tr("history.dayDistribution")).flex_1())
                        .children(
                            [
                                (false, "data.destinationApp"),
                                (true, "data.destinationCategory"),
                            ]
                            .map(|(cat, key)| {
                                action(
                                    key,
                                    tr(key),
                                    tr(key),
                                    cat != self.by_category,
                                    cx.listener(move |this, _, _, cx| {
                                        this.by_category = cat;
                                        cx.notify();
                                    }),
                                )
                            }),
                        ),
                );
            let mut rows = div()
                .id("history-apps")
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(8.));
            let items: Vec<_> = if self.by_category {
                let mut v: Vec<_> = day.categories.iter().map(|(n, t)| (n, n, *t)).collect();
                v.sort_by_key(|v| std::cmp::Reverse(v.2));
                v
            } else {
                day.apps.iter().map(|(k, n, t)| (k, n, *t)).collect()
            };
            for (key, n, ms) in items {
                let target = (key.clone(), n.clone());
                let open = format_text(locale, "destinationDetail.open", &[("name", n.clone())]);
                let ratio = ms as f32 / total.max(1) as f32;
                let row = div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(div().size(px(8.)).rounded_full().bg(color_for(key)))
                    .child(label(n.clone()).flex_1())
                    .child(label(format!("{} · {:.0}%", duration(ms), ratio * 100.)));
                let inner = div().flex().flex_col().gap(px(5.)).child(row).child(
                    div()
                        .w_full()
                        .h(px(4.))
                        .bg(colors.track)
                        .child(div().h_full().w(relative(ratio)).bg(color_for(key))),
                );
                rows = rows.child(
                    gpui_kit::base::Button::new(SharedString::from(format!("dist-{key}")))
                        .accessibility_label(open)
                        .disabled(self.by_category || key == "activity:anonymous")
                        .w_full()
                        .p(px(10.))
                        .child(inner.w_full())
                        .on_click(cx.listener(move |this, _, win, cx| {
                            this.read = None;
                            this.detail_trigger = win.focused(cx);
                            win.focus(&this.detail_focus, cx);
                            this.detail = Some(cx.new(|cx| {
                                Self::new(
                                    this.client.clone(),
                                    this.date,
                                    Some(target.clone()),
                                    win,
                                    cx,
                                )
                            }));
                            cx.notify();
                        })),
                );
            }
            right_col = right_col.child(rows);
            page = page.child(
                div()
                    .flex_1()
                    .min_h_0()
                    .flex()
                    .gap(px(crate::page_controls::CARD_GAP))
                    .child(left_col)
                    .child(right_col),
            );
            if self
                .overlay
                .as_ref()
                .is_some_and(|o| o.0 != Overlay::Calendar)
            {
                let zoom = self.overlay.as_ref().unwrap().0 == Overlay::Zoom;
                let mut popup = panel(colors)
                    .w(px(690.))
                    .h(px(440.))
                    .gap(px(12.))
                    .child(heading(tr(if zoom {
                        "history.timelineZoom"
                    } else {
                        "history.timeline"
                    })))
                    .child(tools);
                if zoom {
                    popup = popup.child(label(range_label)).child(strip);
                }
                page = page.child(self.modal(popup.child(list), colors, cx));
            }
        }
        if self
            .overlay
            .as_ref()
            .is_some_and(|o| o.0 == Overlay::Calendar)
        {
            let month = self.month;
            let mut calendar = panel(colors).w(px(328.)).gap(px(6.)).child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(action(
                        "prev-month",
                        tr("accessibility.history.previousMonth"),
                        "‹".into(),
                        true,
                        cx.listener(|this, _, _, cx| {
                            this.month = this.month - Months::new(1);
                            cx.notify();
                        }),
                    ))
                    .child(label(month.format("%Y-%m").to_string()))
                    .child(action(
                        "next-month",
                        tr("accessibility.history.nextMonth"),
                        "›".into(),
                        month + Months::new(1) <= Local::now().date_naive(),
                        cx.listener(|this, _, _, cx| {
                            this.month = this.month + Months::new(1);
                            cx.notify();
                        }),
                    )),
            );
            let grid_start = month - Days::new(month.weekday().num_days_from_monday().into());
            for week in 0..6 {
                let mut row = div().flex();
                for d in 0..7 {
                    let date = grid_start + Days::new(week * 7 + d);
                    if date.month() != month.month() {
                        row = row.child(div().w(px(38.)));
                        continue;
                    }
                    let chosen = date
                        .and_hms_opt(12, 0, 0)
                        .unwrap()
                        .and_local_timezone(Local)
                        .earliest();
                    row = row.child(div().w(px(38.)).child(action(
                        SharedString::from(date.to_string()),
                        date.to_string(),
                        date.day().to_string(),
                        date <= Local::now().date_naive() && chosen.is_some(),
                        cx.listener(move |this, _, win, cx| {
                            if let Some(date) = chosen {
                                this.close_overlay(win, cx);
                                this.change_day(date.timestamp_millis(), cx);
                            }
                        }),
                    )));
                }
                calendar = calendar.child(row);
            }
            page = page.child(self.modal(calendar, colors, cx));
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
                cx,
            ));
        }
        page
    }
}
impl History {
    fn modal(&self, content: Div, _c: Palette, cx: &mut Context<Self>) -> impl IntoElement + use<> {
        let view = cx.weak_entity();
        let focus = self.overlay.as_ref().unwrap().1.clone();
        gpui_kit::base::Dialog::new(cx)
            .focus_handle(focus)
            .accessibility_label(text(self.client.locale.get(), "history.title"))
            .on_ok(|_, _, _| false)
            .backdrop(div().size_full().bg(rgba(0x00000055)))
            .popup(
                gpui_kit::base::DialogPopup::new().child(content.child(action(
                    "dismiss-overlay",
                    text(self.client.locale.get(), "common.close"),
                    text(self.client.locale.get(), "common.close"),
                    true,
                    cx.listener(|this, _, win, cx| this.close_overlay(win, cx)),
                ))),
            )
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
        .text_size(px(10.))
        .children(["00:00", "06:00", "12:00", "18:00"].map(|h| div().w(relative(0.25)).child(h)))
}
