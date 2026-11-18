use std::time::{Duration, Instant};

pub(super) const LEAVE_GRACE: Duration = Duration::from_millis(180);

const MORPH_DURATION: Duration = Duration::from_millis(180);

pub(super) fn motion_progress(
    target: f32,
    motion: Option<(Instant, f32)>,
    now: Instant,
    reduced: bool,
) -> f32 {
    let Some((start, from)) = motion.filter(|_| !reduced) else {
        return target;
    };
    let step = now.saturating_duration_since(start).as_secs_f32() / MORPH_DURATION.as_secs_f32();
    if target > from {
        (from + step).min(target)
    } else {
        (from - step).max(target)
    }
}

#[derive(Clone, Default)]
pub(super) struct Interaction {
    pub expanded: bool,
    pub protected: bool,
    pub leave_since: Option<Instant>,
    pub require_leave: bool,
}

impl Interaction {
    pub fn reveal(&mut self) {
        self.expanded = true;
        self.leave_since = None;
    }

    pub fn observe_pointer(&mut self, inside: bool, now: Instant) {
        if !inside {
            self.require_leave = false;
        }
        if self.protected {
            self.leave_since = None;
        } else if inside {
            if !self.require_leave {
                self.reveal();
            }
            self.leave_since = None;
        } else if self.expanded {
            let since = self.leave_since.get_or_insert(now);
            if now.saturating_duration_since(*since) >= LEAVE_GRACE {
                self.expanded = false;
                self.leave_since = None;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leave_deadline_starts_over_after_reentry_or_protection() {
        let now = Instant::now();
        let mut state = Interaction::default();
        state.observe_pointer(true, now);
        state.observe_pointer(false, now);
        state.observe_pointer(false, now + LEAVE_GRACE - Duration::from_millis(1));
        assert!(state.expanded);
        state.observe_pointer(true, now + LEAVE_GRACE);
        assert!(state.leave_since.is_none());
        state.protected = true;
        state.observe_pointer(false, now + LEAVE_GRACE * 2);
        assert!(state.expanded && state.leave_since.is_none());
        state.protected = false;
        state.observe_pointer(false, now + LEAVE_GRACE * 3);
        state.observe_pointer(false, now + LEAVE_GRACE * 4);
        assert!(!state.expanded && state.leave_since.is_none());
    }

    #[test]
    fn motion_reverses_from_the_displayed_frame_and_reduced_motion_finishes_immediately() {
        let start = Instant::now();
        let midpoint = start + MORPH_DURATION / 2;
        let half = motion_progress(0., Some((start, 1.)), midpoint, false);
        assert_eq!(half, 0.5);
        assert_eq!(
            motion_progress(1., Some((midpoint, half)), midpoint, false),
            half
        );
        assert_eq!(
            motion_progress(1., Some((midpoint, half)), midpoint + MORPH_DURATION, false),
            1.
        );
        assert_eq!(
            motion_progress(0., Some((midpoint, half)), midpoint, true),
            0.
        );
        assert_eq!(motion_progress(1., None, midpoint, false), 1.);
    }

    #[test]
    fn escape_over_the_handle_requires_leaving_before_hover_reopens() {
        let now = Instant::now();
        let mut state = Interaction {
            require_leave: true,
            ..Default::default()
        };
        state.observe_pointer(true, now);
        assert!(!state.expanded);
        state.observe_pointer(false, now);
        state.observe_pointer(true, now);
        assert!(state.expanded);
    }
}
