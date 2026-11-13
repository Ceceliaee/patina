use gpui_kit::{base::Button, prelude::*, *};
use quietpro::{Icon, Palette, continuous_corner_layer, glyph};

const GROUP: &str = "sidebar-navigation-item";
const RADIUS: f32 = 12.;

pub(super) fn navigation_item(
    id: &'static str,
    label: String,
    icon: Icon,
    show_label: bool,
    selected: bool,
    colors: Palette,
) -> Button {
    let ink = if selected {
        colors.accent
    } else {
        colors.secondary
    };
    let face = div()
        .id("face")
        .absolute()
        .inset_0()
        .text_color(if selected {
            colors.hover
        } else {
            colors.canvas
        })
        .when(!selected, |s| {
            s.group_hover(GROUP, move |s| s.text_color(colors.chrome))
                .group_active(GROUP, move |s| s.text_color(colors.track))
        })
        .child(continuous_corner_layer(px(RADIUS), px(1.)));
    Button::new(id)
        .accessibility_label(label.clone())
        .selected(selected)
        .group(GROUP)
        .relative()
        .flex()
        .flex_none()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(4.))
        .px(px(4.))
        .w_full()
        .h(px(40.))
        .cursor_pointer()
        .text_color(if selected {
            colors.hover
        } else {
            colors.canvas
        })
        .focus_visible(move |s| s.text_color(colors.accent))
        .child(continuous_corner_layer(px(RADIUS), px(0.)))
        .child(face)
        .child(glyph(icon, ink).size(px(if show_label { 16. } else { 20. })))
        .when(show_label, |s| {
            s.child(
                div()
                    .max_w_full()
                    .truncate()
                    .text_size(px(12.))
                    .line_height(px(16.))
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(ink)
                    .child(label),
            )
        })
}
