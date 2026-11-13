use crate::{continuous_corner_layer, theme::Palette};
use gpui_kit::{ElementId, SharedString, base::Button, div, prelude::*, px, transparent_black};

const BUTTON_GROUP: &str = "quietpro-text-button";
const CORNER_RADIUS: f32 = 12.;

pub fn text_button(
    id: impl Into<ElementId>,
    label: impl Into<SharedString>,
    colors: Palette,
    enabled: bool,
) -> Button {
    let label = label.into();
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
        .child(label.clone());
    Button::new(id)
        .accessibility_label(label)
        .disabled(!enabled)
        .group(BUTTON_GROUP)
        .relative()
        .min_h(px(32.))
        .px(px(12.))
        .text_size(px(14.))
        .line_height(px(20.))
        .font_weight(gpui_kit::FontWeight::SEMIBOLD)
        .text_color(colors.border)
        .whitespace_nowrap()
        .when(enabled, |button| {
            button
                .cursor_pointer()
                .hover(move |s| s.text_color(colors.border_strong))
                .focus_visible(move |s| s.text_color(colors.accent))
        })
        .child(continuous_corner_layer(px(CORNER_RADIUS), px(0.)))
        .child(face)
        .child(caption)
}
