use super::super::runtime_snapshot::{TrackingRuntimeProbeDiagnostics, TrackingRuntimeProbeStatus};
use crate::platform::windows::foreground as tracker;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::task::spawn_blocking;
use tokio::time::{timeout, Duration};

const WINDOW_POLL_TIMEOUT_SECS: u64 = 3;
const FOREGROUND_PROBE_RECOVERY_AFTER_MS: i64 = 10_000;
const FOREGROUND_PROBE_RECOVERY_COOLDOWN_MS: i64 = 30_000;
const FOREGROUND_PROBE_MAX_DETACHED_TASKS: u32 = 2;
const FOREGROUND_PROBE_HARD_DEGRADED_AFTER_MS: i64 = 60_000;

#[derive(Clone, Debug)]
pub(super) struct WindowPollOutcome {
    pub window: tracker::WindowInfo,
    pub probe_status: TrackingRuntimeProbeStatus,
    pub degraded_reason: Option<String>,
    pub probe_diagnostics: TrackingRuntimeProbeDiagnostics,
}

impl WindowPollOutcome {
    pub(super) fn is_successful_sample(&self) -> bool {
        self.probe_status == TrackingRuntimeProbeStatus::Ok
    }
}

#[derive(Debug, Default)]
struct ForegroundProbeState {
    inner: Mutex<ForegroundProbeInner>,
}

#[derive(Debug, Default)]
struct ForegroundProbeInner {
    current_generation: u64,
    active_generation: Option<u64>,
    detached_probe_count: u32,
    last_successful_window: Option<tracker::WindowInfo>,
    last_successful_sample_at_ms: Option<i64>,
    fallback_started_at_ms: Option<i64>,
    fallback_count: u64,
    consecutive_fallback_count: u64,
    recovery_attempt_count: u64,
    last_recovery_attempt_at_ms: Option<i64>,
    hard_degraded: bool,
}

#[derive(Clone, Copy, Debug)]
struct ProbeStart {
    generation: u64,
    is_recovery_attempt: bool,
}

enum ProbeDecision {
    Start(ProbeStart),
    Fallback {
        fallback_status: TrackingRuntimeProbeStatus,
        inactive_status: TrackingRuntimeProbeStatus,
        reason: String,
    },
}

struct ForegroundProbeInFlightGuard {
    state: Arc<ForegroundProbeState>,
    generation: u64,
}

pub(super) async fn poll_active_window_with_timeout() -> WindowPollOutcome {
    poll_active_window_with_state(
        foreground_probe_state().clone(),
        Duration::from_secs(WINDOW_POLL_TIMEOUT_SECS),
        now_ms(),
        tracker::get_active_window,
    )
    .await
}

async fn poll_active_window_with_state<F>(
    state: Arc<ForegroundProbeState>,
    timeout_duration: Duration,
    sampled_at_ms: i64,
    probe: F,
) -> WindowPollOutcome
where
    F: FnOnce() -> tracker::WindowInfo + Send + 'static,
{
    let probe_start = match prepare_probe_decision(&state, sampled_at_ms) {
        ProbeDecision::Start(probe_start) => probe_start,
        ProbeDecision::Fallback {
            fallback_status,
            inactive_status,
            reason,
        } => {
            return fallback_outcome(
                &state,
                fallback_status,
                inactive_status,
                &reason,
                sampled_at_ms,
            );
        }
    };

    let guard_state = state.clone();
    let query = spawn_blocking(move || {
        let _guard = ForegroundProbeInFlightGuard {
            state: guard_state,
            generation: probe_start.generation,
        };
        probe()
    });

    match timeout(timeout_duration, query).await {
        Ok(Ok(window)) => {
            let probe_diagnostics =
                remember_successful_window(&state, probe_start.generation, &window, sampled_at_ms);
            WindowPollOutcome {
                window,
                probe_status: TrackingRuntimeProbeStatus::Ok,
                degraded_reason: None,
                probe_diagnostics,
            }
        }
        Ok(Err(error)) => fallback_outcome(
            &state,
            TrackingRuntimeProbeStatus::TaskFailedFallback,
            TrackingRuntimeProbeStatus::TaskFailedInactive,
            &format!("active window poll task failed: {error}"),
            sampled_at_ms,
        ),
        Err(_) => fallback_outcome(
            &state,
            if probe_start.is_recovery_attempt {
                TrackingRuntimeProbeStatus::RecoveryAttemptedFallback
            } else {
                TrackingRuntimeProbeStatus::TimeoutFallback
            },
            if probe_start.is_recovery_attempt {
                TrackingRuntimeProbeStatus::RecoveryAttemptedInactive
            } else {
                TrackingRuntimeProbeStatus::TimeoutInactive
            },
            &format!(
                "active window poll timed out after {} seconds",
                timeout_duration.as_secs()
            ),
            sampled_at_ms,
        ),
    }
}

fn prepare_probe_decision(state: &ForegroundProbeState, sampled_at_ms: i64) -> ProbeDecision {
    let mut guard = lock_inner(state);

    if guard.active_generation.is_none() {
        guard.current_generation += 1;
        guard.active_generation = Some(guard.current_generation);
        return ProbeDecision::Start(ProbeStart {
            generation: guard.current_generation,
            is_recovery_attempt: false,
        });
    }

    if should_mark_hard_degraded(&guard, sampled_at_ms) {
        guard.hard_degraded = true;
    }

    if guard.hard_degraded {
        return ProbeDecision::Fallback {
            fallback_status: TrackingRuntimeProbeStatus::HardDegradedFallback,
            inactive_status: TrackingRuntimeProbeStatus::HardDegradedInactive,
            reason: "active window probe is hard degraded".to_string(),
        };
    }

    if should_attempt_recovery(&guard, sampled_at_ms) {
        guard.detached_probe_count += 1;
        guard.recovery_attempt_count += 1;
        guard.last_recovery_attempt_at_ms = Some(sampled_at_ms);
        guard.current_generation += 1;
        guard.active_generation = Some(guard.current_generation);
        return ProbeDecision::Start(ProbeStart {
            generation: guard.current_generation,
            is_recovery_attempt: true,
        });
    }

    ProbeDecision::Fallback {
        fallback_status: TrackingRuntimeProbeStatus::BackingOffFallback,
        inactive_status: TrackingRuntimeProbeStatus::BackingOffInactive,
        reason: "active window probe still in flight".to_string(),
    }
}

fn should_attempt_recovery(inner: &ForegroundProbeInner, sampled_at_ms: i64) -> bool {
    if inner.detached_probe_count >= FOREGROUND_PROBE_MAX_DETACHED_TASKS {
        return false;
    }

    let Some(fallback_started_at_ms) = inner.fallback_started_at_ms else {
        return false;
    };

    if sampled_at_ms - fallback_started_at_ms < FOREGROUND_PROBE_RECOVERY_AFTER_MS {
        return false;
    }

    match inner.last_recovery_attempt_at_ms {
        Some(last_attempt_at_ms) => {
            sampled_at_ms - last_attempt_at_ms >= FOREGROUND_PROBE_RECOVERY_COOLDOWN_MS
        }
        None => true,
    }
}

fn should_mark_hard_degraded(inner: &ForegroundProbeInner, sampled_at_ms: i64) -> bool {
    if inner.detached_probe_count >= FOREGROUND_PROBE_MAX_DETACHED_TASKS {
        return true;
    }

    should_mark_hard_degraded_by_duration(inner, sampled_at_ms)
}

fn should_mark_hard_degraded_by_duration(inner: &ForegroundProbeInner, sampled_at_ms: i64) -> bool {
    match inner.fallback_started_at_ms {
        Some(fallback_started_at_ms) => {
            sampled_at_ms - fallback_started_at_ms >= FOREGROUND_PROBE_HARD_DEGRADED_AFTER_MS
        }
        None => false,
    }
}

fn fallback_outcome(
    state: &ForegroundProbeState,
    fallback_status: TrackingRuntimeProbeStatus,
    inactive_status: TrackingRuntimeProbeStatus,
    degraded_reason: &str,
    sampled_at_ms: i64,
) -> WindowPollOutcome {
    let mut guard = lock_inner(state);
    guard.fallback_count += 1;
    guard.consecutive_fallback_count += 1;
    if guard.fallback_started_at_ms.is_none() {
        guard.fallback_started_at_ms = Some(sampled_at_ms);
    }
    if should_mark_hard_degraded_by_duration(&guard, sampled_at_ms) {
        guard.hard_degraded = true;
    }

    let window = guard.last_successful_window.clone();
    let has_cached_window = window.is_some();
    let probe_status = if guard.hard_degraded {
        if has_cached_window {
            TrackingRuntimeProbeStatus::HardDegradedFallback
        } else {
            TrackingRuntimeProbeStatus::HardDegradedInactive
        }
    } else if has_cached_window {
        fallback_status
    } else {
        inactive_status
    };
    let probe_diagnostics = diagnostics_from_inner(&guard);
    drop(guard);

    WindowPollOutcome {
        window: window.unwrap_or_else(inactive_window),
        probe_status,
        degraded_reason: Some(degraded_reason.to_string()),
        probe_diagnostics,
    }
}

fn remember_successful_window(
    state: &ForegroundProbeState,
    generation: u64,
    window: &tracker::WindowInfo,
    sampled_at_ms: i64,
) -> TrackingRuntimeProbeDiagnostics {
    let mut guard = lock_inner(state);
    guard.last_successful_window = Some(window.clone());
    guard.last_successful_sample_at_ms = Some(sampled_at_ms);
    guard.fallback_started_at_ms = None;
    guard.consecutive_fallback_count = 0;
    guard.detached_probe_count = 0;
    guard.hard_degraded = false;
    if guard.active_generation == Some(generation) {
        guard.active_generation = None;
    }
    diagnostics_from_inner(&guard)
}

fn complete_probe_generation(state: &ForegroundProbeState, generation: u64) {
    let mut guard = lock_inner(state);
    if guard.active_generation == Some(generation) {
        guard.active_generation = None;
    }
}

fn diagnostics_from_inner(inner: &ForegroundProbeInner) -> TrackingRuntimeProbeDiagnostics {
    TrackingRuntimeProbeDiagnostics {
        last_successful_sample_at_ms: inner.last_successful_sample_at_ms,
        fallback_started_at_ms: inner.fallback_started_at_ms,
        fallback_count: inner.fallback_count,
        consecutive_fallback_count: inner.consecutive_fallback_count,
        recovery_attempt_count: inner.recovery_attempt_count,
        last_recovery_attempt_at_ms: inner.last_recovery_attempt_at_ms,
    }
}

fn lock_inner(state: &ForegroundProbeState) -> std::sync::MutexGuard<'_, ForegroundProbeInner> {
    match state.inner.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

fn inactive_window() -> tracker::WindowInfo {
    tracker::WindowInfo {
        hwnd: String::new(),
        root_owner_hwnd: String::new(),
        process_id: 0,
        window_class: String::new(),
        title: String::new(),
        exe_name: String::new(),
        process_path: String::new(),
        app_user_model_id: String::new(),
        is_afk: false,
        idle_time_ms: 0,
    }
}

fn foreground_probe_state() -> &'static Arc<ForegroundProbeState> {
    static FOREGROUND_PROBE_STATE: OnceLock<Arc<ForegroundProbeState>> = OnceLock::new();
    FOREGROUND_PROBE_STATE.get_or_init(|| Arc::new(ForegroundProbeState::default()))
}

impl Drop for ForegroundProbeInFlightGuard {
    fn drop(&mut self) {
        complete_probe_generation(&self.state, self.generation);
    }
}

fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;

    // Blocking sleeps below are the simulated foreground probes: they must
    // outlive the configured timeout to exercise fallback behavior. Test
    // coordination itself waits on observable probe state rather than sleeps.
    async fn wait_for_probe_state(
        state: &ForegroundProbeState,
        predicate: impl Fn(&ForegroundProbeInner) -> bool,
    ) {
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if predicate(&lock_inner(state)) {
                    return;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("timed out waiting for foreground probe state");
    }

    fn make_window(exe_name: &str) -> tracker::WindowInfo {
        tracker::WindowInfo {
            hwnd: "0x100".into(),
            root_owner_hwnd: "0x100".into(),
            process_id: 123,
            window_class: "Chrome_WidgetWin_1".into(),
            title: "Window".into(),
            exe_name: exe_name.into(),
            process_path: format!(r"C:\Program Files\{exe_name}"),
            app_user_model_id: String::new(),
            is_afk: false,
            idle_time_ms: 0,
        }
    }

    #[test]
    fn poll_returns_cached_window_when_probe_times_out() {
        tauri::async_runtime::block_on(async {
            let state = Arc::new(ForegroundProbeState::default());
            remember_successful_window(&state, 0, &make_window("Code.exe"), 500);

            let outcome =
                poll_active_window_with_state(state, Duration::from_millis(10), 1_000, || {
                    thread::sleep(Duration::from_millis(80));
                    make_window("Late.exe")
                })
                .await;

            assert_eq!(outcome.window.exe_name, "Code.exe");
            assert_eq!(
                outcome.probe_status,
                TrackingRuntimeProbeStatus::TimeoutFallback
            );
            assert_eq!(
                outcome.probe_diagnostics.fallback_started_at_ms,
                Some(1_000)
            );
            assert_eq!(outcome.probe_diagnostics.consecutive_fallback_count, 1);
            assert!(!outcome.is_successful_sample());
        });
    }

    #[test]
    fn poll_returns_inactive_window_when_probe_times_out_without_cache() {
        tauri::async_runtime::block_on(async {
            let state = Arc::new(ForegroundProbeState::default());

            let outcome =
                poll_active_window_with_state(state, Duration::from_millis(10), 1_000, || {
                    thread::sleep(Duration::from_millis(80));
                    make_window("Late.exe")
                })
                .await;

            assert_eq!(outcome.window.exe_name, "");
            assert_eq!(
                outcome.probe_status,
                TrackingRuntimeProbeStatus::TimeoutInactive
            );
            assert!(!outcome.is_successful_sample());
        });
    }

    #[test]
    fn concurrent_polls_reuse_single_in_flight_probe() {
        tauri::async_runtime::block_on(async {
            let state = Arc::new(ForegroundProbeState::default());
            remember_successful_window(&state, 0, &make_window("Code.exe"), 500);
            let calls = Arc::new(AtomicUsize::new(0));
            let first_calls = calls.clone();
            let first_state = state.clone();

            let first = tauri::async_runtime::spawn(async move {
                poll_active_window_with_state(
                    first_state,
                    Duration::from_millis(30),
                    1_000,
                    move || {
                        first_calls.fetch_add(1, Ordering::SeqCst);
                        thread::sleep(Duration::from_millis(120));
                        make_window("Late.exe")
                    },
                )
                .await
            });

            wait_for_probe_state(&state, |inner| inner.active_generation.is_some()).await;
            for _ in 0..10 {
                let outcome = poll_active_window_with_state(
                    state.clone(),
                    Duration::from_millis(30),
                    1_010,
                    || make_window("ShouldNotRun.exe"),
                )
                .await;
                assert_eq!(
                    outcome.probe_status,
                    TrackingRuntimeProbeStatus::BackingOffFallback
                );
            }

            let first_outcome = first.await.unwrap();
            assert_eq!(
                first_outcome.probe_status,
                TrackingRuntimeProbeStatus::TimeoutFallback
            );
            assert_eq!(calls.load(Ordering::SeqCst), 1);
        });
    }

    #[test]
    fn successful_probe_updates_cache() {
        tauri::async_runtime::block_on(async {
            let state = Arc::new(ForegroundProbeState::default());

            let outcome = poll_active_window_with_state(
                state.clone(),
                Duration::from_millis(50),
                1_000,
                || make_window("Code.exe"),
            )
            .await;

            assert_eq!(outcome.probe_status, TrackingRuntimeProbeStatus::Ok);
            assert!(outcome.is_successful_sample());
            assert_eq!(
                lock_inner(&state)
                    .last_successful_window
                    .as_ref()
                    .unwrap()
                    .exe_name,
                "Code.exe"
            );
            assert_eq!(
                outcome.probe_diagnostics.last_successful_sample_at_ms,
                Some(1_000)
            );
        });
    }

    #[test]
    fn long_running_probe_gets_bounded_recovery_attempt() {
        tauri::async_runtime::block_on(async {
            let state = Arc::new(ForegroundProbeState::default());
            let calls = Arc::new(AtomicUsize::new(0));
            let first_calls = calls.clone();
            let first_state = state.clone();

            let first = tauri::async_runtime::spawn(async move {
                poll_active_window_with_state(
                    first_state,
                    Duration::from_millis(10),
                    1_000,
                    move || {
                        first_calls.fetch_add(1, Ordering::SeqCst);
                        thread::sleep(Duration::from_millis(180));
                        make_window("Late.exe")
                    },
                )
                .await
            });

            wait_for_probe_state(&state, |inner| {
                inner.fallback_started_at_ms == Some(1_000) && inner.active_generation.is_some()
            })
            .await;
            let recovery_calls = calls.clone();
            let recovered = poll_active_window_with_state(
                state.clone(),
                Duration::from_millis(50),
                12_000,
                move || {
                    recovery_calls.fetch_add(1, Ordering::SeqCst);
                    make_window("Code.exe")
                },
            )
            .await;

            assert_eq!(recovered.probe_status, TrackingRuntimeProbeStatus::Ok);
            assert_eq!(recovered.window.exe_name, "Code.exe");
            assert_eq!(recovered.probe_diagnostics.recovery_attempt_count, 1);
            assert_eq!(
                recovered.probe_diagnostics.last_recovery_attempt_at_ms,
                Some(12_000)
            );

            let first_outcome = first.await.unwrap();
            assert_eq!(
                first_outcome.probe_status,
                TrackingRuntimeProbeStatus::TimeoutInactive
            );
            assert_eq!(calls.load(Ordering::SeqCst), 2);
        });
    }

    #[test]
    fn repeated_stuck_probes_enter_hard_degraded_without_unbounded_tasks() {
        tauri::async_runtime::block_on(async {
            let state = Arc::new(ForegroundProbeState::default());
            remember_successful_window(&state, 0, &make_window("Code.exe"), 1_000);
            {
                let mut guard = lock_inner(&state);
                guard.current_generation = 1;
                guard.active_generation = Some(1);
                guard.detached_probe_count = 1;
                guard.fallback_started_at_ms = Some(2_000);
                guard.fallback_count = 2;
                guard.consecutive_fallback_count = 2;
                guard.recovery_attempt_count = 1;
                guard.last_recovery_attempt_at_ms = Some(13_000);
            }

            let third = poll_active_window_with_state(
                state.clone(),
                Duration::from_millis(10),
                43_000,
                || {
                    thread::sleep(Duration::from_millis(80));
                    make_window("Late2.exe")
                },
            )
            .await;
            assert_eq!(
                third.probe_status,
                TrackingRuntimeProbeStatus::RecoveryAttemptedFallback
            );
            let hard_degraded =
                poll_active_window_with_state(state, Duration::from_millis(10), 44_000, || {
                    make_window("ShouldNotRun.exe")
                })
                .await;

            assert_eq!(
                hard_degraded.probe_status,
                TrackingRuntimeProbeStatus::HardDegradedFallback
            );
            assert_eq!(hard_degraded.window.exe_name, "Code.exe");
            assert_eq!(hard_degraded.probe_diagnostics.recovery_attempt_count, 2);
        });
    }
}
