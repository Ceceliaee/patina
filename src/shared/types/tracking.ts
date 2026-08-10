export interface TrackedWindow {
  hwnd: string;
  rootOwnerHwnd: string;
  processId: number;
  windowClass: string;
  title: string;
  exeName: string;
  processPath: string;
  isAfk: boolean;
  idleTimeMs: number;
}

export type TrackingWindowSnapshot = TrackedWindow;

export type SustainedParticipationKind = "audio";
export type SustainedParticipationSignalSource = "system-media" | "audio-session";
export type SustainedParticipationState =
  | "inactive"
  | "candidate"
  | "active"
  | "grace"
  | "expired";
export type SustainedParticipationStatusReason =
  | "no-signal"
  | "tracking-paused"
  | "empty-window"
  | "not-eligible"
  | "signal-inactive"
  | "identity-mismatch"
  | "signal-matched"
  | "grace-window"
  | "grace-expired"
  | "sustained-window-expired";
export type SustainedParticipationAppIdentity =
  | "chrome"
  | "edge"
  | "firefox"
  | "brave"
  | "zoom"
  | "teams"
  | "vlc"
  | "bilibili"
  | "douyin"
  | "we-meet";
export type SustainedParticipationSignalMatchResult =
  | "unavailable"
  | "inactive"
  | "identity-mismatch"
  | "matched";

export interface SustainedParticipationSignalSnapshot {
  isAvailable: boolean;
  isActive: boolean;
  signalSource: SustainedParticipationSignalSource | null;
  sourceAppId: string | null;
  sourceAppIdentity: SustainedParticipationAppIdentity | null;
  playbackType: "unknown" | "audio" | "video" | "image" | null;
}

export interface SustainedParticipationSignalEvaluationSnapshot {
  signal: SustainedParticipationSignalSnapshot;
  matchResult: SustainedParticipationSignalMatchResult;
}

export interface SustainedParticipationDiagnosticsSnapshot {
  state: SustainedParticipationState;
  reason: SustainedParticipationStatusReason;
  windowIdentity: SustainedParticipationAppIdentity | null;
  effectiveSignalSource: SustainedParticipationSignalSource | null;
  lastMatchAtMs: number | null;
  graceDeadlineMs: number | null;
  systemMedia: SustainedParticipationSignalEvaluationSnapshot;
  audioSession: SustainedParticipationSignalEvaluationSnapshot;
}

export interface TrackingStatusSnapshot {
  isTrackingActive: boolean;
  sustainedParticipationEligible: boolean;
  sustainedParticipationActive: boolean;
  sustainedParticipationKind: SustainedParticipationKind | null;
  sustainedParticipationState: SustainedParticipationState;
  sustainedParticipationSignalSource: SustainedParticipationSignalSource | null;
  sustainedParticipationReason: SustainedParticipationStatusReason;
  sustainedParticipationDiagnostics: SustainedParticipationDiagnosticsSnapshot;
}

export type TrackingRuntimeProbeStatus =
  | "ok"
  | "timeout-fallback"
  | "timeout-inactive"
  | "backing-off-fallback"
  | "backing-off-inactive"
  | "recovery-attempted-fallback"
  | "recovery-attempted-inactive"
  | "hard-degraded-fallback"
  | "hard-degraded-inactive"
  | "task-failed-fallback"
  | "task-failed-inactive";

export interface TrackingRuntimeProbeDiagnostics {
  lastSuccessfulSampleAtMs?: number | null;
  fallbackStartedAtMs?: number | null;
  fallbackCount?: number;
  consecutiveFallbackCount?: number;
  recoveryAttemptCount?: number;
  lastRecoveryAttemptAtMs?: number | null;
}

export interface CurrentTrackingSnapshot {
  window: TrackingWindowSnapshot;
  status: TrackingStatusSnapshot;
  sampledAtMs?: number;
  probeStatus?: TrackingRuntimeProbeStatus;
  degradedReason?: string | null;
  probeDiagnostics?: TrackingRuntimeProbeDiagnostics;
}

export interface TrackingDataChangedPayload {
  reason: string;
  changedAtMs: number;
}

export type TrackerHealthStatus = "healthy" | "stale";

export const TRACKER_HEARTBEAT_STALE_AFTER_MS = 8_000;

export interface TrackerHealthSnapshot {
  status: TrackerHealthStatus;
  lastHeartbeatMs: number | null;
  checkedAtMs: number;
  staleAfterMs: number;
}

export interface TrackerHealthRuntimeSnapshot {
  lastHeartbeatMs: number | null;
  lastSuccessfulSampleMs: number | null;
  lastWatchdogSealSampleMs: number | null;
}

export const DEFAULT_TRACKING_STATUS: TrackingStatusSnapshot = {
  isTrackingActive: false,
  sustainedParticipationEligible: false,
  sustainedParticipationActive: false,
  sustainedParticipationKind: null,
  sustainedParticipationState: "inactive",
  sustainedParticipationSignalSource: null,
  sustainedParticipationReason: "no-signal",
  sustainedParticipationDiagnostics: {
    state: "inactive",
    reason: "no-signal",
    windowIdentity: null,
    effectiveSignalSource: null,
    lastMatchAtMs: null,
    graceDeadlineMs: null,
    systemMedia: {
      signal: {
        isAvailable: false,
        isActive: false,
        signalSource: null,
        sourceAppId: null,
        sourceAppIdentity: null,
        playbackType: null,
      },
      matchResult: "unavailable",
    },
    audioSession: {
      signal: {
        isAvailable: false,
        isActive: false,
        signalSource: null,
        sourceAppId: null,
        sourceAppIdentity: null,
        playbackType: null,
      },
      matchResult: "unavailable",
    },
  },
};

export function resolveTrackerHealth(
  lastHeartbeatMs: number | null,
  checkedAtMs: number,
  staleAfterMs: number,
): TrackerHealthSnapshot {
  const isHealthy = lastHeartbeatMs !== null && (checkedAtMs - lastHeartbeatMs) <= staleAfterMs;

  return {
    status: isHealthy ? "healthy" : "stale",
    lastHeartbeatMs,
    checkedAtMs,
    staleAfterMs,
  };
}
