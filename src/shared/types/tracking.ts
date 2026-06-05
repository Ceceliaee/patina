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
  | "task-failed-fallback"
  | "task-failed-inactive";

export interface CurrentTrackingSnapshot {
  window: TrackingWindowSnapshot;
  status: TrackingStatusSnapshot;
  sampledAtMs?: number;
  probeStatus?: TrackingRuntimeProbeStatus;
  degradedReason?: string | null;
}

export interface TrackingDataChangedPayload {
  reason: string;
  changedAtMs: number;
}

export type TrackerHealthStatus = "healthy" | "stale";

export interface TrackerHealthSnapshot {
  status: TrackerHealthStatus;
  lastHeartbeatMs: number | null;
  checkedAtMs: number;
  staleAfterMs: number;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

export function isTrackingWindowSnapshot(value: unknown): value is TrackingWindowSnapshot {
  return isRecord(value)
    && typeof value.hwnd === "string"
    && typeof value.rootOwnerHwnd === "string"
    && typeof value.processId === "number"
    && typeof value.windowClass === "string"
    && typeof value.title === "string"
    && typeof value.exeName === "string"
    && typeof value.processPath === "string"
    && typeof value.isAfk === "boolean"
    && typeof value.idleTimeMs === "number";
}

export function isTrackingStatusSnapshot(value: unknown): value is TrackingStatusSnapshot {
  return isRecord(value)
    && typeof value.isTrackingActive === "boolean"
    && typeof value.sustainedParticipationEligible === "boolean"
    && typeof value.sustainedParticipationActive === "boolean"
    && (
      value.sustainedParticipationKind === null
      || value.sustainedParticipationKind === "audio"
    )
    && isEnumValue(value.sustainedParticipationState, [
      "inactive",
      "candidate",
      "active",
      "grace",
      "expired",
    ] as const)
    && (
      value.sustainedParticipationSignalSource === null
      || value.sustainedParticipationSignalSource === "system-media"
      || value.sustainedParticipationSignalSource === "audio-session"
    )
    && isEnumValue(value.sustainedParticipationReason, [
      "no-signal",
      "tracking-paused",
      "empty-window",
      "not-eligible",
      "signal-inactive",
      "identity-mismatch",
      "signal-matched",
      "grace-window",
      "grace-expired",
      "sustained-window-expired",
    ] as const)
    && isSustainedParticipationDiagnosticsSnapshot(value.sustainedParticipationDiagnostics);
}

export function isSustainedParticipationSignalSnapshot(
  value: unknown,
): value is SustainedParticipationSignalSnapshot {
  return isRecord(value)
    && typeof value.isAvailable === "boolean"
    && typeof value.isActive === "boolean"
    && (
      value.signalSource === null
      || value.signalSource === "system-media"
      || value.signalSource === "audio-session"
    )
    && (value.sourceAppId === null || typeof value.sourceAppId === "string")
    && (
      value.sourceAppIdentity === null
      || isEnumValue(value.sourceAppIdentity, [
        "chrome",
        "edge",
        "firefox",
        "brave",
        "zoom",
        "teams",
        "vlc",
        "bilibili",
        "douyin",
        "we-meet",
      ] as const)
    )
    && (
      value.playbackType === null
      || isEnumValue(value.playbackType, [
        "unknown",
        "audio",
        "video",
        "image",
      ] as const)
    );
}

export function isSustainedParticipationSignalEvaluationSnapshot(
  value: unknown,
): value is SustainedParticipationSignalEvaluationSnapshot {
  return isRecord(value)
    && isSustainedParticipationSignalSnapshot(value.signal)
    && isEnumValue(value.matchResult, [
      "unavailable",
      "inactive",
      "identity-mismatch",
      "matched",
    ] as const);
}

export function isSustainedParticipationDiagnosticsSnapshot(
  value: unknown,
): value is SustainedParticipationDiagnosticsSnapshot {
  return isRecord(value)
    && isEnumValue(value.state, [
      "inactive",
      "candidate",
      "active",
      "grace",
      "expired",
    ] as const)
    && isEnumValue(value.reason, [
      "no-signal",
      "tracking-paused",
      "empty-window",
      "not-eligible",
      "signal-inactive",
      "identity-mismatch",
      "signal-matched",
      "grace-window",
      "grace-expired",
      "sustained-window-expired",
    ] as const)
    && (
      value.windowIdentity === null
      || isEnumValue(value.windowIdentity, [
        "chrome",
        "edge",
        "firefox",
        "brave",
        "zoom",
        "teams",
        "vlc",
        "bilibili",
        "douyin",
        "we-meet",
      ] as const)
    )
    && (
      value.effectiveSignalSource === null
      || value.effectiveSignalSource === "system-media"
      || value.effectiveSignalSource === "audio-session"
    )
    && (value.lastMatchAtMs === null || typeof value.lastMatchAtMs === "number")
    && (value.graceDeadlineMs === null || typeof value.graceDeadlineMs === "number")
    && isSustainedParticipationSignalEvaluationSnapshot(value.systemMedia)
    && isSustainedParticipationSignalEvaluationSnapshot(value.audioSession);
}

export function isCurrentTrackingSnapshot(value: unknown): value is CurrentTrackingSnapshot {
  return isRecord(value)
    && isTrackingWindowSnapshot(value.window)
    && isTrackingStatusSnapshot(value.status)
    && (
      value.sampledAtMs === undefined
      || typeof value.sampledAtMs === "number"
    )
    && (
      value.probeStatus === undefined
      || isEnumValue(value.probeStatus, [
        "ok",
        "timeout-fallback",
        "timeout-inactive",
        "backing-off-fallback",
        "backing-off-inactive",
        "task-failed-fallback",
        "task-failed-inactive",
      ] as const)
    )
    && (
      value.degradedReason === undefined
      || value.degradedReason === null
      || typeof value.degradedReason === "string"
    );
}

export function isTrackingDataChangedPayload(value: unknown): value is TrackingDataChangedPayload {
  return isRecord(value)
    && typeof value.reason === "string"
    && typeof value.changedAtMs === "number";
}
