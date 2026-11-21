use super::HEATMAP_CELL_SIZE;
use crate::continuous_corner::{corner_points, paint_frame};
use gpui_kit::*;
use std::{fmt::Write, sync::OnceLock};

// All dates of a given size share the same two alpha masks in GPUI's sprite atlas.
// A quarter DIP step bounds the contour error without keeping a key per resize event.
const STEPS: usize = 4;
const SIZES: usize = HEATMAP_CELL_SIZE as usize * STEPS + 1;
struct Mask {
    key: SharedString,
    svg: String,
}
static MASKS: [OnceLock<[Option<Mask>; 2]>; SIZES] = [const { OnceLock::new() }; SIZES];

fn masks(slot: usize) -> [Option<Mask>; 2] {
    let side = slot as f32 / STEPS as f32;
    let bounds = Bounds::new(Point::default(), size(px(side), px(side)));
    std::array::from_fn(|inset| {
        let points = corner_points(bounds, px(4.), px(inset as f32))?;
        let mut svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{side}" height="{side}" viewBox="0 0 {side} {side}"><path d="M"#
        );
        for point in points {
            write!(svg, "{:.3} {:.3} ", f32::from(point.x), f32::from(point.y)).unwrap();
        }
        svg.push_str(r#"Z"/></svg>"#);
        Some(Mask {
            key: format!("quietpro-heatmap-{slot}-{inset}").into(),
            svg,
        })
    })
}

pub(super) fn cell(
    bounds: Bounds<Pixels>,
    border: Rgba,
    fill: Rgba,
    window: &mut Window,
    cx: &App,
) {
    if bounds.intersect(&window.content_mask().bounds).is_empty() {
        return;
    }
    let width = f32::from(bounds.size.width);
    let slot = (width * STEPS as f32).round() as usize;
    if slot == 0 || slot >= SIZES || (width - f32::from(bounds.size.height)).abs() > 1. {
        return paint_frame(bounds, px(4.), border, fill, window);
    }
    let masks = MASKS[slot].get_or_init(|| masks(slot));
    for (mask, color) in masks.iter().zip([border, fill]) {
        if let Some(mask) = mask
            && window
                .paint_svg(
                    bounds,
                    mask.key.clone(),
                    Some(mask.svg.as_bytes()),
                    TransformationMatrix::unit(),
                    color.into(),
                    cx,
                )
                .is_err()
        {
            paint_frame(bounds, px(4.), border, fill, window);
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::masks;
    use gpui_kit::{DevicePixels, SvgRenderer, SvgSize, size};
    use std::sync::Arc;

    #[test]
    fn masks_fill_the_cell_and_leave_the_one_dip_border_visible() {
        let renderer = SvgRenderer::new(Arc::new(()));
        for logical_side in [6, 9, 12] {
            let side = logical_side * 4;
            for (inset, mask) in masks(side).into_iter().enumerate() {
                let svg = renderer.parse_svg(mask.unwrap().svg.as_bytes()).unwrap();
                let extent = DevicePixels(side as i32);
                let image = renderer
                    .render_parsed(&svg, SvgSize::Size(size(extent, extent)))
                    .unwrap();
                let bytes = image.as_bytes(0).unwrap();
                let alpha = |x: usize, y: usize| bytes[4 * (y * side + x) + 3];
                assert_eq!(alpha(side / 2, side / 2), 255);
                assert_eq!(alpha(0, 0), 0);
                assert_eq!(alpha(side / 2, 1), if inset == 0 { 255 } else { 0 });
                assert_eq!(alpha(side / 2, 5), 255);
            }
        }
    }
}
