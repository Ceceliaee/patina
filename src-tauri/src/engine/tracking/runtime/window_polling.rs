use crate::platform::windows::foreground as tracker;
use super::super::runtime_snapshot::TrackingRuntimeProbeStatus;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use tokio::task::spawn_blocking;
use tokio::time::{timeout, Duration};

const WINDOW_POLL_TIMEOUT_SECS: u64 = 3;

#[derive(Clone, Debug)]
pub(super) struct WindowPollOutcome {
    pub window: tracker::WindowInfo,
    pub probe_status: TrackingRuntimeProbeStatus,
    pub degraded_reason: Option<String>,
}

impl WindowPollOutcome {
    pub(super) fn is_successful_sample(&self) -> bool {
        self.probe_status == TrackingRuntimeProbeStatus::Ok
    }
}

#[derive(Debug, Default)]
struct ForegroundProbeState {
    probe_in_flight: Arc<AtomicBool>,
    last_successful_window: Mutex<Option<tracker::WindowInfo>>,
}

struct ForegroundProbeInFlightGuard {
    probe_in_flight: Arc<AtomicBool>,
}

pub(super) async fn poll_active_window_with_timeout() -> WindowPollOutcome {
    poll_active_window_with_state(
        foreground_probe_state().clone(),
        Duration::from_secs(WINDOW_POLL_TIMEOUT_SECS),
        tracker::get_active_window,
    )
    .await
}

async fn poll_active_window_with_state<F>(
    state: Arc<ForegroundProbeState>,
    timeout_duration: Duration,
    probe: F,
) -> WindowPollOutcome
where
    F: FnOnce() -> tracker::WindowInfo + Send + 'static,
{
    if state.probe_in_flight.swap(true, Ordering::AcqRel) {
        return fallback_outcome(
            &state,
            TrackingRuntimeProbeStatus::BackingOffFallback,
            TrackingRuntimeProbeStatus::BackingOffInactive,
            "active window probe still in flight",
        );
    }

    let probe_in_flight = state.probe_in_flight.clone();
    let query = spawn_blocking(move || {
        let _guard = ForegroundProbeInFlightGuard { probe_in_flight };
        probe()
    });

    match timeout(timeout_duration, query).await {
        Ok(Ok(window)) => {
            remember_successful_window(&state, &window);
            WindowPollOutcome {
                window,
                probe_status: TrackingRuntimeProbeStatus::Ok,
                degraded_reason: None,
            }
        }
        Ok(Err(error)) => fallback_outcome(
            &state,
            TrackingRuntimeProbeStatus::TaskFailedFallback,
            TrackingRuntimeProbeStatus::TaskFailedInactive,
            &format!("active window poll task failed: {error}"),
        ),
        Err(_) => fallback_outcome(
            &state,
            TrackingRuntimeProbeStatus::TimeoutFallback,
            TrackingRuntimeProbeStatus::TimeoutInactive,
            &format!(
                "active window poll timed out after {} seconds",
                timeout_duration.as_secs()
            ),
        ),
    }
}

fn fallback_outcome(
    state: &ForegroundProbeState,
    fallback_status: TrackingRuntimeProbeStatus,
    inactive_status: TrackingRuntimeProbeStatus,
    degraded_reason: &str,
) -> WindowPollOutcome {
    let window = load_last_successful_window(state);
    let has_cached_window = window.is_some();
    WindowPollOutcome {
        window: window.unwrap_or_else(inactive_window),
        probe_status: if has_cached_window {
            fallback_status
        } else {
            inactive_status
        },
        degraded_reason: Some(degraded_reason.to_string()),
    }
}

fn remember_successful_window(state: &ForegroundProbeState, window: &tracker::WindowInfo) {
    match state.last_successful_window.lock() {
        Ok(mut guard) => {
            *guard = Some(window.clone());
        }
        Err(poisoned) => {
            let mut guard = poisoned.into_inner();
            *guard = Some(window.clone());
        }
    }
}

fn load_last_successful_window(state: &ForegroundProbeState) -> Option<tracker::WindowInfo> {
    match state.last_successful_window.lock() {
        Ok(guard) => guard.clone(),
        Err(poisoned) => poisoned.into_inner().clone(),
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
        self.probe_in_flight.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::thread;

    fn make_window(exe_name: &str) -> tracker::WindowInfo {
        tracker::WindowInfo {
            hwnd: "0x100".into(),
            root_owner_hwnd: "0x100".into(),
            process_id: 123,
            window_class: "Chrome_WidgetWin_1".into(),
            title: "Window".into(),
            exe_name: exe_name.into(),
            process_path: format!(r"C:\Program Files\{exe_name}"),
            is_afk: false,
            idle_time_ms: 0,
        }
    }

    #[test]
    fn poll_returns_cached_window_when_probe_times_out() {
        tauri::async_runtime::block_on(async {
            let state = Arc::new(ForegroundProbeState::default());
            remember_successful_window(&state, &make_window("Code.exe"));

            let outcome = poll_active_window_with_state(
                state,
                Duration::from_millis(10),
                || {
                    thread::sleep(Duration::from_millis(80));
                    make_window("Late.exe")
                },
            )
            .await;

            assert_eq!(outcome.window.exe_name, "Code.exe");
            assert_eq!(outcome.probe_status, TrackingRuntimeProbeStatus::TimeoutFallback);
            assert!(!outcome.is_successful_sample());
        });
    }

    #[test]
    fn poll_returns_inactive_window_when_probe_times_out_without_cache() {
        tauri::async_runtime::block_on(async {
            let state = Arc::new(ForegroundProbeState::default());

            let outcome = poll_active_window_with_state(
                state,
                Duration::from_millis(10),
                || {
                    thread::sleep(Duration::from_millis(80));
                    make_window("Late.exe")
                },
            )
            .await;

            assert_eq!(outcome.window.exe_name, "");
            assert_eq!(outcome.probe_status, TrackingRuntimeProbeStatus::TimeoutInactive);
            assert!(!outcome.is_successful_sample());
        });
    }

    #[test]
    fn concurrent_polls_reuse_single_in_flight_probe() {
        tauri::async_runtime::block_on(async {
            let state = Arc::new(ForegroundProbeState::default());
            remember_successful_window(&state, &make_window("Code.exe"));
            let calls = Arc::new(AtomicUsize::new(0));
            let first_calls = calls.clone();
            let first_state = state.clone();

            let first = tauri::async_runtime::spawn(async move {
                poll_active_window_with_state(
                    first_state,
                    Duration::from_millis(30),
                    move || {
                        first_calls.fetch_add(1, Ordering::SeqCst);
                        thread::sleep(Duration::from_millis(120));
                        make_window("Late.exe")
                    },
                )
                .await
            });

            tokio::time::sleep(Duration::from_millis(5)).await;
            for _ in 0..10 {
                let outcome = poll_active_window_with_state(
                    state.clone(),
                    Duration::from_millis(30),
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
                || make_window("Code.exe"),
            )
            .await;

            assert_eq!(outcome.probe_status, TrackingRuntimeProbeStatus::Ok);
            assert!(outcome.is_successful_sample());
            assert_eq!(
                load_last_successful_window(&state).unwrap().exe_name,
                "Code.exe"
            );
        });
    }
}
