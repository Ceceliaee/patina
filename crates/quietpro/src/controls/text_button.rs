use crate::{ControlSize, continuous_corner_layer, theme::Palette};
use gpui_kit::{
    ElementId, HighlightStyle, SharedString, StyledText, Svg, base::Button, div, prelude::*, px,
    transparent_black,
};
use std::ops::Range;

const BUTTON_GROUP: &str = "quietpro-text-button";
const CORNER_RADIUS: f32 = 12.;

pub trait ButtonSizeExt {
    fn control_size(self, size: ControlSize) -> Self;
}

impl ButtonSizeExt for Button {
    fn control_size(self, size: ControlSize) -> Self {
        self.min_h(size.height()).h(size.height())
    }
}

pub fn text_button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    colors: Palette,
    enabled: bool,
) -> Button {
    let label = label.into();
    build_text_button(id, label.clone(), colors, enabled, None, label)
}

pub fn text_button_with_icon(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    colors: Palette,
    enabled: bool,
    icon: Svg,
    highlights: impl IntoIterator<Item = (Range<usize>, HighlightStyle)>,
) -> Button {
    let label = label.into();
    let mut caption = StyledText::new(label.clone());
    if enabled {
        caption = caption.with_highlights(highlights);
    }
    build_text_button(id, label, colors, enabled, Some(icon), caption)
}

fn build_text_button(
    id: impl Into<ElementId>,
    label: SharedString,
    colors: Palette,
    enabled: bool,
    icon: Option<Svg>,
    content: impl IntoElement,
) -> Button {
    let face = div()
        .id("face")
        .absolute()
        .inset_0()
        .text_color(colors.panel)
        .when(enabled, |s| {
            s.group_active(BUTTON_GROUP, move |s| s.text_color(colors.track))
        })
        .child(continuous_corner_layer(px(CORNER_RADIUS), px(1.)));
    let caption = div()
        .id("caption")
        .border_1()
        .border_color(transparent_black())
        .text_color(if enabled {
            colors.secondary
        } else {
            colors.disabled_text
        })
        .when(enabled, |s| {
            s.group_hover(BUTTON_GROUP, move |s| s.text_color(colors.text))
                .group_active(BUTTON_GROUP, move |s| s.text_color(colors.text))
        })
        .when_some(icon, |s, icon| {
            s.flex().items_center().gap(px(8.)).child(
                icon.flex_none()
                    .size(px(14.))
                    .when(!enabled, |s| s.text_color(colors.disabled_text)),
            )
        })
        .child(content);
    Button::new(id)
        .accessibility_label(label)
        .disabled(!enabled)
        .group(BUTTON_GROUP)
        .relative()
        .min_h(ControlSize::Large.height())
        .px(px(super::CONTROL_HORIZONTAL_PADDING))
        .text_size(px(14.))
        .line_height(px(20.))
        .font_weight(gpui_kit::FontWeight::BOLD)
        .text_color(colors.border)
        .whitespace_nowrap()
        .when(enabled, |button| {
            button
                .cursor_pointer()
                .hover(move |s| s.text_color(colors.border_strong))
                .focus_visible(move |s| s.text_color(colors.secondary))
        })
        .child(continuous_corner_layer(px(CORNER_RADIUS), px(0.)))
        .child(face)
        .child(caption)
}
