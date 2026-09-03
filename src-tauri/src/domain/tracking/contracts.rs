use serde::{Deserialize, Serialize};

pub const TRACKING_REASON_WATCHDOG_SEALED: &str = "watchdog-sealed";
pub const TRACKING_REASON_STARTUP_SEALED: &str = "startup-sealed";
pub const TRACKING_REASON_TRACKING_PAUSED_SEALED: &str = "tracking-paused-sealed";
pub const TRACKING_REASON_CONTINUITY_WINDOW_SEALED: &str = "continuity-window-sealed";
pub const TRACKING_REASON_PASSIVE_PARTICIPATION_SEALED: &str = "passive-participation-sealed";
pub const TRACKING_REASON_STATUS_CHANGED: &str = "tracking-status-changed";
pub const TRACKING_REASON_APP_EXCLUDED_SEALED: &str = "app-excluded-sealed";
pub const TRACKING_REASON_WEB_DOMAIN_EXCLUDED_SEALED: &str = "web-domain-excluded-sealed";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SustainedParticipationKind {
    Audio,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SustainedParticipationSignalSource {
    SystemMedia,
    AudioSession,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SustainedParticipationSignalMatchResult {
    #[default]
    Unavailable,
    Inactive,
    IdentityMismatch,
    Matched,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SustainedParticipationState {
    #[default]
    Inactive,
    Candidate,
    Active,
    Grace,
    Expired,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SustainedParticipationStatusReason {
    #[default]
    NoSignal,
    TrackingPaused,
    EmptyWindow,
    NotEligible,
    SignalInactive,
    IdentityMismatch,
    SignalMatched,
    GraceWindow,
    GraceExpired,
    SustainedWindowExpired,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SustainedParticipationAppIdentity {
    Chrome,
    Edge,
    Firefox,
    Brave,
    Zoom,
    Teams,
    Vlc,
    Bilibili,
    Douyin,
    WeMeet,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SystemMediaPlaybackType {
    Unknown,
    Audio,
    Video,
    Image,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AudioSignalState {
    #[default]
    Unknown,
    NoAudio,
    Active,
    ProbeUnavailable,
    StaleSnapshot,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum AudioProbeStatus {
    #[default]
    Starting,
    Ok,
    Timeout,
    WindowsApiFailed,
    BackingOff,
    Disabled,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SustainedParticipationSignalSnapshot {
    pub is_available: bool,
    pub is_active: bool,
    pub signal_source: Option<SustainedParticipationSignalSource>,
    pub source_app_id: Option<String>,
    pub source_app_identity: Option<SustainedParticipationAppIdentity>,
    pub playback_type: Option<SystemMediaPlaybackType>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AudioSessionFact {
    pub session_id: String,
    pub process_id: u32,
    pub exe_name: String,
    pub process_path: Option<String>,
    pub source_identity: Option<SustainedParticipationAppIdentity>,
    pub state: AudioSignalState,
    pub first_observed_at_ms: i64,
    pub last_observed_at_ms: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct AudioSnapshot {
    pub generated_at_ms: i64,
    pub last_success_at_ms: Option<i64>,
    pub last_error_at_ms: Option<i64>,
    pub freshness_deadline_ms: i64,
    pub probe_status: AudioProbeStatus,
    pub sessions: Vec<AudioSessionFact>,
}

impl AudioSnapshot {
    pub fn unknown(now_ms: i64, ttl_ms: i64) -> Self {
        Self {
            generated_at_ms: now_ms,
            last_success_at_ms: None,
            last_error_at_ms: None,
            freshness_deadline_ms: now_ms.saturating_add(ttl_ms),
            probe_status: AudioProbeStatus::Starting,
            sessions: Vec::new(),
        }
    }

    pub fn empty_success(now_ms: i64, ttl_ms: i64) -> Self {
        Self {
            generated_at_ms: now_ms,
            last_success_at_ms: Some(now_ms),
            last_error_at_ms: None,
            freshness_deadline_ms: now_ms.saturating_add(ttl_ms),
            probe_status: AudioProbeStatus::Ok,
            sessions: Vec::new(),
        }
    }

    pub fn probe_unavailable(
        now_ms: i64,
        ttl_ms: i64,
        probe_status: AudioProbeStatus,
        last_success_at_ms: Option<i64>,
    ) -> Self {
        Self {
            generated_at_ms: now_ms,
            last_success_at_ms,
            last_error_at_ms: Some(now_ms),
            freshness_deadline_ms: now_ms.saturating_add(ttl_ms),
            probe_status,
            sessions: Vec::new(),
        }
    }

    pub fn is_fresh(&self, now_ms: i64) -> bool {
        now_ms <= self.freshness_deadline_ms
    }

    pub fn signal_state(&self, now_ms: i64) -> AudioSignalState {
        if !self.is_fresh(now_ms) {
            return AudioSignalState::StaleSnapshot;
        }

        match self.probe_status {
            AudioProbeStatus::Ok if self.sessions.is_empty() => AudioSignalState::NoAudio,
            AudioProbeStatus::Ok => AudioSignalState::Active,
            AudioProbeStatus::Starting => AudioSignalState::Unknown,
            AudioProbeStatus::Disabled
            | AudioProbeStatus::Timeout
            | AudioProbeStatus::WindowsApiFailed
            | AudioProbeStatus::BackingOff => AudioSignalState::ProbeUnavailable,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SustainedParticipationSignalEvaluationSnapshot {
    pub signal: SustainedParticipationSignalSnapshot,
    pub match_result: SustainedParticipationSignalMatchResult,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SustainedParticipationDiagnosticsSnapshot {
    pub state: SustainedParticipationState,
    pub reason: SustainedParticipationStatusReason,
    pub window_identity: Option<SustainedParticipationAppIdentity>,
    pub effective_signal_source: Option<SustainedParticipationSignalSource>,
    pub last_match_at_ms: Option<i64>,
    pub grace_deadline_ms: Option<i64>,
    pub system_media: SustainedParticipationSignalEvaluationSnapshot,
    pub audio_session: SustainedParticipationSignalEvaluationSnapshot,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct TrackingStatusSnapshot {
    pub is_tracking_active: bool,
    pub sustained_participation_eligible: bool,
    pub sustained_participation_active: bool,
    pub sustained_participation_kind: Option<SustainedParticipationKind>,
    pub sustained_participation_state: SustainedParticipationState,
    pub sustained_participation_signal_source: Option<SustainedParticipationSignalSource>,
    pub sustained_participation_reason: SustainedParticipationStatusReason,
    pub sustained_participation_diagnostics: SustainedParticipationDiagnosticsSnapshot,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TrackingDataChangedPayload {
    pub reason: String,
    pub changed_at_ms: u64,
}

impl TrackingDataChangedPayload {
    pub fn new(reason: impl Into<String>, changed_at_ms: u64) -> Self {
        Self {
            reason: reason.into(),
            changed_at_ms,
        }
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowTransitionDecision {
    pub reason: &'static str,
    pub should_end_previous: bool,
    pub should_start_next: bool,
    pub should_refresh_metadata: bool,
    pub end_time_override: Option<i64>,
}

impl WindowTransitionDecision {
    pub fn has_session_work(&self) -> bool {
        self.should_end_previous || self.should_start_next
    }

    pub fn has_mutation_plan(&self) -> bool {
        self.has_session_work() || self.should_refresh_metadata
    }

    pub fn resolved_end_time(&self, fallback_end_time: i64) -> i64 {
        self.end_time_override.unwrap_or(fallback_end_time)
    }

    pub fn mutation_reason(&self, did_mutate: bool) -> Option<&'static str> {
        if !did_mutate {
            return None;
        }

        Some(if self.should_end_previous && self.should_start_next {
            "session-transition"
        } else if self.should_end_previous {
            "session-ended"
        } else if self.should_start_next {
            "session-started"
        } else {
            self.reason
        })
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ActiveSessionSnapshot {
    pub id: i64,
    pub app_name: String,
    pub exe_name: String,
    pub start_time: i64,
    pub continuity_group_start_time: i64,
    pub closed_duration_ms: i64,
}

#[cfg(test)]
mod tests {
    use super::{
        AudioProbeStatus, AudioSessionFact, AudioSignalState, AudioSnapshot,
        SustainedParticipationAppIdentity,
    };

    #[test]
    fn no_audio_snapshot_is_successful_empty_result() {
        let snapshot = AudioSnapshot::empty_success(1_000, 15_000);

        assert_eq!(snapshot.probe_status, AudioProbeStatus::Ok);
        assert!(snapshot.sessions.is_empty());
        assert_eq!(snapshot.signal_state(2_000), AudioSignalState::NoAudio);
    }

    #[test]
    fn probe_fault_is_not_treated_as_no_audio() {
        let snapshot =
            AudioSnapshot::probe_unavailable(1_000, 15_000, AudioProbeStatus::Timeout, Some(500));

        assert_eq!(
            snapshot.signal_state(2_000),
            AudioSignalState::ProbeUnavailable
        );
    }

    #[test]
    fn stale_snapshot_becomes_stale_state() {
        let snapshot = AudioSnapshot::empty_success(1_000, 15_000);

        assert_eq!(
            snapshot.signal_state(20_001),
            AudioSignalState::StaleSnapshot
        );
    }

    #[test]
    fn active_audio_snapshot_reports_active_state() {
        let mut snapshot = AudioSnapshot::empty_success(1_000, 15_000);
        snapshot.sessions.push(AudioSessionFact {
            session_id: "123:potplayer.exe".into(),
            process_id: 123,
            exe_name: "PotPlayer.exe".into(),
            process_path: None,
            source_identity: Some(SustainedParticipationAppIdentity::Vlc),
            state: AudioSignalState::Active,
            first_observed_at_ms: 1_000,
            last_observed_at_ms: 1_000,
        });

        assert_eq!(snapshot.signal_state(2_000), AudioSignalState::Active);
    }
}

pub(crate) fn resolve_interrupted_session_end(
    session_start_time: i64,
    last_sample_ms: Option<i64>,
    now_ms: i64,
) -> i64 {
    // A heartbeat proves liveness, not foreground activity. Missing or impossible
    // sample times cannot justify extending an interrupted session through downtime.
    last_sample_ms
        .filter(|sample| *sample >= session_start_time && *sample <= now_ms)
        .unwrap_or(session_start_time)
}
