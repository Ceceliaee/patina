use crate::{Palette, continuous_corner_layer, continuous_frame};
use gpui_kit::{prelude::*, *};

fn calendar_control_face(c: Palette) -> Rgba {
    c.panel.blend(c.secondary.opacity(0.025))
}

pub fn calendar_controls() -> Div {
    crate::page_actions().gap(px(4.))
}

pub fn calendar_caption(label: impl Into<SharedString>, c: Palette) -> Div {
    continuous_frame(px(12.), c.border, calendar_control_face(c))
        .h(px(28.))
        .min_w(px(80.))
        .px(px(12.))
        .flex_none()
        .items_center()
        .justify_center()
        .text_size(px(14.))
        .line_height(px(20.))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(c.secondary)
        .child(label.into())
}

pub fn calendar_trigger(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    c: Palette,
) -> gpui_kit::base::Button {
    crate::text_button(
        id,
        label,
        Palette {
            panel: calendar_control_face(c),
            ..c
        },
        true,
    )
}

pub fn calendar_arrow_frame(control: impl IntoElement, c: Palette) -> Div {
    continuous_frame(px(28. / 2.), c.border, calendar_control_face(c))
        .size(px(28.))
        .flex_none()
        .p_0()
        .child(control)
}

#[derive(Clone, Copy, Default)]
pub struct CalendarDayState {
    pub enabled: bool,
    pub selected: bool,
    pub in_range: bool,
    pub active: bool,
    pub keyboard: bool,
    pub outside_month: bool,
    pub today: bool,
}

pub fn calendar_surface(c: Palette) -> Div {
    continuous_frame(px(16.), c.border, c.panel)
        .w(px(228.))
        .p(px(16.))
        .flex_col()
        .gap(px(8.))
        .occlude()
}

pub fn calendar_month_header(
    previous: impl IntoElement,
    title: String,
    next: impl IntoElement,
) -> Div {
    div()
        .flex()
        .items_center()
        .h(px(28.))
        .flex_none()
        .gap(px(4.))
        .child(previous)
        .child(
            div()
                .id("calendar-month-title")
                .role(Role::Label)
                .aria_value(title.clone())
                .flex_1()
                .text_center()
                .text_size(px(14.))
                .font_weight(FontWeight::SEMIBOLD)
                .child(title),
        )
        .child(next)
}

pub fn calendar_weekdays(names: [String; 7], c: Palette) -> Div {
    div()
        .flex()
        .h(px(24.))
        .flex_none()
        .children(names.into_iter().map(|name| {
            div()
                .w(px(28.))
                .flex_none()
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(12.))
                .text_color(c.secondary)
                .child(name)
        }))
}

pub fn calendar_week(id: impl Into<ElementId>) -> Stateful<Div> {
    div().id(id).role(Role::Row).flex().h(px(28.)).flex_none()
}

pub fn calendar_day(
    id: impl Into<ElementId>,
    name: String,
    number: u32,
    state: CalendarDayState,
    c: Palette,
) -> gpui_kit::base::Button {
    let face = if state.selected {
        c.panel.blend(c.secondary.opacity(0.08))
    } else if state.in_range {
        c.panel.opacity(0.)
    } else if state.active && state.keyboard {
        c.panel.blend(c.secondary.opacity(0.05))
    } else {
        c.panel
    };
    gpui_kit::base::Button::new(id)
        .disabled(!state.enabled)
        .tab_stop(false)
        .focusable(false)
        .role(Role::GridCell)
        .aria_label(name)
        .aria_selected(state.selected || state.in_range)
        .when(state.active, |d| d.aria_active_descendant())
        .relative()
        .group("quietpro-calendar-day")
        .size(px(28.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .text_color(transparent_black())
        .when(state.enabled, |d| d.cursor_pointer())
        .when(state.enabled, |d| d.hover(move |d| d.text_color(c.border)))
        .child(continuous_corner_layer(px(12.), px(0.)))
        .child(
            div()
                .absolute()
                .inset_0()
                .text_color(face)
                .when(state.enabled && !state.selected, |d| {
                    d.group_hover("quietpro-calendar-day", move |d| {
                        d.text_color(c.panel.blend(c.secondary.opacity(0.03)))
                    })
                })
                .child(continuous_corner_layer(px(12.), px(1.))),
        )
        .child(
            div()
                .text_size(px(12.))
                .line_height(px(16.))
                .font_weight(FontWeight::NORMAL)
                .text_color(if !state.enabled {
                    c.disabled_text
                } else if state.outside_month {
                    c.secondary.opacity(0.6)
                } else {
                    c.text
                })
                .child(number.to_string()),
        )
        .when(state.today, |d| {
            d.child(
                div()
                    .absolute()
                    .bottom(px(2.))
                    .size(px(4.))
                    .rounded_full()
                    .bg(c.secondary),
            )
        })
}

/// A range cell keeps the existing day target while joining adjacent selected dates.
pub fn calendar_range_cell(
    day: impl IntoElement,
    in_range: bool,
    joins_left: bool,
    joins_right: bool,
    c: Palette,
) -> Div {
    div()
        .relative()
        .flex()
        .flex_none()
        .size(px(28.))
        .items_center()
        .justify_center()
        .when(in_range, |d| {
            d.child(
                div()
                    .absolute()
                    .top(px(2.))
                    .bottom(px(2.))
                    .left(if joins_left {
                        relative(0.)
                    } else {
                        relative(0.5)
                    })
                    .right(if joins_right {
                        relative(0.)
                    } else {
                        relative(0.5)
                    })
                    .bg(c.panel.blend(c.secondary.opacity(0.035))),
            )
        })
        .child(day)
}
