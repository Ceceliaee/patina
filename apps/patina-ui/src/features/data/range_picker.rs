use super::*;
use chrono::Months;
use gpui_kit::base::{Align, POPUP_PRIORITY, Placement, Positioner};
use patina_activity_model::{Locale, format_text};
use quietpro::{CalendarDayState, Icon, IconControl, Palette};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum PickerMode {
    Custom,
    Week,
    Month,
    Year,
}

impl PickerMode {
    fn key(self) -> &'static str {
        match self {
            Self::Custom => "data.pickerModes.custom",
            Self::Week => "data.pickerModes.week",
            Self::Month => "data.pickerModes.month",
            Self::Year => "data.pickerModes.year",
        }
    }
    fn adjacent(self, next: bool) -> Option<Self> {
        let modes = [Self::Custom, Self::Week, Self::Month, Self::Year];
        let index =
            modes.iter().position(|m| *m == self).unwrap() as isize + if next { 1 } else { -1 };
        modes.get(usize::try_from(index).ok()?).copied()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum RangeSelection {
    All,
    Rolling(u64),
    Custom(NaiveDate, NaiveDate),
    Period(PickerMode, NaiveDate),
}

impl RangeSelection {
    fn monthly(self, today: NaiveDate) -> bool {
        match self {
            Self::All | Self::Rolling(365) | Self::Period(PickerMode::Year, _) => true,
            Self::Custom(_, _) => self
                .bounds(today)
                .is_some_and(|(a, b)| (b - a).num_days() + 1 > 62),
            _ => false,
        }
    }
    fn bounds(self, today: NaiveDate) -> Option<(NaiveDate, NaiveDate)> {
        let (a, b) = match self {
            Self::All => return None,
            Self::Rolling(365) => (today.with_day(1).unwrap() - Months::new(11), today),
            Self::Rolling(n) => (today - Days::new(n - 1), today),
            Self::Custom(a, b) => (a.min(b), a.max(b)),
            Self::Period(mode, anchor) => {
                let anchor = anchor.min(today);
                match mode {
                    PickerMode::Week => {
                        let a = anchor - Days::new(anchor.weekday().num_days_from_monday().into());
                        (a, a + Days::new(6))
                    }
                    PickerMode::Month => {
                        let a = anchor.with_day(1).unwrap();
                        (a, a + Months::new(1) - Days::new(1))
                    }
                    PickerMode::Year => (
                        NaiveDate::from_ymd_opt(anchor.year(), 1, 1).unwrap(),
                        NaiveDate::from_ymd_opt(anchor.year(), 12, 31).unwrap(),
                    ),
                    PickerMode::Custom => (anchor, anchor),
                }
            }
        };
        Some((a, b.min(today)))
    }
    fn special(self) -> bool {
        matches!(self, Self::Custom(..) | Self::Period(..))
    }
    fn label(self, locale: Locale, today: NaiveDate) -> String {
        match self {
            Self::All => text(locale, "data.allTime"),
            Self::Rolling(n) => text(
                locale,
                match n {
                    7 => "data.pastSevenDays",
                    30 => "data.pastThirtyDays",
                    _ => "data.recentYear",
                },
            ),
            Self::Custom(..) => {
                let (a, b) = self.bounds(today).unwrap();
                format_text(
                    locale,
                    "data.customDayCount",
                    &[("days", ((b - a).num_days() + 1).to_string())],
                )
            }
            Self::Period(PickerMode::Week, anchor) => format_text(
                locale,
                "data.weekLabel",
                &[("week", anchor.iso_week().week().to_string())],
            ),
            Self::Period(PickerMode::Month, anchor) => format_text(
                locale,
                "date.monthLabel",
                &[("month", anchor.month().to_string())],
            ),
            Self::Period(_, anchor) => format_text(
                locale,
                "data.yearLabel",
                &[("year", anchor.year().to_string())],
            ),
        }
    }
    fn adjacent(self, next: bool, today: NaiveDate) -> Option<Self> {
        match self {
            Self::All => next.then_some(Self::Rolling(7)),
            Self::Rolling(n) => match (n, next) {
                (7, false) => Some(Self::All),
                (7, true) => Some(Self::Rolling(30)),
                (30, false) => Some(Self::Rolling(7)),
                (30, true) => Some(Self::Rolling(365)),
                (365, false) => Some(Self::Rolling(30)),
                _ => None,
            },
            Self::Custom(..) => {
                let (a, b) = self.bounds(today)?;
                let span = Days::new(((b - a).num_days() + 1) as u64);
                let (a, b) = if next {
                    (a + span, b + span)
                } else {
                    (a - span, b - span)
                };
                (b <= today).then_some(Self::Custom(a, b))
            }
            Self::Period(mode, _) => {
                let (start, _) = self.bounds(today)?;
                let anchor = match (mode, next) {
                    (PickerMode::Week, true) => start + Days::new(7),
                    (PickerMode::Week, false) => start - Days::new(7),
                    (PickerMode::Month, true) => start + Months::new(1),
                    (PickerMode::Month, false) => start - Months::new(1),
                    (_, true) => start + Months::new(12),
                    (_, false) => start - Months::new(12),
                };
                (anchor <= today).then_some(Self::Period(mode, anchor))
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum RangeTarget {
    Overview,
    Destination,
}

pub(super) struct RangeControl {
    selection: RangeSelection,
    focus: FocusHandle,
    bounds: Rc<std::cell::Cell<Bounds<Pixels>>>,
    controls_bounds: Rc<std::cell::Cell<Bounds<Pixels>>>,
}
impl RangeControl {
    pub(super) fn new(cx: &mut Context<DataPage>) -> Self {
        Self {
            selection: RangeSelection::Rolling(7),
            focus: cx.focus_handle(),
            bounds: Rc::new(std::cell::Cell::new(Bounds::default())),
            controls_bounds: Rc::new(std::cell::Cell::new(Bounds::default())),
        }
    }
    pub(super) fn monthly(&self) -> bool {
        self.selection.monthly(Local::now().date_naive())
    }
    pub(super) fn range(&self) -> Option<(i64, i64)> {
        self.selection
            .bounds(Local::now().date_naive())
            .and_then(|(a, b)| noon(a).zip(noon(b)))
    }
}

pub(super) struct RangePicker {
    target: RangeTarget,
    month: NaiveDate,
    active: NaiveDate,
    mode: PickerMode,
    first: Option<NaiveDate>,
    draft: Option<RangeSelection>,
    focus: FocusHandle,
}
impl RangePicker {
    fn choose(&mut self, date: NaiveDate) {
        self.active = date;
        if self.mode != PickerMode::Custom {
            self.draft = Some(RangeSelection::Period(self.mode, date));
        } else if let Some(start) = self.first.filter(|_| self.draft.is_none()) {
            self.draft = Some(RangeSelection::Custom(start.min(date), start.max(date)));
            self.first = None;
        } else {
            self.first = Some(date);
            self.draft = None;
        }
    }
    fn preview(&self) -> Option<(NaiveDate, NaiveDate)> {
        self.draft
            .and_then(|s| s.bounds(Local::now().date_naive()))
            .or_else(|| self.first.map(|d| (d, d)))
    }
    fn summary(&self, locale: Locale) -> String {
        if let Some((a, b)) = self.draft.and_then(|s| s.bounds(Local::now().date_naive())) {
            format!("{a} – {b}")
        } else {
            text(
                locale,
                if self.mode != PickerMode::Custom {
                    "data.pickDate"
                } else if self.first.is_some() {
                    "data.pickEndDate"
                } else {
                    "data.pickStartDate"
                },
            )
        }
    }
}

impl DataPage {
    pub(super) fn close_range(&mut self, restore: bool, win: &mut Window, cx: &mut Context<Self>) {
        if let Some(picker) = self.range_picker.take()
            && restore
        {
            win.focus(&self.ranges[picker.target as usize].focus, cx);
        }
        cx.notify();
    }
    fn commit_range(
        &mut self,
        target: RangeTarget,
        selection: RangeSelection,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.ranges[target as usize].selection = selection;
        self.close_range(false, win, cx);
        win.focus(&self.ranges[target as usize].focus, cx);
        match target {
            RangeTarget::Overview => self.load_overview(cx),
            RangeTarget::Destination => self.load_destination(cx),
        }
        cx.notify();
    }

    pub(super) fn range_control(
        &self,
        target: RangeTarget,
        c: Palette,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let control = &self.ranges[target as usize];
        let picker = self.range_picker.as_ref().filter(|p| p.target == target);
        let locale = self.client.locale.get();
        let today = Local::now().date_naive();
        let caption = picker.map_or_else(
            || control.selection.label(locale, today),
            |p| {
                p.draft
                    .map_or_else(|| text(locale, p.mode.key()), |s| s.label(locale, today))
            },
        );
        let bounds = control.bounds.clone();
        let control_bounds = control.controls_bounds.clone();
        let mut controls = quietpro::calendar_controls()
            .id(("trend-range-control", target as usize))
            .role(Role::Group)
            .aria_label(text(
                locale,
                match target {
                    RangeTarget::Overview => "accessibility.data.trendRange",
                    RangeTarget::Destination => match self.kind {
                        SeriesKind::App => "accessibility.data.appTrendRange",
                        SeriesKind::Category => "accessibility.data.categoryTrendRange",
                        SeriesKind::Web => "accessibility.data.webTrendRange",
                    },
                },
            ))
            .relative()
            .child(
                canvas(move |b, _, _| control_bounds.set(b), |_, _, _, _| {})
                    .absolute()
                    .inset_0(),
            );
        if control.selection.special() {
            controls = controls.child(
                IconControl::new(
                    "reset-range",
                    text(locale, "accessibility.data.resetTrendRange"),
                    Icon::RotateCcw,
                )
                .action(
                    c,
                    cx.listener(move |this, _, win, cx| {
                        this.commit_range(target, RangeSelection::Rolling(7), win, cx)
                    }),
                ),
            );
        }
        for next in [false, true] {
            if next {
                controls = controls.child(
                    quietpro::calendar_trigger("open-range", caption.clone(), c)
                        .h(px(28.))
                        .min_h(px(28.))
                        .flex_none()
                        .min_w(px(80.))
                        .accessibility_label(text(locale, "data.rangePickerTitle"))
                        .aria_expanded(picker.is_some())
                        .track_focus(&control.focus)
                        .child(
                            canvas(
                                {
                                    let bounds = bounds.clone();
                                    move |b, _, _| bounds.set(b)
                                },
                                |_, _, _, _| {},
                            )
                            .absolute()
                            .inset_0(),
                        )
                        .on_click(cx.listener(move |this, _, win, cx| {
                            if this
                                .range_picker
                                .as_ref()
                                .is_some_and(|p| p.target == target)
                            {
                                this.close_range(true, win, cx);
                                return;
                            }
                            let today = Local::now().date_naive();
                            let focus = cx.focus_handle();
                            win.focus(&focus, cx);
                            this.range_picker = Some(RangePicker {
                                target,
                                month: today.with_day(1).unwrap(),
                                active: today,
                                mode: PickerMode::Custom,
                                first: None,
                                draft: None,
                                focus,
                            });
                            cx.notify();
                        })),
                );
            }
            let enabled = picker.map_or_else(
                || control.selection.adjacent(next, today).is_some(),
                |p| p.mode.adjacent(next).is_some(),
            );
            let key = if picker.is_some() {
                if next {
                    "accessibility.data.nextPickerMode"
                } else {
                    "accessibility.data.previousPickerMode"
                }
            } else if control.selection.special() {
                if next {
                    "accessibility.data.newerRange"
                } else {
                    "accessibility.data.earlierRange"
                }
            } else if next {
                "accessibility.data.longerTrendRange"
            } else {
                "accessibility.data.shorterTrendRange"
            };
            controls = controls.child(quietpro::calendar_arrow_frame(
                IconControl::new(
                    if next { "range-next" } else { "range-prev" },
                    text(locale, key),
                    if next {
                        Icon::ChevronRight
                    } else {
                        Icon::ChevronLeft
                    },
                )
                .disabled(!enabled)
                .action(
                    c,
                    cx.listener(move |this, _, win, cx| {
                        if let Some(p) = this.range_picker.as_mut().filter(|p| p.target == target) {
                            if let Some(mode) = p.mode.adjacent(next) {
                                p.mode = mode;
                                p.first = None;
                                p.draft = None;
                                win.focus(&p.focus, cx);
                                cx.notify();
                            }
                        } else if let Some(selection) = this.ranges[target as usize]
                            .selection
                            .adjacent(next, Local::now().date_naive())
                        {
                            this.commit_range(target, selection, win, cx);
                        }
                    }),
                ),
                c,
            ));
        }
        controls
    }
    pub(super) fn range_popup(
        &self,
        c: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let picker = self.range_picker.as_ref().unwrap();
        let target = picker.target;
        let locale = self.client.locale.get();
        let today = Local::now().date_naive();
        let month = picker.month;
        let preview = picker.preview();
        let keyboard = picker.focus.is_focused(win) && win.last_input_was_keyboard();
        let mut popup = quietpro::calendar_surface(c)
            .id("data-range-picker")
            .role(Role::Group)
            .aria_label(text(locale, "data.rangePickerTitle"))
            .max_h(win.viewport_size().height - px(16.))
            .overflow_y_scroll()
            .on_mouse_down_out(cx.listener(move |this, e: &MouseDownEvent, win, cx| {
                if !this.ranges[target as usize]
                    .controls_bounds
                    .get()
                    .contains(&e.position)
                {
                    this.close_range(false, win, cx);
                }
            }))
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, win, cx| {
                if e.keystroke.key == "escape" {
                    this.close_range(true, win, cx);
                    cx.stop_propagation();
                }
            }))
            .child(
                label(picker.summary(locale))
                    .text_size(px(12.))
                    .font_weight(FontWeight::SEMIBOLD),
            );
        let arrow = |next| {
            IconControl::new(
                if next {
                    "range-next-month"
                } else {
                    "range-prev-month"
                },
                text(
                    locale,
                    if next {
                        "accessibility.history.nextMonth"
                    } else {
                        "accessibility.history.previousMonth"
                    },
                ),
                if next {
                    Icon::ChevronRight
                } else {
                    Icon::ChevronLeft
                },
            )
            .disabled(next && month + Months::new(1) > today)
            .action(
                c,
                cx.listener(move |this, _, _, cx| {
                    if let Some(p) = &mut this.range_picker {
                        p.month = if next {
                            p.month + Months::new(1)
                        } else {
                            p.month - Months::new(1)
                        };
                        p.active = p.month.min(Local::now().date_naive());

                        cx.notify();
                    }
                }),
            )
        };
        let header = quietpro::calendar_month_header(
            arrow(false),
            format_text(
                locale,
                "date.calendarMonth",
                &[
                    ("year", month.year().to_string()),
                    ("month", month.month().to_string()),
                ],
            ),
            arrow(true),
        );
        let weekdays = quietpro::calendar_weekdays(
            std::array::from_fn(|day| {
                format_text(locale, "date.calendarWeekday", &[("day", day.to_string())])
            }),
            c,
        );
        let mut grid = div()
            .id("range-grid")
            .role(Role::Grid)
            .aria_label(text(
                locale,
                if picker.first.is_some() && picker.draft.is_none() {
                    "data.pickEndDate"
                } else {
                    "data.pickStartDate"
                },
            ))
            .track_focus(&picker.focus)
            .tab_stop(true)
            .flex()
            .flex_col()
            .flex_none()
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, win, cx| {
                let Some(p) = &mut this.range_picker else {
                    return;
                };
                if !p.focus.is_focused(win) || e.keystroke.modifiers.modified() {
                    return;
                }
                let date = match e.keystroke.key.as_str() {
                    "left" => p.active - Days::new(1),
                    "right" => p.active + Days::new(1),
                    "up" => p.active - Days::new(7),
                    "down" => p.active + Days::new(7),
                    "home" => {
                        p.active - Days::new(p.active.weekday().num_days_from_monday().into())
                    }
                    "end" => {
                        p.active + Days::new((6 - p.active.weekday().num_days_from_monday()).into())
                    }
                    "pageup" => p.active - Months::new(1),
                    "pagedown" => p.active + Months::new(1),
                    "enter" | "space" => {
                        p.choose(p.active);
                        cx.notify();
                        cx.stop_propagation();
                        return;
                    }
                    _ => return,
                }
                .min(Local::now().date_naive());
                p.active = date;
                p.month = date.with_day(1).unwrap();

                cx.notify();
                cx.stop_propagation();
            }));
        let start = month - Days::new(month.weekday().num_days_from_monday().into());
        for week in 0_usize..6 {
            let mut row = quietpro::calendar_week(("range-week", week));
            for day in 0..7 {
                let date = start + Days::new((week * 7 + day) as u64);
                let enabled = date <= today && noon(date).is_some();
                let inside = preview.is_some_and(|(a, b)| date >= a && date <= b);
                let endpoint = preview.is_some_and(|(a, b)| date == a || date == b);
                let item = quietpro::calendar_day(
                    SharedString::from(format!("range-{date}")),
                    date.to_string(),
                    date.day(),
                    CalendarDayState {
                        enabled,
                        selected: endpoint,
                        in_range: inside,
                        active: date == picker.active,
                        keyboard,
                        outside_month: date.month() != month.month(),
                        today: date == today,
                    },
                    c,
                )
                .when(enabled, |d| {
                    d.on_mouse_down(MouseButton::Left, |_, win, _| win.prevent_default())
                        .on_click(cx.listener(move |this, _, win, cx| {
                            if let Some(p) = &mut this.range_picker {
                                p.choose(date);
                                win.focus(&p.focus, cx);
                                cx.notify();
                            }
                            cx.stop_propagation();
                        }))
                });
                row = row.child(quietpro::calendar_range_cell(
                    item,
                    inside,
                    preview.is_some_and(|(a, _)| date > a),
                    preview.is_some_and(|(_, b)| date < b),
                    c,
                ));
            }
            grid = grid.child(row);
        }

        popup = popup.child(header).child(
            div()
                .flex()
                .flex_col()
                .flex_none()
                .child(weekdays)
                .child(grid),
        );
        if picker.mode == PickerMode::Custom
            && picker
                .draft
                .is_some_and(|s| s.bounds(today).is_some_and(|(a, b)| (b - a).num_days() < 6))
        {
            popup = popup.child(quietpro::caption(text(locale, "data.shortRangeHint"), c));
        }
        popup = popup.child(
            div()
                .flex()
                .justify_end()
                .gap(px(8.))
                .flex_none()
                .child(
                    quietpro::text_button("cancel-range", text(locale, "common.cancel"), c, true)
                        .on_click(cx.listener(|this, _, win, cx| this.close_range(true, win, cx))),
                )
                .child(
                    quietpro::text_button(
                        "apply-dates",
                        text(locale, "data.applyRange"),
                        c,
                        picker.draft.is_some(),
                    )
                    .on_click(cx.listener(|this, _, win, cx| {
                        if let Some((target, s)) = this
                            .range_picker
                            .as_ref()
                            .and_then(|p| p.draft.map(|s| (p.target, s)))
                        {
                            this.commit_range(target, s, win, cx);
                        }
                    })),
                ),
        );
        deferred(
            Positioner::side(self.ranges[target as usize].bounds.get())
                .placement(Placement::Bottom)
                .align(Align::Center)
                .offset(px(4.))
                .margin(px(8.))
                .occlude()
                .child(popup),
        )
        .with_priority(POPUP_PRIORITY)
    }
}

#[cfg(test)]
mod tests {
    use super::{PickerMode, RangeSelection};
    use chrono::{Datelike, Days, NaiveDate};
    #[test]
    fn year_granularity_does_not_change_with_available_days() {
        let today = NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
        assert!(RangeSelection::Period(PickerMode::Year, today).monthly(today));
        assert!(RangeSelection::All.monthly(today));
        assert!(RangeSelection::Rolling(365).monthly(today));
        assert!(!RangeSelection::Period(PickerMode::Month, today).monthly(today));
        assert!(!RangeSelection::Custom(today - Days::new(61), today).monthly(today));
        assert!(RangeSelection::Custom(today - Days::new(62), today).monthly(today));
    }
    #[test]
    fn range_navigation_matches_legacy_control() {
        let today = NaiveDate::from_ymd_opt(2026, 11, 16).unwrap();
        assert_eq!(
            RangeSelection::Rolling(7).adjacent(false, today),
            Some(RangeSelection::All)
        );
        assert_eq!(
            RangeSelection::All.adjacent(true, today),
            Some(RangeSelection::Rolling(7))
        );
        assert_eq!(RangeSelection::Rolling(365).adjacent(true, today), None);
        assert_eq!(
            RangeSelection::Rolling(365).bounds(today),
            Some((NaiveDate::from_ymd_opt(2025, 12, 1).unwrap(), today))
        );
        let custom = RangeSelection::Custom(today, today - Days::new(2));
        assert_eq!(custom.bounds(today), Some((today - Days::new(2), today)));
        assert_eq!(
            custom.adjacent(false, today),
            Some(RangeSelection::Custom(
                today - Days::new(5),
                today - Days::new(3)
            ))
        );
        assert_eq!(custom.adjacent(true, today), None);
        let current = RangeSelection::Period(PickerMode::Month, today);
        assert_eq!(
            current.bounds(today),
            Some((today.with_day(1).unwrap(), today))
        );
        assert_eq!(current.adjacent(true, today), None);
        assert_eq!(PickerMode::Custom.adjacent(false), None);
        assert_eq!(PickerMode::Year.adjacent(true), None);
    }

    #[test]
    fn range_labels_use_existing_translations() {
        use patina_activity_model::{Locale, format_text};
        assert_eq!(
            format_text(Locale::EnUs, "date.monthLabel", &[("month", "11".into())]),
            "Nov"
        );
        assert_eq!(
            format_text(Locale::Es, "data.customDayCount", &[("days", "1".into())]),
            "1 día"
        );
        assert_eq!(
            format_text(Locale::Es, "data.customDayCount", &[("days", "2".into())]),
            "2 días"
        );
    }
}
