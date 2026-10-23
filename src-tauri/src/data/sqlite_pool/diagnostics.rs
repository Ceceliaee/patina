//! Fixed-size, content-free timings. SQL execution includes SQLite busy waits;
//! SQLx does not expose a separate per-statement lock-wait duration.
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;

#[derive(Clone, Copy)]
pub(crate) enum Phase {
    Acquire,
    Statement,
    Commit,
    ReadModel,
    Maintenance,
    Backup,
}

#[derive(Default)]
struct Counter {
    in_flight: AtomicU64,
    ended: AtomicU64,
    last_us: AtomicU64,
    max_us: AtomicU64,
}

static COUNTERS: std::sync::LazyLock<[Counter; 6]> =
    std::sync::LazyLock::new(|| std::array::from_fn(|_| Counter::default()));

pub(crate) struct Timer<'a> {
    counter: &'a Counter,
    started: Instant,
}

impl<'a> Timer<'a> {
    fn new(counter: &'a Counter) -> Self {
        counter.in_flight.fetch_add(1, Ordering::Relaxed);
        Self {
            counter,
            started: Instant::now(),
        }
    }
}

impl Drop for Timer<'_> {
    fn drop(&mut self) {
        let elapsed = self.started.elapsed().as_micros().min(u64::MAX as u128) as u64;
        self.counter.last_us.store(elapsed, Ordering::Relaxed);
        self.counter.max_us.fetch_max(elapsed, Ordering::Relaxed);
        self.counter.ended.fetch_add(1, Ordering::Relaxed);
        self.counter.in_flight.fetch_sub(1, Ordering::Relaxed);
    }
}

pub(crate) fn start(phase: Phase) -> Timer<'static> {
    Timer::new(&COUNTERS[phase as usize])
}

pub(crate) async fn measure<T>(phase: Phase, work: impl std::future::Future<Output = T>) -> T {
    let _timer = start(phase);
    work.await
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct Snapshot {
    phase: &'static str,
    in_flight: u64,
    ended: u64,
    last_us: u64,
    max_us: u64,
}

pub(crate) fn snapshot() -> Vec<Snapshot> {
    [
        "connection-acquire",
        "sql-including-lock-wait",
        "commit",
        "read-model",
        "maintenance",
        "backup",
    ]
    .into_iter()
    .zip(COUNTERS.iter())
    .map(|(phase, counter)| Snapshot {
        phase,
        in_flight: counter.in_flight.load(Ordering::Relaxed),
        ended: counter.ended.load(Ordering::Relaxed),
        last_us: counter.last_us.load(Ordering::Relaxed),
        max_us: counter.max_us.load(Ordering::Relaxed),
    })
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn early_return_and_unwind_release_measurement_without_claiming_a_commit() {
        let counter = Counter::default();
        let result = std::panic::catch_unwind(|| {
            let _timer = Timer::new(&counter);
            assert_eq!(counter.in_flight.load(Ordering::Relaxed), 1);
            panic!("injected failure");
        });
        assert!(result.is_err());
        assert_eq!(counter.in_flight.load(Ordering::Relaxed), 0);
        assert_eq!(counter.ended.load(Ordering::Relaxed), 1);
    }
}
