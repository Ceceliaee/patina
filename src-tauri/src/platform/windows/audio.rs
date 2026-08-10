use crate::domain::tracking::{
    evaluate_sustained_participation_signal, sustained_participation_app_identity,
    AudioProbeStatus, AudioSessionFact, AudioSignalState, AudioSnapshot,
    SustainedParticipationSignalMatchResult, SustainedParticipationSignalSnapshot,
    SustainedParticipationSignalSource,
};
use crate::platform::windows::foreground::{self, WindowInfo};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use tokio::{
    task::spawn_blocking,
    time::{sleep, timeout, Duration},
};
use windows::core::Interface;
use windows::Win32::Foundation::RPC_E_CHANGED_MODE;
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, AudioSessionStateActive, IAudioSessionControl2, IAudioSessionManager2,
    IMMDeviceEnumerator, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

const AUDIO_SESSION_QUERY_TIMEOUT_SECS: u64 = 2;
const AUDIO_SNAPSHOT_TTL_MS: i64 = 15_000;
const AUDIO_RECONCILE_INTERVAL_SECS: u64 = 10;
const AUDIO_SESSION_LIMIT: usize = 64;
const AUDIO_PROBE_LOG_THROTTLE_MS: i64 = 60_000;

static AUDIO_SIGNAL_SOURCE: OnceLock<Arc<AudioSignalSourceState>> = OnceLock::new();

#[derive(Debug)]
struct AudioSignalSourceState {
    snapshot: Mutex<AudioSnapshot>,
    probe_in_flight: Arc<AtomicBool>,
}

struct AudioProbeInFlightGuard {
    probe_in_flight: Arc<AtomicBool>,
}

pub fn start_signal_source() {
    let state = AUDIO_SIGNAL_SOURCE
        .get_or_init(|| Arc::new(AudioSignalSourceState::new()))
        .clone();

    tauri::async_runtime::spawn(async move {
        state.run().await;
    });
}

pub async fn get_sustained_participation_signal(
    window: &WindowInfo,
) -> SustainedParticipationSignalSnapshot {
    if window.exe_name.trim().is_empty() {
        return SustainedParticipationSignalSnapshot::default();
    }

    let now_ms = now_ms();
    let Some(state) = AUDIO_SIGNAL_SOURCE.get() else {
        return SustainedParticipationSignalSnapshot::default();
    };

    state.resolve_signal_for_window(window, now_ms)
}

impl AudioSignalSourceState {
    fn new() -> Self {
        Self {
            snapshot: Mutex::new(AudioSnapshot::unknown(now_ms(), AUDIO_SNAPSHOT_TTL_MS)),
            probe_in_flight: Arc::new(AtomicBool::new(false)),
        }
    }

    async fn run(&self) {
        loop {
            self.reconcile_once().await;
            sleep(Duration::from_secs(AUDIO_RECONCILE_INTERVAL_SECS)).await;
        }
    }

    async fn reconcile_once(&self) {
        let started_at_ms = now_ms();
        if self.probe_in_flight.swap(true, Ordering::AcqRel) {
            self.replace_snapshot(self.unavailable_snapshot(AudioProbeStatus::BackingOff));
            return;
        }

        let probe_in_flight = self.probe_in_flight.clone();
        let query = spawn_blocking(move || {
            let _guard = AudioProbeInFlightGuard { probe_in_flight };
            query_audio_snapshot(started_at_ms)
        });

        let snapshot =
            match timeout(Duration::from_secs(AUDIO_SESSION_QUERY_TIMEOUT_SECS), query).await {
                Ok(Ok(Ok(snapshot))) => snapshot,
                Ok(Ok(Err(error))) => {
                    log_audio_probe_error(format!("failed to reconcile audio sessions: {error}"));
                    self.unavailable_snapshot(AudioProbeStatus::WindowsApiFailed)
                }
                Ok(Err(error)) => {
                    log_audio_probe_error(format!("audio session query task failed: {error}"));
                    self.unavailable_snapshot(AudioProbeStatus::WindowsApiFailed)
                }
                Err(_) => {
                    log_audio_probe_error(format!(
                        "timed out reconciling audio sessions after {}s",
                        AUDIO_SESSION_QUERY_TIMEOUT_SECS
                    ));
                    self.unavailable_snapshot(AudioProbeStatus::Timeout)
                }
            };

        self.replace_snapshot(snapshot);
    }

    fn unavailable_snapshot(&self, status: AudioProbeStatus) -> AudioSnapshot {
        let last_success_at_ms = self
            .snapshot
            .lock()
            .ok()
            .and_then(|snapshot| snapshot.last_success_at_ms);
        AudioSnapshot::probe_unavailable(
            now_ms(),
            AUDIO_SNAPSHOT_TTL_MS,
            status,
            last_success_at_ms,
        )
    }

    fn replace_snapshot(&self, snapshot: AudioSnapshot) {
        if let Ok(mut current) = self.snapshot.lock() {
            *current = snapshot;
        }
    }

    fn resolve_signal_for_window(
        &self,
        window: &WindowInfo,
        now_ms: i64,
    ) -> SustainedParticipationSignalSnapshot {
        let snapshot = match self.snapshot.lock() {
            Ok(snapshot) => snapshot.clone(),
            Err(_) => return SustainedParticipationSignalSnapshot::default(),
        };

        if snapshot.signal_state(now_ms) != AudioSignalState::Active {
            return SustainedParticipationSignalSnapshot::default();
        }

        let mut fallback_active: Option<SustainedParticipationSignalSnapshot> = None;
        for session in snapshot.sessions {
            let signal = session_fact_to_signal(&session);
            match evaluate_sustained_participation_signal(
                &window.exe_name,
                &window.process_path,
                &signal,
            )
            .match_result
            {
                SustainedParticipationSignalMatchResult::Matched => return signal,
                SustainedParticipationSignalMatchResult::IdentityMismatch
                | SustainedParticipationSignalMatchResult::Inactive => {
                    if fallback_active.is_none() {
                        fallback_active = Some(signal);
                    }
                }
                SustainedParticipationSignalMatchResult::Unavailable => {}
            }
        }

        fallback_active.unwrap_or_default()
    }
}

impl Drop for AudioProbeInFlightGuard {
    fn drop(&mut self) {
        self.probe_in_flight.store(false, Ordering::Release);
    }
}

fn query_audio_snapshot(now_ms: i64) -> Result<AudioSnapshot, String> {
    let _com = ComGuard::initialize()?;
    let mut sessions = Vec::new();

    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                .map_err(|error| format!("creating audio device enumerator failed: {error}"))?;
        let device = enumerator
            .GetDefaultAudioEndpoint(eRender, eMultimedia)
            .map_err(|error| format!("loading default audio endpoint failed: {error}"))?;
        let manager = device
            .Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
            .map_err(|error| format!("activating audio session manager failed: {error}"))?;
        let session_enumerator = manager
            .GetSessionEnumerator()
            .map_err(|error| format!("loading audio sessions failed: {error}"))?;
        let session_count = session_enumerator
            .GetCount()
            .map_err(|error| format!("reading audio session count failed: {error}"))?;

        for index in 0..session_count {
            let session = session_enumerator
                .GetSession(index)
                .map_err(|error| format!("reading audio session at {index} failed: {error}"))?;
            let session = session
                .cast::<IAudioSessionControl2>()
                .map_err(|error| format!("casting audio session at {index} failed: {error}"))?;
            let state = session.GetState().map_err(|error| {
                format!("reading audio session state at {index} failed: {error}")
            })?;
            if state != AudioSessionStateActive {
                continue;
            }

            let process_id = session.GetProcessId().map_err(|error| {
                format!("reading audio session process at {index} failed: {error}")
            })?;
            let process_exe_name = foreground::get_process_exe_name(process_id);
            let process_path = foreground::get_process_path(process_id);
            let source_identity =
                sustained_participation_app_identity(&process_exe_name, &process_path);

            sessions.push(AudioSessionFact {
                session_id: format!("{}:{}", process_id, process_exe_name.to_ascii_lowercase()),
                process_id,
                exe_name: process_exe_name,
                process_path: if process_path.trim().is_empty() {
                    None
                } else {
                    Some(process_path)
                },
                source_identity,
                state: AudioSignalState::Active,
                first_observed_at_ms: now_ms,
                last_observed_at_ms: now_ms,
            });

            if sessions.len() >= AUDIO_SESSION_LIMIT {
                break;
            }
        }
    }

    if sessions.is_empty() {
        return Ok(AudioSnapshot::empty_success(now_ms, AUDIO_SNAPSHOT_TTL_MS));
    }

    Ok(AudioSnapshot {
        generated_at_ms: now_ms,
        last_success_at_ms: Some(now_ms),
        last_error_at_ms: None,
        freshness_deadline_ms: now_ms.saturating_add(AUDIO_SNAPSHOT_TTL_MS),
        probe_status: AudioProbeStatus::Ok,
        sessions,
    })
}

fn session_fact_to_signal(session: &AudioSessionFact) -> SustainedParticipationSignalSnapshot {
    SustainedParticipationSignalSnapshot {
        is_available: true,
        is_active: session.state == AudioSignalState::Active,
        signal_source: Some(SustainedParticipationSignalSource::AudioSession),
        source_app_id: Some(session.exe_name.clone()),
        source_app_identity: session.source_identity,
        playback_type: None,
    }
}

fn log_audio_probe_error(message: String) {
    static LAST_LOGGED_AT_MS: OnceLock<Mutex<i64>> = OnceLock::new();
    let now_ms = now_ms();
    let last_logged_at_ms = LAST_LOGGED_AT_MS.get_or_init(|| Mutex::new(0));

    if let Ok(mut last_logged_at_ms) = last_logged_at_ms.lock() {
        if now_ms.saturating_sub(*last_logged_at_ms) < AUDIO_PROBE_LOG_THROTTLE_MS {
            return;
        }

        *last_logged_at_ms = now_ms;
    }

    eprintln!("[audio] {message}");
}

fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}

struct ComGuard {
    should_uninitialize: bool,
}

impl ComGuard {
    fn initialize() -> Result<Self, String> {
        let result = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        if result.is_ok() {
            return Ok(Self {
                should_uninitialize: true,
            });
        }

        if result == RPC_E_CHANGED_MODE {
            return Ok(Self {
                should_uninitialize: false,
            });
        }

        Err(format!("initializing COM failed: {result}"))
    }
}

impl Drop for ComGuard {
    fn drop(&mut self) {
        if self.should_uninitialize {
            unsafe { CoUninitialize() };
        }
    }
}
