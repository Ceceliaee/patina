use crate::{Palette, continuous_corner_fill};
use gpui_kit::{Div, Rgba, div, linear_color_stop, linear_gradient, prelude::*, px};

const FRAME_SIZE: f32 = 40.;
const COLOR_EDGE: f32 = 2.;
const CORNER_RADIUS: f32 = 16.;

/// Application identity frame; the caller supplies the icon and its existing interactions.
pub fn app_icon_frame(color: Rgba, colors: Palette) -> Div {
    div()
        .relative()
        .flex()
        .flex_none()
        .items_center()
        .justify_center()
        .size(px(FRAME_SIZE))
        .child(continuous_corner_fill(
            px(CORNER_RADIUS),
            px(0.),
            colors.panel,
        ))
        .child(continuous_corner_fill(
            px(CORNER_RADIUS),
            px(0.),
            linear_gradient(
                180.,
                linear_color_stop(color.opacity(0.12), 0.),
                linear_color_stop(color.opacity(0.20), 1.),
            ),
        ))
        .child(continuous_corner_fill(
            px(CORNER_RADIUS),
            px(COLOR_EDGE),
            colors.panel,
        ))
}
