use crate::{Icon, SETTINGS_ROW_HEIGHT, content_card, heading};
use gpui_kit::{prelude::*, *};

pub fn settings_row() -> Div {
    div()
        .flex()
        .items_center()
        .h(px(SETTINGS_ROW_HEIGHT))
        .flex_none()
}

pub fn settings_row_label(name: impl Into<SharedString>) -> Stateful<Div> {
    row_label(name).font_weight(FontWeight::MEDIUM)
}

pub(super) fn row_label(name: impl Into<SharedString>) -> Stateful<Div> {
    let name = name.into();
    div()
        .id(name.clone())
        .role(Role::Label)
        .aria_value(name.clone())
        .text_size(px(14.))
        .child(name)
}

// The frame is painted inside the card. Its edge belongs to the first and last rows.
pub fn settings_rows_card(c: crate::Palette) -> Div {
    content_card(c.border, c.canvas).py_0()
}

pub fn divider_color(c: crate::Palette) -> Rgba {
    c.border.opacity(0.65)
}

pub fn vertical_divider(c: crate::Palette) -> Div {
    div().flex_none().w(px(1.)).h(px(28.)).bg(divider_color(c))
}

pub fn line_above(row: Div, c: crate::Palette, offset: f32) -> Div {
    row.relative().child(
        div()
            .absolute()
            .left_0()
            .right_0()
            .top(px(-offset))
            .h(px(1.))
            .bg(divider_color(c)),
    )
}

pub fn settings_title(c: crate::Palette, icon: Icon, title: String) -> Div {
    div()
        .relative()
        .flex()
        .items_center()
        .gap(px(8.))
        .child(crate::glyph(icon, c.accent).size(px(16.)))
        .child(heading(title).aria_level(2).line_height(px(24.)).flex_1())
        .child(section_rule(c))
}

pub fn section_rule(c: crate::Palette) -> Div {
    div()
        .absolute()
        .left_0()
        .right_0()
        .bottom(px(-4.))
        .h(px(1.))
        .bg(divider_color(c))
}
