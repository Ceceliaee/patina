use gpui_kit::{prelude::*, *};

pub(crate) fn icon(color: Rgba, label: String, icon_size: f32) -> impl IntoElement {
    div()
        .id("anonymous-activity-icon")
        .role(Role::Image)
        .aria_label(label)
        .size(px(icon_size))
        .flex_none()
        .child(
            canvas(
                |_, _, _| {},
                move |b, _, win, _| {
                    let mut previous_alpha = 0.;
                    for step in (1..=44).rev() {
                        let radius = step as f32 / 4. * icon_size / 24.;
                        let t = (step as f32 - 0.5) / 44.;
                        let alpha = if t <= 0.3 {
                            1. - t / 0.3 * 0.05
                        } else if t <= 0.65 {
                            0.95 - (t - 0.3) / 0.35 * 0.45
                        } else {
                            0.5 * (1. - t) / 0.35
                        };
                        let layer_alpha = (alpha - previous_alpha) / (1. - previous_alpha);
                        win.paint_quad(
                            fill(
                                Bounds::new(
                                    b.center() - point(px(radius), px(radius)),
                                    size(px(radius * 2.), px(radius * 2.)),
                                ),
                                color.opacity(layer_alpha),
                            )
                            .corner_radii(px(radius)),
                        );
                        previous_alpha = alpha;
                    }
                },
            )
            .size_full(),
        )
}

pub(crate) fn name(color: Rgba) -> impl IntoElement {
    div().w(px(70.)).h(px(14.)).flex_none().child(
        canvas(
            |_, _, _| {},
            move |b, _, win, _| {
                for x in [1., 25., 69.] {
                    win.paint_quad(
                        fill(
                            Bounds::new(
                                b.origin + point(px(x - 0.75), px(6.25)),
                                size(px(1.5), px(1.5)),
                            ),
                            color,
                        )
                        .corner_radii(px(0.75)),
                    );
                }
                for x in [4., 16., 32., 40., 48., 60.] {
                    win.paint_quad(fill(
                        Bounds::new(b.origin + point(px(x), px(6.25)), size(px(6.), px(1.5))),
                        color,
                    ));
                }
            },
        )
        .size_full(),
    )
}
