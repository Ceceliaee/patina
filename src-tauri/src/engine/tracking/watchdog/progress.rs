use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

#[derive(Clone, Copy)]
pub(crate) enum TrackingStage {
    Starting = 0,
    Foreground = 1,
    TransitionLock = 2,
    Persisting = 3,
    Policy = 4,
    Transition = 5,
    Snapshot = 6,
    Waiting = 7,
    Stopped = 8,
}

#[derive(Debug)]
pub(crate) struct TrackingProgress {
    clock: Instant,
    // Pack stage and start together so the observer cannot combine two stages.
    stage: AtomicU64,
    last_observed: AtomicU64,
    last_committed: AtomicU64,
    committed_batches: AtomicU64,
}

impl Default for TrackingProgress {
    fn default() -> Self {
        Self {
            clock: Instant::now(),
            stage: AtomicU64::new(0),
            last_observed: AtomicU64::new(0),
            last_committed: AtomicU64::new(0),
            committed_batches: AtomicU64::new(0),
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Eq, PartialEq)]
pub(crate) struct TrackingProgressSnapshot {
    pub stage: &'static str,
    pub stage_age_ms: u64,
    pub last_observed_age_ms: Option<u64>,
    pub last_committed_age_ms: Option<u64>,
    pub committed_batches: u64,
    pub stalled: bool,
}

impl TrackingProgress {
    fn elapsed_ms(&self) -> u64 {
        (self.clock.elapsed().as_millis() as u64).saturating_add(1)
    }

    pub(crate) fn enter(&self, stage: TrackingStage) {
        self.stage
            .store((self.elapsed_ms() << 8) | stage as u64, Ordering::Release);
    }

    pub(crate) fn observed(&self) {
        self.last_observed
            .store(self.elapsed_ms(), Ordering::Relaxed);
    }

    pub(crate) fn committed(&self) {
        self.last_committed
            .store(self.elapsed_ms(), Ordering::Relaxed);
        self.committed_batches.fetch_add(1, Ordering::Relaxed);
    }

    pub(crate) fn snapshot(&self) -> TrackingProgressSnapshot {
        let now = self.elapsed_ms();
        let packed = self.stage.load(Ordering::Acquire);
        let stage = match packed & 255 {
            0 => "starting",
            1 => "foreground",
            2 => "transition-lock",
            3 => "persisting",
            4 => "policy",
            5 => "transition",
            6 => "snapshot",
            7 => "waiting",
            _ => "stopped",
        };
        let age = now.saturating_sub(packed >> 8);
        let last_observed = self.last_observed.load(Ordering::Relaxed);
        let last_committed = self.last_committed.load(Ordering::Relaxed);
        TrackingProgressSnapshot {
            stage,
            stage_age_ms: age,
            last_observed_age_ms: (last_observed > 0).then(|| now.saturating_sub(last_observed)),
            last_committed_age_ms: (last_committed > 0).then(|| now.saturating_sub(last_committed)),
            committed_batches: self.committed_batches.load(Ordering::Relaxed),
            stalled: stage == "stopped"
                || age > 8_000
                || now.saturating_sub(last_observed) > 8_000
                || now.saturating_sub(last_committed) > 8_000,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn observations_and_commits_are_distinct_and_do_not_need_a_runtime() {
        let progress = TrackingProgress::default();
        progress.enter(TrackingStage::Foreground);
        progress.observed();
        let observed = progress.snapshot();
        assert!(observed.last_observed_age_ms.is_some());
        assert!(observed.last_committed_age_ms.is_none());
        assert_eq!(observed.committed_batches, 0);
        progress.enter(TrackingStage::Persisting);
        progress.committed();
        assert_eq!(progress.snapshot().committed_batches, 1);
        assert_eq!(progress.snapshot().stage, "persisting");
    }

    #[test]
    fn repeated_stages_cannot_hide_missing_database_progress() {
        let progress = TrackingProgress {
            clock: Instant::now() - std::time::Duration::from_secs(20),
            ..Default::default()
        };
        progress.enter(TrackingStage::Waiting);
        progress.observed();
        assert!(progress.snapshot().stalled);
        progress.committed();
        assert!(!progress.snapshot().stalled);
        progress.enter(TrackingStage::Stopped);
        assert!(progress.snapshot().stalled);
    }
}
