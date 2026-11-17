use super::*;
use chrono::Months;

pub(super) fn format_name(value: &str) -> &'static str {
    match value {
        "markdown" => "markdown",
        "sqlite" => "sqlite",
        "parquet" => "parquet",
        _ => "csv",
    }
}
pub(super) fn extension(format: &str) -> &str {
    if format == "markdown" { "md" } else { format }
}
fn defaults(format: &str) -> Vec<String> {
    let fields = match format {
        "sqlite" => ALL_EXPORT_FIELDS.to_vec(),
        "parquet" => DEFAULT_EXPORT_FIELDS
            .iter()
            .copied()
            .chain([
                "category_id",
                "local_date",
                "local_week",
                "local_month",
                "weekday",
                "start_hour",
                "duration_minutes",
                "source_key",
                "source_name",
            ])
            .collect(),
        "markdown" => vec![
            "start_time",
            "end_time",
            "duration_minutes",
            "record_type",
            "source_name",
            "category",
            "window_title",
            "page_title",
            "url",
        ],
        _ => DEFAULT_EXPORT_FIELDS.to_vec(),
    };
    fields.into_iter().map(str::to_owned).collect()
}
fn period(mode: &str, anchor: NaiveDate) -> (NaiveDate, NaiveDate) {
    let today = Local::now().date_naive();
    let start = match mode {
        "week" => anchor - Duration::days(anchor.weekday().num_days_from_monday().into()),
        "month" => anchor.with_day(1).unwrap(),
        "year" => anchor.with_ordinal(1).unwrap(),
        _ => anchor,
    };
    let end = match mode {
        "week" => start + Duration::days(6),
        "month" => start + Months::new(1) - Duration::days(1),
        "year" => start + Months::new(12) - Duration::days(1),
        _ => start,
    };
    (start, end.min(today))
}
impl StorageCard {
    pub(super) fn saved_columns(&self, format: &str) -> Vec<String> {
        let stored = self.export_preferences["fields"][format].as_array();
        let fields: Vec<_> = ALL_EXPORT_FIELDS
            .iter()
            .filter(|key| stored.is_some_and(|a| a.iter().any(|v| v.as_str() == Some(**key))))
            .map(|s| s.to_string())
            .collect();
        if fields.is_empty() {
            defaults(format)
        } else {
            fields
        }
    }
    pub(super) fn remember_export(&mut self, cx: &mut Context<Self>) {
        self.export_preferences["format"] = json!(self.format);
        self.export_preferences["mode"] = json!(if self.range_mode == "custom" {
            "month"
        } else {
            &self.range_mode
        });
        if !self.export_preferences["fields"].is_object() {
            self.export_preferences["fields"] = json!({});
        }
        self.export_preferences["fields"][self.format] = json!(self.columns);
        let req = self
            .client
            .request::<Value>(Query::Storage(Request::ExportPreferences(Some(
                self.export_preferences.clone(),
            ))));
        cx.spawn(async move |view, cx| {
            if req.await.is_err() {
                let _ = view.update(cx, |s, cx| {
                    s.message = s.tr("settings.saveFailed");
                    cx.notify();
                });
            }
        })
        .detach();
    }
    pub(super) fn change_format(&mut self, format: &'static str, cx: &mut Context<Self>) {
        self.format = format;
        self.columns = self.saved_columns(format);
        self.remember_export(cx);
    }
    fn dates(&self, cx: &App) -> (NaiveDate, NaiveDate) {
        let read = |i| {
            NaiveDate::parse_from_str(&self.val(i, cx), "%Y-%m-%d")
                .unwrap_or(Local::now().date_naive())
        };
        (read(4), read(5))
    }
    fn set_dates(&self, a: NaiveDate, b: NaiveDate, win: &mut Window, cx: &mut Context<Self>) {
        self.set(4, "native.export.field.start_time", &a.to_string(), win, cx);
        self.set(5, "native.export.field.end_time", &b.to_string(), win, cx);
    }
    pub(super) fn set_period(&self, anchor: NaiveDate, win: &mut Window, cx: &mut Context<Self>) {
        let (a, b) = period(&self.range_mode, anchor);
        self.set_dates(a, b, win, cx);
    }
    fn shift_range(&mut self, next: bool, win: &mut Window, cx: &mut Context<Self>) {
        let (a, b) = self.dates(cx);
        let anchor = match (self.range_mode.as_str(), next) {
            ("month", true) => a + Months::new(1),
            ("month", false) => a - Months::new(1),
            ("year", true) => a + Months::new(12),
            ("year", false) => a - Months::new(12),
            ("week", _) => a + Duration::days(if next { 7 } else { -7 }),
            ("custom", _) => {
                a + Duration::days(((b - a).num_days() + 1) * if next { 1 } else { -1 })
            }
            _ => a + Duration::days(if next { 1 } else { -1 }),
        };
        if anchor > Local::now().date_naive() {
            return;
        }
        if self.range_mode == "custom" {
            self.set_dates(
                anchor,
                (anchor + (b - a)).min(Local::now().date_naive()),
                win,
                cx,
            );
        } else {
            self.set_period(anchor, win, cx);
        }
        cx.notify();
    }
    pub(super) fn export_range(&self, c: quietpro::Palette, cx: &Context<Self>) -> Div {
        let (a, b) = self.dates(cx);
        let mut controls = quietpro::calendar_controls();
        for next in [false, true] {
            if next {
                controls = controls.child(
                    quietpro::calendar_trigger("export-range", format!("{a} – {b}"), c)
                        .accessibility_label(self.tr("export.openRangePicker"))
                        .on_click(cx.listener(|s, _, w, cx| {
                            let (a, b) = s.dates(cx);
                            s.calendar_start = Some(a);
                            s.calendar_end = Some(b);
                            s.calendar_active = b;
                            s.calendar_month = b.with_day(1).unwrap();
                            s.calendar_mode = "custom";
                            s.go(View::Range, w, cx);
                        })),
                );
            }
            let key = if next {
                "export.nextRange"
            } else {
                "export.previousRange"
            };
            controls = controls.child(
                IconControl::new(
                    key,
                    self.tr(key),
                    if next {
                        Icon::ChevronRight
                    } else {
                        Icon::ChevronLeft
                    },
                )
                .disabled(self.busy || (next && b >= Local::now().date_naive()))
                .action(
                    c,
                    cx.listener(move |s, _, w, cx| s.shift_range(next, w, cx)),
                ),
            );
        }
        content_card(c.border, c.panel).flex_none().child(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .justify_between()
                .gap(px(8.))
                .child(heading(self.tr("export.timeRangeLabel")))
                .child(controls),
        )
    }
    fn select_day(&mut self, day: NaiveDate, cx: &mut Context<Self>) {
        self.calendar_active = day;
        if self.calendar_mode != "custom" {
            let (a, b) = period(self.calendar_mode, day);
            self.calendar_start = Some(a);
            self.calendar_end = Some(b);
        } else if self.calendar_end.is_some() || self.calendar_start.is_none() {
            self.calendar_start = Some(day);
            self.calendar_end = None;
        } else {
            let a = self.calendar_start.unwrap();
            self.calendar_start = Some(a.min(day));
            self.calendar_end = Some(a.max(day));
        }
        cx.notify();
    }
    pub(super) fn apply_range(&mut self, w: &mut Window, cx: &mut Context<Self>) {
        if let Some(a) = self.calendar_start {
            let b = self.calendar_end.unwrap_or(a);
            let mode = self.calendar_mode;
            self.close(w, cx);
            self.range_mode = mode.into();
            self.set_dates(a, b, w, cx);
            self.remember_export(cx);
            cx.notify();
        }
    }
    pub(super) fn calendar(&self, c: quietpro::Palette, cx: &Context<Self>) -> Div {
        let weak = cx.weak_entity();
        let modes = [
            ("custom", "data.pickerModes.custom"),
            ("day", "export.timeRangeModeDay"),
            ("week", "export.timeRangeModeWeek"),
            ("month", "export.timeRangeModeMonth"),
            ("year", "export.timeRangeModeYear"),
        ];
        let mut body =
            div()
                .flex()
                .flex_col()
                .items_center()
                .gap(px(12.))
                .child(quietpro::Dropdown::new(
                    "export-range-mode",
                    self.tr("export.timeRangeLabel"),
                    modes.map(|(v, k)| (v, self.tr(k))),
                    self.calendar_mode,
                    c,
                    move |mode, _, cx| {
                        let _ = weak.update(cx, |s, cx| {
                            s.calendar_mode = mode;
                            s.select_day(s.calendar_active, cx);
                        });
                    },
                ));
        let arrow = |next| {
            IconControl::new(
                if next {
                    "next-export-month"
                } else {
                    "previous-export-month"
                },
                self.tr(if next {
                    "accessibility.date.nextMonth"
                } else {
                    "accessibility.date.previousMonth"
                }),
                if next {
                    Icon::ChevronRight
                } else {
                    Icon::ChevronLeft
                },
            )
            .disabled(next && self.calendar_month >= Local::now().date_naive().with_day(1).unwrap())
            .action(
                c,
                cx.listener(move |s, _, _, cx| {
                    s.calendar_month = if next {
                        s.calendar_month + Months::new(1)
                    } else {
                        s.calendar_month - Months::new(1)
                    };
                    cx.notify();
                }),
            )
        };
        let mut cal = quietpro::calendar_surface(c).child(quietpro::calendar_month_header(
            arrow(false),
            self.calendar_month.format("%Y-%m").to_string(),
            arrow(true),
        ));
        let days = patina_recorder::localized_data(self.client.locale.get(), "date.weekdaysShort")
            .unwrap();
        cal = cal.child(quietpro::calendar_weekdays(
            std::array::from_fn(|i| days[i].as_str().unwrap_or("").to_owned()),
            c,
        ));
        let first = self.calendar_month
            - Duration::days(self.calendar_month.weekday().num_days_from_monday().into());
        let mut grid = div()
            .id("export-calendar-grid")
            .role(Role::Grid)
            .track_focus(&self.calendar_focus)
            .on_key_down(cx.listener(|s, e: &KeyDownEvent, _, cx| {
                let shift = match e.keystroke.key.as_str() {
                    "left" => -1,
                    "right" => 1,
                    "up" => -7,
                    "down" => 7,
                    _ => 0,
                };
                if shift != 0 {
                    s.calendar_active =
                        (s.calendar_active + Duration::days(shift)).min(Local::now().date_naive());
                    s.calendar_month = s.calendar_active.with_day(1).unwrap();
                    cx.notify();
                    cx.stop_propagation();
                } else if matches!(e.keystroke.key.as_str(), "enter" | "space") {
                    s.select_day(s.calendar_active, cx);
                    cx.stop_propagation();
                }
            }));
        for week in 0..6 {
            let mut row = quietpro::calendar_week(week);
            for n in 0..7 {
                let day = first + Duration::days(week as i64 * 7 + n);
                row = row.child(
                    quietpro::calendar_day(
                        SharedString::from(day.to_string()),
                        day.to_string(),
                        day.day(),
                        quietpro::CalendarDayState {
                            enabled: day <= Local::now().date_naive(),
                            selected: self.calendar_start == Some(day)
                                || self.calendar_end == Some(day),
                            in_range: self
                                .calendar_start
                                .zip(self.calendar_end)
                                .is_some_and(|(a, b)| day >= a && day <= b),
                            active: self.calendar_active == day,
                            keyboard: true,
                            outside_month: day.month() != self.calendar_month.month(),
                            today: day == Local::now().date_naive(),
                        },
                        c,
                    )
                    .on_click(cx.listener(move |s, _, _, cx| s.select_day(day, cx))),
                );
            }
            grid = grid.child(row);
        }
        cal = cal.child(grid);
        body = body.child(cal);
        if let Some(a) = self.calendar_start {
            body = body.child(label(format!("{} – {}", a, self.calendar_end.unwrap_or(a))));
        }
        body
    }
}

#[cfg(test)]
mod tests {
    use super::{defaults, extension, period};
    use chrono::NaiveDate;
    use patina_recorder::ALL_EXPORT_FIELDS;
    #[test]
    fn format_fields_are_independent_and_extensions_match() {
        assert_ne!(defaults("csv"), defaults("markdown"));
        assert_eq!(defaults("sqlite").len(), ALL_EXPORT_FIELDS.len());
        assert_eq!(extension("markdown"), "md");
    }
    #[test]
    fn calendar_periods_include_leap_day() {
        assert_eq!(
            period("month", NaiveDate::from_ymd_opt(2024, 2, 12).unwrap()),
            (
                NaiveDate::from_ymd_opt(2024, 2, 1).unwrap(),
                NaiveDate::from_ymd_opt(2024, 2, 29).unwrap()
            )
        );
    }
}
