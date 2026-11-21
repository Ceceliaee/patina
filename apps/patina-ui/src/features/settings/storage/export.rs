use super::*;
use chrono::Months;
use gpui_kit::base::{Align, POPUP_PRIORITY, Placement, Positioner};

fn export_card(c: quietpro::Palette) -> Div {
    content_card(c.border, c.panel)
        .min_h(px(64.))
        .justify_center()
        .flex_none()
}

const PRESETS: [(&str, &str); 4] = [
    ("day", "export.timeRangeModeDay"),
    ("week", "export.timeRangeModeWeek"),
    ("month", "export.timeRangeModeMonth"),
    ("year", "export.timeRangeModeYear"),
];

const PICKER_MODES: [(&str, &str); 4] = [
    ("custom", "data.pickerModes.custom"),
    ("week", "data.pickerModes.week"),
    ("month", "data.pickerModes.month"),
    ("year", "data.pickerModes.year"),
];

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
#[derive(IntoElement)]
pub(super) struct ExportForm(pub(super) WeakEntity<StorageCard>);

impl RenderOnce for ExportForm {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        self.0
            .update(cx, |storage, cx| {
                storage.export_form(storage.client.palette(win), cx)
            })
            .unwrap_or_else(|_| div())
    }
}

impl StorageCard {
    fn export_form(&self, c: quietpro::Palette, cx: &Context<Self>) -> Div {
        let body = div()
            .flex()
            .flex_col()
            .gap(px(12.))
            .child(self.export_range(c, cx));
        let options = [
            ("csv", "CSV"),
            ("markdown", "Markdown"),
            ("parquet", "Parquet"),
            ("sqlite", "SQLite"),
        ];
        let weak = cx.weak_entity();
        let formats = quietpro::segmented_with_medium_labels(
            ("export-format", self.tr("export.formatLabel")),
            std::array::from_fn::<_, 4, _>(|i| {
                (
                    options[i].0,
                    options[i].1.to_owned(),
                    None,
                    self.format_focus[i].clone(),
                )
            }),
            self.format,
            !self.busy,
            c,
            ControlSize::Medium,
            move |format, _, cx| {
                let _ = weak.update(cx, |s, cx| {
                    s.change_format(format, cx);
                    cx.notify();
                });
            },
        );
        body.child(
            export_card(c).child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap(px(12.))
                    .child(quietpro::group_heading(self.tr("export.formatLabel")).flex_1())
                    .child(formats),
            ),
        )
        .child(
            export_card(c).child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap(px(8.))
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(8.))
                            .whitespace_nowrap()
                            .child(quietpro::group_heading(
                                self.tr("export.fieldsSectionTitle"),
                            ))
                            .child(
                                label(format!(
                                    "{} / {}",
                                    self.columns.len(),
                                    ALL_EXPORT_FIELDS.len()
                                ))
                                .text_size(px(12.))
                                .text_color(c.secondary),
                            ),
                    )
                    .child(
                        self.btn("export.configFields", c, cx, |s, w, cx| {
                            s.expanded_field_groups = [false; 6];
                            s.field_draft = Some((s.columns.clone(), w.focused(cx)));
                            s.set_view(View::Fields, w, cx);
                            cx.notify();
                        })
                        .control_size(ControlSize::Medium)
                        .track_focus(&self.fields_trigger),
                    ),
            ),
        )
    }

    pub(super) fn saved_columns(&self, format: &str) -> Vec<String> {
        let stored = self.export_preferences.fields.get(format);
        let fields: Vec<_> = ALL_EXPORT_FIELDS
            .iter()
            .filter(|key| stored.is_some_and(|a| a.iter().any(|v| v == **key)))
            .map(|s| s.to_string())
            .collect();
        if fields.is_empty() {
            defaults(format)
        } else {
            fields
        }
    }
    pub(super) fn remember_export(&mut self, cx: &mut Context<Self>) {
        self.export_preferences.format = Some(self.format.to_owned());
        self.export_preferences.mode = Some(if self.range_mode == "custom" {
            "month".to_owned()
        } else {
            self.range_mode.clone()
        });
        self.export_preferences
            .fields
            .insert(self.format.to_owned(), self.columns.clone());
        let req = self
            .client
            .save_export_preferences(self.export_preferences.clone());
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
        let open = self.view == View::Range;
        let mode = if open {
            self.calendar_mode
        } else {
            self.range_mode.as_str()
        };
        let modes = if open { PICKER_MODES } else { PRESETS };
        let mode_index = modes.iter().position(|(v, _)| *v == mode).unwrap_or(0);
        let group_bounds = self.range_group_bounds.clone();
        let mut controls = quietpro::calendar_controls().relative().child(
            canvas(move |b, _, _| group_bounds.set(b), |_, _, _, _| {})
                .absolute()
                .inset_0(),
        );
        for next in [false, true] {
            if next {
                let bounds = self.range_bounds.clone();
                controls = controls.child(
                    quietpro::calendar_trigger(
                        "export-range",
                        if !open && self.range_from_calendar {
                            match mode {
                                "custom" => self.formatted(
                                    "data.customDayCount",
                                    &[("days", ((b - a).num_days() + 1).to_string())],
                                ),
                                "week" => self.formatted(
                                    "data.weekLabel",
                                    &[("week", a.iso_week().week().to_string())],
                                ),
                                "month" => self.formatted(
                                    "date.monthLabel",
                                    &[("month", a.month().to_string())],
                                ),
                                "year" => self
                                    .formatted("data.yearLabel", &[("year", a.year().to_string())]),
                                _ => a.to_string(),
                            }
                        } else {
                            self.tr(modes[mode_index].1)
                        },
                        c,
                    )
                    .control_size(ControlSize::Medium)
                    .min_w(px(80.))
                    .font_weight(FontWeight::MEDIUM)
                    .disabled(self.busy)
                    .accessibility_label(self.tr("export.openRangePicker"))
                    .track_focus(&self.range_trigger)
                    .child(
                        canvas(move |b, _, _| bounds.set(b), |_, _, _, _| {})
                            .absolute()
                            .inset_0(),
                    )
                    .on_click(cx.listener(|s, _, w, cx| {
                        if s.view == View::Range {
                            s.close(w, cx);
                            return;
                        }
                        let today = Local::now().date_naive();
                        s.calendar_start = None;
                        s.calendar_end = None;
                        s.calendar_active = today;
                        s.calendar_month = today.with_day(1).unwrap();
                        s.calendar_mode = "custom";
                        s.open_view(View::Range, w, cx);
                    })),
                );
            }
            let key = match (open, next) {
                (true, true) => "accessibility.data.nextPickerMode",
                (true, false) => "accessibility.data.previousPickerMode",
                (false, true) => "export.nextRange",
                (false, false) => "export.previousRange",
            };
            let adjacent = if next {
                modes.get(mode_index + 1)
            } else {
                mode_index.checked_sub(1).and_then(|i| modes.get(i))
            }
            .copied();
            controls = controls.child(quietpro::calendar_arrow_frame(
                IconControl::new(
                    key,
                    self.tr(key),
                    if next {
                        Icon::ChevronRight
                    } else {
                        Icon::ChevronLeft
                    },
                )
                .disabled(
                    self.busy
                        || if !open && self.range_from_calendar {
                            next && (if mode == "custom" {
                                b + Duration::days((b - a).num_days() + 1)
                            } else {
                                b.succ_opt().unwrap()
                            }) > Local::now().date_naive()
                        } else {
                            adjacent.is_none()
                        },
                )
                .action(
                    c,
                    cx.listener(move |s, _, w, cx| {
                        if !open && s.range_from_calendar {
                            s.shift_range(next, w, cx);
                            return;
                        }
                        let Some((mode, _)) = adjacent else { return };
                        if open {
                            s.calendar_mode = mode;
                            s.calendar_start = None;
                            s.calendar_end = None;
                        } else {
                            s.range_mode = mode.into();
                            s.set_period(Local::now().date_naive(), w, cx);
                            s.remember_export(cx);
                        }
                        cx.notify();
                    }),
                ),
                ControlSize::Medium,
                c,
            ));
        }
        export_card(c).child(
            div()
                .flex()
                .flex_wrap()
                .items_center()
                .gap(px(8.))
                .justify_between()
                .child(
                    div()
                        .flex()
                        .items_center()
                        .whitespace_nowrap()
                        .gap(px(8.))
                        .child(quietpro::group_heading(self.tr("export.timeRangeLabel")))
                        .child(
                            label(format!("{a} – {b}"))
                                .accessibility_id("export-range-dates")
                                .text_size(px(12.))
                                .text_color(c.secondary),
                        ),
                )
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
            self.range_from_calendar = true;
            self.range_mode = mode.into();
            self.set_dates(a, b, w, cx);
            self.remember_export(cx);
            cx.notify();
        }
    }
    pub(super) fn calendar(
        &self,
        c: quietpro::Palette,
        win: &Window,
        cx: &Context<Self>,
    ) -> impl IntoElement + use<> {
        let summary = match (self.calendar_start, self.calendar_end) {
            (Some(a), Some(b)) => format!("{a} – {b}"),
            (Some(_), None) => self.tr("data.pickEndDate"),
            _ if self.calendar_mode == "custom" => self.tr("data.pickStartDate"),
            _ => self.tr("data.pickDate"),
        };
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
        let mut cal = quietpro::calendar_surface(c)
            .id("export-range-panel")
            .role(Role::Group)
            .aria_label(self.tr("data.rangePickerTitle"))
            .max_h(win.viewport_size().height - px(16.))
            .overflow_y_scroll()
            .on_mouse_down_out(cx.listener(|s, e: &MouseDownEvent, w, cx| {
                if s.view == View::Range && !s.range_group_bounds.get().contains(&e.position) {
                    s.close(w, cx);
                }
            }))
            .child(
                label(summary)
                    .text_size(px(12.))
                    .font_weight(FontWeight::BOLD),
            )
            .child(quietpro::calendar_month_header(
                arrow(false),
                patina_activity_model::format_text(
                    self.client.locale.get(),
                    "date.calendarMonth",
                    &[
                        ("year", self.calendar_month.year().to_string()),
                        ("month", self.calendar_month.month().to_string()),
                    ],
                ),
                arrow(true),
            ));
        let days =
            patina_i18n::localized_data(self.client.locale.get(), "date.weekdaysShort").unwrap();
        let weekdays = quietpro::calendar_weekdays(
            std::array::from_fn(|i| days[i].as_str().unwrap_or("").to_owned()),
            c,
        );
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
                    "home" => -(s.calendar_active.weekday().num_days_from_monday() as i64),
                    "end" => 6 - s.calendar_active.weekday().num_days_from_monday() as i64,
                    "pageup" => (s.calendar_active - Months::new(1) - s.calendar_active).num_days(),
                    "pagedown" => {
                        (s.calendar_active + Months::new(1) - s.calendar_active).num_days()
                    }
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
                let item = quietpro::calendar_day(
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
                .on_click(cx.listener(move |s, _, _, cx| s.select_day(day, cx)));
                let range = self.calendar_start.zip(self.calendar_end);
                row = row.child(quietpro::calendar_range_cell(
                    item,
                    range.is_some_and(|(a, b)| day >= a && day <= b),
                    self.calendar_start.is_some_and(|a| day > a),
                    self.calendar_end.is_some_and(|b| day < b),
                    c,
                ));
            }
            grid = grid.child(row);
        }
        cal = cal
            .child(
                div()
                    .flex()
                    .flex_col()
                    .flex_none()
                    .child(weekdays)
                    .child(grid),
            )
            .child(
                quietpro::dialog_actions()
                    .child(self.btn("common.cancel", c, cx, |s, w, cx| s.close(w, cx)))
                    .child(
                        self.btn("data.applyRange", c, cx, |s, w, cx| s.apply_range(w, cx))
                            .disabled(self.calendar_end.is_none()),
                    ),
            );
        deferred(
            Positioner::side(self.range_bounds.get())
                .placement(Placement::Bottom)
                .align(Align::Center)
                .offset(px(4.))
                .margin(px(8.))
                .occlude()
                .child(cal),
        )
        .with_priority(POPUP_PRIORITY)
    }
}

#[cfg(test)]
mod tests {
    use super::{defaults, extension, period};
    use chrono::NaiveDate;
    use patina_activity_model::ALL_EXPORT_FIELDS;
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
