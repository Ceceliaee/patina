use crate::domain::window_geometry::{PhysicalPoint, PhysicalRect};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct MonitorAffinity {
    pub name: Option<String>,
    pub work_area: PhysicalRect,
}

impl MonitorAffinity {
    pub fn new(name: Option<String>, work_area: PhysicalRect) -> Self {
        Self {
            name: normalize_monitor_name(name),
            work_area,
        }
    }

    fn stable_key(&self) -> (String, i32, i32, u32, u32) {
        (
            self.name
                .as_deref()
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase(),
            self.work_area.x,
            self.work_area.y,
            self.work_area.width,
            self.work_area.height,
        )
    }
}

fn normalize_monitor_name(name: Option<String>) -> Option<String> {
    name.and_then(|name| {
        let trimmed = name.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

pub fn select_monitor_for_release(
    release_point: PhysicalPoint,
    monitors: &[MonitorAffinity],
) -> Option<usize> {
    select_monitor(
        &PhysicalRect::new(release_point.x, release_point.y, 1, 1),
        monitors,
    )
}

pub fn select_monitor(window_rect: &PhysicalRect, monitors: &[MonitorAffinity]) -> Option<usize> {
    let mut best: Option<(usize, MonitorScore)> = None;

    for (index, monitor) in monitors.iter().enumerate() {
        if !monitor.work_area.is_valid() {
            continue;
        }

        let score = MonitorScore {
            intersection_area: intersection_area(*window_rect, monitor.work_area),
            contains_center: contains_center(monitor.work_area, *window_rect),
            distance_squared: point_to_rect_distance_squared(
                window_rect.center(),
                monitor.work_area,
            ),
            stable_key: monitor.stable_key(),
        };

        let should_replace = best
            .as_ref()
            .map(|(_, current)| score.is_better_than(current))
            .unwrap_or(true);
        if should_replace {
            best = Some((index, score));
        }
    }

    best.map(|(index, _)| index)
}

pub fn match_monitor(saved: &MonitorAffinity, monitors: &[MonitorAffinity]) -> Option<usize> {
    let valid_monitors = monitors
        .iter()
        .enumerate()
        .filter(|(_, monitor)| monitor.work_area.is_valid());

    if let Some(saved_name) = saved.name.as_deref() {
        let mut exact_matches = valid_monitors
            .clone()
            .filter(|(_, monitor)| {
                monitor
                    .name
                    .as_deref()
                    .is_some_and(|name| name.eq_ignore_ascii_case(saved_name))
            })
            .collect::<Vec<_>>();
        exact_matches.sort_by(|(_, left), (_, right)| compare_affinity_match(saved, left, right));
        if let Some((index, _)) = exact_matches.first() {
            return Some(*index);
        }
    }

    let mut exact_geometry_matches = valid_monitors
        .filter(|(_, monitor)| monitor.work_area == saved.work_area)
        .collect::<Vec<_>>();
    exact_geometry_matches
        .sort_by(|(_, left), (_, right)| left.stable_key().cmp(&right.stable_key()));
    exact_geometry_matches.first().map(|(index, _)| *index)
}

#[derive(Debug)]
struct MonitorScore {
    intersection_area: u64,
    contains_center: bool,
    distance_squared: f64,
    stable_key: (String, i32, i32, u32, u32),
}

impl MonitorScore {
    fn is_better_than(&self, other: &Self) -> bool {
        match self.intersection_area.cmp(&other.intersection_area) {
            Ordering::Greater => return true,
            Ordering::Less => return false,
            Ordering::Equal => {}
        }

        match self.contains_center.cmp(&other.contains_center) {
            Ordering::Greater => return true,
            Ordering::Less => return false,
            Ordering::Equal => {}
        }

        if self.intersection_area == 0 {
            match self.distance_squared.total_cmp(&other.distance_squared) {
                Ordering::Less => return true,
                Ordering::Greater => return false,
                Ordering::Equal => {}
            }
        }

        self.stable_key < other.stable_key
    }
}

fn intersection_area(left: PhysicalRect, right: PhysicalRect) -> u64 {
    let overlap_width =
        (left.right().min(right.right()) - i64::from(left.x).max(i64::from(right.x))).max(0);
    let overlap_height =
        (left.bottom().min(right.bottom()) - i64::from(left.y).max(i64::from(right.y))).max(0);

    u64::try_from(overlap_width).unwrap_or(0) * u64::try_from(overlap_height).unwrap_or(0)
}

fn contains_center(container: PhysicalRect, target: PhysicalRect) -> bool {
    let (center_x, center_y) = target.center();
    center_x >= f64::from(container.x)
        && center_x < container.right() as f64
        && center_y >= f64::from(container.y)
        && center_y < container.bottom() as f64
}

fn point_to_rect_distance_squared((point_x, point_y): (f64, f64), rect: PhysicalRect) -> f64 {
    let left = f64::from(rect.x);
    let right = rect.right() as f64;
    let top = f64::from(rect.y);
    let bottom = rect.bottom() as f64;
    let delta_x = if point_x < left {
        left - point_x
    } else if point_x > right {
        point_x - right
    } else {
        0.0
    };
    let delta_y = if point_y < top {
        top - point_y
    } else if point_y > bottom {
        point_y - bottom
    } else {
        0.0
    };

    delta_x.mul_add(delta_x, delta_y * delta_y)
}

fn compare_affinity_match(
    saved: &MonitorAffinity,
    left: &MonitorAffinity,
    right: &MonitorAffinity,
) -> Ordering {
    affinity_geometry_distance(saved.work_area, left.work_area)
        .cmp(&affinity_geometry_distance(
            saved.work_area,
            right.work_area,
        ))
        .then_with(|| left.stable_key().cmp(&right.stable_key()))
}

fn affinity_geometry_distance(saved: PhysicalRect, candidate: PhysicalRect) -> u64 {
    i64::from(saved.x)
        .abs_diff(i64::from(candidate.x))
        .saturating_add(i64::from(saved.y).abs_diff(i64::from(candidate.y)))
        .saturating_add(u64::from(saved.width.abs_diff(candidate.width)))
        .saturating_add(u64::from(saved.height.abs_diff(candidate.height)))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn monitor(name: &str, x: i32, y: i32, width: u32, height: u32) -> MonitorAffinity {
        MonitorAffinity::new(
            Some(name.to_string()),
            PhysicalRect::new(x, y, width, height),
        )
    }

    #[test]
    fn monitor_selection_uses_final_rect_instead_of_source_monitor_state() {
        let monitors = [
            monitor(r"\\.\DISPLAY1", 0, 0, 1920, 1040),
            monitor(r"\\.\DISPLAY2", 1920, 0, 2560, 1392),
        ];
        let final_rect = PhysicalRect::new(2200, 300, 80, 60);

        assert_eq!(select_monitor(&final_rect, &monitors), Some(1));
    }

    #[test]
    fn release_point_owns_the_target_when_the_window_still_straddles_the_source_monitor() {
        let monitors = [
            monitor("primary", 0, 0, 1920, 1040),
            monitor("secondary", 1920, 0, 2560, 1392),
        ];
        let straddling_window = PhysicalRect::new(1840, 300, 96, 72);
        let release_on_secondary = PhysicalPoint::new(1928, 336);

        assert_eq!(select_monitor(&straddling_window, &monitors), Some(0));
        assert_eq!(
            select_monitor_for_release(release_on_secondary, &monitors),
            Some(1)
        );
    }

    #[test]
    fn monitor_selection_handles_negative_and_vertical_origins() {
        let monitors = [
            monitor("primary", 0, 0, 1920, 1040),
            monitor("left", -2560, 100, 2560, 1392),
            monitor("above", 0, -1440, 2560, 1400),
            monitor("below", 0, 1080, 1600, 860),
        ];

        assert_eq!(
            select_monitor(&PhysicalRect::new(-2000, 400, 96, 72), &monitors),
            Some(1)
        );
        assert_eq!(
            select_monitor(&PhysicalRect::new(500, -900, 96, 72), &monitors),
            Some(2)
        );
        assert_eq!(
            select_monitor(&PhysicalRect::new(500, 1300, 96, 72), &monitors),
            Some(3)
        );
    }

    #[test]
    fn monitor_selection_prefers_largest_intersection_then_center() {
        let monitors = [
            monitor("a", 0, 0, 1000, 1000),
            monitor("b", 1000, 0, 1000, 1000),
        ];

        assert_eq!(
            select_monitor(&PhysicalRect::new(940, 100, 200, 100), &monitors),
            Some(1)
        );
        assert_eq!(
            select_monitor(&PhysicalRect::new(900, 100, 200, 100), &monitors),
            Some(1)
        );
    }

    #[test]
    fn monitor_selection_uses_nearest_work_area_across_gaps() {
        let monitors = [
            monitor("left", 0, 0, 1000, 1000),
            monitor("right", 1500, 0, 1000, 1000),
        ];

        assert_eq!(
            select_monitor(&PhysicalRect::new(1320, 400, 50, 50), &monitors),
            Some(1)
        );
    }

    #[test]
    fn monitor_selection_tie_break_is_independent_of_enumeration_order() {
        let window = PhysicalRect::new(1075, 1100, 50, 50);
        let first = [
            monitor("z", 0, 0, 1000, 1000),
            monitor("a", 1200, 1200, 1000, 1000),
        ];
        let reversed = [first[1].clone(), first[0].clone()];

        let first_selected = &first[select_monitor(&window, &first).unwrap()];
        let reversed_selected = &reversed[select_monitor(&window, &reversed).unwrap()];
        assert_eq!(first_selected.name, reversed_selected.name);
    }

    #[test]
    fn monitor_selection_ignores_invalid_work_areas() {
        let monitors = [
            monitor("invalid", 0, 0, 0, 1000),
            monitor("valid", 1000, 0, 1000, 1000),
        ];

        assert_eq!(
            select_monitor(&PhysicalRect::new(10, 10, 50, 50), &monitors),
            Some(1)
        );
        assert_eq!(select_monitor(&PhysicalRect::new(0, 0, 1, 1), &[]), None);
    }

    #[test]
    fn saved_monitor_matches_name_before_geometry() {
        let saved = monitor("display-b", 1920, 0, 2560, 1392);
        let monitors = [
            monitor("display-a", 1920, 0, 2560, 1392),
            monitor("DISPLAY-B", 0, 0, 1920, 1040),
        ];

        assert_eq!(match_monitor(&saved, &monitors), Some(1));
    }

    #[test]
    fn disconnected_saved_monitor_does_not_hijack_the_safe_fallback_chain() {
        let saved = monitor("missing", -2560, 0, 2560, 1392);
        let monitors = [
            monitor("primary", 0, 0, 1920, 1040),
            monitor("other", 1920, 0, 2560, 1392),
        ];

        assert_eq!(match_monitor(&saved, &monitors), None);
    }

    #[test]
    fn renamed_saved_monitor_matches_only_when_its_work_area_is_unchanged() {
        let saved = monitor("old-name", -2560, 0, 2560, 1392);
        let monitors = [
            monitor("primary", 0, 0, 1920, 1040),
            monitor("new-name", -2560, 0, 2560, 1392),
        ];

        assert_eq!(match_monitor(&saved, &monitors), Some(1));
    }

    #[test]
    fn duplicate_monitor_names_use_saved_geometry() {
        let saved = monitor("same-model", 1920, 0, 2560, 1392);
        let monitors = [
            monitor("same-model", 0, 0, 1920, 1040),
            monitor("same-model", 1920, 0, 2560, 1392),
        ];

        assert_eq!(match_monitor(&saved, &monitors), Some(1));
    }

    #[test]
    fn issue_55_mixed_dpi_layout_selects_both_drag_directions() {
        let primary_150 = monitor("primary-150", 0, 0, 2880, 1560);
        let secondary_125 = monitor("secondary-125", 2880, 0, 2400, 1300);
        let monitors = [primary_150, secondary_125];

        let on_secondary = PhysicalRect::new(4000, 420, 80, 60);
        let on_primary = PhysicalRect::new(1200, 420, 96, 72);

        assert_eq!(select_monitor(&on_secondary, &monitors), Some(1));
        assert_eq!(select_monitor(&on_primary, &monitors), Some(0));
    }

    #[test]
    fn zero_sized_window_rect_has_a_deterministic_nearest_monitor() {
        let monitors = [
            monitor("left", 0, 0, 1000, 1000),
            monitor("right", 1500, 0, 1000, 1000),
        ];

        assert_eq!(
            select_monitor(&PhysicalRect::new(1400, 400, 0, 0), &monitors),
            Some(1)
        );
    }

    #[test]
    fn resolution_and_dpi_matrix_selects_each_synthetic_target() {
        let resolutions = [
            (1280_u32, 720_u32),
            (1366, 768),
            (1600, 900),
            (1920, 1080),
            (2560, 1440),
            (3840, 2160),
        ];
        let scales = [1.0_f64, 1.25, 1.5, 2.0];
        let mut cases = 0;

        for (width, height) in resolutions {
            for scale in scales {
                let primary = monitor("primary", 0, 0, 1920, 1040);
                let target = monitor("target", 1920, 0, width, height);
                let width = (64.0 * scale).round() as u32;
                let height = (48.0 * scale).round() as u32;
                let rect =
                    PhysicalRect::new(1920 + width as i32 - width as i32, 100, width, height);
                let monitors = [primary, target];

                assert_eq!(select_monitor(&rect, &monitors), Some(1));
                cases += 1;
            }
        }

        assert_eq!(cases, 24);
    }
}
