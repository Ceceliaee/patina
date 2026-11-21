use gpui_kit::{
    Background, Bounds, PathBuilder, Pixels, Point, Rgba, Window, canvas, point, prelude::*, px,
};
use std::{f32::consts::FRAC_PI_2, sync::LazyLock};

const CORNER_EXPONENT: f32 = 4.;
const QUARTER: usize = 9;

static ARC: LazyLock<[(f32, f32); QUARTER]> = LazyLock::new(|| {
    std::array::from_fn(|i| {
        let angle = FRAC_PI_2 * i as f32 / (QUARTER - 1) as f32;
        let (y, x) = angle.sin_cos();
        let scale = (x.abs().powf(CORNER_EXPONENT) + y.abs().powf(CORNER_EXPONENT))
            .powf(-1. / CORNER_EXPONENT);
        (x * scale, y * scale)
    })
});

/// Paints a continuous corner layer in the inherited text color. The inset follows the outer contour.
pub fn continuous_corner_layer(radius: Pixels, inset: Pixels) -> impl IntoElement {
    layer(radius, inset, None)
}

/// Paints a solid or gradient fill using the same continuous contour as other controls.
pub fn continuous_corner_fill(
    radius: Pixels,
    inset: Pixels,
    fill: impl Into<Background>,
) -> impl IntoElement {
    layer(radius, inset, Some(fill.into()))
}

fn layer(radius: Pixels, inset: Pixels, fill: Option<Background>) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            let fill = fill.unwrap_or_else(|| window.text_style().color.into());
            paint_corner(bounds, radius, inset, fill, window);
        },
    )
    .absolute()
    .inset_0()
}

pub(crate) fn paint_frame(
    bounds: Bounds<Pixels>,
    radius: Pixels,
    border: Rgba,
    fill: Rgba,
    window: &mut Window,
) {
    paint_corner(bounds, radius, px(0.), border.into(), window);
    paint_corner(bounds, radius, px(1.), fill.into(), window);
}

fn paint_corner(
    bounds: Bounds<Pixels>,
    radius: Pixels,
    inset: Pixels,
    fill: Background,
    window: &mut Window,
) {
    if bounds.intersect(&window.content_mask().bounds).is_empty() {
        return;
    }
    let Some(points) = corner_points(bounds, radius, inset) else {
        return;
    };
    let mut path = PathBuilder::fill();
    path.add_polygon(&points, true);
    if let Ok(path) = path.build() {
        window.paint_path(path, fill);
    }
}

pub(crate) fn corner_points(
    bounds: Bounds<Pixels>,
    radius: Pixels,
    inset: Pixels,
) -> Option<[Point<Pixels>; 4 * QUARTER]> {
    let bounds = bounds.inset(inset);
    if bounds.size.width <= px(0.) || bounds.size.height <= px(0.) {
        return None;
    }
    let radius = (radius - inset).clamp(px(0.), bounds.size.width.min(bounds.size.height) * 0.5);
    Some(std::array::from_fn(|i| {
        let (x, y) = ARC[i % QUARTER];
        let dx = radius * (1. - x);
        let dy = radius * (1. - y);
        match i / QUARTER {
            0 => point(bounds.right() - dy, bounds.top() + dx),
            1 => point(bounds.right() - dx, bounds.bottom() - dy),
            2 => point(bounds.left() + dy, bounds.bottom() - dx),
            _ => point(bounds.left() + dx, bounds.top() + dy),
        }
    }))
}
