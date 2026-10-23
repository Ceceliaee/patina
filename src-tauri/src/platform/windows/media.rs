use crate::domain::tracking::{
    evaluate_sustained_participation_signal, source_app_id_identity,
    SustainedParticipationSignalMatchResult, SustainedParticipationSignalSnapshot,
    SustainedParticipationSignalSource, SystemMediaPlaybackType,
};
use crate::platform::windows::foreground::WindowInfo;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex, OnceLock,
};
use tokio::time::{sleep, timeout, Duration};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Media::MediaPlaybackType;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

const MEDIA_SESSION_QUERY_TIMEOUT_SECS: u64 = 2;
const MEDIA_SNAPSHOT_TTL_MS: i64 = 15_000;
const MEDIA_RECONCILE_INTERVAL_SECS: u64 = 10;
const MEDIA_PROBE_LOG_THROTTLE_MS: i64 = 60_000;

static MEDIA_SIGNAL_SOURCE: OnceLock<Arc<MediaSignalSourceState>> = OnceLock::new();

#[derive(Debug)]
struct MediaSnapshot {
    generated_at_ms: i64,
    freshness_deadline_ms: i64,
    signal: SustainedParticipationSignalSnapshot,
}

#[derive(Debug)]
struct MediaSignalSourceState {
    snapshot: Mutex<MediaSnapshot>,
    probe_in_flight: Arc<AtomicBool>,
}

struct MediaProbeInFlightGuard {
    probe_in_flight: Arc<AtomicBool>,
}

pub fn start_signal_source() {
    let state = MEDIA_SIGNAL_SOURCE
        .get_or_init(|| Arc::new(MediaSignalSourceState::new()))
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

    let Some(state) = MEDIA_SIGNAL_SOURCE.get() else {
        return SustainedParticipationSignalSnapshot::default();
    };

    state.resolve_signal_for_window(window, now_ms())
}

impl MediaSignalSourceState {
    fn new() -> Self {
        Self {
            snapshot: Mutex::new(MediaSnapshot {
                generated_at_ms: now_ms(),
                freshness_deadline_ms: now_ms().saturating_add(MEDIA_SNAPSHOT_TTL_MS),
                signal: SustainedParticipationSignalSnapshot::default(),
            }),
            probe_in_flight: Arc::new(AtomicBool::new(false)),
        }
    }

    async fn run(&self) {
        loop {
            self.reconcile_once().await;
            sleep(Duration::from_secs(MEDIA_RECONCILE_INTERVAL_SECS)).await;
        }
    }

    async fn reconcile_once(&self) {
        self.reconcile_with_probe(
            Duration::from_secs(MEDIA_SESSION_QUERY_TIMEOUT_SECS),
            query_media_session_signal,
        )
        .await;
    }

    async fn reconcile_with_probe<F>(&self, query_timeout: Duration, probe: F)
    where
        F: FnOnce() -> Result<Option<SustainedParticipationSignalSnapshot>, String>
            + Send
            + 'static,
    {
        let now_ms = now_ms();
        if self.probe_in_flight.swap(true, Ordering::AcqRel) {
            self.replace_snapshot(MediaSnapshot {
                generated_at_ms: now_ms,
                freshness_deadline_ms: now_ms.saturating_add(MEDIA_SNAPSHOT_TTL_MS),
                signal: SustainedParticipationSignalSnapshot::default(),
            });
            return;
        }

        let probe_in_flight = self.probe_in_flight.clone();
        // COM calls can block without yielding, even when RequestAsync is used.
        // Keep them off the executor that owns tracking, timers and IPC.
        let query = tokio::task::spawn_blocking(move || {
            let _guard = MediaProbeInFlightGuard { probe_in_flight };
            probe()
        });

        let signal = match timeout(query_timeout, query).await {
            Ok(Ok(Ok(Some(signal)))) => signal,
            Ok(Ok(Ok(None))) => SustainedParticipationSignalSnapshot::default(),
            Ok(Ok(Err(error))) => {
                log_media_probe_error(format!(
                    "failed to reconcile system media sessions: {error}"
                ));
                SustainedParticipationSignalSnapshot::default()
            }
            Ok(Err(error)) => {
                log_media_probe_error(format!("system media query task failed: {error}"));
                SustainedParticipationSignalSnapshot::default()
            }
            Err(_) => {
                log_media_probe_error(format!(
                    "timed out reconciling system media sessions after {MEDIA_SESSION_QUERY_TIMEOUT_SECS}s"
                ));
                SustainedParticipationSignalSnapshot::default()
            }
        };

        self.replace_snapshot(MediaSnapshot {
            generated_at_ms: now_ms,
            freshness_deadline_ms: now_ms.saturating_add(MEDIA_SNAPSHOT_TTL_MS),
            signal,
        });
    }

    fn replace_snapshot(&self, snapshot: MediaSnapshot) {
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
            Ok(snapshot) => MediaSnapshot {
                generated_at_ms: snapshot.generated_at_ms,
                freshness_deadline_ms: snapshot.freshness_deadline_ms,
                signal: snapshot.signal.clone(),
            },
            Err(_) => return SustainedParticipationSignalSnapshot::default(),
        };

        if now_ms > snapshot.freshness_deadline_ms {
            return SustainedParticipationSignalSnapshot::default();
        }

        if evaluate_sustained_participation_signal(
            &window.exe_name,
            &window.process_path,
            &snapshot.signal,
        )
        .match_result
            == SustainedParticipationSignalMatchResult::Unavailable
        {
            return SustainedParticipationSignalSnapshot::default();
        }

        snapshot.signal
    }
}

impl Drop for MediaProbeInFlightGuard {
    fn drop(&mut self) {
        self.probe_in_flight.store(false, Ordering::Release);
    }
}

fn query_media_session_signal() -> Result<Option<SustainedParticipationSignalSnapshot>, String> {
    super::native_probe::media()
}

pub(super) struct MediaSessionProbe {
    // Fields drop in declaration order: release the manager before its apartment.
    manager: GlobalSystemMediaTransportControlsSessionManager,
    _apartment: MediaApartment,
}

impl MediaSessionProbe {
    pub(super) fn new() -> Result<Self, String> {
        let apartment = MediaApartment::initialize()?;
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|error| format!("requesting media session manager failed: {error}"))?
            .join()
            .map_err(|error| format!("awaiting media session manager failed: {error}"))?;
        Ok(Self {
            manager,
            _apartment: apartment,
        })
    }

    pub(super) fn query(&self) -> Result<Option<SustainedParticipationSignalSnapshot>, String> {
        // RequestAsync activation grows native allocations when repeated. Retain
        // one manager per helper, but fetch current sessions and playback each time.
        query_media_session_signal_native(&self.manager)
    }
}

fn query_media_session_signal_native(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
) -> Result<Option<SustainedParticipationSignalSnapshot>, String> {
    let sessions = manager
        .GetSessions()
        .map_err(|error| format!("loading media sessions failed: {error}"))?;
    let session_count = sessions
        .Size()
        .map_err(|error| format!("reading media session count failed: {error}"))?;

    let mut fallback_active: Option<SustainedParticipationSignalSnapshot> = None;
    let mut fallback_available: Option<SustainedParticipationSignalSnapshot> = None;

    for index in 0..session_count {
        let session = sessions
            .GetAt(index)
            .map_err(|error| format!("reading media session at {index} failed: {error}"))?;
        let signal = build_signal_snapshot(&session)?;
        if signal.is_active {
            if fallback_active.is_none() {
                fallback_active = Some(signal);
            }
        } else if signal.is_available && fallback_available.is_none() {
            fallback_available = Some(signal);
        }
    }

    Ok(fallback_active.or(fallback_available))
}

struct MediaApartment(std::marker::PhantomData<std::rc::Rc<()>>);

impl MediaApartment {
    fn initialize() -> Result<Self, String> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
            .map_err(|error| format!("initializing media WinRT apartment failed: {error}"))?;
        Ok(Self(std::marker::PhantomData))
    }
}

impl Drop for MediaApartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

fn build_signal_snapshot(
    session: &GlobalSystemMediaTransportControlsSession,
) -> Result<SustainedParticipationSignalSnapshot, String> {
    let source_app_id = session
        .SourceAppUserModelId()
        .map_err(|error| format!("reading media source app id failed: {error}"))?
        .to_string_lossy();
    let playback_info = session
        .GetPlaybackInfo()
        .map_err(|error| format!("reading media playback info failed: {error}"))?;
    let playback_status = playback_info
        .PlaybackStatus()
        .map_err(|error| format!("reading media playback status failed: {error}"))?;
    let playback_type = playback_info
        .PlaybackType()
        .ok()
        .and_then(|value| value.Value().ok())
        .map(map_playback_type);

    let source_app_identity = source_app_id_identity(&source_app_id);
    let signal = SustainedParticipationSignalSnapshot {
        is_available: true,
        is_active: playback_status
            == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing,
        signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
        source_app_id: Some(source_app_id),
        source_app_identity,
        playback_type,
    };

    Ok(signal)
}

fn map_playback_type(value: MediaPlaybackType) -> SystemMediaPlaybackType {
    if value == MediaPlaybackType::Video {
        return SystemMediaPlaybackType::Video;
    }

    if value == MediaPlaybackType::Music {
        return SystemMediaPlaybackType::Audio;
    }

    if value == MediaPlaybackType::Image {
        return SystemMediaPlaybackType::Image;
    }

    SystemMediaPlaybackType::Unknown
}

fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
}

fn log_media_probe_error(message: String) {
    static LAST_LOGGED_AT_MS: OnceLock<Mutex<i64>> = OnceLock::new();
    let now_ms = now_ms();
    let last_logged_at_ms = LAST_LOGGED_AT_MS.get_or_init(|| Mutex::new(0));

    if let Ok(mut last_logged_at_ms) = last_logged_at_ms.lock() {
        if now_ms.saturating_sub(*last_logged_at_ms) < MEDIA_PROBE_LOG_THROTTLE_MS {
            return;
        }

        *last_logged_at_ms = now_ms;
    }

    eprintln!("[media] {message}");
}

#[cfg(test)]
mod tests {
    use super::map_playback_type;
    use crate::domain::tracking::SystemMediaPlaybackType;
    use windows::Media::MediaPlaybackType;

    #[test]
    fn busy_media_probe_cannot_starve_timeout_or_accumulate_retries() {
        use super::*;
        use std::time::Instant;

        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let released = Arc::new(AtomicBool::new(false));
        let completed = Arc::new(AtomicBool::new(false));
        let release_probe = released.clone();
        let probe_completed = completed.clone();
        let state = MediaSignalSourceState::new();
        runtime.block_on(async {
            state
                .reconcile_with_probe(Duration::from_millis(20), move || {
                    // Deliberately consume a worker without yielding; the deadline bounds
                    // the failing implementation as well as the test's cleanup.
                    let deadline = Instant::now() + Duration::from_secs(2);
                    while !release_probe.load(Ordering::Acquire) && Instant::now() < deadline {
                        std::hint::spin_loop();
                    }
                    probe_completed.store(true, Ordering::Release);
                    Ok(None)
                })
                .await;
            let timed_out_before_completion = !completed.load(Ordering::Acquire);
            let in_flight_after_timeout = state.probe_in_flight.load(Ordering::Acquire);
            let retries = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            for _ in 0..100 {
                let retries = retries.clone();
                state
                    .reconcile_with_probe(Duration::from_millis(20), move || {
                        retries.fetch_add(1, Ordering::Relaxed);
                        Ok(None)
                    })
                    .await;
            }
            released.store(true, Ordering::Release);
            assert!(
                timed_out_before_completion,
                "native busy loop starved the async timeout"
            );
            assert!(in_flight_after_timeout);
            assert_eq!(retries.load(Ordering::Relaxed), 0);
            timeout(Duration::from_secs(3), async {
                while state.probe_in_flight.load(Ordering::Acquire) {
                    tokio::task::yield_now().await;
                }
            })
            .await
            .expect("probe failed to release its in-flight guard");
            state
                .reconcile_with_probe(Duration::from_secs(1), || Ok(None))
                .await;
            assert!(!state.probe_in_flight.load(Ordering::Acquire));
        });
    }

    #[test]
    fn busy_media_probe_does_not_stop_multi_worker_timers() {
        use super::*;
        use std::sync::mpsc;
        use std::time::Instant;

        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(4)
            .enable_all()
            .build()
            .unwrap();
        let release = Arc::new(AtomicBool::new(false));
        let probe_release = release.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (timer_tx, timer_rx) = mpsc::channel();
        let probe = runtime.spawn(async move {
            // Let the workers park before a timer wakes the native probe. A busy
            // driver-owning worker must not strand the other timers while idle.
            sleep(Duration::from_millis(50)).await;
            MediaSignalSourceState::new()
                .reconcile_with_probe(Duration::from_millis(20), move || {
                    started_tx.send(()).unwrap();
                    let deadline = Instant::now() + Duration::from_secs(3);
                    while !probe_release.load(Ordering::Acquire) && Instant::now() < deadline {
                        std::hint::spin_loop();
                    }
                    Ok(None)
                })
                .await;
        });
        let timer = runtime.spawn(async move {
            sleep(Duration::from_millis(150)).await;
            let _ = timer_tx.send(());
        });
        let started = started_rx.recv_timeout(Duration::from_secs(2));
        // This deadline runs outside Tokio so a frozen timer driver cannot also
        // freeze the test's failure detection or leave its busy probe running.
        let timer_result = timer_rx.recv_timeout(Duration::from_secs(1));
        release.store(true, Ordering::Release);
        runtime.block_on(async {
            probe.await.unwrap();
            timer.await.unwrap();
        });
        assert!(started.is_ok(), "probe did not start");
        assert!(
            timer_result.is_ok(),
            "one busy probe stalled all runtime timers"
        );
    }

    #[test]
    fn media_playback_type_mapping_preserves_expected_categories() {
        assert_eq!(
            map_playback_type(MediaPlaybackType::Video),
            SystemMediaPlaybackType::Video
        );
        assert_eq!(
            map_playback_type(MediaPlaybackType::Music),
            SystemMediaPlaybackType::Audio
        );
        assert_eq!(
            map_playback_type(MediaPlaybackType::Image),
            SystemMediaPlaybackType::Image
        );
        assert_eq!(
            map_playback_type(MediaPlaybackType::Unknown),
            SystemMediaPlaybackType::Unknown
        );
    }
}
