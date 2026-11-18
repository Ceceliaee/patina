use crate::Palette;
use gpui_kit::{prelude::*, *};

pub fn color_swatch_button(
    id: impl Into<ElementId>,
    name: impl Into<SharedString>,
    color: Rgba,
    enabled: bool,
    c: Palette,
) -> gpui_kit::base::Button {
    let needs_outline = (color.r - c.panel.r)
        .abs()
        .max((color.g - c.panel.g).abs())
        .max((color.b - c.panel.b).abs())
        < 0.15;
    super::icon_control::control_surface(
        gpui_kit::base::Button::new(id)
            .accessibility_label(name)
            .disabled(!enabled),
        c,
        !enabled,
    )
    .child(
        div()
            .size(px(12.))
            .rounded_full()
            .bg(color)
            .when(needs_outline, |dot| {
                dot.border_1().border_color(c.text.opacity(0.35))
            }),
    )
}

pub fn color_plane(
    surface: Stateful<Div>,
    hue: f32,
    saturation: f32,
    brightness: f32,
    value: Rgba,
    c: Palette,
) -> Stateful<Div> {
    surface
        .aspect_ratio(16. / 10.)
        .flex_none()
        .child(crate::continuous_corner_fill(
            px(12.),
            px(0.),
            linear_gradient(
                90.,
                linear_color_stop(rgb(0xffffff), 0.),
                linear_color_stop(hsla(hue, 1., 0.5, 1.), 1.),
            ),
        ))
        .child(crate::continuous_corner_fill(
            px(12.),
            px(0.),
            linear_gradient(
                180.,
                linear_color_stop(transparent_black(), 0.),
                linear_color_stop(rgb(0), 1.),
            ),
        ))
        .child(
            div()
                .absolute()
                .left(relative(saturation))
                .top(relative(1. - brightness))
                .ml(px(-6.))
                .mt(px(-6.))
                .size(px(12.))
                .rounded_full()
                .shadow_sm()
                .border_2()
                .border_color(rgb(0xffffff))
                .bg(value),
        )
        .rounded(px(12.))
        .focus_visible(|s| {
            s.shadow(vec![
                BoxShadow::new(px(0.), px(0.), c.secondary.into()).spread_radius(px(1.)),
            ])
        })
}

pub fn hue_strip(surface: Stateful<Div>, hue: f32, c: Palette) -> Stateful<Div> {
    surface
        .h(px(28.))
        .flex()
        .items_center()
        .px(px(6.))
        .child(
            div()
                .relative()
                .w_full()
                .h(px(8.))
                .child(
                    canvas(
                        |_, _, _| (),
                        |bounds, (), window, _| {
                            // Paint adjacent gradients directly; parent overflow does not
                            // clip child backgrounds to rounded corners in GPUI.
                            for i in 0..6 {
                                let start = i as f32 / 6.;
                                let end = (i + 1) as f32 / 6.;
                                let segment = Bounds::new(
                                    point(bounds.left() + bounds.size.width * start, bounds.top()),
                                    size(bounds.size.width / 6., bounds.size.height),
                                );
                                let radius = bounds.size.height * 0.5;
                                let corners = Corners {
                                    top_left: if i == 0 { radius } else { px(0.) },
                                    bottom_left: if i == 0 { radius } else { px(0.) },
                                    top_right: if i == 5 { radius } else { px(0.) },
                                    bottom_right: if i == 5 { radius } else { px(0.) },
                                };
                                window.paint_quad(
                                    fill(
                                        segment,
                                        linear_gradient(
                                            90.,
                                            linear_color_stop(hsla(start, 1., 0.5, 1.), 0.),
                                            linear_color_stop(hsla(end, 1., 0.5, 1.), 1.),
                                        ),
                                    )
                                    .corner_radii(corners),
                                );
                            }
                        },
                    )
                    .absolute()
                    .size_full(),
                )
                .child(
                    div()
                        .absolute()
                        .left(relative(hue))
                        .ml(px(-6.))
                        .top(px(-2.))
                        .size(px(12.))
                        .rounded_full()
                        .shadow_sm()
                        .border_2()
                        .border_color(rgb(0xffffff))
                        .bg(hsla(hue, 1., 0.5, 1.)),
                ),
        )
        .rounded(px(12.))
        .focus_visible(|s| {
            s.shadow(vec![
                BoxShadow::new(px(0.), px(0.), c.secondary.into()).spread_radius(px(1.)),
            ])
        })
}

pub fn color_picker_surface(c: Palette) -> Div {
    crate::continuous_frame(px(16.), c.border, c.panel)
        .w(px(280.))
        .p(px(17.))
        .flex()
        .flex_col()
        .gap(px(12.))
        .text_color(c.text)
}
