use crate::{Palette, continuous_corner_layer};
use gpui_kit::{prelude::*, *};

const ROW_HEIGHT: f32 = 48.;
const ROW_RADIUS: f32 = 12.;

pub struct DistributionValue {
    pub label: String,
    pub ratio: f32,
    pub color: Rgba,
}

pub fn distribution_row(
    id: impl Into<ElementId>,
    name: String,
    name_content: impl IntoElement,
    value: DistributionValue,
    mark: impl IntoElement,
    c: Palette,
) -> Stateful<Div> {
    let DistributionValue {
        label: value,
        ratio,
        color,
    } = value;
    let ratio = if ratio.is_finite() {
        ratio.clamp(0., 1.)
    } else {
        0.
    };
    div()
        .id(id)
        .relative()
        .flex()
        .flex_col()
        .justify_start()
        .flex_none()
        .w_full()
        .min_w_0()
        .h(px(ROW_HEIGHT))
        .px(px(8.))
        .pt(px(8.))
        .text_color(transparent_black())
        .child(continuous_corner_layer(px(ROW_RADIUS), px(0.)))
        .child(crate::continuous_corner_fill(
            px(ROW_RADIUS),
            px(1.),
            c.panel,
        ))
        .child(
            div()
                .relative()
                .flex()
                .flex_col()
                .w_full()
                .min_w_0()
                .gap(px(4.))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .h(px(20.))
                        .gap(px(8.))
                        .text_color(c.text)
                        .text_size(px(14.))
                        .line_height(px(20.))
                        .font_weight(FontWeight::NORMAL)
                        .child(div().flex_none().flex().items_center().child(mark))
                        .child(
                            div()
                                .id("name")
                                .role(Role::Label)
                                .aria_value(name.clone())
                                .flex_1()
                                .min_w_0()
                                .truncate()
                                .child(name_content),
                        )
                        .child(
                            div()
                                .id("value")
                                .role(Role::Label)
                                .aria_value(value.clone())
                                .flex_none()
                                .whitespace_nowrap()
                                .text_size(px(12.))
                                .text_color(c.secondary)
                                .child(value),
                        ),
                )
                .child(
                    div()
                        .w_full()
                        .h(px(4.))
                        .flex_none()
                        .rounded_full()
                        .overflow_hidden()
                        .bg(c.panel.blend(c.secondary.opacity(0.05)))
                        .child(div().h_full().w(relative(ratio)).rounded_full().bg(color)),
                ),
        )
}
