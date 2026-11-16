use crate::{
    format::duration,
    history::History,
    page_controls::{label, stamp},
    windows_host::Client,
};
use chrono::{Datelike, Days, Local, NaiveDate};
use gpui_kit::{
    base::input::{InputAccessibility, InputEvent, InputState},
    prelude::*,
    *,
};
use patina_recorder::{SeriesKind, Trends, text};
use quietpro::{CARD_TITLE_GAP, content_card, heading, page as shell, page_title_row};
use std::{
    collections::{BTreeSet, HashMap},
    rc::Rc,
    sync::Arc,
};
mod range_picker;
mod trend;
use range_picker::{RangeControl, RangePicker, RangeTarget};

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
    year: i32,
    recent_heat: bool,
    heat: Option<Trends>,
    heat_read: Option<Task<()>>,
    weekly: bool,
    mode_focus: [FocusHandle; 3],
    heatmap_mode_focus: [FocusHandle; 2],
    range_picker: Option<RangePicker>,
    ranges: [RangeControl; 2],

    kind: SeriesKind,
    data_kind: SeriesKind,
    data: Option<Trends>,
    overview: Option<Trends>,
    overview_read: Option<Task<()>>,
    read: Option<Task<()>>,
    error: bool,
    selected: BTreeSet<String>,
    icons: HashMap<String, trend::SourceIcon>,
    icon_read: Option<Task<()>>,
    trend_heat: Option<(SeriesKind, Trends)>,
    trend_heat_read: Option<Task<()>>,
    trend_heat_year: Option<i32>,
    trend_heat_weekly: bool,
    trend_heat_mode_focus: [FocusHandle; 2],
    search: Entity<InputState>,
    detail: Option<Entity<History>>,
    detail_focus: FocusHandle,
    detail_trigger: Option<FocusHandle>,
}
impl DataPage {
    pub(super) fn new(client: Rc<Client>, win: &mut Window, cx: &mut Context<Self>) -> Self {
        let today = Local::now().date_naive();
        let search = cx.new(|cx| InputState::new(win, cx));
        cx.subscribe(&search, |_, _, event, cx| {
            if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                cx.notify();
            }
        })
        .detach();
        cx.observe(&search, |_, _, cx| cx.notify()).detach();
        let mut this = Self {
            client,
            year: today.year(),
            recent_heat: true,
            heat: None,
            heat_read: None,
            weekly: false,
            mode_focus: std::array::from_fn(|_| cx.focus_handle()),
            heatmap_mode_focus: std::array::from_fn(|_| cx.focus_handle()),
            range_picker: None,
            ranges: std::array::from_fn(|_| RangeControl::new(cx)),
            kind: SeriesKind::App,
            data_kind: SeriesKind::App,
            data: None,
            overview: None,
            overview_read: None,
            read: None,
            error: false,
            selected: BTreeSet::new(),
            icons: HashMap::new(),
            icon_read: None,
            trend_heat: None,
            trend_heat_read: None,
            trend_heat_year: None,
            trend_heat_weekly: false,
            trend_heat_mode_focus: std::array::from_fn(|_| cx.focus_handle()),
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
        self.load_overview(cx);
        self.load_destination(cx);
    }
    fn load_overview(&mut self, cx: &mut Context<Self>) {
        let read = self.client.trends(
            self.ranges[RangeTarget::Overview as usize].range(),
            SeriesKind::App,
        );
        self.overview_read = Some(cx.spawn(async move |view, cx| {
            let result = read.await;
            let _ = view.update(cx, |this, cx| {
                match result {
                    Ok(data) => this.overview = Some(data),
                    Err(_) => this.error = true,
                }
                cx.notify();
            });
        }));
    }
    fn load_destination(&mut self, cx: &mut Context<Self>) {
        let kind = self.kind;
        let read = self
            .client
            .trends(self.ranges[RangeTarget::Destination as usize].range(), kind);
        self.read = Some(cx.spawn(async move |view, cx| {
            let result = read.await;
            let _ = view.update(cx, |this, cx| {
                match result {
                    Ok(data) => {
                        if this.data_kind != kind {
                            this.selected.clear();
                        }
                        this.data_kind = kind;
                        this.selected
                            .retain(|key| data.series.iter().any(|s| &s.key == key));
                        if this.selected.is_empty()
                            && let Some(first) = data.series.first()
                        {
                            this.selected.insert(first.key.clone());
                        }
                        this.data = Some(data);
                        this.load_icons(cx);
                        if this
                            .trend_heat
                            .as_ref()
                            .is_none_or(|(kind, _)| *kind != this.kind)
                        {
                            this.load_trend_heat(cx);
                        }
                    }
                    Err(_) => this.error = true,
                };
                cx.notify();
            });
        }));
        cx.notify();
    }
}
impl Render for DataPage {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.client.locale.get();
        let tr = |k| text(locale, k);
        let colors = self.client.palette(win);

        let mut page = shell(colors);

        page = page.child(page_title_row(
            tr("data.title"),
            quietpro::Icon::ChartColumn,
            colors,
        ));
        let mode_options = [
            (SeriesKind::App, "data.destinationApp"),
            (SeriesKind::Category, "data.destinationCategory"),
            (SeriesKind::Web, "data.destinationWeb"),
        ];
        let view = cx.weak_entity();
        let modes = quietpro::segmented(
            "destination-mode",
            tr("data.destinationMode"),
            std::array::from_fn::<_, 3, _>(|i| {
                let (kind, key) = mode_options[i];
                (kind, tr(key), None, self.mode_focus[i].clone())
            }),
            self.kind,
            true,
            colors,
            move |kind, _, cx| {
                let _ = view.update(cx, |this, cx| {
                    if this.kind != kind {
                        this.kind = kind;
                        this.load_destination(cx);
                    }
                });
            },
        );

        if self.error {
            page = page.child(label(tr("destinationDetail.dayError"))).child({
                let accessible_name = tr("common.retry");
                quietpro::text_button("retry", tr("common.retry"), colors, true)
                    .accessibility_label(accessible_name)
                    .on_click(cx.listener(|this, _, _, cx| this.refresh(cx)))
            });
        }
        let (Some(data), Some(_)) = (&self.overview, &self.data) else {
            return page.child(label(tr("common.loading")));
        };
        let overall = daily_totals(data);
        let overview_total = overall.iter().sum::<i64>();
        let mut overview = content_card(colors.border, colors.panel)
            .id("data-overview")
            .flex_none()
            .gap(px(12.));
        overview = overview.child(
            div()
                .flex()
                .items_center()
                .gap(px(16.))
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
                .child(self.range_control(RangeTarget::Overview, colors, cx)),
        );
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
            let dates: Vec<_> = entries.iter().map(|(date, _)| date.clone()).collect();
            let descriptions = entries
                .iter()
                .map(|(date, value)| format!("{date} · {}", duration(*value)))
                .collect();
            let days = data.days.clone();
            let view = cx.weak_entity();
            let activate = (data.days.len() <= 62).then(|| {
                Rc::new(move |i: usize, win: &mut Window, cx: &mut App| {
                    if let Some(&day) = days.get(i) {
                        let _ = view.update(cx, |this, cx| {
                            this.detail_trigger = win.focused(cx);
                            win.focus(&this.detail_focus, cx);
                            this.detail = Some(cx.new(|cx| {
                                History::new_source(this.client.clone(), day, None, false, win, cx)
                            }));
                            cx.notify();
                        });
                    }
                }) as Rc<dyn Fn(usize, &mut Window, &mut App)>
            });
            div()
                .w_full()
                .h(px(height))
                .flex()
                .flex_col()
                .child(quietpro::TrendChart {
                    id: id.into(),
                    label: tr("data.activityTrend").into(),
                    labels: dates,
                    descriptions,
                    series: vec![quietpro::TrendSeries {
                        values: entries
                            .iter()
                            .map(|(_, ms)| *ms as f32 / 3_600_000.)
                            .collect(),
                        color: quietpro::activity_display_color(
                            u32::from(colors.accent) >> 8,
                            colors.panel,
                            self.client.dark(win),
                        ),
                    }],
                    colors,
                    unit: "h".into(),
                    activate,
                })
        };
        overview = overview.child(make_chart("overview-trend", &overall, 240.));
        let mut heat = div()
            .border_t_1()
            .border_color(colors.border)
            .pt(px(14.))
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .child(heading(tr("data.activityHeatmap")).flex_1())
                    .child({
                        let view = cx.weak_entity();
                        quietpro::segmented(
                            "heatmap-mode",
                            tr("data.activityHeatmap"),
                            std::array::from_fn::<_, 2, _>(|i| {
                                let (weekly, key) =
                                    [(false, "data.heatmapDaily"), (true, "data.heatmapWeekly")][i];
                                (weekly, tr(key), None, self.heatmap_mode_focus[i].clone())
                            }),
                            self.weekly,
                            true,
                            colors,
                            move |weekly, _, cx| {
                                let _ = view.update(cx, |this, cx| {
                                    this.weekly = weekly;
                                    cx.notify();
                                });
                            },
                        )
                    })
                    .child(
                        quietpro::calendar_controls()
                            .child(quietpro::calendar_arrow_frame(
                                {
                                    let accessible_name = tr("accessibility.history.previousMonth");
                                    quietpro::IconControl::new(
                                        "year-prev",
                                        accessible_name,
                                        quietpro::Icon::ChevronLeft,
                                    )
                                    .disabled(self.year <= 1970)
                                    .button(colors)
                                    .on_click(cx.listener(
                                        |this, _, _, cx| {
                                            if this.recent_heat {
                                                this.recent_heat = false;
                                                this.year = Local::now().date_naive().year();
                                            } else {
                                                this.year -= 1;
                                            }
                                            this.load_heat(cx);
                                        },
                                    ))
                                },
                                colors,
                            ))
                            .child(quietpro::calendar_caption(
                                if self.recent_heat {
                                    tr("data.recentYear")
                                } else {
                                    self.year.to_string()
                                },
                                colors,
                            ))
                            .child(quietpro::calendar_arrow_frame(
                                {
                                    let accessible_name = tr("accessibility.history.nextMonth");
                                    quietpro::IconControl::new(
                                        "year-next",
                                        accessible_name,
                                        quietpro::Icon::ChevronRight,
                                    )
                                    .disabled(self.recent_heat)
                                    .button(colors)
                                    .on_click(cx.listener(
                                        |this, _, _, cx| {
                                            if this.year == Local::now().date_naive().year() {
                                                this.recent_heat = true;
                                            } else {
                                                this.year += 1;
                                            }
                                            this.load_heat(cx);
                                        },
                                    ))
                                },
                                colors,
                            )),
                    ),
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
        let destination = self.trend_panel(modes, colors, win, cx);
        let page = page.child(
            div()
                .id("data-scroll")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(quietpro::CARD_GAP))
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
                win,
                cx,
            ));
        }
        if self.range_picker.is_some() {
            page.child(self.range_popup(colors, win, cx))
        } else {
            page
        }
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
