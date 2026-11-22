use super::{Tools, fields::field_group};
use chrono::{Datelike, Days, Local, Months, NaiveDate, NaiveDateTime, Timelike};
use gpui_kit::base::{Popover, TestSupportExt};
use gpui_kit::{prelude::*, *};
use patina_activity_model::Locale;
use patina_i18n::text;
use quietpro::{ControlSize, Icon, IconControl, Palette};

use patina_i18n::format_text;
use std::ops::RangeInclusive;
use std::rc::Rc;

fn number_options(range: RangeInclusive<u32>) -> Rc<[(u32, SharedString)]> {
    range.map(|n| (n, format!("{n:02}").into())).collect()
}

pub(super) struct Picker {
    selected: NaiveDate,
    active: NaiveDate,
    grid_focus: FocusHandle,
    locale: Locale,
    colors: Palette,
}

struct DateSelected(NaiveDate);
impl EventEmitter<DateSelected> for Picker {}

#[derive(Clone, Copy)]
enum TimeValue {
    Scheduled(NaiveDateTime),
    Interval(u32, u32),
}

impl Tools {
    pub(super) fn schedule_fields(
        &mut self,
        id: &str,
        title: &str,
        initial: &str,
        c: Palette,
        ready: bool,
        cx: &Context<Self>,
    ) -> Popover {
        let local = self
            .choices
            .entry(id.into())
            .or_insert_with(|| initial.to_owned());
        let value = NaiveDateTime::parse_from_str(local, "%Y-%m-%d %H:%M")
            .ok()
            .filter(|date| (1..=9999).contains(&date.year()))
            .unwrap_or_else(|| {
                let next = Local::now().naive_local() + chrono::Duration::minutes(5);
                *local = next.format("%Y-%m-%d %H:%M").to_string();
                next
            });
        self.time_popover(id, title, TimeValue::Scheduled(value), c, ready, cx)
    }

    pub(super) fn interval_field(
        &mut self,
        id: &str,
        title: &str,
        initial: &str,
        max_minutes: u32,
        view: super::fields::PanelView<'_>,
        cx: &Context<Self>,
    ) -> Popover {
        let stored = self
            .choices
            .entry(id.into())
            .or_insert_with(|| initial.to_owned());
        let minutes = stored
            .parse::<u32>()
            .ok()
            .filter(|n| *n > 0 && (*n <= max_minutes || stored.as_str() == initial))
            .unwrap_or_else(|| {
                *stored = 60.min(max_minutes).to_string();
                60.min(max_minutes)
            });
        self.time_popover(
            id,
            title,
            TimeValue::Interval(minutes, max_minutes),
            view.colors,
            view.ready,
            cx,
        )
    }

    fn time_popover(
        &mut self,
        field_id: &str,
        title: &str,
        value: TimeValue,
        c: Palette,
        ready: bool,
        cx: &Context<Self>,
    ) -> Popover {
        let locale = self.client.locale.get();
        let display = match value {
            TimeValue::Scheduled(at) => at.format("%Y-%m-%d %H:%M").to_string(),
            TimeValue::Interval(total, _) => patina_i18n::messages::time_selected_duration(
                locale,
                (total / 60).into(),
                (total % 60).into(),
            ),
        };
        let focus = self.panel.field_focus(field_id, cx);
        let expanded = ready && self.panel.expanded.as_deref() == Some(field_id);
        let id = SharedString::from(format!("time-{field_id}"));
        let key = field_id.to_owned();
        let popup = Popover::new((ElementId::from(id.clone()), "popup"))
            .open(expanded)
            .overlay_closable(false)
            .anchor(Anchor::TopLeft)
            .offset(px(4.))
            .trigger(
                self.form_button(id, display.clone(), c, ready)
                    .role(Role::ComboBox)
                    .accessibility_label(title.to_owned())
                    .aria_expanded(expanded)
                    .aria_value(display)
                    .track_focus(&focus)
                    .w_full()
                    .justify_between()
                    .text_size(self.form_value_size())
                    .font_weight(FontWeight::MEDIUM)
                    .gap(px(8.))
                    .child(
                        quietpro::glyph(
                            if expanded {
                                Icon::ChevronUp
                            } else {
                                Icon::ChevronDown
                            },
                            if ready { c.text } else { c.disabled_text },
                        )
                        .size(px(12.))
                        .mr(px(1.))
                        .id("chevron")
                        .test_support(),
                    ),
            )
            .on_open_change(cx.listener(move |t, open, win, cx| {
                if *open && ready {
                    t.panel.expanded = Some(key.clone());
                    if matches!(value, TimeValue::Scheduled(_)) {
                        win.focus(&t.panel.schedule_focus, cx);
                    }
                } else {
                    t.panel.close_picker();
                    win.focus(&focus, cx);
                    if std::mem::take(&mut t.refresh_pending) {
                        t.background_refresh(cx);
                    }
                }
                cx.notify();
            }));
        if !expanded {
            return popup;
        }
        let controls = self.schedule_options(field_id, value, c, cx);
        popup.content(move |_, win, cx| {
            let viewport = win.viewport_size();
            let backdrop = div()
                .w(viewport.width)
                .h(viewport.height)
                .occlude()
                .on_mouse_down(
                    MouseButton::Left,
                    cx.listener(|popup, _, win, cx| {
                        popup.dismiss(win, cx);
                    }),
                );
            div()
                .child(anchored().position(Point::default()).child(backdrop))
                .child(controls.occlude())
        })
    }

    fn date_select(
        &self,
        field_id: &str,
        value: NaiveDateTime,
        c: Palette,
        cx: &Context<Self>,
    ) -> Popover {
        let locale = self.client.locale.get();
        let date = value.date();
        let key = field_id.to_owned();
        let picker = self.panel.picker.clone();
        let focus = self.panel.schedule_focus.clone();
        let open = picker.is_some();
        Popover::new("time-date-popup")
            .open(open)
            .anchor(Anchor::TopLeft)
            .offset(px(4.))
            .trigger(
                self.form_button("time-date", date.to_string(), c, true)
                    .when(self.is_task_form(), |button| {
                        button.font_weight(FontWeight::MEDIUM)
                    })
                    .role(Role::ComboBox)
                    .accessibility_label(text(locale, "date.pickDate"))
                    .aria_value(date.to_string())
                    .aria_expanded(open)
                    .track_focus(&focus)
                    .gap(px(4.))
                    .child(
                        quietpro::glyph(
                            if open {
                                Icon::ChevronUp
                            } else {
                                Icon::ChevronDown
                            },
                            c.secondary,
                        )
                        .size(px(12.)),
                    ),
            )
            .on_open_change(cx.listener(move |t, open, win, cx| {
                if *open {
                    let grid_focus = cx.focus_handle();
                    win.focus(&grid_focus, cx);
                    let picker = cx.new(|_| Picker {
                        selected: date,
                        active: date,
                        grid_focus,
                        locale,
                        colors: c,
                    });
                    let key = key.clone();
                    cx.subscribe_in(&picker, win, move |t, _, picked: &DateSelected, win, cx| {
                        t.set_schedule(&key, picked.0.and_time(value.time()), cx);
                        t.close_calendar(win, cx);
                    })
                    .detach();
                    t.panel.picker = Some(picker);
                } else {
                    t.close_calendar(win, cx);
                }
                cx.notify();
            }))
            .content(move |_, _, _| div().children(picker))
    }

    fn schedule_options(
        &mut self,
        field_id: &str,
        value: TimeValue,
        c: Palette,
        cx: &Context<Self>,
    ) -> Div {
        let locale = self.client.locale.get();
        let (hours, minutes, max_hour) = match value {
            TimeValue::Scheduled(at) => (at.hour(), at.minute(), 23),
            TimeValue::Interval(total, max_minutes) => {
                let selectable = total.min(max_minutes);
                (selectable / 60, selectable % 60, max_minutes / 60)
            }
        };
        let minute_range = match value {
            TimeValue::Interval(_, max) => u32::from(hours == 0)..=59.min(max - hours * 60),
            _ => 0..=59,
        };
        let task_form = self.is_task_form();
        let mut time_select = |hour: bool| {
            let (id, key, range, selected) = if hour {
                ("time-hour", "time.hours", 0..=max_hour, hours)
            } else {
                ("time-minute", "time.minutes", minute_range.clone(), minutes)
            };
            let view = cx.weak_entity();
            let interval_hours = hour && max_hour > 59;
            let options = if interval_hours {
                let cache = &mut self.panel.hour_options;
                if cache.as_ref().is_none_or(|(max, _)| *max != max_hour) {
                    *cache = Some((max_hour, number_options(range)));
                }
                cache.as_ref().unwrap().1.clone()
            } else {
                number_options(range)
            };
            let field_id = field_id.to_owned();
            quietpro::Dropdown::with_shared_options(
                id,
                text(locale, key),
                options,
                selected,
                c,
                move |n, _, cx| {
                    let _ = view.update(cx, |t, cx| match value {
                        TimeValue::Scheduled(at) => {
                            let changed = if hour {
                                at.with_hour(n)
                            } else {
                                at.with_minute(n)
                            };
                            if let Some(changed) = changed {
                                t.set_schedule(&field_id, changed, cx);
                            }
                        }
                        TimeValue::Interval(_, max_minutes) => {
                            let total = if hour {
                                n * 60 + minutes
                            } else {
                                hours * 60 + n
                            };
                            t.choices
                                .insert(field_id.clone(), total.clamp(1, max_minutes).to_string());
                            cx.notify();
                        }
                    });
                },
            )
            .trigger_size(ControlSize::Large)
            .when(task_form, |dropdown| dropdown.medium_labels(px(14.)))
            .selected_option_color(c.text)
            .when(interval_hours, |dropdown| dropdown.virtualized("8888"))
        };
        let hours = time_select(true);
        let minutes = time_select(false);
        quietpro::content_card(c.border, c.panel)
            .flex_row()
            .items_end()
            .gap(px(quietpro::SUBHEADING_GAP))
            .when_some(
                match value {
                    TimeValue::Scheduled(at) => Some(at),
                    TimeValue::Interval(..) => None,
                },
                |panel, at| {
                    panel.child(
                        field_group(&text(locale, "date.pickDate"), c, false)
                            .id("field-date")
                            .child(self.date_select(field_id, at, c, cx)),
                    )
                },
            )
            .child(
                field_group(&text(locale, "time.hours"), c, false)
                    .id("field-hour")
                    .child(hours),
            )
            .child(
                field_group(&text(locale, "time.minutes"), c, false)
                    .id("field-minute")
                    .child(minutes),
            )
    }

    fn set_schedule(&mut self, key: &str, value: NaiveDateTime, cx: &mut Context<Self>) {
        self.choices
            .insert(key.into(), value.format("%Y-%m-%d %H:%M").to_string());
        cx.notify();
    }

    fn close_calendar(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        self.panel.picker = None;
        win.focus(&self.panel.schedule_focus, cx);
        cx.notify();
    }
}

impl Picker {
    fn select(&mut self, date: NaiveDate, cx: &mut Context<Self>) {
        self.selected = date;
        cx.emit(DateSelected(date));
    }

    fn month_button(&self, next: bool, cx: &Context<Self>) -> impl IntoElement + use<> {
        let date = if next {
            self.active.checked_add_months(Months::new(1))
        } else {
            self.active.checked_sub_months(Months::new(1))
        }
        .filter(|date| (1..=9999).contains(&date.year()));
        let (id, key, icon) = if next {
            (
                "time-next-month",
                "accessibility.date.nextMonth",
                Icon::ChevronRight,
            )
        } else {
            (
                "time-previous-month",
                "accessibility.date.previousMonth",
                Icon::ChevronLeft,
            )
        };
        IconControl::new(id, text(self.locale, key), icon)
            .disabled(date.is_none())
            .action(
                self.colors,
                cx.listener(move |t, _, win, cx| {
                    if let Some(date) = date {
                        t.active = date;
                        win.focus(&t.grid_focus, cx);
                        cx.notify();
                    }
                }),
            )
    }
}

impl Render for Picker {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let c = self.colors;
        let first = self.active.with_day(1).unwrap();
        let start = first - Days::new(first.weekday().num_days_from_monday().into());
        let today = Local::now().date_naive();
        let mut grid = div()
            .id("time-calendar-grid")
            .role(Role::Grid)
            .track_focus(&self.grid_focus)
            .aria_label(text(self.locale, "date.pickDate"))
            .flex()
            .flex_col()
            .on_key_down(cx.listener(|t, e: &KeyDownEvent, _, cx| {
                if e.keystroke.modifiers.modified() {
                    return;
                }
                let days = match e.keystroke.key.as_str() {
                    "left" => -1,
                    "right" => 1,
                    "up" => -7,
                    "down" => 7,
                    "enter" | "space" => {
                        t.select(t.active, cx);
                        cx.stop_propagation();
                        return;
                    }
                    _ => return,
                };
                let day = t.active + chrono::Duration::days(days);
                if (1..=9999).contains(&day.year()) {
                    t.active = day;
                    cx.notify();
                }
                cx.stop_propagation();
            }));
        for week in 0_usize..6 {
            let mut row = quietpro::calendar_week(("time-week", week));
            for n in 0..7 {
                let date = start + Days::new((7 * week + n) as u64);
                row = row.child(
                    quietpro::calendar_day(
                        SharedString::from(format!("time-day-{date}")),
                        date.to_string(),
                        date.day(),
                        quietpro::CalendarDayState {
                            enabled: (1..=9999).contains(&date.year()),
                            selected: self.selected == date,
                            active: self.active == date,
                            keyboard: self.grid_focus.is_focused(win)
                                && win.last_input_was_keyboard(),
                            outside_month: date.month() != first.month(),
                            today: date == today,
                            ..Default::default()
                        },
                        c,
                    )
                    .on_click(cx.listener(move |t, _, _, cx| {
                        t.select(date, cx);
                    })),
                );
            }
            grid = grid.child(row);
        }
        quietpro::calendar_surface(c)
            .child(quietpro::calendar_month_header(
                self.month_button(false, cx),
                format_text(
                    self.locale,
                    "date.calendarMonth",
                    &[
                        ("year", first.year().to_string()),
                        ("month", first.month().to_string()),
                    ],
                ),
                self.month_button(true, cx),
            ))
            .child(quietpro::calendar_weekdays(
                std::array::from_fn(|day| {
                    format_text(
                        self.locale,
                        "date.calendarWeekday",
                        &[("day", day.to_string())],
                    )
                }),
                c,
            ))
            .child(grid)
    }
}

#[cfg(all(test, feature = "test-support"))]
mod tests {
    use super::{Locale, NaiveDate, Palette, Picker};
    use gpui_kit::{AppContext, TestAppContext, WindowOptions, test::TestWindowExt};

    #[gpui_kit::test]
    fn time_field_values_and_chevrons_align_to_opposite_edges(cx: &mut TestAppContext) {
        use super::{TimeValue, Tools};
        use crate::client::Client;
        use gpui_kit::{Context, Entity, Window, div, prelude::*, px};

        struct TimeFields(Entity<Tools>);
        impl Render for TimeFields {
            fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
                self.0.update(cx, |tools, cx| {
                    let c = Palette::for_scheme(false, "default");
                    let date = NaiveDate::from_ymd_opt(2026, 11, 22)
                        .unwrap()
                        .and_hms_opt(16, 34, 0)
                        .unwrap();
                    div().flex().flex_col().items_start().children(
                        [
                            ("date", TimeValue::Scheduled(date), 216.),
                            ("limit", TimeValue::Interval(30, 1439), 364.),
                        ]
                        .map(|(id, value, width)| {
                            div()
                                .w(px(width))
                                .flex()
                                .flex_col()
                                .child(tools.time_popover(id, id, value, c, true, cx))
                        }),
                    )
                })
            }
        }

        cx.update(gpui_kit::init);
        let (client, _requests) = Client::test_connection();
        let (handle, _) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |_, cx| {
                let tools = cx.new(|cx| Tools::new(client, None, cx));
                cx.new(|_| TimeFields(tools))
            })
            .unwrap()
        });
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            for (id, width) in [("time-date", 216.), ("time-limit", 364.)] {
                let field = win.find(id).bounds();
                let caption = win.within(id).find("caption").bounds();
                let arrow = win.within(id).find("chevron").bounds();
                assert_eq!(field.size.width, px(width));
                assert_eq!(caption.left() - field.left(), px(12.));
                assert_eq!(field.right() - arrow.right(), px(13.));
            }
        })
        .unwrap();
    }

    #[gpui_kit::test]
    fn keyboard_date_selection_across_month_boundaries(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        let (handle, picker) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |win, cx| {
                cx.new(|cx| {
                    let value = NaiveDate::from_ymd_opt(2028, 2, 28)
                        .unwrap()
                        .and_hms_opt(18, 22, 0)
                        .unwrap();
                    let grid_focus = cx.focus_handle();
                    win.focus(&grid_focus, cx);
                    Picker {
                        selected: value.date(),
                        active: value.date(),
                        grid_focus,
                        locale: Locale::EnUs,
                        colors: Palette::for_scheme(false, "default"),
                    }
                })
            })
            .unwrap()
        });
        cx.update_window(handle, |_, win, cx| {
            win.render_frame(cx);
            for expected in ["2028-02-29", "2028-03-01"] {
                win.press("right", cx);
                win.press("enter", cx);
                win.render_frame(cx);
                assert_eq!(picker.read(cx).selected.to_string(), expected);
            }
        })
        .unwrap();
    }
}
