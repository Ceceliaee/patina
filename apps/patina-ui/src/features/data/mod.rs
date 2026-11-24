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
use patina_desktop_protocol::MainNavigation;
use quietpro::{CARD_TITLE_GAP, content_card, heading, page as shell, page_title_row};
use std::{
    collections::{BTreeSet, HashMap},
    rc::Rc,
};
mod heatmap;
mod icons;
mod range_picker;
mod snapshot;
pub(crate) use snapshot::DataCache;
use snapshot::DataFrame;
#[cfg(all(test, feature = "test-support"))]
mod tests;
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
    frame: Option<DataFrame>,
    cache: DataCache,
    web_enabled: Option<bool>,
    view_focus: [FocusHandle; 2],
    overview_year: Option<i32>,
    heat_focus: std::cell::RefCell<HashMap<&'static str, heatmap::HeatmapFocus>>,
    weekly: bool,
    mode_focus: [FocusHandle; 3],
    heatmap_mode_focus: [FocusHandle; 2],
    range_picker: Option<RangePicker>,
    ranges: [RangeControl; 2],

    data_kind: SeriesKind,
    modes_read: Option<Task<()>>,
    read: Option<(snapshot::PanelRequest, Task<()>)>,
    error: bool,
    selected: BTreeSet<String>,
    selections: [BTreeSet<String>; 3],
    selection_notice: bool,
    rank_scroll: UniformListScrollHandle,
    viewport_height: Pixels,
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
    fn select_view(&mut self, detailed: bool, cx: &mut Context<Self>) {
        self.select_panel(detailed, self.client.navigation.get().data_kind, cx);
    }

    fn select_panel(&mut self, detailed: bool, kind: SeriesKind, cx: &mut Context<Self>) {
        let current = self.client.navigation.get();
        if current.data_detailed != detailed || current.data_kind != kind {
            self.client.remember_navigation(MainNavigation {
                data_detailed: detailed,
                data_kind: kind,
                ..current
            });
        }
        self.load_panel(false, cx);
    }

    fn detail_kind(&self) -> Option<SeriesKind> {
        match self.client.navigation.get().data_kind {
            SeriesKind::Web => self.web_enabled.map(|enabled| {
                if enabled {
                    SeriesKind::Web
                } else {
                    SeriesKind::App
                }
            }),
            kind => Some(kind),
        }
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

    pub(crate) fn new(
        client: Rc<Client>,
        cache: DataCache,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.on_release(|page, cx| page.release_frame(&HashMap::new(), cx))
            .detach();
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
            frame: None,
            cache,
            web_enabled: None,
            view_focus: std::array::from_fn(|_| cx.focus_handle()),
            overview_year: None,
            heat_focus: Default::default(),
            weekly: false,
            mode_focus: std::array::from_fn(|_| cx.focus_handle()),
            heatmap_mode_focus: std::array::from_fn(|_| cx.focus_handle()),
            range_picker: None,
            ranges: std::array::from_fn(|_| RangeControl::new(cx)),
            data_kind: SeriesKind::App,
            modes_read: None,
            read: None,
            error: false,
            selected: BTreeSet::new(),
            selections: Default::default(),
            selection_notice: false,
            rank_scroll: UniformListScrollHandle::new(),
            viewport_height: win.viewport_size().height,
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
    pub(crate) fn refresh(&mut self, cx: &mut Context<Self>) {
        let read = self.client.history_modes(None);
        self.modes_read = Some(cx.spawn(async move |view, cx| {
            let result = read.await;
            let _ = view.update(cx, |this, cx| {
                this.modes_read = None;
                let previous = this.detail_kind();
                if let Ok((_, enabled)) = result {
                    this.web_enabled = Some(enabled);
                }
                if this.client.navigation.get().data_detailed
                    && (previous.is_none() || previous != this.detail_kind())
                {
                    this.load_panel(previous.is_none(), cx);
                }
                cx.notify();
            });
        }));
        self.load_panel(true, cx);
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
        let frame = self.frame.as_ref().unwrap();
        let data = &frame.trend;
        let overall = daily_totals(data);
        let overview_total = overall.iter().sum::<i64>();
        let metric = |key, ms| {
            let value = duration(ms);
            let summary = SharedString::from(format!("{} ･ {value}", tr(key)));
            let value_range = summary.len() - value.len()..summary.len();
            div()
                .id(summary.clone())
                .role(Role::Label)
                .aria_value(summary.clone())
                .whitespace_nowrap()
                .child(StyledText::new(summary).with_highlights([(
                    value_range,
                    HighlightStyle {
                        color: Some(colors.text.into()),
                        ..Default::default()
                    },
                )]))
        };
        let mut overview = content_card(colors.border, colors.panel)
            .id("data-overview")
            .accessibility_id("data-overview")
            .flex_1()
            .min_h(px(480.))
            .gap(px(12.));
        overview = overview.child(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(16.))
                .child(
                    heading(tr("data.activityTrend"))
                        .flex_1()
                        .whitespace_nowrap(),
                )
                .child(
                    div()
                        .flex()
                        .flex_none()
                        .items_center()
                        .gap(px(16.))
                        .text_size(px(14.))
                        .font_weight(FontWeight::MEDIUM)
                        .text_color(colors.secondary)
                        .child(metric("data.appTrendTotal", overview_total))
                        .child(metric(
                            "data.appTrendAverage",
                            overview_total / data.days.len().max(1) as i64,
                        )),
                )
                .child(
                    div()
                        .flex_1()
                        .flex()
                        .justify_end()
                        .child(self.range_control(RangeTarget::Overview, colors, cx)),
                ),
        );
        let make_chart = |id: &'static str, values: &[i64], height: f32| {
            let mut points = std::collections::BTreeMap::<String, i64>::new();
            for (&day, &v) in data.days.iter().zip(values) {
                *points
                    .entry(stamp(
                        day,
                        if frame.request.selection.monthly(Local::now().date_naive()) {
                            "%Y-%m"
                        } else {
                            "%Y-%m-%d"
                        },
                    ))
                    .or_default() += v;
            }
            let entries: Vec<_> = points.into_iter().collect();
            let dates: Vec<_> = entries.iter().map(|(date, _)| date.clone()).collect();
            let tooltips = entries
                .iter()
                .map(|(date, value)| quietpro::TrendTooltip {
                    heading: format!("{date} ･ {}", duration(*value)),
                    rows: Vec::new(),
                })
                .collect();
            let days = data.days.clone();
            let view = cx.weak_entity();
            let activate =
                (!frame.request.selection.monthly(Local::now().date_naive())).then(|| {
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
                    tooltips,
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
                        quietpro::segmented_with_medium_labels(
                            ("heatmap-mode", tr("data.activityHeatmap")),
                            std::array::from_fn::<_, 2, _>(|i| {
                                let (weekly, key) =
                                    [(false, "data.heatmapDaily"), (true, "data.heatmapWeekly")][i];
                                (weekly, tr(key), None, self.heatmap_mode_focus[i].clone())
                            }),
                            self.weekly,
                            true,
                            colors,
                            quietpro::ControlSize::Medium,
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
                                    .disabled(self.overview_year.is_some_and(|year| year <= 1970))
                                    .button(colors)
                                    .on_click(cx.listener(
                                        |this, _, _, cx| {
                                            this.overview_year =
                                                Some(this.overview_year.map_or_else(
                                                    || Local::now().year(),
                                                    |year| year - 1,
                                                ));
                                            this.select_view(false, cx);
                                        },
                                    ))
                                },
                                quietpro::ControlSize::Medium,
                                colors,
                            ))
                            .child(quietpro::calendar_caption(
                                frame
                                    .request
                                    .year
                                    .map_or_else(|| tr("data.recentYear"), |year| year.to_string()),
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
                                    .disabled(self.overview_year.is_none())
                                    .button(colors)
                                    .on_click(cx.listener(
                                        |this, _, _, cx| {
                                            this.overview_year = this
                                                .overview_year
                                                .filter(|year| *year < Local::now().year())
                                                .map(|year| year + 1);
                                            this.select_view(false, cx);
                                        },
                                    ))
                                },
                                quietpro::ControlSize::Medium,
                                colors,
                            )),
                    ),
            );
        let totals = daily_totals(&frame.heat);
        heat = heat.child(self.render_heatmap(
            heatmap::HeatmapView {
                id: "overview-heatmap",
                day_indices: &frame.heat_day_indices,
                totals: &totals,
                year: frame.request.year,
                weekly: self.weekly,
            },
            colors,
            cx,
        ));
        overview.child(heat)
    }
}

impl Render for DataPage {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.viewport_height = win.viewport_size().height;
        let locale = self.client.locale.get();
        let tr = |k| text(locale, k);
        let colors = self.client.palette(win);

        let mut page = shell(colors);
        let requested_detail = self.client.navigation.get().data_detailed;
        let detailed = self
            .frame
            .as_ref()
            .map_or(requested_detail, |frame| frame.request.detailed);

        let view = cx.weak_entity();
        let view_switch = quietpro::page_tabs(
            ("data-view", tr("data.title")),
            std::array::from_fn::<_, 2, _>(|i| {
                let (detailed, key) =
                    [(false, "data.overview"), (true, "data.detailedAnalysis")][i];
                (detailed, tr(key), None, self.view_focus[i].clone())
            }),
            quietpro::SegmentSelection {
                displayed: detailed,
                requested: requested_detail,
            },
            colors,
            move |detailed, win, cx| {
                let _ = view.update(cx, |this, cx| {
                    if this.client.navigation.get().data_detailed != detailed {
                        this.close_range(false, win, cx);
                        this.select_view(detailed, cx);
                    }
                });
            },
        );
        page = page.child(
            page_title_row(tr("data.title"), quietpro::Icon::ChartSpline, colors)
                .child(view_switch),
        );
        let mode_options = [
            (SeriesKind::App, "data.destinationApp"),
            (SeriesKind::Category, "data.destinationCategory"),
            (SeriesKind::Web, "data.destinationWeb"),
        ];
        let view = cx.weak_entity();
        let modes = quietpro::segmented_with_medium_labels(
            ("destination-mode", tr("data.destinationMode")),
            std::array::from_fn::<_, 3, _>(|i| {
                let (kind, key) = mode_options[i];
                (kind, tr(key), None, self.mode_focus[i].clone())
            })
            .into_iter()
            .take(if self.web_enabled == Some(true) { 3 } else { 2 }),
            quietpro::SegmentSelection {
                displayed: self.data_kind,
                requested: self.detail_kind().unwrap_or(self.data_kind),
            },
            true,
            colors,
            quietpro::ControlSize::Medium,
            move |kind, _, cx| {
                let _ = view.update(cx, |this, cx| {
                    this.select_panel(true, kind, cx);
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
        if self.frame.is_none() {
            return page;
        }
        let panel = if detailed {
            self.trend_panel(modes, colors, win, cx)
        } else {
            self.overview_panel(colors, win, cx)
        };
        let page = page.child(
            div()
                .id(if detailed {
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
            return page.child(crate::features::history::History::detail_dialog(
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
