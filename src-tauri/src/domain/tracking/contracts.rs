use serde::{Deserialize, Serialize};

pub const TRACKING_REASON_WATCHDOG_SEALED: &str = "watchdog-sealed";
pub const TRACKING_REASON_STARTUP_SEALED: &str = "startup-sealed";
pub const TRACKING_REASON_TRACKING_PAUSED_SEALED: &str = "tracking-paused-sealed";
pub const TRACKING_REASON_CONTINUITY_WINDOW_SEALED: &str = "continuity-window-sealed";
pub const TRACKING_REASON_PASSIVE_PARTICIPATION_SEALED: &str = "passive-participation-sealed";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SustainedParticipationKind {
    Video,
    Meeting,
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

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct SustainedParticipationSignalSnapshot {
    pub is_available: bool,
    pub is_active: bool,
    pub signal_source: Option<SustainedParticipationSignalSource>,
    pub source_app_id: Option<String>,
    pub source_app_identity: Option<SustainedParticipationAppIdentity>,
    pub playback_type: Option<SystemMediaPlaybackType>,
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

#[derive(Clone, Debug)]
pub struct ActiveSessionSnapshot {
    pub start_time: i64,
    pub continuity_group_start_time: i64,
    pub exe_name: String,
    pub window_title: String,
}
