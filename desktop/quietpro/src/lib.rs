//! Quiet Pro controls shared by Patina's native views.
use gpui_kit::{Rgba, prelude::*, px};

mod continuous_corner;
mod controls;
mod theme;

pub use continuous_corner::continuous_corner_layer;
pub use controls::icon_control::IconControl;
pub use controls::text_button::text_button;
pub use theme::Palette;

pub use gpui_kit::assets::IconName as Icon;

gpui_kit::assets::icon_assets!(pub QuietProAssets, [Bell, ToolCase, Tags, ZoomIn, Expand, Settings2, Info, AppWindow, Pencil, Palette, Type, EyeOff, Check, Sparkles, ChartColumn, Clock, Menu, Layers, Maximize2, Minimize2, Minus, Monitor, Pin, SquareArrowOutUpRight, X]);

pub fn glyph(icon: Icon, color: Rgba) -> gpui_kit::Svg {
    gpui_kit::svg()
        .path(icon.path())
        .flex_none()
        .size(px(14.))
        .text_color(color)
}

pub fn caption(label: impl Into<gpui_kit::SharedString>, colors: Palette) -> gpui_kit::Div {
    gpui_kit::div()
        .text_size(px(12.))
        .text_color(colors.secondary)
        .child(label.into())
}
