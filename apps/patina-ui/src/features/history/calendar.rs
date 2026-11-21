use super::*;

use chrono::{Datelike, Days, Months, NaiveDate, TimeZone};
use gpui_kit::base::{Align, POPUP_PRIORITY, Placement, Positioner};
use quietpro::{ButtonSizeExt, ControlSize, Icon, IconControl};

#[derive(Clone)]
pub(super) struct DateTrigger {
    pub(super) focus: FocusHandle,
    bounds: Rc<std::cell::Cell<Bounds<Pixels>>>,
    size: ControlSize,
}

impl DateTrigger {
    pub(super) fn new(size: ControlSize, cx: &App) -> Self {
        Self {
            focus: cx.focus_handle(),
            bounds: Default::default(),
            size,
        }
    }
}

pub(super) struct Calendar {
    month: NaiveDate,
    active: NaiveDate,
    focus: FocusHandle,
    trigger: DateTrigger,
}

fn timestamp(date: NaiveDate) -> Option<i64> {
    date.and_hms_opt(12, 0, 0)?
        .and_local_timezone(Local)
        .earliest()
        .map(|d| d.timestamp_millis())
}

fn date_caption(
    locale: patina_activity_model::Locale,
    date: NaiveDate,
    today: NaiveDate,
) -> String {
    if date == today {
        return text(locale, "date.today");
    }
    if date == today - Days::new(1) {
        return text(locale, "date.yesterday");
    }
    use windows::{
        Win32::{
            Foundation::SYSTEMTIME,
            Globalization::{ENUM_DATE_FORMATS_FLAGS, GetDateFormatEx},
        },
        core::{HSTRING, PCWSTR},
    };
    let time = SYSTEMTIME {
        wYear: date.year() as u16,
        wMonth: date.month() as u16,
        wDay: date.day() as u16,
        ..Default::default()
    };
    let mut output = [0_u16; 128];
    let length = unsafe {
        GetDateFormatEx(
            &HSTRING::from(locale.tag()),
            ENUM_DATE_FORMATS_FLAGS(0),
            Some(&time),
            &HSTRING::from(text(locale, "date.compactPattern")),
            Some(&mut output),
            PCWSTR::null(),
        )
    };
    if length > 0 {
        String::from_utf16_lossy(&output[..length as usize - 1])
    } else {
        date.to_string()
    }
}

impl History {
    fn selected_date(&self) -> NaiveDate {
        Local
            .timestamp_millis_opt(self.date)
            .single()
            .unwrap()
            .date_naive()
    }

    pub(super) fn requested_date_error(&self) -> Option<String> {
        let day = self.data.as_ref()?;
        (self.error && !(day.start..day.end).contains(&self.date)).then(|| {
            let locale = self.client.locale.get();
            let date = date_caption(locale, self.selected_date(), Local::now().date_naive());
            format!("{date} ･ {}", text(locale, "destinationDetail.dayError"))
        })
    }

    fn close_calendar(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if let Some(calendar) = self.calendar.take() {
            win.focus(&calendar.trigger.focus, cx);
            cx.notify();
        }
    }

    fn choose_date(&mut self, date: NaiveDate, win: &mut Window, cx: &mut Context<Self>) {
        if date <= Local::now().date_naive()
            && let Some(ms) = timestamp(date)
        {
            self.close_calendar(win, cx);
            self.change_day(ms, cx);
        }
    }

    fn browse_month(&mut self, next: bool, cx: &mut Context<Self>) {
        if let Some(cal) = &mut self.calendar {
            let date = if next {
                cal.active + Months::new(1)
            } else {
                cal.active - Months::new(1)
            };
            cal.active = date.min(Local::now().date_naive());
            cal.month = cal.active.with_day(1).unwrap();
            cx.notify();
        }
    }

    pub(super) fn date_controls(
        &self,
        trigger: &DateTrigger,
        colors: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> Div {
        let locale = self.client.locale.get();
        let date = self.selected_date();
        let presented = Local
            .timestamp_millis_opt(self.presented_date())
            .single()
            .unwrap()
            .date_naive();
        let today = Local::now().date_naive();
        let today_label = text(locale, "date.today");
        let size = trigger.size;
        let weight = match size {
            ControlSize::Large => FontWeight::BOLD,
            _ => FontWeight::MEDIUM,
        };
        let width = ["8888-88-88", today_label.as_str()]
            .into_iter()
            .map(|s| {
                let mut run = win.text_style().to_run(s.len());
                run.font.weight = weight;
                f32::from(
                    win.text_system()
                        .shape_line(s.to_owned().into(), px(14.), &[run], None)
                        .width,
                )
            })
            .fold(0_f32, f32::max);
        let trigger = trigger.clone();
        let bounds = trigger.bounds.clone();
        quietpro::calendar_controls()
            .child(quietpro::calendar_arrow_frame(
                IconControl::new(
                    "prev-date",
                    text(locale, "destinationDetail.previousDay"),
                    Icon::ChevronLeft,
                )
                .action(
                    colors,
                    cx.listener(move |this, _, _, cx| {
                        if let Some(ms) = timestamp(date - Days::new(1)) {
                            this.change_day(ms, cx);
                        }
                    }),
                ),
                size,
                colors,
            ))
            .child(
                quietpro::calendar_trigger(
                    "date-picker",
                    date_caption(locale, presented, today),
                    colors,
                )
                .w(px(((width + 24. + 2.) / 4.).ceil() * 4.))
                .control_size(size)
                .font_weight(weight)
                .flex_none()
                .accessibility_label(presented.to_string())
                .track_focus(&trigger.focus)
                .child(
                    canvas(move |b, _, _| bounds.set(b), |_, _, _, _| {})
                        .absolute()
                        .inset_0()
                        .size_full(),
                )
                .on_click(cx.listener(move |this, _, win, cx| {
                    if this.calendar.is_some() {
                        this.close_calendar(win, cx);
                        return;
                    }
                    let focus = cx.focus_handle();
                    win.focus(&focus, cx);
                    this.calendar = Some(Calendar {
                        month: date.with_day(1).unwrap(),
                        active: date,
                        focus,
                        trigger: trigger.clone(),
                    });
                    cx.notify();
                })),
            )
            .child(quietpro::calendar_arrow_frame(
                IconControl::new(
                    "next-date",
                    text(locale, "destinationDetail.nextDay"),
                    Icon::ChevronRight,
                )
                .disabled(date >= today)
                .action(
                    colors,
                    cx.listener(move |this, _, _, cx| {
                        if date < Local::now().date_naive()
                            && let Some(ms) = timestamp(date + Days::new(1))
                        {
                            this.change_day(ms, cx);
                        }
                    }),
                ),
                size,
                colors,
            ))
    }

    pub(super) fn calendar_popup(
        &self,
        c: Palette,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + use<> {
        let cal = self.calendar.as_ref().unwrap();
        let (month, active) = (cal.month, cal.active);
        let locale = self.client.locale.get();
        let today = Local::now().date_naive();
        let selected = self.selected_date();
        let keyboard = cal.focus.is_focused(win) && win.last_input_was_keyboard();
        let mut popup = quietpro::calendar_surface(c)
            .id("history-calendar")
            .role(Role::Group)
            .aria_label(text(locale, "date.pickDate"))
            .track_focus(&cal.focus)
            .on_mouse_down_out(cx.listener(|this, e: &MouseDownEvent, win, cx| {
                if this
                    .calendar
                    .as_ref()
                    .is_some_and(|cal| !cal.trigger.bounds.get().contains(&e.position))
                {
                    this.close_calendar(win, cx);
                }
            }))
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, win, cx| {
                if e.keystroke.key == "escape" {
                    this.close_calendar(win, cx);
                    cx.stop_propagation();
                    return;
                }
                let Some(cal) = &mut this.calendar else {
                    return;
                };
                // Tab leaves this transient picker; date navigation stays on its grid.
                if e.keystroke.key == "tab" {
                    this.close_calendar(win, cx);
                    return;
                }
                if !cal.focus.is_focused(win) || e.keystroke.modifiers.modified() {
                    return;
                }
                let date = match e.keystroke.key.as_str() {
                    "left" => cal.active - Days::new(1),
                    "right" => cal.active + Days::new(1),
                    "up" => cal.active - Days::new(7),
                    "down" => cal.active + Days::new(7),
                    "home" => {
                        cal.active - Days::new(cal.active.weekday().num_days_from_monday().into())
                    }
                    "end" => {
                        cal.active
                            + Days::new((6 - cal.active.weekday().num_days_from_monday()).into())
                    }
                    "pageup" => cal.active - Months::new(1),
                    "pagedown" => cal.active + Months::new(1),
                    "enter" | "space" => {
                        let date = cal.active;
                        this.choose_date(date, win, cx);
                        cx.stop_propagation();
                        return;
                    }
                    _ => return,
                }
                .min(Local::now().date_naive());
                cal.active = date;
                cal.month = date.with_day(1).unwrap();
                cx.notify();
                cx.stop_propagation();
            }))
            .child(quietpro::calendar_month_header(
                IconControl::new(
                    "prev-month",
                    text(locale, "accessibility.history.previousMonth"),
                    Icon::ChevronLeft,
                )
                .action(
                    c,
                    cx.listener(|this, _, win, cx| {
                        this.browse_month(false, cx);
                        if let Some(cal) = &this.calendar {
                            win.focus(&cal.focus, cx);
                        }
                    }),
                ),
                format_text(
                    locale,
                    "date.calendarMonth",
                    &[
                        ("year", month.year().to_string()),
                        ("month", month.month().to_string()),
                    ],
                ),
                IconControl::new(
                    "next-month",
                    text(locale, "accessibility.history.nextMonth"),
                    Icon::ChevronRight,
                )
                .disabled(month + Months::new(1) > today)
                .action(
                    c,
                    cx.listener(|this, _, win, cx| {
                        this.browse_month(true, cx);
                        if let Some(cal) = &this.calendar {
                            win.focus(&cal.focus, cx);
                        }
                    }),
                ),
            ));
        let weekdays = quietpro::calendar_weekdays(
            std::array::from_fn(|day| {
                format_text(locale, "date.calendarWeekday", &[("day", day.to_string())])
            }),
            c,
        );
        let mut grid = div()
            .id("calendar-grid")
            .role(Role::Grid)
            .aria_label(text(locale, "date.pickDate"))
            .flex()
            .flex_col();
        let start = month - Days::new(month.weekday().num_days_from_monday().into());
        for week in 0_usize..6 {
            let mut row = quietpro::calendar_week(("calendar-week", week));
            for day in 0..7 {
                let date = start + Days::new((week * 7 + day) as u64);
                let enabled = date <= today && timestamp(date).is_some();
                let item = quietpro::calendar_day(
                    SharedString::from(format!("calendar-{date}")),
                    date.to_string(),
                    date.day(),
                    quietpro::CalendarDayState {
                        enabled,
                        selected: date == selected,
                        in_range: false,
                        active: date == active,
                        keyboard,
                        outside_month: date.month() != month.month(),
                        today: date == today,
                    },
                    c,
                )
                .when(enabled, |d| {
                    d.on_mouse_down(MouseButton::Left, |_, win, _| win.prevent_default())
                        .on_click(cx.listener(move |this, _, win, cx| {
                            this.choose_date(date, win, cx);
                            cx.stop_propagation();
                        }))
                });
                row = row.child(item);
            }
            grid = grid.child(row);
        }
        popup = popup.child(div().flex().flex_col().child(weekdays).child(grid));
        deferred(
            Positioner::side(cal.trigger.bounds.get())
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
