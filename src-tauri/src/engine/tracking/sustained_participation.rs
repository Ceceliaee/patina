use crate::domain::tracking::{
    evaluate_sustained_participation_signal, resolve_sustained_participation_identity_key,
    resolve_sustained_participation_kind, signal_explicitly_stopped_for_window,
    sustained_participation_app_identity, SustainedParticipationAppIdentity,
    SustainedParticipationDiagnosticsSnapshot, SustainedParticipationKind,
    SustainedParticipationSignalEvaluationSnapshot, SustainedParticipationSignalMatchResult,
    SustainedParticipationSignalSnapshot, SustainedParticipationSignalSource,
    SustainedParticipationState, SustainedParticipationStatusReason, TrackingStatusSnapshot,
};
use crate::platform::windows::{audio, foreground as tracker, media};

const SUSTAINED_PARTICIPATION_TRANSIENT_MISS_THRESHOLD: u8 = 3;
const SUSTAINED_PARTICIPATION_GRACE_WINDOW_SECS: u64 = 12;

#[derive(Clone, Debug, Default)]
pub(super) struct SustainedParticipationRuntimeState {
    pub identity_key: Option<String>,
    pub last_match_at_ms: Option<i64>,
    pub grace_deadline_ms: Option<i64>,
    pub last_signal_source: Option<SustainedParticipationSignalSource>,
    pub last_kind: Option<SustainedParticipationKind>,
    pub transient_miss_count: u8,
}

pub(super) struct SustainedParticipationStatusInput<'a> {
    pub exe_name: &'a str,
    pub process_path: &'a str,
    pub idle_time_ms: u32,
    pub is_afk: bool,
    pub continuity_window_secs: u64,
    pub sustained_participation_secs: u64,
    pub tracking_paused: bool,
    pub now_ms: i64,
    pub previous_state: &'a SustainedParticipationRuntimeState,
    pub system_media_signal: &'a SustainedParticipationSignalSnapshot,
    pub audio_signal: &'a SustainedParticipationSignalSnapshot,
}

pub(super) fn apply_tracking_mode_window_state(
    mut tracked_window: tracker::WindowInfo,
    tracking_status: &TrackingStatusSnapshot,
) -> tracker::WindowInfo {
    // Sustained participation is a distinct mode: once a supported media signal is
    // active, we keep the window trackable until the sustained-participation
    // threshold is reached instead of letting the generic AFK threshold close it
    // early.
    if tracking_status.sustained_participation_active {
        tracked_window.is_afk = false;
    }

    tracked_window
}

pub(super) async fn load_sustained_participation_signals(
    tracked_window: &tracker::WindowInfo,
    tracking_paused: bool,
) -> (
    SustainedParticipationSignalSnapshot,
    SustainedParticipationSignalSnapshot,
) {
    if tracking_paused {
        return (
            SustainedParticipationSignalSnapshot::default(),
            SustainedParticipationSignalSnapshot::default(),
        );
    }

    let system_media_signal = media::get_sustained_participation_signal(tracked_window).await;
    let audio_signal = audio::get_sustained_participation_signal(tracked_window).await;

    (system_media_signal, audio_signal)
}

pub(super) fn resolve_tracking_status_with_runtime(
    input: SustainedParticipationStatusInput<'_>,
) -> (TrackingStatusSnapshot, SustainedParticipationRuntimeState) {
    let SustainedParticipationStatusInput {
        exe_name,
        process_path,
        idle_time_ms,
        is_afk,
        continuity_window_secs,
        sustained_participation_secs,
        tracking_paused,
        now_ms,
        previous_state,
        system_media_signal,
        audio_signal,
    } = input;

    let continuity_active = !is_afk && u64::from(idle_time_ms) <= continuity_window_secs * 1000;
    let window_identity = sustained_participation_app_identity(exe_name, process_path);
    let system_media =
        evaluate_sustained_participation_signal(exe_name, process_path, system_media_signal);
    let audio_session =
        evaluate_sustained_participation_signal(exe_name, process_path, audio_signal);
    let matched_signal =
        select_matched_signal(exe_name, process_path, &system_media, &audio_session);
    let matched_kind = matched_signal.and_then(|evaluation| {
        resolve_sustained_participation_kind(exe_name, process_path, &evaluation.signal)
    });
    let window_identity_key = resolve_sustained_participation_identity_key(exe_name, process_path);
    let same_identity =
        window_identity_key.is_some() && previous_state.identity_key == window_identity_key;
    let within_sustained_window = u64::from(idle_time_ms) <= sustained_participation_secs * 1000;
    let grace_kind = matched_kind.or(previous_state.last_kind);
    let explicit_stop_detected =
        signal_explicitly_stopped_for_window(exe_name, process_path, system_media_signal);
    let next_transient_miss_count = previous_state.transient_miss_count.saturating_add(1);

    let (
        state,
        reason,
        effective_signal_source,
        sustained_participation_active,
        status_kind,
        next_state,
    ) = if tracking_paused {
        (
            SustainedParticipationState::Inactive,
            SustainedParticipationStatusReason::TrackingPaused,
            None,
            false,
            None,
            SustainedParticipationRuntimeState::default(),
        )
    } else if exe_name.trim().is_empty() {
        (
            SustainedParticipationState::Inactive,
            SustainedParticipationStatusReason::EmptyWindow,
            None,
            false,
            None,
            SustainedParticipationRuntimeState::default(),
        )
    } else if let Some(matched_signal) = matched_signal {
        let last_kind = matched_kind;
        if within_sustained_window {
            (
                SustainedParticipationState::Active,
                SustainedParticipationStatusReason::SignalMatched,
                matched_signal.signal.signal_source,
                true,
                last_kind,
                SustainedParticipationRuntimeState {
                    identity_key: window_identity_key.clone(),
                    last_match_at_ms: Some(now_ms),
                    grace_deadline_ms: None,
                    last_signal_source: matched_signal.signal.signal_source,
                    last_kind,
                    transient_miss_count: 0,
                },
            )
        } else {
            (
                SustainedParticipationState::Expired,
                SustainedParticipationStatusReason::SustainedWindowExpired,
                matched_signal.signal.signal_source,
                false,
                last_kind,
                SustainedParticipationRuntimeState {
                    identity_key: window_identity_key.clone(),
                    last_match_at_ms: previous_state.last_match_at_ms.or(Some(now_ms)),
                    grace_deadline_ms: None,
                    last_signal_source: matched_signal.signal.signal_source,
                    last_kind,
                    transient_miss_count: 0,
                },
            )
        }
    } else if same_identity && previous_state.last_match_at_ms.is_some() && !within_sustained_window
    {
        (
            SustainedParticipationState::Expired,
            SustainedParticipationStatusReason::SustainedWindowExpired,
            previous_state.last_signal_source,
            false,
            grace_kind,
            SustainedParticipationRuntimeState {
                identity_key: window_identity_key.clone(),
                last_match_at_ms: previous_state.last_match_at_ms,
                grace_deadline_ms: None,
                last_signal_source: previous_state.last_signal_source,
                last_kind: grace_kind,
                transient_miss_count: 0,
            },
        )
    } else if same_identity && previous_state.last_match_at_ms.is_some() && explicit_stop_detected {
        (
            SustainedParticipationState::Candidate,
            SustainedParticipationStatusReason::SignalInactive,
            previous_state.last_signal_source,
            false,
            grace_kind,
            SustainedParticipationRuntimeState {
                identity_key: window_identity_key.clone(),
                last_match_at_ms: previous_state.last_match_at_ms,
                grace_deadline_ms: None,
                last_signal_source: previous_state.last_signal_source,
                last_kind: grace_kind,
                transient_miss_count: 0,
            },
        )
    } else if same_identity && previous_state.last_match_at_ms.is_some() {
        let grace_deadline_ms =
            if next_transient_miss_count >= SUSTAINED_PARTICIPATION_TRANSIENT_MISS_THRESHOLD {
                Some(
                    previous_state
                        .grace_deadline_ms
                        .unwrap_or_else(|| now_ms.saturating_add(resolve_grace_window_ms())),
                )
            } else {
                None
            };
        let still_in_grace = grace_deadline_ms
            .map(|deadline| deadline >= now_ms)
            .unwrap_or(false);

        if next_transient_miss_count < SUSTAINED_PARTICIPATION_TRANSIENT_MISS_THRESHOLD
            || still_in_grace
        {
            (
                SustainedParticipationState::Grace,
                SustainedParticipationStatusReason::GraceWindow,
                previous_state.last_signal_source,
                true,
                grace_kind,
                SustainedParticipationRuntimeState {
                    identity_key: window_identity_key.clone(),
                    last_match_at_ms: previous_state.last_match_at_ms,
                    grace_deadline_ms,
                    last_signal_source: previous_state.last_signal_source,
                    last_kind: grace_kind,
                    transient_miss_count: next_transient_miss_count,
                },
            )
        } else {
            (
                SustainedParticipationState::Candidate,
                if next_transient_miss_count >= SUSTAINED_PARTICIPATION_TRANSIENT_MISS_THRESHOLD {
                    SustainedParticipationStatusReason::GraceExpired
                } else {
                    resolve_candidate_reason(&system_media, &audio_session)
                },
                previous_state.last_signal_source,
                false,
                grace_kind,
                SustainedParticipationRuntimeState {
                    identity_key: window_identity_key.clone(),
                    last_match_at_ms: previous_state.last_match_at_ms,
                    grace_deadline_ms: None,
                    last_signal_source: previous_state.last_signal_source,
                    last_kind: grace_kind,
                    transient_miss_count: next_transient_miss_count,
                },
            )
        }
    } else if system_media.match_result != SustainedParticipationSignalMatchResult::Unavailable
        || audio_session.match_result != SustainedParticipationSignalMatchResult::Unavailable
    {
        (
            SustainedParticipationState::Candidate,
            resolve_candidate_reason(&system_media, &audio_session),
            None,
            false,
            None,
            SustainedParticipationRuntimeState {
                identity_key: window_identity_key.clone(),
                last_match_at_ms: None,
                grace_deadline_ms: None,
                last_signal_source: None,
                last_kind: None,
                transient_miss_count: 0,
            },
        )
    } else {
        (
            SustainedParticipationState::Inactive,
            resolve_inactive_reason(&system_media, &audio_session, window_identity),
            None,
            false,
            None,
            SustainedParticipationRuntimeState::default(),
        )
    };

    let tracking_status = TrackingStatusSnapshot {
        is_tracking_active: continuity_active || sustained_participation_active,
        sustained_participation_eligible: status_kind.is_some(),
        sustained_participation_active,
        sustained_participation_kind: status_kind,
        sustained_participation_state: state,
        sustained_participation_signal_source: effective_signal_source,
        sustained_participation_reason: reason,
        sustained_participation_diagnostics: SustainedParticipationDiagnosticsSnapshot {
            state,
            reason,
            window_identity,
            effective_signal_source,
            last_match_at_ms: next_state.last_match_at_ms,
            grace_deadline_ms: next_state.grace_deadline_ms,
            system_media,
            audio_session,
        },
    };

    (tracking_status, next_state)
}

fn select_matched_signal<'a>(
    exe_name: &str,
    process_path: &str,
    system_media: &'a SustainedParticipationSignalEvaluationSnapshot,
    audio_session: &'a SustainedParticipationSignalEvaluationSnapshot,
) -> Option<&'a SustainedParticipationSignalEvaluationSnapshot> {
    [system_media, audio_session]
        .into_iter()
        .find(|evaluation| {
            evaluation.match_result == SustainedParticipationSignalMatchResult::Matched
                && resolve_sustained_participation_kind(exe_name, process_path, &evaluation.signal)
                    .is_some()
        })
}

fn resolve_grace_window_ms() -> i64 {
    SUSTAINED_PARTICIPATION_GRACE_WINDOW_SECS
        .saturating_mul(1000)
        .min(i64::MAX as u64) as i64
}

fn resolve_candidate_reason(
    system_media: &SustainedParticipationSignalEvaluationSnapshot,
    audio_session: &SustainedParticipationSignalEvaluationSnapshot,
) -> SustainedParticipationStatusReason {
    for match_result in [system_media.match_result, audio_session.match_result] {
        match match_result {
            SustainedParticipationSignalMatchResult::Inactive => {
                return SustainedParticipationStatusReason::SignalInactive;
            }
            SustainedParticipationSignalMatchResult::IdentityMismatch => {
                return SustainedParticipationStatusReason::IdentityMismatch;
            }
            SustainedParticipationSignalMatchResult::Matched => {
                return SustainedParticipationStatusReason::SignalMatched;
            }
            SustainedParticipationSignalMatchResult::Unavailable => {}
        }
    }

    SustainedParticipationStatusReason::NoSignal
}

fn resolve_inactive_reason(
    system_media: &SustainedParticipationSignalEvaluationSnapshot,
    audio_session: &SustainedParticipationSignalEvaluationSnapshot,
    _window_identity: Option<SustainedParticipationAppIdentity>,
) -> SustainedParticipationStatusReason {
    if system_media.match_result == SustainedParticipationSignalMatchResult::IdentityMismatch
        || audio_session.match_result == SustainedParticipationSignalMatchResult::IdentityMismatch
    {
        return SustainedParticipationStatusReason::IdentityMismatch;
    }

    SustainedParticipationStatusReason::NoSignal
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_window(overrides: &[(&str, &str)]) -> tracker::WindowInfo {
        let mut window = tracker::WindowInfo {
            hwnd: "0x100".into(),
            root_owner_hwnd: "0x100".into(),
            process_id: 123,
            window_class: "Chrome_WidgetWin_1".into(),
            title: "Window".into(),
            exe_name: "QQ.exe".into(),
            process_path: r"C:\Program Files\QQ\QQ.exe".into(),
            is_afk: false,
            idle_time_ms: 0,
        };

        for (key, value) in overrides {
            match *key {
                "hwnd" => window.hwnd = (*value).into(),
                "root_owner_hwnd" => window.root_owner_hwnd = (*value).into(),
                "process_id" => window.process_id = value.parse().unwrap(),
                "window_class" => window.window_class = (*value).into(),
                "title" => window.title = (*value).into(),
                "exe_name" => window.exe_name = (*value).into(),
                "process_path" => window.process_path = (*value).into(),
                "is_afk" => window.is_afk = *value == "true",
                "idle_time_ms" => window.idle_time_ms = value.parse().unwrap(),
                _ => {}
            }
        }

        window
    }

    #[allow(clippy::too_many_arguments)]
    fn resolve_status_for_test(
        exe_name: &str,
        process_path: &str,
        idle_time_ms: u32,
        is_afk: bool,
        continuity_window_secs: u64,
        sustained_participation_secs: u64,
        tracking_paused: bool,
        now_ms: i64,
        previous_state: &SustainedParticipationRuntimeState,
        system_media_signal: &SustainedParticipationSignalSnapshot,
        audio_signal: &SustainedParticipationSignalSnapshot,
    ) -> (TrackingStatusSnapshot, SustainedParticipationRuntimeState) {
        resolve_tracking_status_with_runtime(SustainedParticipationStatusInput {
            exe_name,
            process_path,
            idle_time_ms,
            is_afk,
            continuity_window_secs,
            sustained_participation_secs,
            tracking_paused,
            now_ms,
            previous_state,
            system_media_signal,
            audio_signal,
        })
    }

    #[test]
    fn sustained_participation_masks_generic_afk_before_sustained_timeout() {
        let current = make_window(&[
            ("exe_name", "Zoom.exe"),
            ("idle_time_ms", "240000"),
            ("is_afk", "true"),
        ]);
        let tracking_status = TrackingStatusSnapshot {
            is_tracking_active: true,
            sustained_participation_eligible: true,
            sustained_participation_active: true,
            sustained_participation_kind: Some(SustainedParticipationKind::Audio),
            ..TrackingStatusSnapshot::default()
        };

        let adjusted = apply_tracking_mode_window_state(current, &tracking_status);

        assert!(!adjusted.is_afk);
        assert_eq!(adjusted.idle_time_ms, 240_000);
    }

    #[test]
    fn sustained_participation_enters_grace_after_signal_drops_for_same_app() {
        let previous_state = SustainedParticipationRuntimeState {
            identity_key: Some("zoom".into()),
            last_match_at_ms: Some(10_000),
            last_signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            last_kind: Some(SustainedParticipationKind::Audio),
            ..SustainedParticipationRuntimeState::default()
        };

        let (status, next_state) = resolve_status_for_test(
            "Zoom.exe",
            r"C:\Program Files\Zoom\Zoom.exe",
            240_000,
            true,
            180,
            900,
            false,
            12_000,
            &previous_state,
            &SustainedParticipationSignalSnapshot::default(),
            &SustainedParticipationSignalSnapshot::default(),
        );

        assert!(status.is_tracking_active);
        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_state,
            SustainedParticipationState::Grace
        );
        assert_eq!(
            status.sustained_participation_reason,
            SustainedParticipationStatusReason::GraceWindow
        );
        assert_eq!(next_state.last_match_at_ms, Some(10_000));
        assert_eq!(next_state.grace_deadline_ms, None);
        assert_eq!(next_state.transient_miss_count, 1);
    }

    #[test]
    fn sustained_participation_starts_timed_grace_after_three_consecutive_misses() {
        let previous_state = SustainedParticipationRuntimeState {
            identity_key: Some("zoom".into()),
            last_match_at_ms: Some(10_000),
            last_signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            last_kind: Some(SustainedParticipationKind::Audio),
            transient_miss_count: 2,
            ..SustainedParticipationRuntimeState::default()
        };

        let (status, next_state) = resolve_status_for_test(
            "Zoom.exe",
            r"C:\Program Files\Zoom\Zoom.exe",
            240_000,
            true,
            180,
            900,
            false,
            12_000,
            &previous_state,
            &SustainedParticipationSignalSnapshot::default(),
            &SustainedParticipationSignalSnapshot::default(),
        );

        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_state,
            SustainedParticipationState::Grace
        );
        assert_eq!(next_state.transient_miss_count, 3);
        assert_eq!(next_state.grace_deadline_ms, Some(24_000));
    }

    #[test]
    fn sustained_participation_grace_expiry_downgrades_to_candidate() {
        let previous_state = SustainedParticipationRuntimeState {
            identity_key: Some("zoom".into()),
            last_match_at_ms: Some(10_000),
            grace_deadline_ms: Some(11_000),
            last_signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            last_kind: Some(SustainedParticipationKind::Audio),
            transient_miss_count: 3,
        };

        let (status, _) = resolve_status_for_test(
            "Zoom.exe",
            r"C:\Program Files\Zoom\Zoom.exe",
            240_000,
            true,
            180,
            900,
            false,
            12_000,
            &previous_state,
            &SustainedParticipationSignalSnapshot::default(),
            &SustainedParticipationSignalSnapshot::default(),
        );

        assert!(!status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_state,
            SustainedParticipationState::Candidate
        );
        assert_eq!(
            status.sustained_participation_reason,
            SustainedParticipationStatusReason::GraceExpired
        );
    }

    #[test]
    fn explicit_system_media_pause_skips_extended_grace() {
        let previous_state = SustainedParticipationRuntimeState {
            identity_key: Some("zoom".into()),
            last_match_at_ms: Some(10_000),
            last_signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            last_kind: Some(SustainedParticipationKind::Audio),
            ..SustainedParticipationRuntimeState::default()
        };
        let inactive_system_media = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: false,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("Zoom".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Zoom),
            playback_type: Some(crate::domain::tracking::SystemMediaPlaybackType::Video),
        };

        let (status, next_state) = resolve_status_for_test(
            "Zoom.exe",
            r"C:\Program Files\Zoom\Zoom.exe",
            240_000,
            true,
            180,
            900,
            false,
            12_000,
            &previous_state,
            &inactive_system_media,
            &SustainedParticipationSignalSnapshot::default(),
        );

        assert!(!status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_reason,
            SustainedParticipationStatusReason::SignalInactive
        );
        assert_eq!(next_state.grace_deadline_ms, None);
        assert_eq!(next_state.transient_miss_count, 0);
    }

    #[test]
    fn sustained_participation_diagnostics_expose_identity_mismatch() {
        let system_media_signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("electron.app.douyin".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Douyin),
            playback_type: Some(crate::domain::tracking::SystemMediaPlaybackType::Video),
        };

        let (status, _) = resolve_status_for_test(
            "Zoom.exe",
            r"C:\Program Files\Zoom\Zoom.exe",
            1_000,
            false,
            180,
            900,
            false,
            12_000,
            &SustainedParticipationRuntimeState::default(),
            &system_media_signal,
            &SustainedParticipationSignalSnapshot::default(),
        );

        assert_eq!(
            status
                .sustained_participation_diagnostics
                .system_media
                .match_result,
            SustainedParticipationSignalMatchResult::IdentityMismatch
        );
        assert_eq!(
            status.sustained_participation_reason,
            SustainedParticipationStatusReason::IdentityMismatch
        );
    }

    #[test]
    fn matched_audio_signal_beats_mismatched_system_media_signal() {
        let system_media_signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("electron.app.douyin".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Douyin),
            playback_type: Some(crate::domain::tracking::SystemMediaPlaybackType::Video),
        };
        let audio_signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::AudioSession),
            source_app_id: Some("Zoom.exe".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Zoom),
            playback_type: None,
        };

        let (status, _) = resolve_status_for_test(
            "Zoom.exe",
            r"C:\Program Files\Zoom\Zoom.exe",
            240_000,
            true,
            180,
            900,
            false,
            12_000,
            &SustainedParticipationRuntimeState::default(),
            &system_media_signal,
            &audio_signal,
        );

        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_signal_source,
            Some(SustainedParticipationSignalSource::AudioSession)
        );
        assert_eq!(
            status
                .sustained_participation_diagnostics
                .system_media
                .match_result,
            SustainedParticipationSignalMatchResult::IdentityMismatch
        );
        assert_eq!(
            status
                .sustained_participation_diagnostics
                .audio_session
                .match_result,
            SustainedParticipationSignalMatchResult::Matched
        );
    }

    #[test]
    fn browser_audio_signal_activates_sustained_participation() {
        let audio_signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::AudioSession),
            source_app_id: Some("Chrome.exe".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Chrome),
            playback_type: None,
        };

        let (status, _) = resolve_status_for_test(
            "Chrome.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            240_000,
            true,
            180,
            900,
            false,
            12_000,
            &SustainedParticipationRuntimeState::default(),
            &SustainedParticipationSignalSnapshot::default(),
            &audio_signal,
        );

        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_state,
            SustainedParticipationState::Active
        );
        assert!(status.sustained_participation_eligible);
    }

    #[test]
    fn sustained_participation_grace_uses_single_signal_deadline() {
        let previous_state = SustainedParticipationRuntimeState {
            identity_key: Some("chrome".into()),
            last_match_at_ms: Some(10_000),
            last_signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            last_kind: Some(SustainedParticipationKind::Audio),
            transient_miss_count: 2,
            ..SustainedParticipationRuntimeState::default()
        };

        let (status, next_state) = resolve_status_for_test(
            "Chrome.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            240_000,
            true,
            180,
            900,
            false,
            12_000,
            &previous_state,
            &SustainedParticipationSignalSnapshot::default(),
            &SustainedParticipationSignalSnapshot::default(),
        );

        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_state,
            SustainedParticipationState::Grace
        );
        assert_eq!(next_state.grace_deadline_ms, Some(24_000));
    }
}
