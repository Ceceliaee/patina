#[path = "tracking/contracts.rs"]
mod contracts;
#[path = "tracking/process_filters.rs"]
mod process_filters;
#[path = "tracking/session_identity.rs"]
mod session_identity;
#[path = "tracking/status_resolution.rs"]
mod status_resolution;
#[path = "tracking/sustained_identity.rs"]
mod sustained_identity;

pub use contracts::*;
#[allow(unused_imports)]
pub use process_filters::should_track;
pub use session_identity::*;
#[allow(unused_imports)]
pub use status_resolution::*;
pub use sustained_identity::*;

// Owner ledger: this file is a thin aggregate for stable tracking domain exports.
// Runtime orchestration stays in engine/tracking; concrete domain decisions live
// in the owner modules under domain/tracking/.

#[cfg(test)]
mod tests {
    use super::{
        is_trackable_window, resolve_sustained_participation_kind, resolve_tracking_status,
        should_track, signal_matches_window, source_app_id_identity,
        sustained_participation_app_identity, SustainedParticipationAppIdentity,
        SustainedParticipationKind, SustainedParticipationSignalSnapshot,
        SustainedParticipationSignalSource, SystemMediaPlaybackType, TrackingDataChangedPayload,
        TrackingStatusResolutionInput, WindowSessionIdentity, WindowTrackingCandidate,
        WindowTransitionDecision, TRACKING_REASON_STARTUP_SEALED, TRACKING_REASON_STATUS_CHANGED,
        TRACKING_REASON_TRACKING_PAUSED_SEALED, TRACKING_REASON_WATCHDOG_SEALED,
    };

    #[test]
    fn session_identity_uses_stable_window_fields() {
        let identity = WindowSessionIdentity::from_window_fields(
            "QQ.exe",
            42,
            "0x100",
            "0x100",
            "Chrome_WidgetWin_1",
        )
        .unwrap();

        assert_eq!(identity.app_key, "qq.exe");
        assert_eq!(
            identity.instance_key,
            "qq.exe|pid:42|root:0x100|class:chrome_widgetwin_1"
        );
        assert!(identity.is_same_app(
            &WindowSessionIdentity::from_window_fields(
                "qq.exe",
                100,
                "0x200",
                "0x200",
                "OtherClass",
            )
            .unwrap()
        ));
        assert!(!identity.is_same_instance(
            &WindowSessionIdentity::from_window_fields(
                "qq.exe",
                100,
                "0x200",
                "0x200",
                "OtherClass",
            )
            .unwrap()
        ));
    }

    #[test]
    fn transition_decision_exposes_stable_mutation_semantics() {
        let decision = WindowTransitionDecision {
            reason: "session-transition-app-change",
            should_end_previous: true,
            should_start_next: false,
            should_refresh_metadata: false,
            end_time_override: Some(8_000),
        };

        assert!(decision.has_session_work());
        assert!(decision.has_mutation_plan());
        assert_eq!(decision.resolved_end_time(10_000), 8_000);
        assert_eq!(decision.mutation_reason(true), Some("session-ended"));
        assert_eq!(decision.mutation_reason(false), None);
    }

    #[test]
    fn tracking_payload_constructor_preserves_contract_fields() {
        let payload = TrackingDataChangedPayload::new("session-transition", 123);
        assert_eq!(payload.reason, "session-transition");
        assert_eq!(payload.changed_at_ms, 123);
    }

    #[test]
    fn sealed_reason_contracts_are_stable() {
        assert_eq!(TRACKING_REASON_WATCHDOG_SEALED, "watchdog-sealed");
        assert_eq!(TRACKING_REASON_STARTUP_SEALED, "startup-sealed");
        assert_eq!(
            TRACKING_REASON_TRACKING_PAUSED_SEALED,
            "tracking-paused-sealed"
        );
        assert_eq!(TRACKING_REASON_STATUS_CHANGED, "tracking-status-changed");
    }

    #[test]
    fn should_track_filters_system_and_lifecycle_processes() {
        assert!(!should_track("LockApp.exe"));
        assert!(!should_track("SearchHost.exe"));
        assert!(!should_track("obsidian-setup.exe"));
        assert!(!should_track("cursor-updater.exe"));
        assert!(!should_track("hrupdate.exe"));
        assert!(!should_track("bscccloud-3.33.0.tmp"));
        assert!(should_track("ui32.exe"));
        assert!(should_track("wallpaper32.exe"));
        assert!(should_track("wallpaper64.exe"));
        assert!(should_track("wallpaperengine.exe"));
        assert!(should_track("geek.exe"));
        assert!(should_track("geek-uninstaller.exe"));
        assert!(should_track("bcuninstaller.exe"));
        assert!(should_track("Antigravity.exe"));
        assert!(should_track("cmd.exe"));
        assert!(should_track("powershell.exe"));
        assert!(should_track("pwsh.exe"));
        assert!(should_track("windowsterminal.exe"));
        assert!(should_track("wt.exe"));
        assert!(should_track("conhost.exe"));
        assert!(should_track("openconsole.exe"));
        assert!(should_track("explorer.exe"));
    }

    #[test]
    fn sustained_participation_profiles_cover_known_audio_signal_apps() {
        assert_eq!(
            sustained_participation_app_identity("Zoom.exe", r"C:\Program Files\Zoom\Zoom.exe"),
            Some(SustainedParticipationAppIdentity::Zoom)
        );
        assert_eq!(
            sustained_participation_app_identity(
                "douyin.exe",
                r"C:\Program Files (x86)\ByteDance\douyin\douyin.exe"
            ),
            Some(SustainedParticipationAppIdentity::Douyin)
        );
        assert_eq!(
            sustained_participation_app_identity("douyin_widget.exe", ""),
            Some(SustainedParticipationAppIdentity::Douyin)
        );
        assert_eq!(
            sustained_participation_app_identity(
                "哔哩哔哩.exe",
                r"C:\Program Files\bilibili\哔哩哔哩.exe"
            ),
            Some(SustainedParticipationAppIdentity::Bilibili)
        );
        assert_eq!(
            sustained_participation_app_identity(
                "Chrome.exe",
                r"C:\Program Files\Google\Chrome\Application\chrome.exe"
            ),
            Some(SustainedParticipationAppIdentity::Chrome)
        );
        assert_eq!(sustained_participation_app_identity("QQ.exe", ""), None);
    }

    #[test]
    fn source_app_identity_matching_uses_known_aliases() {
        assert_eq!(
            source_app_id_identity("Chrome"),
            Some(SustainedParticipationAppIdentity::Chrome)
        );
        assert_eq!(
            source_app_id_identity("MSTeams_8wekyb3d8bbwe!MSTeams"),
            Some(SustainedParticipationAppIdentity::Teams)
        );
        assert_eq!(
            source_app_id_identity("BiliBiliPC"),
            Some(SustainedParticipationAppIdentity::Bilibili)
        );
        assert_eq!(
            source_app_id_identity("TencentMeeting"),
            Some(SustainedParticipationAppIdentity::WeMeet)
        );
        assert_eq!(source_app_id_identity("Spotify"), None);
    }

    #[test]
    fn signal_matching_requires_active_signal_and_matching_source() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("Chrome".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Chrome),
            playback_type: Some(SystemMediaPlaybackType::Video),
        };

        assert!(signal_matches_window(
            "chrome.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            &signal
        ));
        assert!(!signal_matches_window(
            "firefox.exe",
            r"C:\Program Files\Mozilla Firefox\firefox.exe",
            &signal
        ));
    }

    #[test]
    fn signal_matching_accepts_unknown_apps_when_source_app_id_matches_window() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("PotPlayerMini64".into()),
            source_app_identity: None,
            playback_type: Some(SystemMediaPlaybackType::Audio),
        };

        assert!(signal_matches_window(
            "PotPlayerMini64.exe",
            r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
            &signal
        ));
        assert_eq!(
            resolve_sustained_participation_kind(
                "PotPlayerMini64.exe",
                r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
                &signal,
            ),
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn browser_audio_signal_counts_as_sustained_participation() {
        let audio_only_signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::AudioSession),
            source_app_id: Some("Chrome.exe".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Chrome),
            playback_type: None,
        };
        assert!(signal_matches_window(
            "chrome.exe",
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            &audio_only_signal
        ));
        assert_eq!(
            resolve_sustained_participation_kind(
                "chrome.exe",
                r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                &audio_only_signal,
            ),
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn tracking_status_prefers_signal_gated_sustained_participation() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("Chrome".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Chrome),
            playback_type: Some(SystemMediaPlaybackType::Video),
        };

        let status = resolve_tracking_status(TrackingStatusResolutionInput {
            exe_name: "chrome.exe",
            process_path: r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            idle_time_ms: 500_000,
            is_afk: false,
            continuity_window_secs: 180,
            sustained_participation_secs: 600,
            tracking_paused: false,
            signal: &signal,
        });

        assert!(status.is_tracking_active);
        assert!(status.sustained_participation_eligible);
        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_kind,
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn tracking_status_falls_back_to_continuity_without_signal() {
        let signal = SustainedParticipationSignalSnapshot::default();

        let status = resolve_tracking_status(TrackingStatusResolutionInput {
            exe_name: "zoom.exe",
            process_path: r"C:\Program Files\Zoom\Zoom.exe",
            idle_time_ms: 250_000,
            is_afk: false,
            continuity_window_secs: 180,
            sustained_participation_secs: 600,
            tracking_paused: false,
            signal: &signal,
        });

        assert!(!status.is_tracking_active);
        assert!(!status.sustained_participation_eligible);
        assert!(!status.sustained_participation_active);
        assert_eq!(status.sustained_participation_kind, None);
    }

    #[test]
    fn tracking_status_accepts_unknown_audio_session_matches() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::AudioSession),
            source_app_id: Some("PotPlayerMini64.exe".into()),
            source_app_identity: None,
            playback_type: None,
        };

        let status = resolve_tracking_status(TrackingStatusResolutionInput {
            exe_name: "PotPlayerMini64.exe",
            process_path: r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
            idle_time_ms: 240_000,
            is_afk: false,
            continuity_window_secs: 180,
            sustained_participation_secs: 600,
            tracking_paused: false,
            signal: &signal,
        });

        assert!(status.is_tracking_active);
        assert!(status.sustained_participation_eligible);
        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_kind,
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn tracking_status_accepts_browser_audio_only_matches() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::AudioSession),
            source_app_id: Some("Chrome.exe".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Chrome),
            playback_type: None,
        };

        let status = resolve_tracking_status(TrackingStatusResolutionInput {
            exe_name: "Chrome.exe",
            process_path: r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            idle_time_ms: 240_000,
            is_afk: true,
            continuity_window_secs: 180,
            sustained_participation_secs: 900,
            tracking_paused: false,
            signal: &signal,
        });

        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_kind,
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn tracking_status_keeps_sustained_participation_active_after_generic_afk_threshold() {
        let signal = SustainedParticipationSignalSnapshot {
            is_available: true,
            is_active: true,
            signal_source: Some(SustainedParticipationSignalSource::SystemMedia),
            source_app_id: Some("Zoom".into()),
            source_app_identity: Some(SustainedParticipationAppIdentity::Zoom),
            playback_type: Some(SystemMediaPlaybackType::Video),
        };

        let status = resolve_tracking_status(TrackingStatusResolutionInput {
            exe_name: "zoom.exe",
            process_path: r"C:\Program Files\Zoom\Zoom.exe",
            idle_time_ms: 240_000,
            is_afk: true,
            continuity_window_secs: 180,
            sustained_participation_secs: 900,
            tracking_paused: false,
            signal: &signal,
        });

        assert!(status.is_tracking_active);
        assert!(status.sustained_participation_eligible);
        assert!(status.sustained_participation_active);
        assert_eq!(
            status.sustained_participation_kind,
            Some(SustainedParticipationKind::Audio)
        );
    }

    #[test]
    fn trackable_window_rejects_versioned_lifecycle_titles() {
        let installer = WindowTrackingCandidate::from_window_fields(
            "alma-0.0.750-win-x64.exe",
            "Alma 安装",
            "Chrome_WidgetWin_1",
            false,
        );
        let app = WindowTrackingCandidate::from_window_fields(
            "Alma.exe",
            "Alma",
            "Chrome_WidgetWin_1",
            false,
        );

        assert!(!is_trackable_window(Some(installer)));
        assert!(is_trackable_window(Some(app)));
    }
}
