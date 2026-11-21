use crate::{Palette, continuous_frame};
use gpui_kit::{Div, prelude::*, px};

/// Non-modal feedback surface; the host owns placement, content and dismissal.
pub fn toast_surface(colors: Palette) -> Div {
    continuous_frame(px(12.), colors.border, colors.panel)
        .flex()
        .items_center()
        .gap(px(8.))
        .px(px(12.))
        .min_h(px(32.))
        .max_w(px(360.))
        .text_size(px(12.))
        .line_height(px(20.))
        .text_color(colors.text)
}
