use crate::{Palette, continuous_corner_fill};
use gpui_kit::{Div, Rgba, div, linear_color_stop, linear_gradient, prelude::*, px};
use gpui_kit::{ElementId, Image, Role, SharedString, Stateful, img};
use std::sync::Arc;

const FRAME_SIZE: f32 = 40.;
const COLOR_EDGE: f32 = 2.;
const CORNER_RADIUS: f32 = 16.;

pub const UNFRAMED_APP_ICON_SIZE: f32 = 16.;

pub fn unframed_app_icon(
    id: impl Into<ElementId>,
    name: impl Into<SharedString>,
    image: Option<Arc<Image>>,
    fallback: crate::Icon,
    colors: Palette,
) -> Stateful<Div> {
    let content = if let Some(image) = image {
        img(image)
            .size(px(UNFRAMED_APP_ICON_SIZE))
            .object_fit(gpui_kit::ObjectFit::Contain)
            .into_any_element()
    } else {
        crate::glyph(fallback, colors.secondary)
            .size(px(UNFRAMED_APP_ICON_SIZE))
            .into_any_element()
    };
    div()
        .id(id)
        .role(Role::Image)
        .aria_label(name)
        .size(px(UNFRAMED_APP_ICON_SIZE))
        .flex_none()
        .child(content)
}

pub fn unframed_app_icon_button(
    id: impl Into<ElementId>,
    name: impl Into<SharedString>,
    colors: Palette,
) -> gpui_kit::base::Button {
    gpui_kit::base::Button::new(id)
        .accessibility_label(name)
        .size(px(UNFRAMED_APP_ICON_SIZE))
        .flex_none()
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .rounded(px(4.))
        .focus_visible(move |s| s.border_1().border_color(colors.secondary))
}

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
