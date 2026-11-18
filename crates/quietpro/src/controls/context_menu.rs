use crate::Palette;
use gpui_kit::{prelude::*, *};

pub const MENU_FRAME_INSET: f32 = 5.;
const FRAME_RADIUS: f32 = 16.;
const ITEM_RADIUS: f32 = 12.;
fn surface(radius: f32, inset: f32, color: Rgba) -> Div {
    div()
        .absolute()
        .inset_0()
        .text_color(color)
        .child(crate::continuous_corner_layer(px(radius), px(inset)))
}

pub fn menu_width(win: &Window, name: &str, arrow: bool) -> Pixels {
    let mut run = win.text_style().to_run(name.len());
    run.font.weight = FontWeight::MEDIUM;
    let width = win
        .text_system()
        .shape_line(name.to_owned().into(), px(12.), &[run], None)
        .width;
    let total = f32::from(width) + 2. * MENU_FRAME_INSET + 16. + if arrow { 20. } else { 0. };
    px((total / 4.).ceil() * 4.)
}
pub fn menu_item(
    id: impl Into<ElementId>,
    name: String,
    active: bool,
    selected: bool,
    colors: Palette,
) -> Stateful<Div> {
    let hover_fill = colors.panel.blend(colors.secondary.opacity(0.03));
    let selected_fill = colors.panel.blend(colors.secondary.opacity(0.055));

    div()
        .id(id)
        .role(Role::MenuItem)
        .aria_label(name.clone())
        .when(active, |s| s.aria_active_descendant())
        .relative()
        .text_color(if selected {
            selected_fill
        } else if active {
            hover_fill
        } else {
            colors.panel
        })
        .h(px(28.))
        .flex_none()
        .px(px(8.))
        .flex()
        .items_center()
        .gap(px(8.))
        .cursor_pointer()
        .when(!selected, |s| s.hover(move |s| s.text_color(hover_fill)))
        .child(crate::continuous_corner_layer(px(ITEM_RADIUS), px(0.)))
        .child(
            div()
                .text_color(colors.text)
                .text_size(px(12.))
                .font_weight(FontWeight::MEDIUM)
                .whitespace_nowrap()
                .child(name),
        )
}
pub fn menu_surface(
    id: impl Into<ElementId>,
    name: String,
    width: Pixels,
    colors: Palette,
) -> Stateful<Div> {
    div()
        .id(id)
        .role(Role::Menu)
        .aria_label(name)
        .relative()
        .flex()
        .flex_col()
        .p(px(MENU_FRAME_INSET))
        .w(width)
        .text_size(px(12.))
        .gap_0()
        .occlude()
        .child(surface(FRAME_RADIUS, 0., colors.border))
        .child(surface(FRAME_RADIUS, 1., colors.panel))
        .on_any_mouse_down(|_, win, cx| {
            win.prevent_default();
            cx.stop_propagation();
        })
}
