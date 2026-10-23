#[cfg(debug_assertions)]
pub(crate) mod acceptance;
mod fault;
#[cfg(debug_assertions)]
mod fixture;
mod process;
mod protocol;
mod worker;

use super::foreground::WindowInfo;
use crate::domain::tracking::{AudioSnapshot, SustainedParticipationSignalSnapshot};
pub use fault::NativeProbeFault;
use process::ProbeProcess;
pub(crate) use protocol::IconRequest;
use protocol::{ProbeKind, Request, RequestBody};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub(crate) use worker::run_if_requested;
const CALL_BUDGET: Duration = Duration::from_millis(1_500);
const CLEANUP_BUDGET: Duration = Duration::from_secs(5);

#[derive(Default)]
struct ProbeCounters {
    observer: Mutex<Option<Arc<process::ExitObserver>>>,
    started_at: AtomicU64,
    requests: AtomicU64,
    failed: AtomicU64,
    succeeded: AtomicU64,
    timed_out: AtomicU64,
    rejected: AtomicU64,
    waiters: [AtomicU64; 2],
    process_id: AtomicU32,
    last_response_at: AtomicU64,
    process_cache: AtomicU64,
    process_details_bytes: AtomicU64,
    process_identities: AtomicU64,
    process_identity_bytes: AtomicU64,
    icon_cache: AtomicU64,
    icon_bytes: AtomicU64,
    shell_entries: AtomicU64,
    shell_bytes: AtomicU64,
    last_error: Mutex<Option<&'static str>>,
    exits: AtomicU64,
    last_exit: Mutex<Option<NativeProbeExit>>,
    last_abnormal_exit: Mutex<Option<NativeProbeExit>>,
    shell: Mutex<Option<ShellProbeDiagnostics>>,
}

fn counters() -> &'static [ProbeCounters; 6] {
    static COUNTERS: OnceLock<[ProbeCounters; 6]> = OnceLock::new();
    COUNTERS.get_or_init(|| std::array::from_fn(|_| ProbeCounters::default()))
}

fn elapsed_ms() -> u64 {
    static CLOCK: OnceLock<Instant> = OnceLock::new();
    CLOCK.get_or_init(Instant::now).elapsed().as_millis() as u64 + 1
}

struct CallGuard(&'static ProbeCounters);
impl Drop for CallGuard {
    fn drop(&mut self) {
        self.0.started_at.store(0, Ordering::Release);
    }
}

struct WaitGuard<'a>(&'a AtomicU64);
impl<'a> WaitGuard<'a> {
    fn acquire(stats: &'a ProbeCounters) -> Option<Self> {
        stats.waiters.iter().find_map(|slot| {
            slot.compare_exchange(0, elapsed_ms(), Ordering::AcqRel, Ordering::Relaxed)
                .ok()
                .map(|_| Self(slot))
        })
    }
}
impl Drop for WaitGuard<'_> {
    fn drop(&mut self) {
        self.0.store(0, Ordering::Release);
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct NativeProbeExit {
    pub process_id: u32,
    pub code: u32,
    pub observed_at_ms: u64,
    // Strings preserve Windows' 100 ns identity without JSON number rounding.
    pub created_filetime: Option<String>,
    pub exited_filetime: Option<String>,
    pub termination_requested: bool,
    pub cleanup_elapsed_ms: Option<u64>,
    pub fault: Option<NativeProbeFault>,
}

impl NativeProbeExit {
    fn is_abnormal(&self) -> bool {
        // Cleanup may race an already-recorded exception. A later termination
        // request must not erase the native fault that preceded it.
        self.fault.is_some() || (self.code != 0 && !self.termination_requested)
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ShellProbeDiagnostics {
    pub requests: u64,
    pub failed: u64,
    pub last_exit: Option<NativeProbeExit>,
    pub last_abnormal_exit: Option<NativeProbeExit>,
}

#[derive(Clone, Debug, Serialize)]
pub struct NativeProbeDiagnostics {
    pub kind: &'static str,
    pub process_id: u32,
    pub in_flight_age_ms: Option<u64>,
    pub requests: u64,
    pub failed: u64,
    pub succeeded: u64,
    pub timed_out: u64,
    pub rejected: u64,
    pub queued: usize,
    pub queue_limit: usize,
    pub oldest_queued_age_ms: Option<u64>,
    pub last_response_age_ms: Option<u64>,
    pub caches: Option<protocol::ProbeCacheCounts>,
    pub last_error: Option<&'static str>,
    pub exits: u64,
    pub last_exit: Option<NativeProbeExit>,
    pub last_abnormal_exit: Option<NativeProbeExit>,
    pub shell: Option<ShellProbeDiagnostics>,
}

pub(crate) fn diagnostics() -> Vec<NativeProbeDiagnostics> {
    [
        ProbeKind::Foreground,
        ProbeKind::Name,
        ProbeKind::Icon,
        ProbeKind::Media,
        ProbeKind::Audio,
    ]
    .into_iter()
    .map(|kind| {
        let stats = &counters()[kind as usize];
        let observer = stats
            .observer
            .try_lock()
            .ok()
            .and_then(|value| value.clone());
        if let Some(observer) = observer {
            let _ = observer.observe();
        }
        let started = stats.started_at.load(Ordering::Acquire);
        let last_response = stats.last_response_at.load(Ordering::Acquire);
        let queued = stats
            .waiters
            .iter()
            .map(|slot| slot.load(Ordering::Acquire))
            .filter(|started| *started > 0)
            .collect::<Vec<_>>();
        NativeProbeDiagnostics {
            kind: kind.argument(),
            shell: stats.shell.try_lock().ok().and_then(|value| value.clone()),
            exits: stats.exits.load(Ordering::Relaxed),
            last_abnormal_exit: stats
                .last_abnormal_exit
                .try_lock()
                .ok()
                .and_then(|exit| exit.clone()),
            last_exit: stats
                .last_exit
                .try_lock()
                .ok()
                .and_then(|exit| exit.clone()),
            last_error: stats.last_error.try_lock().ok().and_then(|error| *error),
            process_id: stats.process_id.load(Ordering::Relaxed),
            in_flight_age_ms: (started > 0).then(|| elapsed_ms().saturating_sub(started)),
            requests: stats.requests.load(Ordering::Relaxed),
            failed: stats.failed.load(Ordering::Relaxed),
            succeeded: stats.succeeded.load(Ordering::Relaxed),
            timed_out: stats.timed_out.load(Ordering::Relaxed),
            rejected: stats.rejected.load(Ordering::Relaxed),
            queued: queued.len(),
            queue_limit: if matches!(kind, ProbeKind::Name | ProbeKind::Icon) {
                2
            } else {
                0
            },
            oldest_queued_age_ms: queued
                .into_iter()
                .min()
                .map(|started| elapsed_ms().saturating_sub(started)),
            last_response_age_ms: (last_response > 0)
                .then(|| elapsed_ms().saturating_sub(last_response)),
            caches: (last_response > 0).then(|| protocol::ProbeCacheCounts {
                process_details: stats.process_cache.load(Ordering::Relaxed) as usize,
                process_details_bytes: stats.process_details_bytes.load(Ordering::Relaxed) as usize,
                process_identities: stats.process_identities.load(Ordering::Relaxed) as usize,
                process_identity_bytes: stats.process_identity_bytes.load(Ordering::Relaxed)
                    as usize,
                icon_results: stats.icon_cache.load(Ordering::Relaxed) as usize,
                icon_bytes: stats.icon_bytes.load(Ordering::Relaxed) as usize,
                shell_entries: stats.shell_entries.load(Ordering::Relaxed) as usize,
                shell_bytes: stats.shell_bytes.load(Ordering::Relaxed) as usize,
            }),
        }
    })
    .collect()
}

#[derive(Default)]
struct Lane {
    process: Option<ProbeProcess>,
    next_id: u64,
    failures: u32,
    retry_after: Option<Instant>,
    retired: bool,
}

impl Lane {
    fn call<T: DeserializeOwned>(
        &mut self,
        executable: &std::path::Path,
        kind: ProbeKind,
        body: RequestBody,
        budget: Duration,
    ) -> Result<T, String> {
        if self.retired {
            return Err("probe termination unconfirmed".into());
        }
        if self
            .retry_after
            .is_some_and(|deadline| Instant::now() < deadline)
        {
            return Err("probe cooling down".into());
        }
        let result = self
            .exchange(executable, kind, body, budget)
            .and_then(|value| {
                serde_json::from_value(value).map_err(|_| "probe result shape invalid".to_owned())
            });
        match result {
            Ok(value) => {
                self.failures = 0;
                self.retry_after = None;
                Ok(value)
            }
            Err(error) => {
                self.failures = self.failures.saturating_add(1);
                self.retry_after = Some(Instant::now() + retry_delay(self.failures));
                if let Some(process) = self.process.as_mut().filter(|_| !self.retired) {
                    if process.stop(CLEANUP_BUDGET) {
                        self.process = None;
                    } else {
                        self.retired = true;
                    }
                }
                Err(error)
            }
        }
    }

    fn exchange(
        &mut self,
        executable: &std::path::Path,
        kind: ProbeKind,
        body: RequestBody,
        budget: Duration,
    ) -> Result<serde_json::Value, String> {
        // An idle child may have exited since its last response. Reap that
        // generation before sending the new request; never retry an in-flight
        // request whose native side effects are unknown.
        if let Some(process) = self.process.as_mut() {
            if process.observe_exit()? {
                if !process.stop(CLEANUP_BUDGET) {
                    self.retired = true;
                    return Err("probe termination unconfirmed".into());
                }
                self.process = None;
            }
        }
        if self.process.is_none() {
            self.process = Some(ProbeProcess::start(executable, kind)?);
        }
        self.next_id = self
            .next_id
            .checked_add(1)
            .ok_or("probe request sequence exhausted")?;
        let request = Request {
            version: protocol::VERSION,
            id: self.next_id,
            body,
        };
        let receiver = self
            .process
            .as_ref()
            .ok_or("probe unavailable")?
            .request(request)?;
        let response = receiver
            .recv_timeout(budget)
            .map_err(|error| match error {
                std::sync::mpsc::RecvTimeoutError::Timeout => "probe deadline exceeded",
                std::sync::mpsc::RecvTimeoutError::Disconnected => "probe pipe closed",
            })??;
        if response.version != protocol::VERSION || response.id != self.next_id {
            return Err("probe response identity invalid".into());
        }
        if kind == ProbeKind::Shell {
            // A Shell result is provisional until the native process and pipe
            // owner have exited. Internal COM workers never survive this call.
            let process = self.process.as_mut().ok_or("probe unavailable")?;
            if !process.finish(Duration::from_millis(250)) {
                return Err("probe normal exit unconfirmed".into());
            }
            self.process = None;
        }
        let stats = &counters()[kind as usize];
        if let Ok(mut shell) = stats.shell.lock() {
            *shell = response.shell;
        }
        stats
            .process_cache
            .store(response.caches.process_details as u64, Ordering::Relaxed);
        stats.process_details_bytes.store(
            response.caches.process_details_bytes as u64,
            Ordering::Relaxed,
        );
        stats
            .process_identities
            .store(response.caches.process_identities as u64, Ordering::Relaxed);
        stats.process_identity_bytes.store(
            response.caches.process_identity_bytes as u64,
            Ordering::Relaxed,
        );
        stats
            .icon_cache
            .store(response.caches.icon_results as u64, Ordering::Relaxed);
        stats
            .last_response_at
            .store(elapsed_ms(), Ordering::Release);
        stats
            .icon_bytes
            .store(response.caches.icon_bytes as u64, Ordering::Relaxed);
        stats
            .shell_entries
            .store(response.caches.shell_entries as u64, Ordering::Relaxed);
        stats
            .shell_bytes
            .store(response.caches.shell_bytes as u64, Ordering::Relaxed);
        response.result
    }
}

fn retry_delay(failures: u32) -> Duration {
    Duration::from_secs((1_u64 << failures.min(5)).min(30))
}

fn lanes() -> &'static [Mutex<Lane>; 6] {
    static LANES: OnceLock<[Mutex<Lane>; 6]> = OnceLock::new();
    LANES.get_or_init(|| std::array::from_fn(|_| Mutex::new(Lane::default())))
}

fn call<T: DeserializeOwned>(kind: ProbeKind, body: RequestBody) -> Result<T, String> {
    let executable = std::env::current_exe().map_err(|_| "probe executable unavailable")?;
    #[cfg(test)]
    let executable = std::env::var_os("PATINA_RESOURCE_PROBE_EXECUTABLE")
        .map(std::path::PathBuf::from)
        .unwrap_or(executable);
    // Name/icon callers already run in bounded blocking slots. Serialize those
    // slots within their own lane so ordinary overlap is not negative-cached as
    // missing metadata. Required facts never queue behind optional work.
    let stats = &counters()[kind as usize];
    let lane = &lanes()[kind as usize];
    let mut lane = if matches!(kind, ProbeKind::Name | ProbeKind::Icon) {
        let Some(_waiting) = WaitGuard::acquire(stats) else {
            stats.rejected.fetch_add(1, Ordering::Relaxed);
            return Err("probe queue full".into());
        };
        lane.lock().map_err(|_| "probe lane poisoned")
    } else {
        lane.try_lock().map_err(|_| "probe already in flight")
    }
    .inspect_err(|_| {
        stats.rejected.fetch_add(1, Ordering::Relaxed);
    })?;
    let _guard = CallGuard(stats);
    stats.started_at.store(elapsed_ms(), Ordering::Release);
    stats.requests.fetch_add(1, Ordering::Relaxed);
    let result = lane.call(&executable, kind, body, CALL_BUDGET);
    if let Err(error) = &result {
        stats.failed.fetch_add(1, Ordering::Relaxed);
        if error == "probe deadline exceeded" {
            stats.timed_out.fetch_add(1, Ordering::Relaxed);
        }
        if let Ok(mut last) = stats.last_error.try_lock() {
            *last = Some(match error.as_str() {
                "probe deadline exceeded" => "deadline",
                "probe cooling down" => "cooldown",
                "probe termination unconfirmed" => "termination-unconfirmed",
                "probe process start failed" => "start",
                "probe Job assignment failed" => "job-assignment",
                "probe pipe closed" | "probe pipe write failed" => "pipe",
                "probe response identity invalid"
                | "probe result shape invalid"
                | "probe frame invalid"
                | "probe frame exceeds limit" => "protocol",
                _ => "native-call",
            });
        }
    } else {
        stats.succeeded.fetch_add(1, Ordering::Relaxed);
    }
    result
}

#[derive(Serialize, Deserialize)]
struct ForegroundResponse {
    window: WindowInfo,
    app_user_model_id: String,
}

pub(crate) fn foreground(afk_threshold_secs: u64) -> Result<WindowInfo, String> {
    let mut result: ForegroundResponse = call(
        ProbeKind::Foreground,
        RequestBody::Foreground { afk_threshold_secs },
    )?;
    result.window.app_user_model_id = result.app_user_model_id;
    Ok(result.window)
}

pub(crate) fn name(process_path: &str, app_user_model_id: &str) -> Option<String> {
    call(
        ProbeKind::Name,
        RequestBody::Name {
            process_path: process_path.to_owned(),
            app_user_model_id: app_user_model_id.to_owned(),
        },
    )
    .ok()
    .flatten()
}

pub(crate) fn icon(request: IconRequest) -> Option<String> {
    call(ProbeKind::Icon, RequestBody::Icon(request))
        .ok()
        .flatten()
}

pub(crate) fn media() -> Result<Option<SustainedParticipationSignalSnapshot>, String> {
    call(ProbeKind::Media, RequestBody::Media)
}

pub(crate) fn audio(timestamp_ms: i64) -> Result<AudioSnapshot, String> {
    call(ProbeKind::Audio, RequestBody::Audio { timestamp_ms })
}

pub(super) fn shell(app_user_model_id: &str, icon: bool) -> Option<String> {
    call(
        ProbeKind::Shell,
        RequestBody::Shell {
            app_user_model_id: app_user_model_id.to_owned(),
            icon,
        },
    )
    .ok()
    .flatten()
}

pub(super) fn shell_diagnostics() -> Option<ShellProbeDiagnostics> {
    let stats = &counters()[ProbeKind::Shell as usize];
    let requests = stats.requests.load(Ordering::Relaxed);
    (requests > 0).then(|| ShellProbeDiagnostics {
        requests,
        failed: stats.failed.load(Ordering::Relaxed),
        last_exit: stats.last_exit.lock().ok().and_then(|value| value.clone()),
        last_abnormal_exit: stats
            .last_abnormal_exit
            .lock()
            .ok()
            .and_then(|value| value.clone()),
    })
}

pub(crate) fn shutdown() {
    for lane in lanes() {
        if let Ok(mut lane) = lane.try_lock() {
            lane.retired = true;
            if let Some(process) = lane.process.as_mut() {
                process.stop(CLEANUP_BUDGET);
            }
        }
    }
    // A busy lane remains owned by this process; closing its Job at process exit
    // also terminates the child. It never inherits the Job ownership handle.
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn optional_probe_waiting_slots_are_bounded_and_unwind_releases_admission() {
        let stats = ProbeCounters::default();
        let first = WaitGuard::acquire(&stats).unwrap();
        let failed = std::panic::catch_unwind(|| {
            let _second = WaitGuard::acquire(&stats).unwrap();
            assert!(WaitGuard::acquire(&stats).is_none());
            panic!("controlled waiter unwind");
        });
        assert!(failed.is_err());
        let second = WaitGuard::acquire(&stats).unwrap();
        assert!(WaitGuard::acquire(&stats).is_none());
        drop((first, second));
        assert!(stats
            .waiters
            .iter()
            .all(|slot| slot.load(Ordering::Acquire) == 0));
    }
    #[test]
    fn retries_are_bounded_and_never_spin() {
        assert_eq!(retry_delay(1), Duration::from_secs(2));
        assert_eq!(retry_delay(2), Duration::from_secs(4));
        assert_eq!(retry_delay(u32::MAX), Duration::from_secs(30));
    }
}
