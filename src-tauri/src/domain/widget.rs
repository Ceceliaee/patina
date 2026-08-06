use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

pub const DEFAULT_WIDGET_ANCHOR_Y: f64 = 0.28;

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WidgetSide {
    Left,
    #[default]
    Right,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct WidgetPhysicalPoint {
    pub x: i32,
    pub y: i32,
}

impl WidgetPhysicalPoint {
    pub const fn new(x: i32, y: i32) -> Self {
        Self { x, y }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct WidgetPhysicalRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl WidgetPhysicalRect {
    pub const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    pub fn is_valid(self) -> bool {
        self.width > 0 && self.height > 0
    }

    pub fn contains_point(self, point: WidgetPhysicalPoint) -> bool {
        i64::from(point.x) >= i64::from(self.x)
            && i64::from(point.x) < self.right()
            && i64::from(point.y) >= i64::from(self.y)
            && i64::from(point.y) < self.bottom()
    }

    fn right(self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }

    fn bottom(self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }

    fn center(self) -> (f64, f64) {
        (
            f64::from(self.x) + f64::from(self.width) / 2.0,
            f64::from(self.y) + f64::from(self.height) / 2.0,
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct WidgetMonitorAffinity {
    pub name: Option<String>,
    pub work_area: WidgetPhysicalRect,
}

impl WidgetMonitorAffinity {
    pub fn new(name: Option<String>, work_area: WidgetPhysicalRect) -> Self {
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

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct WidgetPlacement {
    #[serde(default)]
    pub monitor: Option<WidgetMonitorAffinity>,
    #[serde(default)]
    pub side: WidgetSide,
    #[serde(default = "default_widget_anchor_y")]
    pub anchor_y: f64,
}

impl Default for WidgetPlacement {
    fn default() -> Self {
        Self {
            monitor: None,
            side: WidgetSide::Right,
            anchor_y: DEFAULT_WIDGET_ANCHOR_Y,
        }
    }
}

impl WidgetPlacement {
    #[cfg(test)]
    pub fn new(side: WidgetSide, anchor_y: f64) -> Self {
        Self {
            monitor: None,
            side,
            anchor_y: clamp_widget_anchor_y(anchor_y),
        }
    }

    pub fn with_monitor(monitor: WidgetMonitorAffinity, side: WidgetSide, anchor_y: f64) -> Self {
        Self {
            monitor: monitor.work_area.is_valid().then_some(monitor),
            side,
            anchor_y: clamp_widget_anchor_y(anchor_y),
        }
    }

    pub fn normalized(mut self) -> Self {
        self.anchor_y = clamp_widget_anchor_y(self.anchor_y);
        self.monitor = self
            .monitor
            .filter(|monitor| monitor.work_area.is_valid())
            .map(|monitor| WidgetMonitorAffinity::new(monitor.name, monitor.work_area));
        self
    }
}

fn default_widget_anchor_y() -> f64 {
    DEFAULT_WIDGET_ANCHOR_Y
}

fn normalize_monitor_name(name: Option<String>) -> Option<String> {
    name.and_then(|name| {
        let trimmed = name.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

pub fn clamp_widget_anchor_y(anchor_y: f64) -> f64 {
    if !anchor_y.is_finite() {
        return DEFAULT_WIDGET_ANCHOR_Y;
    }

    anchor_y.clamp(0.0, 1.0)
}

pub fn resolve_widget_placement(
    window_rect: WidgetPhysicalRect,
    monitor: WidgetMonitorAffinity,
) -> WidgetPlacement {
    let (center_x, _) = window_rect.center();
    resolve_widget_placement_from_horizontal_reference(window_rect, center_x, monitor)
}

pub fn resolve_widget_drag_placement(
    window_rect: WidgetPhysicalRect,
    release_point: WidgetPhysicalPoint,
    monitor: WidgetMonitorAffinity,
) -> WidgetPlacement {
    resolve_widget_placement_from_horizontal_reference(
        window_rect,
        f64::from(release_point.x),
        monitor,
    )
}

fn resolve_widget_placement_from_horizontal_reference(
    window_rect: WidgetPhysicalRect,
    horizontal_reference: f64,
    monitor: WidgetMonitorAffinity,
) -> WidgetPlacement {
    let work_area = monitor.work_area;
    let work_center_x = f64::from(work_area.x) + f64::from(work_area.width) / 2.0;
    let side = if horizontal_reference < work_center_x {
        WidgetSide::Left
    } else {
        WidgetSide::Right
    };
    let max_y_offset = work_area.height.saturating_sub(window_rect.height);
    let anchor_y = if max_y_offset == 0 {
        0.0
    } else {
        (f64::from(window_rect.y) - f64::from(work_area.y)) / f64::from(max_y_offset)
    };

    WidgetPlacement::with_monitor(monitor, side, anchor_y)
}

pub fn select_widget_monitor_for_release(
    release_point: WidgetPhysicalPoint,
    monitors: &[WidgetMonitorAffinity],
) -> Option<usize> {
    select_widget_monitor(
        &WidgetPhysicalRect::new(release_point.x, release_point.y, 1, 1),
        monitors,
    )
}

pub fn select_widget_monitor(
    window_rect: &WidgetPhysicalRect,
    monitors: &[WidgetMonitorAffinity],
) -> Option<usize> {
    let mut best: Option<(usize, WidgetMonitorScore)> = None;

    for (index, monitor) in monitors.iter().enumerate() {
        if !monitor.work_area.is_valid() {
            continue;
        }

        let score = WidgetMonitorScore {
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

pub fn match_widget_monitor(
    saved: &WidgetMonitorAffinity,
    monitors: &[WidgetMonitorAffinity],
) -> Option<usize> {
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
struct WidgetMonitorScore {
    intersection_area: u64,
    contains_center: bool,
    distance_squared: f64,
    stable_key: (String, i32, i32, u32, u32),
}

impl WidgetMonitorScore {
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

fn intersection_area(left: WidgetPhysicalRect, right: WidgetPhysicalRect) -> u64 {
    let overlap_width =
        (left.right().min(right.right()) - i64::from(left.x).max(i64::from(right.x))).max(0);
    let overlap_height =
        (left.bottom().min(right.bottom()) - i64::from(left.y).max(i64::from(right.y))).max(0);

    u64::try_from(overlap_width).unwrap_or(0) * u64::try_from(overlap_height).unwrap_or(0)
}

fn contains_center(container: WidgetPhysicalRect, target: WidgetPhysicalRect) -> bool {
    let (center_x, center_y) = target.center();
    center_x >= f64::from(container.x)
        && center_x < container.right() as f64
        && center_y >= f64::from(container.y)
        && center_y < container.bottom() as f64
}

fn point_to_rect_distance_squared((point_x, point_y): (f64, f64), rect: WidgetPhysicalRect) -> f64 {
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
    saved: &WidgetMonitorAffinity,
    left: &WidgetMonitorAffinity,
    right: &WidgetMonitorAffinity,
) -> Ordering {
    affinity_geometry_distance(saved.work_area, left.work_area)
        .cmp(&affinity_geometry_distance(
            saved.work_area,
            right.work_area,
        ))
        .then_with(|| left.stable_key().cmp(&right.stable_key()))
}

fn affinity_geometry_distance(saved: WidgetPhysicalRect, candidate: WidgetPhysicalRect) -> u64 {
    i64::from(saved.x)
        .abs_diff(i64::from(candidate.x))
        .saturating_add(i64::from(saved.y).abs_diff(i64::from(candidate.y)))
        .saturating_add(u64::from(saved.width.abs_diff(candidate.width)))
        .saturating_add(u64::from(saved.height.abs_diff(candidate.height)))
}

#[cfg(test)]
mod tests {
    use super::{
        clamp_widget_anchor_y, match_widget_monitor, resolve_widget_drag_placement,
        resolve_widget_placement, select_widget_monitor, select_widget_monitor_for_release,
        WidgetMonitorAffinity, WidgetPhysicalPoint, WidgetPhysicalRect, WidgetPlacement,
        WidgetSide, DEFAULT_WIDGET_ANCHOR_Y,
    };

    fn monitor(name: &str, x: i32, y: i32, width: u32, height: u32) -> WidgetMonitorAffinity {
        WidgetMonitorAffinity::new(
            Some(name.to_string()),
            WidgetPhysicalRect::new(x, y, width, height),
        )
    }

    #[test]
    fn widget_anchor_y_clamps_invalid_values() {
        assert_eq!(clamp_widget_anchor_y(-1.0), 0.0);
        assert_eq!(clamp_widget_anchor_y(1.5), 1.0);
        assert_eq!(clamp_widget_anchor_y(f64::NAN), DEFAULT_WIDGET_ANCHOR_Y);
    }

    #[test]
    fn widget_placement_uses_safe_defaults() {
        let defaults = WidgetPlacement::default();
        assert_eq!(defaults.monitor, None);
        assert_eq!(defaults.side, WidgetSide::Right);
        assert_eq!(defaults.anchor_y, DEFAULT_WIDGET_ANCHOR_Y);

        let loaded = WidgetPlacement::new(WidgetSide::Left, 3.0);
        assert_eq!(loaded.side, WidgetSide::Left);
        assert_eq!(loaded.anchor_y, 1.0);
    }

    #[test]
    fn widget_monitor_selection_uses_final_rect_instead_of_source_monitor_state() {
        let monitors = [
            monitor(r"\\.\DISPLAY1", 0, 0, 1920, 1040),
            monitor(r"\\.\DISPLAY2", 1920, 0, 2560, 1392),
        ];
        let final_widget_rect = WidgetPhysicalRect::new(2200, 300, 80, 60);

        assert_eq!(
            select_widget_monitor(&final_widget_rect, &monitors),
            Some(1)
        );
    }

    #[test]
    fn release_point_owns_the_target_when_the_window_still_straddles_the_source_monitor() {
        let monitors = [
            monitor("primary", 0, 0, 1920, 1040),
            monitor("secondary", 1920, 0, 2560, 1392),
        ];
        let straddling_window = WidgetPhysicalRect::new(1840, 300, 96, 72);
        let release_on_secondary = WidgetPhysicalPoint::new(1928, 336);

        assert_eq!(
            select_widget_monitor(&straddling_window, &monitors),
            Some(0)
        );
        assert_eq!(
            select_widget_monitor_for_release(release_on_secondary, &monitors),
            Some(1)
        );
    }

    #[test]
    fn release_point_determines_the_nearest_edge_without_drag_handle_offset_bias() {
        let target = monitor("primary", 0, 0, 1920, 1040);
        let window = WidgetPhysicalRect::new(930, 300, 96, 72);

        let released_left = resolve_widget_drag_placement(
            window,
            WidgetPhysicalPoint::new(940, 336),
            target.clone(),
        );
        let released_right =
            resolve_widget_drag_placement(window, WidgetPhysicalPoint::new(980, 336), target);

        assert_eq!(released_left.side, WidgetSide::Left);
        assert_eq!(released_right.side, WidgetSide::Right);
        assert_eq!(released_left.anchor_y, released_right.anchor_y);
    }

    #[test]
    fn widget_monitor_selection_handles_negative_and_vertical_origins() {
        let monitors = [
            monitor("primary", 0, 0, 1920, 1040),
            monitor("left", -2560, 100, 2560, 1392),
            monitor("above", 0, -1440, 2560, 1400),
            monitor("below", 0, 1080, 1600, 860),
        ];

        assert_eq!(
            select_widget_monitor(&WidgetPhysicalRect::new(-2000, 400, 96, 72), &monitors),
            Some(1)
        );
        assert_eq!(
            select_widget_monitor(&WidgetPhysicalRect::new(500, -900, 96, 72), &monitors),
            Some(2)
        );
        assert_eq!(
            select_widget_monitor(&WidgetPhysicalRect::new(500, 1300, 96, 72), &monitors),
            Some(3)
        );
    }

    #[test]
    fn widget_monitor_selection_prefers_largest_intersection_then_center() {
        let monitors = [
            monitor("a", 0, 0, 1000, 1000),
            monitor("b", 1000, 0, 1000, 1000),
        ];

        assert_eq!(
            select_widget_monitor(&WidgetPhysicalRect::new(940, 100, 200, 100), &monitors),
            Some(1)
        );
        assert_eq!(
            select_widget_monitor(&WidgetPhysicalRect::new(900, 100, 200, 100), &monitors),
            Some(1)
        );
    }

    #[test]
    fn widget_monitor_selection_uses_nearest_work_area_across_gaps() {
        let monitors = [
            monitor("left", 0, 0, 1000, 1000),
            monitor("right", 1500, 0, 1000, 1000),
        ];

        assert_eq!(
            select_widget_monitor(&WidgetPhysicalRect::new(1320, 400, 50, 50), &monitors),
            Some(1)
        );
    }

    #[test]
    fn widget_monitor_selection_tie_break_is_independent_of_enumeration_order() {
        let window = WidgetPhysicalRect::new(1075, 1100, 50, 50);
        let first = [
            monitor("z", 0, 0, 1000, 1000),
            monitor("a", 1200, 1200, 1000, 1000),
        ];
        let reversed = [first[1].clone(), first[0].clone()];

        let first_selected = &first[select_widget_monitor(&window, &first).unwrap()];
        let reversed_selected = &reversed[select_widget_monitor(&window, &reversed).unwrap()];
        assert_eq!(first_selected.name, reversed_selected.name);
    }

    #[test]
    fn widget_monitor_selection_ignores_invalid_work_areas() {
        let monitors = [
            monitor("invalid", 0, 0, 0, 1000),
            monitor("valid", 1000, 0, 1000, 1000),
        ];

        assert_eq!(
            select_widget_monitor(&WidgetPhysicalRect::new(10, 10, 50, 50), &monitors),
            Some(1)
        );
        assert_eq!(
            select_widget_monitor(&WidgetPhysicalRect::new(0, 0, 1, 1), &[]),
            None
        );
    }

    #[test]
    fn widget_placement_is_relative_to_selected_monitor_work_area() {
        let target = monitor("secondary", -2560, -100, 2560, 1400);
        let left_top =
            resolve_widget_placement(WidgetPhysicalRect::new(-2550, -100, 96, 72), target.clone());
        assert_eq!(left_top.side, WidgetSide::Left);
        assert_eq!(left_top.anchor_y, 0.0);

        let right_bottom =
            resolve_widget_placement(WidgetPhysicalRect::new(-96, 1228, 96, 72), target);
        assert_eq!(right_bottom.side, WidgetSide::Right);
        assert_eq!(right_bottom.anchor_y, 1.0);
    }

    #[test]
    fn saved_monitor_matches_name_before_geometry() {
        let saved = monitor("display-b", 1920, 0, 2560, 1392);
        let monitors = [
            monitor("display-a", 1920, 0, 2560, 1392),
            monitor("DISPLAY-B", 0, 0, 1920, 1040),
        ];

        assert_eq!(match_widget_monitor(&saved, &monitors), Some(1));
    }

    #[test]
    fn disconnected_saved_monitor_does_not_hijack_the_safe_fallback_chain() {
        let saved = monitor("missing", -2560, 0, 2560, 1392);
        let monitors = [
            monitor("primary", 0, 0, 1920, 1040),
            monitor("other", 1920, 0, 2560, 1392),
        ];

        assert_eq!(match_widget_monitor(&saved, &monitors), None);
    }

    #[test]
    fn renamed_saved_monitor_matches_only_when_its_work_area_is_unchanged() {
        let saved = monitor("old-name", -2560, 0, 2560, 1392);
        let monitors = [
            monitor("primary", 0, 0, 1920, 1040),
            monitor("new-name", -2560, 0, 2560, 1392),
        ];

        assert_eq!(match_widget_monitor(&saved, &monitors), Some(1));
    }

    #[test]
    fn duplicate_monitor_names_use_saved_geometry() {
        let saved = monitor("same-model", 1920, 0, 2560, 1392);
        let monitors = [
            monitor("same-model", 0, 0, 1920, 1040),
            monitor("same-model", 1920, 0, 2560, 1392),
        ];

        assert_eq!(match_widget_monitor(&saved, &monitors), Some(1));
    }

    #[test]
    fn issue_55_mixed_dpi_layout_selects_both_drag_directions() {
        let primary_150 = monitor("primary-150", 0, 0, 2880, 1560);
        let secondary_125 = monitor("secondary-125", 2880, 0, 2400, 1300);
        let monitors = [primary_150, secondary_125];

        let on_secondary = WidgetPhysicalRect::new(4000, 420, 80, 60);
        let on_primary = WidgetPhysicalRect::new(1200, 420, 96, 72);

        assert_eq!(select_widget_monitor(&on_secondary, &monitors), Some(1));
        assert_eq!(select_widget_monitor(&on_primary, &monitors), Some(0));
    }

    #[test]
    fn zero_sized_window_rect_has_a_deterministic_nearest_monitor() {
        let monitors = [
            monitor("left", 0, 0, 1000, 1000),
            monitor("right", 1500, 0, 1000, 1000),
        ];

        assert_eq!(
            select_widget_monitor(&WidgetPhysicalRect::new(1400, 400, 0, 0), &monitors),
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
                let widget_width = (64.0 * scale).round() as u32;
                let widget_height = (48.0 * scale).round() as u32;
                let rect = WidgetPhysicalRect::new(
                    1920 + width as i32 - widget_width as i32,
                    100,
                    widget_width,
                    widget_height,
                );
                let monitors = [primary, target];

                assert_eq!(select_widget_monitor(&rect, &monitors), Some(1));
                cases += 1;
            }
        }

        assert_eq!(cases, 24);
    }
}
