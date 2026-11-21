use crate::SETTINGS_ROW_HEIGHT;
use gpui_kit::{prelude::*, *};

const CHOICE_CARD_GROUP: &str = "quietpro-choice-card";

/// Compact object selection with a neutral border and selection feedback.
pub fn object_list_item(
    id: impl Into<ElementId>,
    name: impl Into<SharedString>,
    selected: bool,
    c: crate::Palette,
) -> gpui_kit::base::Button {
    const GROUP: &str = "quietpro-object-list-item";
    gpui_kit::base::Button::new(id)
        .accessibility_label(name)
        .selected(selected)
        .aria_selected(selected)
        .group(GROUP)
        .relative()
        .flex()
        .items_center()
        .w_full()
        .min_w_0()
        .flex_none()
        .h(px(40.))
        .px(px(8.))
        .gap(px(8.))
        .cursor_pointer()
        .text_color(c.border)
        .focus_visible(move |s| s.text_color(c.secondary))
        .child(crate::continuous_corner_layer(px(16.), px(0.)))
        .child(crate::continuous_corner_fill(px(16.), px(1.), c.panel))
        .child(
            div()
                .id("feedback")
                .absolute()
                .inset_0()
                .text_color(c.secondary.opacity(if selected { 0.08 } else { 0. }))
                .group_hover(GROUP, move |s| {
                    s.text_color(c.secondary.opacity(if selected { 0.10 } else { 0.04 }))
                })
                .group_active(GROUP, move |s| s.text_color(c.secondary.opacity(0.12)))
                .child(crate::continuous_corner_layer(px(16.), px(1.))),
        )
}

pub fn choice_card(
    id: impl Into<ElementId>,
    name: impl Into<SharedString>,
    selected: bool,
    enabled: bool,
    c: crate::Palette,
) -> gpui_kit::base::Button {
    const RADIUS: f32 = 16.;
    gpui_kit::base::Button::new(id)
        .accessibility_label(name)
        .disabled(!enabled)
        .group(CHOICE_CARD_GROUP)
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
                    s.group_hover(CHOICE_CARD_GROUP, move |s| {
                        s.text_color(c.secondary.opacity(if selected { 0.12 } else { 0.04 }))
                    })
                    .group_active(CHOICE_CARD_GROUP, move |s| {
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
    entry_button(id, name, enabled, c, c.text, px(12.))
}

pub fn inline_choice_entry(
    id: impl Into<ElementId>,
    name: impl Into<SharedString>,
    enabled: bool,
    c: crate::Palette,
    label_color: Rgba,
) -> gpui_kit::base::Button {
    entry_button(
        id,
        name,
        enabled,
        c,
        label_color,
        px(super::LABEL_ARROW_GAP),
    )
    .w_auto()
    .px(px(1. + super::CONTROL_HORIZONTAL_PADDING))
}

fn entry_button(
    id: impl Into<ElementId>,
    name: impl Into<SharedString>,
    enabled: bool,
    c: crate::Palette,
    label_color: Rgba,
    gap: Pixels,
) -> gpui_kit::base::Button {
    let name = name.into();
    let button = choice_card(id, name.clone(), false, enabled, c)
        .text_size(px(14.))
        .font_weight(FontWeight::MEDIUM);
    button.child(
        div()
            .relative()
            .flex()
            .items_center()
            .w_full()
            .min_w_0()
            .gap(gap)
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .line_height(px(20.))
                    .text_color(if enabled {
                        label_color
                    } else {
                        c.disabled_text
                    })
                    .when(enabled, |s| {
                        s.group_hover(CHOICE_CARD_GROUP, move |s| s.text_color(c.text))
                    })
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
        .text_size(px(14.))
        .font_weight(gpui_kit::FontWeight::MEDIUM)
        .line_height(px(20.))
        .child(
            div().flex().gap(px(4.)).children(
                colors
                    .into_iter()
                    .map(|color| div().size(px(12.)).rounded_full().bg(color)),
            ),
        )
        .child(div().whitespace_nowrap().text_ellipsis().child(name.into()))
}
