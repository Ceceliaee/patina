use super::*;
use patina_i18n::format_text;
use quietpro::{HeatmapCell, Palette, heatmap_layout};

pub(super) struct HeatmapView<'a> {
    pub id: &'static str,
    pub days: &'a [i64],
    pub totals: &'a [i64],
    pub year: Option<i32>,
    pub weekly: bool,
    pub loading: bool,
}

fn weekly_rows(total: i64, max: i64) -> usize {
    if total <= 0 {
        0
    } else {
        ((total as f64 / max.max(1) as f64 * 7.).ceil() as usize).clamp(1, 7)
    }
}

fn daily_intensity(total: i64, max: i64) -> f32 {
    if total <= 0 {
        0.
    } else {
        (total as f32 / max.max(1) as f32).clamp(0.16, 1.)
    }
}

pub(super) struct HeatmapFocus {
    start: NaiveDate,
    handles: Vec<FocusHandle>,
    active: Rc<std::cell::Cell<usize>>,
}

fn navigation_index(
    index: usize,
    first: usize,
    last: usize,
    key: &str,
    ctrl: bool,
) -> Option<usize> {
    let row = index % 7;
    let next = match key {
        "up" if row > 0 => index.checked_sub(1)?,
        "down" if row < 6 => index + 1,
        "left" => index.checked_sub(7)?,
        "right" => index + 7,
        "home" if ctrl => first,
        "end" if ctrl => last,
        "home" => first + (row + 7 - first % 7) % 7,
        "end" => last.checked_sub((last % 7 + 7 - row) % 7)?,
        _ => return None,
    };
    (first..=last).contains(&next).then_some(next)
}

impl DataPage {
    pub(super) fn render_heatmap(
        &self,
        view: HeatmapView<'_>,
        c: Palette,
        cx: &mut Context<Self>,
    ) -> Div {
        let today = Local::now().date_naive();
        let dates = heatmap_dates(view.year, today);
        let first = dates
            .iter()
            .position(|date| view.year.is_none_or(|y| date.year() == y))
            .unwrap_or(0);
        let last = dates
            .iter()
            .rposition(|date| *date <= today && view.year.is_none_or(|y| date.year() == y))
            .unwrap_or(first);
        let mut cache = self.heat_focus.borrow_mut();
        let entry = cache.entry(view.id).or_insert_with(|| HeatmapFocus {
            start: dates[0],
            handles: Vec::new(),
            active: Rc::new(std::cell::Cell::new(last)),
        });
        if entry.start != dates[0] || entry.handles.len() != dates.len() {
            entry.start = dates[0];
            entry.handles = dates
                .iter()
                .map(|_| cx.focus_handle().tab_stop(false))
                .collect();
            entry.active.set(last);
        }
        let focuses = entry.handles.clone();
        let active = entry.active.clone();
        drop(cache);
        let locale = self.client.locale.get();
        let values: HashMap<_, _> = view
            .days
            .iter()
            .zip(view.totals)
            .filter_map(|(&day, &value)| {
                chrono::DateTime::from_timestamp_millis(day)
                    .map(|date| (date.with_timezone(&Local).date_naive(), value))
            })
            .collect();
        let in_range = |date: NaiveDate| view.year.is_none_or(|year| date.year() == year);
        let value = |date: NaiveDate| {
            if date <= today && in_range(date) {
                values.get(&date).copied().unwrap_or(0)
            } else {
                0
            }
        };
        let totals: Vec<i64> = dates
            .chunks(7)
            .map(|week| week.iter().map(|&date| value(date)).sum())
            .collect();
        let max_week = totals.iter().copied().max().unwrap_or(1).max(1);
        let max_day = dates
            .iter()
            .map(|&date| value(date))
            .max()
            .unwrap_or(1)
            .max(1);
        let mut columns = Vec::new();
        let mut months = Vec::new();
        for (i, week) in dates.chunks(7).enumerate() {
            months.push(
                week.iter()
                    .find(|date| date.day() == 1 && in_range(**date))
                    .map(|date| {
                        format_text(
                            locale,
                            "date.monthLabel",
                            &[("month", date.month().to_string())],
                        )
                    })
                    .unwrap_or_default(),
            );
            let visible: Vec<_> = week
                .iter()
                .copied()
                .filter(|&date| date <= today && in_range(date))
                .collect();
            let rows = weekly_rows(totals[i], max_week);
            let mut column = Vec::new();
            for (row, &date) in week.iter().enumerate() {
                if !in_range(date)
                    || (view.year.is_none()
                        && if view.weekly {
                            visible.is_empty()
                        } else {
                            date > today
                        })
                {
                    column.push(None);
                    continue;
                }
                let description = if view.weekly {
                    let span: Vec<_> = if visible.is_empty() {
                        week.iter()
                            .copied()
                            .filter(|&date| in_range(date))
                            .collect()
                    } else {
                        visible.clone()
                    };
                    format!(
                        "{} – {} · {}",
                        span[0],
                        span[span.len() - 1],
                        if visible.is_empty() {
                            text(locale, "data.notStarted")
                        } else {
                            duration(totals[i])
                        }
                    )
                } else if date > today {
                    format!("{date} · {}", text(locale, "data.notStarted"))
                } else {
                    format!("{date} · {}", duration(value(date)))
                };
                let owner = cx.entity().downgrade();
                column.push(Some(HeatmapCell {
                    state_key: format!("{}-{}-{date}", view.id, dates[0]).into(),
                    focus: focuses[i * 7 + row].clone(),
                    focus_changed: {
                        let active = active.clone();
                        let owner = cx.entity().downgrade();
                        Rc::new(move |cx| {
                            active.set(i * 7 + row);
                            let _ = owner.update(cx, |_, cx| cx.notify());
                        })
                    },
                    tab_stop: active.get() == i * 7 + row,
                    navigate: {
                        let focuses = focuses.clone();
                        let active = active.clone();
                        let owner = cx.entity().downgrade();
                        Rc::new(move |event, win, cx| {
                            let key = event.keystroke.key.as_str();
                            if !matches!(key, "left" | "right" | "up" | "down" | "home" | "end") {
                                return false;
                            }
                            if let Some(next) = navigation_index(
                                i * 7 + row,
                                first,
                                last,
                                key,
                                event.keystroke.modifiers.control,
                            ) {
                                active.set(next);
                                win.focus(&focuses[next], cx);
                                let _ = owner.update(cx, |_, cx| cx.notify());
                            }
                            true
                        })
                    },
                    size: 12.,
                    future: if view.weekly {
                        visible.is_empty()
                    } else {
                        date > today
                    },
                    id: format!(
                        "{}-{date}",
                        if view.id == "overview-heatmap" {
                            "heat"
                        } else {
                            "trend-heat"
                        }
                    )
                    .into(),
                    label: if view.id == "overview-heatmap" {
                        description.clone()
                    } else {
                        date.to_string()
                    },
                    description,
                    intensity: if view.loading {
                        0.
                    } else if view.weekly {
                        if row >= 7 - rows { 0.88 } else { 0. }
                    } else {
                        daily_intensity(value(date), max_day)
                    },
                    enabled: !view.loading
                        && if view.weekly {
                            !visible.is_empty()
                        } else {
                            date <= today
                        },
                    colors: c,
                    activate: (!view.weekly).then(|| {
                        Rc::new(move |_: &mut Window, cx: &mut App| {
                            if let Some(day) = noon(date) {
                                let _ = owner.update(cx, |_, cx| cx.emit(OpenHistoryDay(day)));
                            }
                        }) as Rc<dyn Fn(&mut Window, &mut App)>
                    }),
                }));
            }
            columns.push(column);
        }
        let weekdays = std::array::from_fn(|day| {
            format_text(locale, "date.calendarWeekday", &[("day", day.to_string())])
        });
        div()
            .relative()
            .w_full()
            .min_w_0()
            .flex_none()
            .child(heatmap_layout(view.id, months, weekdays, columns, c))
            .when(view.loading, |grid| {
                grid.child(
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            label(text(
                                locale,
                                if self.error {
                                    "destinationDetail.dayError"
                                } else {
                                    "common.loading"
                                },
                            ))
                            .bg(c.panel)
                            .px(px(8.)),
                        ),
                )
            })
    }
}

pub(super) fn heatmap_dates(year: Option<i32>, today: NaiveDate) -> Vec<NaiveDate> {
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
    use super::{daily_intensity, navigation_index, weekly_rows};
    #[test]
    fn navigation_stays_in_grid_and_preserves_weekday_on_edges() {
        assert_eq!(navigation_index(14, 3, 30, "up", false), None);
        assert_eq!(navigation_index(20, 3, 30, "down", false), None);
        assert_eq!(navigation_index(17, 3, 30, "left", false), Some(10));
        assert_eq!(navigation_index(17, 3, 30, "home", false), Some(3));
        assert_eq!(navigation_index(17, 3, 30, "end", false), Some(24));
        assert_eq!(navigation_index(17, 3, 30, "end", true), Some(30));
        assert_eq!(navigation_index(7, 3, 30, "home", true), Some(3));
        assert_eq!(navigation_index(3, 3, 30, "left", false), None);
    }
    #[test]
    fn weekly_fill_preserves_seven_cell_scale() {
        assert_eq!(
            [0, 1, 14, 15, 50, 100].map(|v| weekly_rows(v, 100)),
            [0, 1, 1, 2, 4, 7]
        );
        assert_eq!(weekly_rows(0, 0), 0);
        assert_eq!(
            (0..7)
                .filter(|&row| row >= 7 - weekly_rows(50, 100))
                .collect::<Vec<_>>(),
            vec![3, 4, 5, 6]
        );
    }
    #[test]
    fn daily_levels_keep_zero_distinct() {
        assert_eq!(
            [0, 1, 25, 26, 50, 51, 75, 76, 100].map(|v| daily_intensity(v, 100)),
            [0., 0.16, 0.25, 0.26, 0.5, 0.51, 0.75, 0.76, 1.]
        );
    }
}
