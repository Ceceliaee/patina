use crate::{Palette, continuous_corner_layer};
use gpui_kit::{Div, Pixels, Size, div, prelude::*, px, rgba};

const RADIUS: f32 = 16.;
pub const DIALOG_FRAME_INSET: f32 = 17.;
pub const DIALOG_WINDOW_MARGIN: f32 = 24.;
const MIN_WIDTH: f32 = 280.;

/// Content-sized dialog surface. The caller owns body scrolling and task actions.
pub fn dialog_surface(colors: Palette, viewport: Size<Pixels>) -> Div {
    let available_width = (viewport.width - px(DIALOG_WINDOW_MARGIN * 2.)).max(px(0.));
    let layer = |inset, color| {
        div()
            .absolute()
            .inset_0()
            .text_color(color)
            .child(continuous_corner_layer(px(RADIUS), px(inset)))
    };
    div()
        .relative()
        .flex()
        .flex_col()
        .min_w(px(MIN_WIDTH).min(available_width))
        .max_w(available_width)
        .min_h_0()
        .max_h((viewport.height - px(DIALOG_WINDOW_MARGIN * 2.)).max(px(0.)))
        .p(px(DIALOG_FRAME_INSET))
        .gap(px(12.))
        .child(layer(0., colors.border))
        .child(layer(1., colors.panel))
}

pub fn dialog_backdrop() -> Div {
    div().size_full().bg(rgba(0x00000033))
}

pub fn dialog_actions() -> Div {
    div()
        .flex()
        .flex_none()
        .flex_wrap()
        .justify_end()
        .items_center()
        .gap(px(8.))
        .mt(px(4.))
}
