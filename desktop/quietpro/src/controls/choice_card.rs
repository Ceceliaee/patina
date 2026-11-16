use crate::SETTINGS_ROW_HEIGHT;
use gpui_kit::{prelude::*, *};

pub fn choice_card(
    id: impl Into<ElementId>,
    name: impl Into<SharedString>,
    selected: bool,
    enabled: bool,
    c: crate::Palette,
) -> gpui_kit::base::Button {
    const GROUP: &str = "quietpro-choice-card";
    const RADIUS: f32 = 16.;
    gpui_kit::base::Button::new(id)
        .accessibility_label(name)
        .disabled(!enabled)
        .group(GROUP)
        .relative()
        .flex()
        .items_center()
        .w_full()
        .min_w_0()
        .flex_none()
        .h(px(SETTINGS_ROW_HEIGHT))
        .px(px(crate::CONTENT_INSET))
        .text_color(c.border)
        .when(enabled, |b| {
            b.cursor_pointer()
                .focus_visible(move |s| s.text_color(c.secondary))
        })
        .child(crate::continuous_corner_layer(px(RADIUS), px(0.)))
        .child(crate::continuous_corner_fill(px(RADIUS), px(1.), c.panel))
        .child(
            div()
                .id("feedback")
                .absolute()
                .inset_0()
                .text_color(if selected {
                    c.secondary.opacity(0.08)
                } else {
                    c.secondary.opacity(0.)
                })
                .when(enabled, |s| {
                    s.group_hover(GROUP, move |s| {
                        s.text_color(c.secondary.opacity(if selected { 0.12 } else { 0.04 }))
                    })
                    .group_active(GROUP, move |s| {
                        s.text_color(c.secondary.opacity(if selected { 0.16 } else { 0.08 }))
                    })
                })
                .child(crate::continuous_corner_layer(px(RADIUS), px(1.))),
        )
}

pub fn choice_entry(
    id: impl Into<ElementId>,
    name: impl Into<SharedString>,
    enabled: bool,
    c: crate::Palette,
) -> gpui_kit::base::Button {
    let name = name.into();
    choice_card(id, name.clone(), false, enabled, c).child(
        div()
            .relative()
            .flex()
            .items_center()
            .w_full()
            .min_w_0()
            .gap(px(12.))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .text_size(px(14.))
                    .line_height(px(20.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if enabled { c.text } else { c.disabled_text })
                    .child(name),
            )
            .child(
                crate::glyph(
                    crate::Icon::ChevronRight,
                    if enabled {
                        c.secondary
                    } else {
                        c.disabled_text
                    },
                )
                .size(px(16.)),
            ),
    )
}

pub fn choice_swatches(
    name: impl Into<SharedString>,
    colors: impl IntoIterator<Item = Rgba>,
    enabled: bool,
    c: crate::Palette,
) -> Div {
    div()
        .relative()
        .flex()
        .flex_col()
        .min_w_0()
        .w_full()
        .gap(px(4.))
        .text_color(if enabled { c.text } else { c.disabled_text })
        .text_size(px(12.))
        .line_height(px(16.))
        .child(
            div().flex().gap(px(4.)).children(
                colors
                    .into_iter()
                    .map(|color| div().size(px(12.)).rounded_full().bg(color)),
            ),
        )
        .child(div().truncate().child(name.into()))
}
