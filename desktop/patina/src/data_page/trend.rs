use super::*;
use gpui_kit::base::Button;
use patina_recorder::{Series, format_text};
use quietpro::{Icon, Palette};

struct TrendTooltip(String, Palette);
impl Render for TrendTooltip {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .max_w(px(440.))
            .p(px(8.))
            .border_1()
            .border_color(self.1.border)
            .rounded(px(6.))
            .bg(self.1.panel)
            .text_color(self.1.text)
            .text_size(px(12.))
            .child(self.0.clone())
    }
}

pub(super) struct SourceIcon {
    image: Arc<Image>,
    color: Option<u32>,
    source: Option<String>,
}

impl DataPage {
    pub(super) fn load_trend_heat(&mut self, cx: &mut Context<Self>) {
        let today = Local::now().date_naive();
        let kind = self.data_kind;
        let dates = heatmap_dates(self.trend_heat_year, today);
        let start = self.trend_heat_year.map_or(dates[0], |year| {
            NaiveDate::from_ymd_opt(year, 1, 1).unwrap()
        });
        let end = self.trend_heat_year.map_or(today, |year| {
            NaiveDate::from_ymd_opt(year, 12, 31).unwrap().min(today)
        });
        let read = self.client.trends(noon(start).zip(noon(end)), kind);
        self.trend_heat = None;
        self.trend_heat_read = Some(cx.spawn(async move |view, cx| {
            let result = read.await;
            let _ = view.update(cx, |this, cx| {
                match result {
                    Ok(data) => this.trend_heat = Some((kind, data)),
                    Err(_) => this.error = true,
                }
                this.trend_heat_read = None;
                cx.notify();
            });
        }));
    }
    fn trend_chart(
        &self,
        days: &[i64],
        lines: Vec<(String, Rgba, Vec<i64>)>,
        c: Palette,
        cx: &mut Context<Self>,
    ) -> quietpro::TrendChart {
        let monthly = days.len() > 62;
        let mut dates = Vec::<String>::new();
        let mut buckets = Vec::new();
        for day in days {
            let date = stamp(*day, if monthly { "%Y-%m" } else { "%Y-%m-%d" });
            if dates.last() != Some(&date) {
                dates.push(date);
            }
            buckets.push(dates.len() - 1);
        }
        let lines: Vec<_> = lines
            .into_iter()
            .map(|(name, color, values)| {
                let mut totals = vec![0i64; dates.len()];
                for (i, value) in values.iter().enumerate() {
                    totals[buckets[i]] += value;
                }
                (name, color, totals)
            })
            .collect();
        let selected = self
            .data
            .as_ref()
            .and_then(|d| {
                d.series.iter().find(|s| {
                    self.selected.len() == 1
                        && self.selected.contains(&s.key)
                        && self.data_kind != SeriesKind::Category
                        && s.key != "activity:anonymous"
                })
            })
            .map(|s| (s.key.clone(), s.name.clone()));
        let descriptions = dates
            .iter()
            .enumerate()
            .map(|(i, date)| {
                let values = lines
                    .iter()
                    .map(|(name, _, values)| format!("{name} {}", duration(values[i])))
                    .collect::<Vec<_>>()
                    .join("\n");
                format!("{date}\n{values}")
            })
            .collect();
        let days = days.to_vec();
        let view = cx.weak_entity();
        let activate = (!monthly).then(|| {
            Rc::new(move |i: usize, win: &mut Window, cx: &mut App| {
                if let Some(&day) = days.get(i) {
                    let _ = view.update(cx, |this, cx| {
                        this.open_trend_day(day, selected.clone(), win, cx)
                    });
                }
            }) as Rc<dyn Fn(usize, &mut Window, &mut App)>
        });
        quietpro::TrendChart {
            id: "selection-trend".into(),
            label: text(self.client.locale.get(), "data.activityTrend").into(),
            labels: dates,
            descriptions,
            series: lines
                .into_iter()
                .map(|(_, color, values)| quietpro::TrendSeries {
                    color,
                    values: values
                        .into_iter()
                        .map(|ms| ms as f32 / 3_600_000.)
                        .collect(),
                })
                .collect(),
            colors: c,
            unit: "h".into(),
            activate,
        }
    }

    fn trend_heat_header(&self, c: Palette, cx: &mut Context<Self>) -> Div {
        let locale = self.client.locale.get();
        let title = text(
            locale,
            match self.data_kind {
                SeriesKind::App => "data.appHeatmap",
                SeriesKind::Category => "data.categoryHeatmap",
                SeriesKind::Web => "data.webHeatmap",
            },
        );
        let current_year = Local::now().year();
        let earliest_year = self
            .trend_heat
            .as_ref()
            .and_then(|(_, data)| data.earliest)
            .and_then(chrono::DateTime::from_timestamp_millis)
            .map(|date| date.with_timezone(&Local).year())
            .unwrap_or(current_year)
            .min(current_year);
        let ready = self.trend_heat_read.is_none() && self.trend_heat.is_some();
        let previous = self.trend_heat_year.is_none_or(|year| year > earliest_year);
        let caption = self
            .trend_heat_year
            .map_or_else(|| text(locale, "data.recentYear"), |year| year.to_string());
        let arrow = |next| {
            quietpro::calendar_arrow_frame(
                quietpro::IconControl::new(
                    if next {
                        "trend-heat-newer"
                    } else {
                        "trend-heat-older"
                    },
                    text(
                        locale,
                        if next {
                            "accessibility.data.newerRange"
                        } else {
                            "accessibility.data.earlierRange"
                        },
                    ),
                    if next {
                        Icon::ChevronRight
                    } else {
                        Icon::ChevronLeft
                    },
                )
                .disabled(
                    !ready
                        || if next {
                            self.trend_heat_year.is_none()
                        } else {
                            !previous
                        },
                )
                .action(
                    c,
                    cx.listener(move |this, _, _, cx| {
                        this.trend_heat_year = if next {
                            this.trend_heat_year
                                .filter(|year| *year < Local::now().year())
                                .map(|year| year + 1)
                        } else {
                            Some(
                                this.trend_heat_year
                                    .map_or(Local::now().year(), |year| year - 1),
                            )
                        };
                        this.load_trend_heat(cx);
                        cx.notify();
                    }),
                ),
                c,
            )
        };
        div()
            .flex()
            .items_center()
            .gap(px(8.))
            .child(
                label(title.clone())
                    .text_size(px(12.))
                    .text_color(c.secondary)
                    .flex_1(),
            )
            .child({
                let view = cx.weak_entity();
                quietpro::segmented(
                    "destination-heat-granularity",
                    title.clone(),
                    std::array::from_fn::<_, 2, _>(|i| {
                        let (weekly, key) =
                            [(false, "data.heatmapDaily"), (true, "data.heatmapWeekly")][i];
                        (
                            weekly,
                            text(locale, key),
                            None,
                            self.trend_heat_mode_focus[i].clone(),
                        )
                    }),
                    self.trend_heat_weekly,
                    true,
                    c,
                    move |weekly, _, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.trend_heat_weekly = weekly;
                            cx.notify();
                        });
                    },
                )
            })
            .child(
                quietpro::calendar_controls()
                    .id("destination-heat-range")
                    .role(Role::Group)
                    .aria_label(text(locale, "accessibility.data.heatmapRange"))
                    .accessibility_id("destination-heat-range")
                    .child(arrow(false))
                    .child(
                        quietpro::calendar_caption(caption.clone(), c)
                            .id("destination-heat-year")
                            .role(Role::Label)
                            .aria_value(caption),
                    )
                    .child(arrow(true)),
            )
    }
    fn trend_heatmap(
        &self,
        days: &[i64],
        totals: &[i64],
        c: Palette,
        _win: &Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let target = self
            .data
            .as_ref()
            .and_then(|d| {
                d.series.iter().find(|s| {
                    self.selected.len() == 1
                        && self.selected.contains(&s.key)
                        && self.data_kind != SeriesKind::Category
                        && s.key != "activity:anonymous"
                })
            })
            .map(|s| (s.key.clone(), s.name.clone()));
        let today = Local::now().date_naive();
        let dates = heatmap_dates(self.trend_heat_year, today);
        let first = days
            .first()
            .and_then(|day| chrono::DateTime::from_timestamp_millis(*day))
            .map(|day| day.with_timezone(&Local).date_naive());
        let in_range =
            |date: NaiveDate| self.trend_heat_year.is_none_or(|year| date.year() == year);
        let value = |date: NaiveDate| {
            if date > today || !in_range(date) {
                return 0;
            }
            first
                .and_then(|first| usize::try_from((date - first).num_days()).ok())
                .and_then(|i| totals.get(i))
                .copied()
                .unwrap_or(0)
        };
        let weekly_totals: Vec<i64> = dates
            .chunks(7)
            .map(|week| week.iter().map(|date| value(*date)).sum())
            .collect();
        let max_week = weekly_totals.iter().copied().max().unwrap_or(1).max(1);
        let max = totals.iter().copied().max().unwrap_or(1).max(1);
        let mut cells = div().flex().gap(px(3.)).w_full().overflow_x_hidden();
        for (week_index, week) in dates.chunks(7).enumerate() {
            let week_total = weekly_totals[week_index];
            let filled_rows = ((week_total as f64 / max_week as f64) * 7.).ceil() as usize;
            let visible: Vec<_> = week
                .iter()
                .copied()
                .filter(|date| in_range(*date) && *date <= today)
                .collect();
            let weekly_description = visible
                .first()
                .zip(visible.last())
                .map(|(start, end)| format!("{start} – {end} · {}", duration(week_total)));
            let mut column = div()
                .flex()
                .flex_col()
                .gap(px(3.))
                .flex_1()
                .max_w(px(14.))
                .min_w(px(4.));
            for (row, &date) in week.iter().enumerate() {
                let active = date <= today && in_range(date);
                if !in_range(date) || (!self.trend_heat_weekly && !active) {
                    column = column.child(div().w_full().h(px(10.)).flex_none());
                    continue;
                }
                let day = noon(date).unwrap();
                let ms = value(date);
                let target = target.clone();
                let description = if self.trend_heat_weekly {
                    weekly_description.clone().unwrap_or_else(|| {
                        format!(
                            "{date} · {}",
                            text(self.client.locale.get(), "data.notStarted")
                        )
                    })
                } else {
                    format!("{date} · {}", duration(ms))
                };
                let intensity = if self.trend_heat_weekly {
                    if row >= 7 - filled_rows && week_total > 0 {
                        0.88
                    } else {
                        0.
                    }
                } else if ms > 0 {
                    (ms as f32 / max as f32).clamp(0.16, 1.)
                } else {
                    0.
                };
                column = column.child(
                    Button::new(SharedString::from(format!("trend-heat-{date}")))
                        .accessibility_label(date.to_string())
                        .aria_description(description.clone())
                        .w_full()
                        .h(px(10.))
                        .flex_none()
                        .rounded(px(2.))
                        .disabled(!active)
                        .bg(if intensity == 0. {
                            c.canvas
                        } else {
                            c.panel.blend(c.accent.opacity(intensity))
                        })
                        .border_1()
                        .border_color(c.border)
                        .focus_visible(move |s| s.border_color(c.secondary))
                        .tooltip(move |_, cx| {
                            cx.new(|_| TrendTooltip(description.clone(), c)).into()
                        })
                        .on_click(cx.listener(move |this, e: &ClickEvent, win, cx| {
                            if active && (e.is_keyboard() || e.click_count() == 2) {
                                this.open_trend_day(day, target.clone(), win, cx);
                            }
                        })),
                );
            }
            cells = cells.child(column);
        }
        let mut months = div()
            .flex()
            .w_full()
            .text_size(px(10.))
            .text_color(c.secondary);
        let mut previous = String::new();
        for week in dates.chunks(7) {
            let month = week
                .iter()
                .find(|date| self.trend_heat_year.is_none_or(|year| date.year() == year))
                .map(|date| date.format("%m").to_string())
                .unwrap_or_default();
            let caption = if month != previous {
                month.clone()
            } else {
                String::new()
            };
            previous = month;
            months = months.child(div().flex_1().min_w_0().child(caption));
        }
        div()
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(months)
            .child(cells)
    }
    pub(super) fn load_icons(&mut self, cx: &mut Context<Self>) {
        self.icon_read = None;
        let Some(data) = &self.data else { return };
        if self.data_kind == SeriesKind::Category {
            return;
        }
        let kind = self.data_kind;
        let missing: Vec<_> = data
            .series
            .iter()
            .filter(|s| s.key != "activity:anonymous")
            .filter(|s| self.icons.get(&s.key).is_none_or(|i| i.source != s.favicon))
            .map(|s| (s.key.clone(), s.favicon.clone()))
            .collect();
        if missing.is_empty() {
            return;
        }
        let client = self.client.clone();
        let renderer = cx.svg_renderer();
        self.icon_read = Some(cx.spawn(async move |view, cx| {
            let images = if kind == SeriesKind::App {
                client
                    .icons(missing.iter().map(|(key, _)| key.clone()).collect())
                    .await
                    .unwrap_or_default()
                    .into_iter()
                    .map(|(key, bytes)| (key, None, bytes))
                    .collect::<Vec<_>>()
            } else {
                let mut images = Vec::new();
                for (key, source) in missing {
                    let Some(source) = source else { continue };
                    let url = source.clone();
                    let executor = cx.background_executor().clone();
                    let renderer = renderer.clone();
                    if let Some(bytes) = cx
                        .background_executor()
                        .spawn(async move {
                            crate::source_icon::favicon(&url, &executor, renderer).await
                        })
                        .await
                    {
                        images.push((key, Some(source), bytes));
                    }
                }
                images
            };
            let _ = view.update(cx, |this, cx| {
                for (key, source, bytes) in images {
                    this.icons.insert(
                        key,
                        SourceIcon {
                            color: patina_recorder::icon_color(&bytes),
                            image: Arc::new(Image::from_bytes(ImageFormat::Png, bytes)),
                            source,
                        },
                    );
                }
                this.icon_read = None;
                cx.notify();
            });
        }));
    }

    fn choose_series(&mut self, key: &str, multi: bool, cx: &mut Context<Self>) {
        if !multi {
            self.selected.clear();
            self.selected.insert(key.to_owned());
        } else if self.selected.contains(key) {
            if self.selected.len() > 1 {
                self.selected.remove(key);
            }
        } else if self.selected.len() < 7 {
            self.selected.insert(key.to_owned());
        }
        cx.notify();
    }

    fn open_trend_day(
        &mut self,
        day: i64,
        target: Option<(String, String)>,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.detail_trigger = win.focused(cx);
        win.focus(&self.detail_focus, cx);
        self.detail = Some(cx.new(|cx| {
            History::new_source(
                self.client.clone(),
                day,
                target,
                self.data_kind == SeriesKind::Web,
                win,
                cx,
            )
        }));
        cx.notify();
    }

    fn series_color(&self, s: &Series, c: Palette, win: &Window) -> Rgba {
        let icon = if self.data_kind == SeriesKind::Category {
            None
        } else {
            self.icons.get(&s.key).and_then(|i| i.color)
        };
        quietpro::activity_display_color(s.source_color(icon), c.panel, self.client.dark(win))
    }

    fn series_icon(&self, s: &Series, c: Palette, win: &Window) -> AnyElement {
        if s.key == "activity:anonymous" {
            quietpro::glyph(Icon::EyeOff, c.secondary)
                .size(px(16.))
                .into_any_element()
        } else if self.data_kind == SeriesKind::Category {
            div()
                .size(px(12.))
                .rounded_full()
                .bg(self.series_color(s, c, win))
                .into_any_element()
        } else if let Some(icon) = self.icons.get(&s.key) {
            div()
                .id(SharedString::from(format!("trend-icon-{}", s.key)))
                .role(Role::Image)
                .aria_label(s.name.clone())
                .size(px(16.))
                .child(img(icon.image.clone()).size(px(16.)))
                .into_any_element()
        } else {
            quietpro::glyph(
                if self.data_kind == SeriesKind::Web {
                    Icon::Globe
                } else {
                    Icon::AppWindow
                },
                c.secondary,
            )
            .size(px(16.))
            .into_any_element()
        }
    }

    pub(super) fn trend_panel(
        &mut self,
        modes: impl IntoElement,
        c: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Stateful<Div> {
        let locale = self.client.locale.get();
        let tr = |k| text(locale, k);
        let data = self.data.as_ref().unwrap();
        let category = self.data_kind == SeriesKind::Category;
        let web = self.data_kind == SeriesKind::Web;
        let title = tr(if category {
            "data.categoryTrend"
        } else if web {
            "data.webTrend"
        } else {
            "data.appTrend"
        });
        let search_name = tr(if category {
            "data.categorySearchPlaceholder"
        } else if web {
            "data.webSearchPlaceholder"
        } else {
            "data.appSearchPlaceholder"
        });
        self.search.update(cx, |f, cx| {
            f.set_placeholder(search_name.clone(), win, cx);
            f.set_accessibility(
                InputAccessibility::new(Some(Role::TextInput)).with_label(Some(search_name.into())),
            );
        });
        let query = self.search.read(cx).value().trim().to_lowercase();
        let selected: Vec<_> = data
            .series
            .iter()
            .filter(|s| self.selected.contains(&s.key))
            .collect();
        let mut totals = vec![0; data.days.len()];
        for s in &selected {
            for (&i, value) in &s.daily {
                totals[i] += value;
            }
        }
        let total: i64 = totals.iter().sum();
        let all: i64 = data.series.iter().flat_map(|s| s.daily.values()).sum();
        let mut status = div().flex().gap(px(5.)).items_center();
        for s in &selected {
            status = status.child(
                div()
                    .size(px(20.))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(self.series_icon(s, c, win)),
            );
        }
        let mut list = div()
            .id("trend-objects")
            .accessibility_id("trend-objects")
            .role(Role::Group)
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap(px(6.));
        let mut count = 0;
        for s in &data.series {
            if !s.name.to_lowercase().contains(&query) && !s.key.to_lowercase().contains(&query) {
                continue;
            }
            count += 1;
            let key = s.key.clone();
            let target = (s.key.clone(), s.name.clone());
            let chosen = self.selected.contains(&s.key);
            let color = self.series_color(s, c, win);
            let ms: i64 = s.daily.values().sum();
            let accessible = format_text(
                locale,
                "destinationDetail.open",
                &[("name", s.name.clone())],
            );
            let view = cx.weak_entity();
            let a11y_target = target.clone();
            let openable = !category && s.key != "activity:anonymous";
            let icon = div()
                .size(px(28.))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(6.))
                .border_1()
                .border_color(c.border)
                .bg(c.panel)
                .child(self.series_icon(s, c, win));
            let mark = if openable {
                Button::new(SharedString::from(format!("trend-open-{}", s.key)))
                    .accessibility_label(accessible)
                    .child(icon)
                    .focus_visible(move |s| s.border_1().border_color(c.secondary))
                    .on_a11y_action(AccessibleAction::Click, move |_, win, cx| {
                        let _ = view.update(cx, |this, cx| {
                            this.open_trend_day(
                                Local::now().timestamp_millis(),
                                Some(a11y_target.clone()),
                                win,
                                cx,
                            )
                        });
                    })
                    .on_click(cx.listener(move |this, event: &ClickEvent, win, cx| {
                        cx.stop_propagation();
                        if event.is_keyboard() || event.click_count() == 2 {
                            this.open_trend_day(
                                Local::now().timestamp_millis(),
                                Some(target.clone()),
                                win,
                                cx,
                            );
                        } else {
                            this.choose_series(&target.0, event.modifiers().control, cx);
                        }
                    }))
                    .into_any_element()
            } else {
                icon.into_any_element()
            };
            let key_for_keyboard = key.clone();
            list = list.child(
                Button::new(SharedString::from(format!("series-{key}")))
                    .accessibility_label(s.name.clone())
                    .selected(chosen)
                    .aria_selected(chosen)
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .w_full()
                    .min_w_0()
                    .h(px(52.))
                    .flex_none()
                    .px(px(9.))
                    .border_1()
                    .rounded(px(8.))
                    .border_color(if chosen { color.opacity(0.5) } else { c.border })
                    .bg(if chosen {
                        c.panel.blend(color.opacity(0.08))
                    } else {
                        c.canvas
                    })
                    .hover(move |s| s.border_color(c.border_strong))
                    .focus_visible(move |s| s.border_color(c.secondary))
                    .child(mark)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(2.))
                            .child(label(s.name.clone()).truncate().text_size(px(12.)))
                            .child(
                                label(format!("{:.0}%", ms as f64 / all.max(1) as f64 * 100.))
                                    .text_size(px(10.))
                                    .text_color(c.secondary),
                            ),
                    )
                    .child(label(duration(ms)).text_size(px(12.)).flex_none())
                    .on_click(cx.listener(move |this, event: &ClickEvent, _, cx| {
                        this.choose_series(&key, event.modifiers().control, cx)
                    }))
                    .on_key_down(cx.listener(move |this, event: &KeyDownEvent, _, cx| {
                        if event.keystroke.key == "space" && event.keystroke.modifiers.control {
                            this.choose_series(&key_for_keyboard, true, cx);
                            cx.stop_propagation();
                        }
                    })),
            );
        }
        if count == 0 {
            let key = match (category, web, query.is_empty()) {
                (true, _, true) => "data.categoryTrendEmpty",
                (true, _, false) => "data.categoryTrendNoMatch",
                (_, true, true) => "data.webTrendEmpty",
                (_, true, false) => "data.webTrendNoMatch",
                (_, _, true) => "data.appTrendEmpty",
                _ => "data.appTrendNoMatch",
            };
            list = list.child(
                label(tr(key))
                    .text_color(c.secondary)
                    .text_size(px(12.))
                    .py(px(24.)),
            );
        }
        let sidebar = div()
            .w(relative(0.28))
            .min_w(px(220.))
            .flex_none()
            .h_full()
            .flex()
            .flex_col()
            .gap(px(10.))
            .child(quietpro::search_input(
                "trend-search",
                &self.search,
                tr("mapping.clearSearch"),
                c,
                win,
                cx,
            ))
            .child(list)
            .child(
                label(tr(if category {
                    "data.categoryInteractionHint"
                } else {
                    "data.interactionHint"
                }))
                .text_size(px(10.))
                .text_color(c.secondary)
                .truncate(),
            );
        let monthly = data.days.len() > 62;
        let periods = if monthly {
            data.days
                .iter()
                .map(|d| stamp(*d, "%Y-%m"))
                .collect::<BTreeSet<_>>()
                .len()
        } else {
            data.days.len()
        };
        let metrics = [
            ("data.appTrendTotal", duration(total)),
            (
                if monthly {
                    "data.monthlyAverage"
                } else {
                    "data.appTrendAverage"
                },
                duration(total / periods.max(1) as i64),
            ),
            (
                "data.appTrendActiveDays",
                totals.iter().filter(|v| **v > 0).count().to_string(),
            ),
            (
                "data.appTrendPeakDay",
                duration(totals.iter().copied().max().unwrap_or(0)),
            ),
        ];
        let metrics = div()
            .flex()
            .w_full()
            .flex_none()
            .pb(px(12.))
            .border_b_1()
            .border_color(c.border)
            .children(metrics.into_iter().enumerate().map(|(i, (key, value))| {
                div()
                    .id(("trend-metric", i))
                    .role(Role::Group)
                    .aria_label(format!("{} · {value}", tr(key)))
                    .flex_1()
                    .min_w_0()
                    .px(px(if i == 0 { 0. } else { 12. }))
                    .when(i > 0, |s| s.border_l_1().border_color(c.border))
                    .child(
                        div()
                            .text_size(px(12.))
                            .text_color(c.secondary)
                            .child(tr(key)),
                    )
                    .child(
                        div()
                            .mt(px(5.))
                            .text_size(px(18.))
                            .font_weight(FontWeight::SEMIBOLD)
                            .child(value),
                    )
            }));
        let lines: Vec<_> = selected
            .iter()
            .map(|s| {
                (
                    s.name.clone(),
                    self.series_color(s, c, win),
                    data.days
                        .iter()
                        .enumerate()
                        .map(|(i, _)| *s.daily.get(&i).unwrap_or(&0))
                        .collect(),
                )
            })
            .collect();
        let chart = self.trend_chart(&data.days, lines, c, cx);
        let heat = if let Some((_, heat)) = &self.trend_heat {
            let mut values = vec![0; heat.days.len()];
            for s in &heat.series {
                if self.selected.contains(&s.key) {
                    for (&i, value) in &s.daily {
                        values[i] += value;
                    }
                }
            }
            self.trend_heatmap(&heat.days, &values, c, win, cx)
        } else {
            div().h(px(106.)).flex_none().child(label(tr(if self.error {
                "destinationDetail.dayError"
            } else {
                "common.loading"
            })))
        };
        let heat = div()
            .id("destination-heatmap")
            .role(Role::Group)
            .accessibility_id("destination-heatmap")
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(8.))
            .pt(px(12.))
            .border_t_1()
            .border_color(c.border)
            .child(self.trend_heat_header(c, cx))
            .child(heat);
        content_card(c.border, c.panel)
            .id("data-destination")
            .accessibility_id("data-destination")
            .h(px(480.))
            .flex_none()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(8.))
                    .mb(px(CARD_TITLE_GAP))
                    .child(heading(title))
                    .child(modes)
                    .child(status)
                    .child(div().flex_1())
                    .child(self.range_control(super::RangeTarget::Destination, c, cx)),
            )
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_h_0()
                    .gap(px(18.))
                    .child(sidebar)
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .gap(px(14.))
                            .child(metrics)
                            .child(chart)
                            .child(heat),
                    ),
            )
    }
}

fn heatmap_dates(year: Option<i32>, today: NaiveDate) -> Vec<NaiveDate> {
    let (first, last) = year.map_or_else(
        || {
            let monday = today - Days::new(today.weekday().num_days_from_monday().into());
            (monday - Days::new(52 * 7), monday + Days::new(6))
        },
        |year| {
            (
                NaiveDate::from_ymd_opt(year, 1, 1).unwrap(),
                NaiveDate::from_ymd_opt(year, 12, 31).unwrap(),
            )
        },
    );
    let start = first - Days::new(first.weekday().num_days_from_monday().into());
    let end = last + Days::new(6 - last.weekday().num_days_from_monday() as u64);
    (0..=(end - start).num_days())
        .map(|day| start + Days::new(day as u64))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::heatmap_dates;
    use chrono::{Datelike, NaiveDate, Weekday};
    #[test]
    fn heatmap_years_keep_calendar_alignment() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 16).unwrap();
        for year in [2024, 2025, 2026, 2012] {
            let dates = heatmap_dates(Some(year), today);
            assert_eq!(dates[0].weekday(), Weekday::Mon);
            assert_eq!(dates.last().unwrap().weekday(), Weekday::Sun);
            assert_eq!(dates.len() % 7, 0);
            let count = dates.iter().filter(|day| day.year() == year).count();
            assert_eq!(
                count,
                if year == 2024 || year == 2012 {
                    366
                } else {
                    365
                }
            );
        }
        assert_eq!(heatmap_dates(None, today).len(), 53 * 7);
    }
}
