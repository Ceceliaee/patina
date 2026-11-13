use crate::{
    format::duration,
    history::History,
    page_controls::{action, label, stamp},
    windows_host::Client,
};
use chrono::{Datelike, Days, Local, NaiveDate};
use gpui_kit::{
    base::{
        Input,
        input::{InputAccessibility, InputState},
    },
    prelude::*,
    *,
};
use patina_recorder::{SeriesKind, Trends, text};
use std::{collections::BTreeSet, rc::Rc};
fn noon(date: NaiveDate) -> Option<i64> {
    Some(
        date.and_hms_opt(12, 0, 0)?
            .and_local_timezone(Local)
            .earliest()?
            .timestamp_millis(),
    )
}
pub(super) struct DataPage {
    client: Rc<Client>,
    range: Option<(i64, i64)>,
    year: i32,
    recent_heat: bool,
    heat: Option<Trends>,
    heat_read: Option<Task<()>>,
    weekly: bool,
    range_open: bool,

    kind: SeriesKind,
    data: Option<Trends>,
    overview: Option<Vec<i64>>,
    read: Option<Task<()>>,
    error: bool,
    selected: BTreeSet<String>,
    dates: [Entity<InputState>; 2],
    search: Entity<InputState>,
    detail: Option<Entity<History>>,
    detail_focus: FocusHandle,
    detail_trigger: Option<FocusHandle>,
}
impl DataPage {
    pub(super) fn new(client: Rc<Client>, win: &mut Window, cx: &mut Context<Self>) -> Self {
        let today = Local::now().date_naive();
        let dates = [today - Days::new(6), today];
        let fields =
            dates.map(|d| cx.new(|cx| InputState::new(win, cx).default_value(d.to_string())));
        let search = cx.new(|cx| InputState::new(win, cx));
        cx.observe(&search, |_, _, cx| cx.notify()).detach();
        let mut this = Self {
            client,
            year: today.year(),
            recent_heat: true,
            heat: None,
            heat_read: None,
            weekly: false,
            range_open: false,
            range: noon(dates[0]).zip(noon(today)),
            kind: SeriesKind::App,
            data: None,
            overview: None,
            read: None,
            error: false,
            selected: BTreeSet::new(),
            dates: fields,
            search,
            detail: None,
            detail_focus: cx.focus_handle(),
            detail_trigger: None,
        };
        this.refresh(cx);
        this.load_heat(cx);
        this
    }
    fn load_heat(&mut self, cx: &mut Context<Self>) {
        let today = Local::now().date_naive();
        let monday = today - Days::new(today.weekday().num_days_from_monday() as u64);
        let (start, end) = if self.recent_heat {
            (noon(monday - Days::new(52 * 7)), noon(today))
        } else {
            (
                NaiveDate::from_ymd_opt(self.year, 1, 1).and_then(noon),
                NaiveDate::from_ymd_opt(self.year, 12, 31).and_then(noon),
            )
        };
        let read = self.client.trends(start.zip(end), SeriesKind::App);
        self.heat = None;
        self.heat_read = Some(cx.spawn(async move |view, cx| {
            let res = read.await;
            let _ = view.update(cx, |this, cx| {
                match res {
                    Ok(data) => this.heat = Some(data),
                    Err(_) => this.error = true,
                };
                cx.notify();
            });
        }));
    }
    fn refresh(&mut self, cx: &mut Context<Self>) {
        self.error = false;
        self.data = None;
        let read = self.client.trends(self.range, self.kind);
        let overall =
            (self.kind != SeriesKind::App).then(|| self.client.trends(self.range, SeriesKind::App));
        self.read = Some(cx.spawn(async move |view, cx| {
            let result = async {
                let data = read.await?;
                let overall = match overall {
                    Some(r) => Some(daily_totals(&r.await?)),
                    None => None,
                };
                Ok::<_, String>((data, overall))
            }
            .await;
            let _ = view.update(cx, |this, cx| {
                match result {
                    Ok((data, overall)) => {
                        this.data = Some(data);
                        this.overview = overall;
                    }
                    Err(_) => this.error = true,
                };
                cx.notify();
            });
        }));
        cx.notify();
    }
    fn rolling(&mut self, n: u64, win: &mut Window, cx: &mut Context<Self>) {
        let end = Local::now().date_naive();
        if n == 0 {
            self.range = None;
        } else {
            let start = if n == 365 {
                end.with_day(1).unwrap() - chrono::Months::new(11)
            } else {
                end - Days::new(n - 1)
            };
            self.range = noon(start).zip(noon(end));
            for (field, date) in self.dates.iter().zip([start, end]) {
                field.update(cx, |v, cx| v.set_value(date.to_string(), win, cx));
            }
        }
        self.range_open = false;
        self.refresh(cx);
    }
}
impl Render for DataPage {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.client.locale.get();
        let tr = |k| text(locale, k);
        let colors = self.client.palette(win);
        use crate::page_controls::{content_card, heading, page as shell, page_title_row};
        let mut page = shell(colors);

        page = page.child(page_title_row(
            tr("data.title"),
            quietpro::Icon::ChartColumn,
            colors,
        ));
        let mut ranges = div().flex().gap(px(3.)).items_center();
        for (n, k) in [
            (7, "data.pastSevenDays"),
            (30, "data.pastThirtyDays"),
            (365, "data.recentYear"),
            (0, "data.allTime"),
        ] {
            ranges = ranges.child(action(
                k,
                tr(k),
                tr(k),
                true,
                cx.listener(move |this, _, win, cx| this.rolling(n, win, cx)),
            ));
        }
        for (i, field) in self.dates.iter().enumerate() {
            let name = tr(if i == 0 {
                "data.pickStartDate"
            } else {
                "data.pickEndDate"
            });
            field.update(cx, |f, _| {
                f.set_accessibility(
                    InputAccessibility::new(Some(Role::TextInput)).with_label(Some(name.into())),
                )
            });
            ranges = ranges.child(div().w(px(112.)).child(Input::new(field)));
        }
        ranges = ranges.child(action(
            "apply-dates",
            tr("data.applyRange"),
            tr("data.applyRange"),
            true,
            cx.listener(move |this, _, _, cx| {
                let parsed = this.dates.each_ref().map(|f| {
                    NaiveDate::parse_from_str(&f.read(cx).value(), "%Y-%m-%d")
                        .ok()
                        .and_then(noon)
                });
                if let [Some(a), Some(b)] = parsed
                    && a <= b
                    && stamp(b, "%Y-%m-%d") <= Local::now().date_naive().to_string()
                {
                    this.range = Some((a, b));
                    this.refresh(cx);
                } else {
                    this.error = true;
                    cx.notify();
                }
            }),
        ));
        let mut calendars = div().flex().gap(px(4.));
        for (index, k) in [
            "data.pickerModes.week",
            "data.pickerModes.month",
            "data.pickerModes.year",
        ]
        .iter()
        .enumerate()
        {
            let k = *k;
            calendars = calendars.child(action(
                k,
                tr(k),
                tr(k),
                true,
                cx.listener(move |t, _, win, cx| {
                    let today = Local::now().date_naive();
                    let Ok(anchor) =
                        NaiveDate::parse_from_str(&t.dates[0].read(cx).value(), "%Y-%m-%d")
                    else {
                        t.error = true;
                        cx.notify();
                        return;
                    };
                    let anchor = anchor.min(today);
                    let (a, b) = match index {
                        0 => {
                            let a =
                                anchor - Days::new(anchor.weekday().num_days_from_monday() as u64);
                            (a, a + Days::new(6))
                        }
                        1 => {
                            let a = anchor.with_day(1).unwrap();
                            (a, a + chrono::Months::new(1) - Days::new(1))
                        }
                        _ => (
                            NaiveDate::from_ymd_opt(anchor.year(), 1, 1).unwrap(),
                            NaiveDate::from_ymd_opt(anchor.year(), 12, 31).unwrap(),
                        ),
                    };
                    let b = b.min(today);
                    for (f, d) in t.dates.iter().zip([a, b]) {
                        f.update(cx, |f, cx| f.set_value(d.to_string(), win, cx));
                    }
                    t.range = noon(a).zip(noon(b));
                    t.range_open = false;
                    t.refresh(cx);
                }),
            ));
        }
        let mut modes = div().flex().gap(px(6.));
        for (kind, k) in [
            (SeriesKind::App, "data.destinationApp"),
            (SeriesKind::Category, "data.destinationCategory"),
            (SeriesKind::Web, "data.destinationWeb"),
        ] {
            modes = modes.child(action(
                k,
                tr(k),
                tr(k),
                self.kind != kind,
                cx.listener(move |this, _, _, cx| {
                    this.kind = kind;
                    this.selected.clear();
                    this.refresh(cx);
                }),
            ));
        }

        if self.error {
            page = page
                .child(label(tr("destinationDetail.dayError")))
                .child(action(
                    "retry",
                    tr("common.retry"),
                    tr("common.retry"),
                    true,
                    cx.listener(|this, _, _, cx| this.refresh(cx)),
                ));
        }
        let Some(data) = &self.data else {
            return page.child(label(tr("common.loading")));
        };
        let mut totals = vec![0i64; data.days.len()];
        for series in &data.series {
            if self.selected.is_empty() || self.selected.contains(&series.key) {
                for (&i, v) in &series.daily {
                    totals[i] += v;
                }
            }
        }
        let sum = totals.iter().sum::<i64>();
        let overall = self.overview.clone().unwrap_or_else(|| daily_totals(data));
        let overview_total = overall.iter().sum::<i64>();
        let mut overview = content_card(colors.border, colors.panel)
            .id("data-overview")
            .flex_none()
            .gap(px(12.));
        let range_name = match self.range {
            None => tr("data.allTime"),
            Some(_) if data.days.len() == 7 => tr("data.pastSevenDays"),
            Some(_) if data.days.len() == 30 => tr("data.pastThirtyDays"),
            Some(_) if data.days.len() == 365 => tr("data.recentYear"),
            Some((a, b)) => format!("{} – {}", stamp(a, "%m/%d"), stamp(b, "%m/%d")),
        };
        overview = overview.child(
            div()
                .flex()
                .items_center()
                .gap(px(14.))
                .child(heading(tr("data.activityTrend")).flex_1())
                .child(label(format!(
                    "{} · {}",
                    tr("data.appTrendTotal"),
                    duration(overview_total)
                )))
                .child(label(format!(
                    "{} · {}",
                    tr("data.appTrendAverage"),
                    duration(overview_total / data.days.len().max(1) as i64)
                )))
                .child(action(
                    "open-range",
                    tr("data.rangePickerTitle"),
                    range_name,
                    true,
                    cx.listener(|this, _, _, cx| {
                        this.range_open = !this.range_open;
                        cx.notify();
                    }),
                )),
        );
        if self.range_open {
            overview = overview.child(calendars).child(ranges);
        }
        let make_chart = |id: &'static str, values: &[i64], height: f32| {
            let mut points = std::collections::BTreeMap::<String, i64>::new();
            for (&day, &v) in data.days.iter().zip(values) {
                *points
                    .entry(stamp(
                        day,
                        if data.days.len() > 62 {
                            "%Y-%m"
                        } else {
                            "%Y-%m-%d"
                        },
                    ))
                    .or_default() += v;
            }
            let entries: Vec<_> = points.into_iter().collect();
            let max_hours = entries.iter().map(|(_, v)| *v).max().unwrap_or(0) as f32 / 3_600_000.;
            let raw = (max_hours / 3.).max(1.);
            let magnitude = 10f32.powf(raw.log10().floor());
            let limit = 3.
                * magnitude
                * [1., 2., 3., 4., 6., 8., 10.]
                    .into_iter()
                    .find(|n| *n >= raw / magnitude)
                    .unwrap_or(10.);
            let samples: Vec<_> = entries
                .iter()
                .map(|(_, ms)| *ms as f32 / 3_600_000.)
                .collect();
            let plot = canvas(
                |_, _, _| (),
                move |bounds, _, win, _| {
                    let width = f32::from(bounds.size.width);
                    let h = f32::from(bounds.size.height);
                    let count = samples.len();
                    let step = width / ((count.saturating_sub(1)).max(1) as f32);
                    let dots: Vec<_> = samples
                        .iter()
                        .enumerate()
                        .map(|(i, y)| (i as f32 * step, (1. - *y / limit) * h))
                        .collect();
                    let area = gpui_kit::base::plot::shape::Area::new()
                        .data(dots.iter().copied())
                        .x(|p: &(f32, f32)| Some(p.0))
                        .y0(h)
                        .y1(|p| Some(p.1))
                        .stroke(colors.accent)
                        .fill(colors.accent.opacity(0.12));
                    area.paint(&bounds, win);
                    for (x, y) in dots {
                        let pt = bounds.origin + point(px(x - 2.), px(y - 2.));
                        win.paint_quad(
                            fill(Bounds::new(pt, size(px(4.), px(4.))), colors.accent)
                                .corner_radii(px(2.)),
                        );
                    }
                },
            )
            .absolute()
            .inset_0()
            .size_full();
            let mut grid = div()
                .relative()
                .flex_1()
                .h_full()
                .flex()
                .flex_col()
                .justify_between()
                .children((0..4).map(|_| {
                    div()
                        .w_full()
                        .border_b_1()
                        .border_color(colors.border.opacity(0.65))
                }))
                .child(plot);
            let mut hit = div().absolute().inset_0().size_full().flex();
            for (date, v) in &entries {
                let name = format!("{date} · {}", duration(*v));
                hit = hit.child(
                    div()
                        .id(SharedString::from(format!("{id}-{date}")))
                        .role(Role::Label)
                        .aria_value(name)
                        .h_full()
                        .flex_1(),
                );
            }
            grid = grid.child(hit);
            let y_ticks = div()
                .h_full()
                .flex()
                .flex_col()
                .justify_between()
                .text_size(px(10.))
                .text_color(colors.secondary)
                .children(
                    (0..4)
                        .rev()
                        .map(|v| div().child(format!("{:.0}", v as f32 * limit / 3.))),
                );
            let tick_step = entries.len().div_ceil(8).max(1);
            let ticks = div()
                .flex()
                .justify_between()
                .text_size(px(10.))
                .text_color(colors.secondary)
                .children(
                    entries
                        .iter()
                        .step_by(tick_step)
                        .map(|(d, _)| div().child(d.get(5..).unwrap_or(d).to_owned())),
                );
            div()
                .id(id)
                .flex()
                .flex_col()
                .gap(px(3.))
                .w_full()
                .h(px(height))
                .child(
                    div()
                        .flex()
                        .gap(px(8.))
                        .flex_1()
                        .min_h_0()
                        .child(y_ticks)
                        .child(grid),
                )
                .child(ticks)
        };
        overview = overview.child(make_chart("overview-trend", &overall, 234.));
        let mut heat = div()
            .border_t_1()
            .border_color(colors.border)
            .pt(px(14.))
            .flex()
            .flex_col()
            .gap(px(10.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(heading(tr("data.activityHeatmap")).flex_1())
                    .children(
                        [(false, "data.heatmapDaily"), (true, "data.heatmapWeekly")].map(
                            |(weekly, k)| {
                                action(
                                    k,
                                    tr(k),
                                    tr(k),
                                    self.weekly != weekly,
                                    cx.listener(move |this, _, _, cx| {
                                        this.weekly = weekly;
                                        cx.notify();
                                    }),
                                )
                            },
                        ),
                    )
                    .child(action(
                        "year-prev",
                        tr("accessibility.history.previousMonth"),
                        "‹".into(),
                        self.year > 1970,
                        cx.listener(|this, _, _, cx| {
                            if this.recent_heat {
                                this.recent_heat = false;
                                this.year = Local::now().date_naive().year();
                            } else {
                                this.year -= 1;
                            }
                            this.load_heat(cx);
                        }),
                    ))
                    .child(label(if self.recent_heat {
                        tr("data.recentYear")
                    } else {
                        self.year.to_string()
                    }))
                    .child(action(
                        "year-next",
                        tr("accessibility.history.nextMonth"),
                        "›".into(),
                        !self.recent_heat,
                        cx.listener(|this, _, _, cx| {
                            if this.year == Local::now().date_naive().year() {
                                this.recent_heat = true;
                            } else {
                                this.year += 1;
                            }
                            this.load_heat(cx);
                        }),
                    )),
            );
        if let Some(data) = &self.heat {
            let mut heat_totals = vec![0i64; data.days.len()];
            for s in &data.series {
                for (&i, d) in &s.daily {
                    heat_totals[i] += d;
                }
            }
            let start_date = data
                .days
                .first()
                .and_then(|s| chrono::DateTime::from_timestamp_millis(*s))
                .map(|t| t.with_timezone(&Local).date_naive())
                .unwrap_or(Local::now().date_naive());
            let offset = start_date.weekday().num_days_from_monday() as usize;
            let max = heat_totals.iter().copied().max().unwrap_or(1).max(1) as f32;
            let mut grid = div().flex().w_full().gap(px(2.));
            for week in 0usize..53 {
                let mut column = div().flex().flex_col().flex_1().gap(px(2.));
                for day in 0..if self.weekly { 1 } else { 7 } {
                    let slot = week * 7 + day;
                    let value = if self.weekly {
                        (0..7)
                            .filter_map(|n| {
                                (week * 7 + n)
                                    .checked_sub(offset)
                                    .and_then(|i| heat_totals.get(i))
                            })
                            .sum()
                    } else {
                        slot.checked_sub(offset)
                            .and_then(|i| heat_totals.get(i))
                            .copied()
                            .unwrap_or(0)
                    };
                    let date = start_date + chrono::Duration::days(slot as i64 - offset as i64);
                    let active = date >= start_date
                        && date <= Local::now().date_naive()
                        && (self.recent_heat || date.year() == self.year);
                    let name = format!("{date} · {}", duration(value));
                    let bg = if value == 0 {
                        colors.canvas
                    } else {
                        colors.accent.opacity((value as f32 / max).clamp(0.16, 1.))
                    };
                    let ms = noon(date);
                    column = column.child(
                        div()
                            .id(SharedString::from(format!("heat-{date}")))
                            .role(Role::Button)
                            .aria_label(name)
                            .w_full()
                            .h(px(if self.weekly { 74. } else { 12. }))
                            .rounded(px(2.))
                            .when(active, |s| {
                                s.border_1()
                                    .border_color(colors.border)
                                    .bg(bg)
                                    .cursor_pointer()
                                    .on_click(cx.listener(move |this, _, win, cx| {
                                        if let Some(d) = ms {
                                            this.detail_trigger = win.focused(cx);
                                            win.focus(&this.detail_focus, cx);
                                            this.detail = Some(cx.new(|cx| {
                                                History::new(this.client.clone(), d, None, win, cx)
                                            }));
                                            cx.notify();
                                        }
                                    }))
                            }),
                    );
                }
                grid = grid.child(column);
            }
            let months = div()
                .w_full()
                .flex()
                .justify_between()
                .children((0..12).map(|i| {
                    let date = start_date + chrono::Duration::days(i * 30 + 8);
                    div()
                        .child(date.format("%b").to_string())
                        .text_size(px(10.))
                        .text_color(colors.secondary)
                }));
            let weekdays = div()
                .w(px(27.))
                .flex()
                .flex_col()
                .justify_between()
                .text_size(px(9.))
                .text_color(colors.secondary)
                .children([1, 3, 5, 7].map(|i| div().child(i.to_string())));
            heat = heat
                .child(months)
                .child(div().flex().gap(px(4.)).child(weekdays).child(grid))
                .pb(px(10.));
        }
        overview = overview.child(heat);
        let query = self.search.read(cx).value().to_lowercase();
        let name = tr(if self.kind == SeriesKind::Category {
            "data.categorySearchPlaceholder"
        } else {
            "data.appSearchPlaceholder"
        });
        self.search.update(cx, |f, _| {
            f.set_accessibility(
                InputAccessibility::new(Some(Role::TextInput)).with_label(Some(name.into())),
            )
        });
        let destination = content_card(colors.border, colors.panel)
            .id("data-destination")
            .h(px(465.))
            .flex_none()
            .gap(px(8.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(heading(tr(match self.kind {
                        SeriesKind::App => "data.appTrend",
                        SeriesKind::Web => "data.webTrend",
                        SeriesKind::Category => "data.categoryTrend",
                    })))
                    .child(modes),
            )
            .child(
                div()
                    .w(px(210.))
                    .h(px(32.))
                    .flex_none()
                    .child(Input::new(&self.search)),
            );
        let mut objects = div()
            .id("trend-objects")
            .w(relative(0.45))
            .overflow_y_scroll()
            .flex()
            .flex_col();
        for s in &data.series {
            if !s.name.to_lowercase().contains(&query) && !s.key.contains(&query) {
                continue;
            }
            let key = s.key.clone();
            let name = s.name.clone();
            objects = objects.child(action(
                SharedString::from(format!("series-{key}")),
                name.clone(),
                format!(
                    "{} {}  {}",
                    if self.selected.contains(&key) {
                        "✓"
                    } else {
                        ""
                    },
                    name,
                    duration(s.daily.values().sum())
                ),
                true,
                cx.listener(move |this, _, _, cx| {
                    if !this.selected.remove(&key) {
                        this.selected.insert(key.clone());
                    }
                    cx.notify();
                }),
            ));
        }
        let mut days = div()
            .id("trend-days")
            .flex_1()
            .overflow_y_scroll()
            .flex()
            .flex_col();
        let selected = data
            .series
            .iter()
            .find(|s| {
                self.selected.len() == 1
                    && self.selected.contains(&s.key)
                    && self.kind == SeriesKind::App
                    && s.key != "activity:anonymous"
            })
            .map(|s| (s.key.clone(), s.name.clone()));
        for (&day, &ms) in data
            .days
            .iter()
            .zip(&totals)
            .rev()
            .filter(|(_, ms)| **ms > 0)
        {
            let date = stamp(day, "%Y-%m-%d");
            let target = selected.clone();
            days = days.child(action(
                SharedString::from(date.clone()),
                date.clone(),
                format!("{date}  {}", duration(ms)),
                true,
                cx.listener(move |this, _, win, cx| {
                    this.detail_trigger = win.focused(cx);
                    win.focus(&this.detail_focus, cx);
                    this.detail =
                        Some(cx.new(|cx| {
                            History::new(this.client.clone(), day, target.clone(), win, cx)
                        }));
                    cx.notify();
                }),
            ));
        }
        let destination = destination.child(
            div().flex().flex_1().min_h_0().child(objects).child(
                div()
                    .flex()
                    .flex_col()
                    .flex_1()
                    .min_h_0()
                    .child(label(format!(
                        "{} · {}",
                        tr("data.appTrendTotal"),
                        duration(sum)
                    )))
                    .child(make_chart("selection-trend", &totals, 100.))
                    .child(days),
            ),
        );
        let page = page.child(
            div()
                .id("data-scroll")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(crate::page_controls::CARD_GAP))
                .child(overview)
                .child(destination),
        );
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
                        cx.notify();
                    });
                },
                cx,
            ));
        }
        page
    }
}

fn daily_totals(data: &Trends) -> Vec<i64> {
    let mut totals = vec![0; data.days.len()];
    for s in &data.series {
        for (&i, v) in &s.daily {
            totals[i] += v;
        }
    }
    totals
}
