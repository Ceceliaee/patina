use crate::{Icon, Palette, continuous_corner_layer, continuous_frame, divider_color, glyph};
use gpui_kit::{base::Checkbox, prelude::*, *};

pub fn checkbox(
    id: impl Into<ElementId>,
    name: impl Into<SharedString>,
    checked: bool,
    mixed: bool,
    enabled: bool,
    c: Palette,
) -> Checkbox {
    let face = continuous_frame(
        px(8.),
        if enabled { c.border_strong } else { c.border },
        if checked || mixed { c.track } else { c.panel },
    )
    .size(px(16.))
    .flex_none()
    .items_center()
    .justify_center()
    .when(checked || mixed, |d| {
        d.child(
            glyph(
                if mixed { Icon::Minus } else { Icon::Check },
                if enabled {
                    c.secondary
                } else {
                    c.disabled_text
                },
            )
            .size(px(12.)),
        )
    });
    Checkbox::new(id)
        .accessibility_label(name)
        .checked(checked)
        .indeterminate(mixed)
        .disabled(!enabled)
        .relative()
        .size(px(28.))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .text_color(transparent_black())
        .when(enabled, |s| {
            s.cursor_pointer()
                .focus_visible(move |s| s.text_color(c.secondary))
        })
        .child(continuous_corner_layer(px(14.), px(0.)))
        .child(
            div()
                .absolute()
                .inset_0()
                .text_color(c.panel)
                .child(continuous_corner_layer(px(14.), px(1.))),
        )
        .child(face)
}

/// First and last rows omit their outer inset. Separators stay inside the row.
pub fn field_row(index: usize, count: usize, c: Palette) -> Div {
    let top = if index == 0 { 0. } else { 4. };
    let bottom = if index + 1 == count { 0. } else { 4. };
    div()
        .relative()
        .w_full()
        .min_w_0()
        .flex_none()
        .flex()
        .items_center()
        .gap(px(8.))
        .h(px(28. + top + bottom))
        .px(px(12.))
        .pt(px(top))
        .pb(px(bottom))
        .when(index > 0, |row| {
            row.child(
                div()
                    .absolute()
                    .top_0()
                    .left(px(12.))
                    .right(px(12.))
                    .h(px(1.))
                    .bg(divider_color(c)),
            )
        })
}
