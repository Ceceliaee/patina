use gpui_kit::{PathBuilder, canvas, point, prelude::*, px};
use std::{f32::consts::TAU, sync::LazyLock};

// Polar radius of |x|^4 + |y|^4 = 1, sampled at equal angles.
static CONTOUR: LazyLock<[(f32, f32); 64]> = LazyLock::new(|| {
    std::array::from_fn(|i| {
        let (y, x) = (TAU * i as f32 / 64.).sin_cos();
        let radius = (x.powi(4) + y.powi(4)).sqrt().sqrt().recip();
        (x * radius, y * radius)
    })
});

pub(crate) fn superellipse_layer(outline: bool) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            let color = window.text_style().color;
            if color.a == 0. {
                return;
            }
            let (bounds, mut path) = if outline {
                (bounds.inset(px(0.5)), PathBuilder::stroke(px(1.)))
            } else {
                (bounds, PathBuilder::fill())
            };
            let center = bounds.center();
            let points = CONTOUR.map(|(x, y)| {
                point(
                    center.x + bounds.size.width * (0.5 * x),
                    center.y + bounds.size.height * (0.5 * y),
                )
            });
            path.add_polygon(&points, true);
            if let Ok(path) = path.build() {
                window.paint_path(path, color);
            }
        },
    )
    .absolute()
    .inset_0()
}
