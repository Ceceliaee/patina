use gpui_kit::{prelude::*, *};

pub(super) fn paint_dots(
    bounds: Bounds<Pixels>,
    color: Rgba,
    window: &mut Window,
    contains: impl Fn(Point<f32>) -> bool,
) {
    let mut y = 3.;
    while y < f32::from(bounds.size.height) {
        let mut x = 3.;
        while x < f32::from(bounds.size.width) {
            if contains(point(x, y)) {
                window.paint_quad(
                    fill(
                        Bounds::new(
                            bounds.origin + point(px(x - 0.7), px(y - 0.7)),
                            size(px(1.4), px(1.4)),
                        ),
                        color.opacity(0.35),
                    )
                    .corner_radii(px(0.7)),
                );
            }
            x += 6.;
        }
        y += 6.;
    }
}

pub fn dot_pattern(color: Rgba) -> impl IntoElement {
    canvas(
        |_, _, _| {},
        move |bounds, _, window, _| {
            paint_dots(bounds, color, window, |_| true);
        },
    )
    .absolute()
    .inset_0()
    .size_full()
}
