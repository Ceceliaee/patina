use gpui_kit::{Bounds, Pixels, Size, point, px, size};
use windows::Win32::Foundation::RECT;

pub const MINI_PANEL_SIZE_DIP: (f32, f32) = (320., 240.);
const HANDLE_SIZE_DIP: (f32, f32) = (112., 24.);

pub(super) fn logical_dock_bounds(viewport: Size<Pixels>, expanded: bool) -> Bounds<Pixels> {
    let bounds = dock_bounds(
        RECT {
            right: f32::from(viewport.width) as i32,
            bottom: f32::from(viewport.height) as i32,
            ..Default::default()
        },
        expanded,
        1.,
    );
    Bounds {
        origin: point(px(bounds.left as f32), px(bounds.top as f32)),
        size: size(
            px((bounds.right - bounds.left) as f32),
            px((bounds.bottom - bounds.top) as f32),
        ),
    }
}

/// Top-center client bounds, in the same coordinate system as the monitor work area.
pub(super) fn dock_bounds(work: RECT, expanded: bool, scale: f32) -> RECT {
    let (width, height) = if expanded {
        MINI_PANEL_SIZE_DIP
    } else {
        HANDLE_SIZE_DIP
    };
    let scale = if scale.is_finite() && scale > 0. {
        scale
    } else {
        1.
    };
    let extent = |start: i32, end: i32| (i64::from(end) - i64::from(start)).max(1);
    let work_width = extent(work.left, work.right);
    let work_height = extent(work.top, work.bottom);
    let width = ((f64::from(width) * f64::from(scale)).round() as i64).clamp(1, work_width);
    let height = ((f64::from(height) * f64::from(scale)).round() as i64).clamp(1, work_height);
    let offset = ((work_width + 1) / 2 - width / 2).clamp(0, work_width - width);
    let left = i64::from(work.left) + offset;
    RECT {
        left: left as i32,
        top: work.top,
        right: (left + width).min(i64::from(i32::MAX)) as i32,
        bottom: (i64::from(work.top) + height).min(i64::from(i32::MAX)) as i32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn panel_and_handle_are_centered_on_negative_and_vertical_monitors_at_each_scale() {
        for (left, top) in [(0, 40), (-2560, -200), (0, -1440), (i32::MIN, -200)] {
            let work = RECT {
                left,
                top,
                right: left + 2560,
                bottom: top + 1400,
            };
            for scale in [1., 1.25, 1.5, 2.] {
                for (expanded, (width, height)) in [(true, (320., 240.)), (false, (112., 24.))] {
                    let bounds = dock_bounds(work, expanded, scale);
                    assert_eq!(bounds.top, top);
                    assert_eq!(bounds.right - bounds.left, (width * scale).round() as i32);
                    assert_eq!(bounds.bottom - bounds.top, (height * scale).round() as i32);
                    assert_eq!(bounds.left - left, 1280 - (bounds.right - bounds.left) / 2);
                }
            }
        }
    }

    #[test]
    fn small_work_area_clips_both_surfaces_and_invalid_scale_uses_one() {
        let work = RECT {
            left: -111,
            top: -51,
            right: -70,
            bottom: -23,
        };
        for invalid in [0., f32::NAN, -1.] {
            assert_eq!(dock_bounds(work, true, invalid), work);
            let handle = dock_bounds(work, false, invalid);
            assert_eq!(
                handle,
                RECT {
                    bottom: -27,
                    ..work
                }
            );
        }
        assert_eq!(dock_bounds(work, false, 2.), work);
    }
}
