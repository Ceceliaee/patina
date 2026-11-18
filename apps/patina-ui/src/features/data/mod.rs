use crate::{
    client::Client,
    features::format::duration,
    features::history::History,
    features::page_controls::{label, stamp},
};
use chrono::{Datelike, Days, Local, NaiveDate};
use gpui_kit::{
    base::input::{InputAccessibility, InputEvent, InputState},
    prelude::*,
    *,
};
use patina_activity_model::{SeriesKind, Trends, text};
use quietpro::{CARD_TITLE_GAP, content_card, heading, page as shell, page_title_row};
use std::{
    collections::{BTreeSet, HashMap},
    rc::Rc,
    sync::Arc,
};
mod heatmap;
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
pub(crate) struct OpenHistoryDay(pub i64);

pub(crate) struct DataPage {
    quick_edit: Option<Entity<crate::features::page_controls::quick_edit::QuickEdit>>,
    client: Rc<Client>,
    refresh_timer: Option<Task<()>>,
    detailed: bool,
    web_enabled: bool,
    view_focus: [FocusHandle; 2],
    year: i32,
    recent_heat: bool,
    heat: Option<Trends>,
    heat_focus: std::cell::RefCell<HashMap<&'static str, heatmap::HeatmapFocus>>,
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
    modes_read: Option<Task<()>>,
    read: Option<Task<()>>,
    error: bool,
    selected: BTreeSet<String>,
    selections: [BTreeSet<String>; 3],
    selection_notice: bool,
    icons: HashMap<String, trend::SourceIcon>,
    icon_read: Option<Task<()>>,
    trend_heat: Option<(SeriesKind, Trends)>,
    trend_heat_read: Option<Task<()>>,
    trend_heat_year: Option<i32>,
    trend_heat_weekly: bool,
    trend_heat_mode_focus: [FocusHandle; 2],
    searches: [Entity<InputState>; 3],
    detail: Option<Entity<History>>,
    detail_focus: FocusHandle,
    detail_trigger: Option<FocusHandle>,
}
impl EventEmitter<OpenHistoryDay> for DataPage {}

impl DataPage {
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

    pub(crate) fn new(client: Rc<Client>, win: &mut Window, cx: &mut Context<Self>) -> Self {
        let today = Local::now().date_naive();
        let searches = std::array::from_fn(|_| {
            let search = cx.new(|cx| InputState::new(win, cx));
            cx.subscribe(&search, |_, _, event, cx| {
                if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                    cx.notify();
                }
            })
            .detach();
            cx.observe(&search, |_, _, cx| cx.notify()).detach();
            search
        });
        let mut this = Self {
            quick_edit: None,
            client,
            refresh_timer: None,
            detailed: false,
            web_enabled: false,
            view_focus: std::array::from_fn(|_| cx.focus_handle()),
            year: today.year(),
            recent_heat: true,
            heat: None,
            heat_focus: Default::default(),
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
            modes_read: None,
            read: None,
            error: false,
            selected: BTreeSet::new(),
            selections: Default::default(),
            selection_notice: false,
            icons: HashMap::new(),
            icon_read: None,
            trend_heat: None,
            trend_heat_read: None,
            trend_heat_year: None,
            trend_heat_weekly: false,
            trend_heat_mode_focus: std::array::from_fn(|_| cx.focus_handle()),
            searches,
            detail: None,
            detail_focus: cx.focus_handle(),
            detail_trigger: None,
        };
        this.refresh(cx);
        this.refresh_timer = Some(cx.spawn_in(win, async move |view, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_secs(30))
                    .await;
                if view
                    .update_in(cx, |this, win, cx| {
                        if win.is_window_active() {
                            this.refresh(cx);
                        }
                    })
                    .is_err()
                {
                    break;
                }
            }
        }));
        cx.observe_window_activation(win, |this: &mut Self, win, cx| {
            if win.is_window_active() {
                this.refresh(cx);
            }
        })
        .detach();
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
    pub(crate) fn refresh(&mut self, cx: &mut Context<Self>) {
        let read = self.client.history_modes(None);
        self.modes_read = Some(cx.spawn(async move |view, cx| {
            if let Ok((_, enabled)) = read.await {
                let _ = view.update(cx, |this, cx| {
                    this.web_enabled = enabled;
                    if !enabled && this.kind == SeriesKind::Web {
                        this.kind = SeriesKind::App;
                        this.load_destination(cx);
                    }
                    cx.notify();
                });
            }
        }));
        self.error = false;
        self.load_overview(cx);
        self.load_destination(cx);
        self.load_heat(cx);
        self.load_trend_heat(cx);
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
                            this.selections[this.data_kind as usize] = this.selected.clone();
                            this.selected = this.selections[kind as usize].clone();
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
impl DataPage {
    fn overview_panel(
        &self,
        colors: quietpro::Palette,
        win: &Window,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let locale = self.client.locale.get();
        let tr = |key| text(locale, key);
        let data = self.overview.as_ref().unwrap();
        let overall = daily_totals(data);
        let overview_total = overall.iter().sum::<i64>();
        let mut overview = content_card(colors.border, colors.panel)
            .id("data-overview")
            .accessibility_id("data-overview")
            .flex_1()
            .min_h(px(480.))
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
                        if self.ranges[RangeTarget::Overview as usize].monthly() {
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
            let activate = (!self.ranges[RangeTarget::Overview as usize].monthly()).then(|| {
                Rc::new(move |i: usize, _win: &mut Window, cx: &mut App| {
                    if let Some(&day) = days.get(i) {
                        let _ = view.update(cx, |_, cx| cx.emit(OpenHistoryDay(day)));
                    }
                }) as Rc<dyn Fn(usize, &mut Window, &mut App)>
            });
            div()
                .w_full()
                .flex_1()
                .min_h(px(height))
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
        overview = overview.child(make_chart("overview-trend", &overall, 200.));
        let mut heat = div()
            .id("overview-heatmap")
            .role(Role::Group)
            .accessibility_id("overview-heatmap")
            .flex_none()
            .border_t_1()
            .border_color(colors.border)
            .pt(px(16.))
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
        let totals = self.heat.as_ref().map(daily_totals).unwrap_or_default();
        heat = heat.child(
            self.render_heatmap(
                heatmap::HeatmapView {
                    id: "overview-heatmap",
                    days: self
                        .heat
                        .as_ref()
                        .map(|data| data.days.as_slice())
                        .unwrap_or_default(),
                    totals: &totals,
                    year: (!self.recent_heat).then_some(self.year),
                    weekly: self.weekly,
                    loading: self.heat.is_none(),
                },
                colors,
                cx,
            ),
        );
        overview.child(heat)
    }
}

impl Render for DataPage {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let locale = self.client.locale.get();
        let tr = |k| text(locale, k);
        let colors = self.client.palette(win);

        let mut page = shell(colors);

        let view = cx.weak_entity();
        let view_switch = quietpro::segmented(
            "data-view",
            tr("data.title"),
            std::array::from_fn::<_, 2, _>(|i| {
                let (detailed, key) =
                    [(false, "data.overview"), (true, "data.detailedAnalysis")][i];
                (detailed, tr(key), None, self.view_focus[i].clone())
            }),
            self.detailed,
            true,
            colors,
            move |detailed, win, cx| {
                let _ = view.update(cx, |this, cx| {
                    if this.detailed != detailed {
                        this.close_range(false, win, cx);
                        this.detailed = detailed;
                        cx.notify();
                    }
                });
            },
        );
        page = page.child(
            page_title_row(tr("data.title"), quietpro::Icon::ChartColumn, colors)
                .child(view_switch),
        );
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
            })
            .into_iter()
            .take(if self.web_enabled { 3 } else { 2 }),
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
        if (self.detailed && self.data.is_none()) || (!self.detailed && self.overview.is_none()) {
            return page.child(label(tr("common.loading")));
        }
        let panel = if self.detailed {
            self.trend_panel(modes, colors, win, cx)
        } else {
            self.overview_panel(colors, win, cx)
        };
        let page = page.child(
            div()
                .id(if self.detailed {
                    "data-detail-scroll"
                } else {
                    "data-overview-scroll"
                })
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .child(panel),
        );
        if let Some(detail) = &self.detail {
            let view = cx.weak_entity();
            return page.child(crate::features::page_controls::detail_dialog(
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
        let page = page.children(self.quick_edit.clone());
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
