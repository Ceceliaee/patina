//! Native clipping follows the current visual transition, not an old completion.
use super::{bounds, Edge, Placement, Rect};
use serde::Serialize;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Default, PartialEq, Serialize)]
pub struct VisualGeometry {
    pub width: f64,
    pub height: f64,
    pub anchor: f64,
}

pub fn visual_geometry(placement: &Placement, work: Rect, dpi: f64) -> VisualGeometry {
    let panel = bounds(placement, true, work, dpi);
    let handle = bounds(placement, false, work, dpi);
    let (offset, travel) = if placement.edge == Some(Edge::Top) {
        (handle.x - panel.x, panel.width.saturating_sub(handle.width))
    } else {
        (
            handle.y - panel.y,
            panel.height.saturating_sub(handle.height),
        )
    };
    VisualGeometry {
        width: f64::from(panel.width) / dpi,
        height: f64::from(panel.height) / dpi,
        anchor: (f64::from(offset) / f64::from(travel.max(1))).clamp(0.0, 1.0),
    }
}

#[derive(Clone, Default)]
pub struct Transition {
    pub id: u64,
    expanded: bool,
    pending_since: Option<Instant>,
}

impl Transition {
    pub fn pending(&self) -> bool {
        self.pending_since.is_some()
    }

    pub fn surface_expanded(&self) -> bool {
        self.expanded || self.pending()
    }

    pub fn target(&mut self, expanded: bool, animate: bool, now: Instant) {
        if self.expanded != expanded || (!animate && self.pending()) {
            self.id = self.id.wrapping_add(1);
            self.expanded = expanded;
            self.pending_since = animate.then_some(now);
        }
    }

    pub fn complete(&mut self, id: u64) -> bool {
        if id != self.id || !self.pending() {
            return false;
        }
        self.pending_since = None;
        true
    }

    pub fn expire(&mut self, now: Instant) -> bool {
        // The renderer normally acknowledges the 180 ms CSS transition. A stalled
        // renderer must not retain an expanded input region indefinitely.
        if self
            .pending_since
            .is_some_and(|since| now.duration_since(since) >= Duration::from_secs(1))
        {
            return self.complete(self.id);
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handle_matches_native_clip_inside_the_fixed_canvas() {
        let work = Rect::new(-1920, -120, 1920, 1080);
        for edge in [Edge::Top, Edge::Left, Edge::Right] {
            for anchor in [0.0, 0.02, 0.5, 0.98, 1.0] {
                for dpi in [1.0, 1.25, 1.5, 2.0] {
                    let placement = Placement {
                        edge: Some(edge),
                        anchor,
                        ..Placement::default()
                    };
                    let panel = bounds(&placement, true, work, dpi);
                    let handle = bounds(&placement, false, work, dpi);
                    let visual = visual_geometry(&placement, work, dpi);
                    let projected = if edge == Edge::Top {
                        f64::from(panel.x) + f64::from(panel.width - handle.width) * visual.anchor
                    } else {
                        f64::from(panel.y) + f64::from(panel.height - handle.height) * visual.anchor
                    };
                    let expected = if edge == Edge::Top {
                        handle.x
                    } else {
                        handle.y
                    };
                    assert!((projected - f64::from(expected)).abs() < 0.001);
                }
            }
        }
    }

    #[test]
    fn reversal_rejects_old_completion_and_keeps_region_until_current_exit_finishes() {
        let now = Instant::now();
        let mut motion = Transition::default();
        motion.target(true, false, now);
        motion.target(false, true, now);
        let closing = motion.id;
        assert!(motion.surface_expanded());
        motion.target(true, true, now);
        assert!(!motion.complete(closing));
        assert!(motion.pending());
        assert!(motion.complete(motion.id));
        assert!(motion.surface_expanded());
        motion.target(false, true, now);
        assert!(!motion.complete(closing));
        assert!(motion.complete(motion.id));
        assert!(!motion.surface_expanded());
        assert!(!motion.complete(motion.id));
    }

    #[test]
    fn ordinary_revisions_do_not_restart_deadline_and_interruption_invalidates_ack() {
        let now = Instant::now();
        let mut motion = Transition::default();
        motion.target(true, false, now);
        motion.target(false, true, now);
        let closing = motion.id;
        motion.target(false, true, now + Duration::from_millis(500));
        assert_eq!(motion.id, closing);
        assert!(!motion.expire(now + Duration::from_millis(999)));
        assert!(motion.expire(now + Duration::from_secs(1)));
        assert!(!motion.surface_expanded());
        motion.target(true, true, now);
        let opening = motion.id;
        motion.target(true, false, now);
        assert!(!motion.pending());
        assert!(!motion.complete(opening));
    }
}
