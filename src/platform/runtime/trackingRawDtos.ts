import type {
  CurrentTrackingSnapshot,
  SustainedParticipationAppIdentity,
  SustainedParticipationDiagnosticsSnapshot,
  SustainedParticipationKind,
  SustainedParticipationSignalEvaluationSnapshot,
  SustainedParticipationSignalMatchResult,
  SustainedParticipationSignalSnapshot,
  SustainedParticipationSignalSource,
  SustainedParticipationState,
  SustainedParticipationStatusReason,
  TrackingDataChangedPayload,
  TrackingStatusSnapshot,
  TrackingRuntimeProbeStatus,
  TrackingWindowSnapshot,
} from "../../shared/types/tracking.ts";

export interface RawTrackingWindowSnapshot {
  hwnd: string;
  root_owner_hwnd: string;
  process_id: number;
  window_class: string;
  title: string;
  exe_name: string;
  process_path: string;
  is_afk: boolean;
  idle_time_ms: number;
}

export interface RawSustainedParticipationSignalSnapshot {
  is_available: boolean;
  is_active: boolean;
  signal_source: SustainedParticipationSignalSource | null;
  source_app_id: string | null;
  source_app_identity: SustainedParticipationAppIdentity | null;
  playback_type: "unknown" | "audio" | "video" | "image" | null;
}

export interface RawSustainedParticipationSignalEvaluationSnapshot {
  signal: RawSustainedParticipationSignalSnapshot;
  match_result: SustainedParticipationSignalMatchResult;
}

export interface RawSustainedParticipationDiagnosticsSnapshot {
  state: SustainedParticipationState;
  reason: SustainedParticipationStatusReason;
  window_identity: SustainedParticipationAppIdentity | null;
  effective_signal_source: SustainedParticipationSignalSource | null;
  last_match_at_ms: number | null;
  grace_deadline_ms: number | null;
  system_media: RawSustainedParticipationSignalEvaluationSnapshot;
  audio_session: RawSustainedParticipationSignalEvaluationSnapshot;
}

export interface RawTrackingStatusSnapshot {
  is_tracking_active: boolean;
  sustained_participation_eligible: boolean;
  sustained_participation_active: boolean;
  sustained_participation_kind: SustainedParticipationKind | null;
  sustained_participation_state: SustainedParticipationState;
  sustained_participation_signal_source: SustainedParticipationSignalSource | null;
  sustained_participation_reason: SustainedParticipationStatusReason;
  sustained_participation_diagnostics: RawSustainedParticipationDiagnosticsSnapshot;
}

export interface RawCurrentTrackingSnapshot {
  window: RawTrackingWindowSnapshot;
  status: RawTrackingStatusSnapshot;
  sampled_at_ms?: number;
  probe_status?: TrackingRuntimeProbeStatus;
  degraded_reason?: string | null;
}

export interface RawTrackingDataChangedPayload {
  reason: string;
  changed_at_ms: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnumValue<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && allowed.includes(value as T);
}

export function isRawTrackingWindowSnapshot(value: unknown): value is RawTrackingWindowSnapshot {
  return isRecord(value)
    && typeof value.hwnd === "string"
    && typeof value.root_owner_hwnd === "string"
    && typeof value.process_id === "number"
    && typeof value.window_class === "string"
    && typeof value.title === "string"
    && typeof value.exe_name === "string"
    && typeof value.process_path === "string"
    && typeof value.is_afk === "boolean"
    && typeof value.idle_time_ms === "number";
}

export function isRawTrackingStatusSnapshot(value: unknown): value is RawTrackingStatusSnapshot {
  return isRecord(value)
    && typeof value.is_tracking_active === "boolean"
    && typeof value.sustained_participation_eligible === "boolean"
    && typeof value.sustained_participation_active === "boolean"
    && (
      value.sustained_participation_kind === null
      || value.sustained_participation_kind === "audio"
    )
    && isEnumValue(value.sustained_participation_state, [
      "inactive",
      "candidate",
      "active",
      "grace",
      "expired",
    ] as const)
    && (
      value.sustained_participation_signal_source === null
      || value.sustained_participation_signal_source === "system-media"
      || value.sustained_participation_signal_source === "audio-session"
    )
    && isEnumValue(value.sustained_participation_reason, [
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
    && isRawSustainedParticipationDiagnosticsSnapshot(value.sustained_participation_diagnostics);
}

export function isRawSustainedParticipationSignalSnapshot(
  value: unknown,
): value is RawSustainedParticipationSignalSnapshot {
  return isRecord(value)
    && typeof value.is_available === "boolean"
    && typeof value.is_active === "boolean"
    && (
      value.signal_source === null
      || value.signal_source === "system-media"
      || value.signal_source === "audio-session"
    )
    && (value.source_app_id === null || typeof value.source_app_id === "string")
    && (
      value.source_app_identity === null
      || isEnumValue(value.source_app_identity, [
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
      value.playback_type === null
      || isEnumValue(value.playback_type, [
        "unknown",
        "audio",
        "video",
        "image",
      ] as const)
    );
}

export function isRawSustainedParticipationSignalEvaluationSnapshot(
  value: unknown,
): value is RawSustainedParticipationSignalEvaluationSnapshot {
  return isRecord(value)
    && isRawSustainedParticipationSignalSnapshot(value.signal)
    && isEnumValue(value.match_result, [
      "unavailable",
      "inactive",
      "identity-mismatch",
      "matched",
    ] as const);
}

export function isRawSustainedParticipationDiagnosticsSnapshot(
  value: unknown,
): value is RawSustainedParticipationDiagnosticsSnapshot {
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
      value.window_identity === null
      || isEnumValue(value.window_identity, [
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
      value.effective_signal_source === null
      || value.effective_signal_source === "system-media"
      || value.effective_signal_source === "audio-session"
    )
    && (value.last_match_at_ms === null || typeof value.last_match_at_ms === "number")
    && (value.grace_deadline_ms === null || typeof value.grace_deadline_ms === "number")
    && isRawSustainedParticipationSignalEvaluationSnapshot(value.system_media)
    && isRawSustainedParticipationSignalEvaluationSnapshot(value.audio_session);
}

export function isRawCurrentTrackingSnapshot(value: unknown): value is RawCurrentTrackingSnapshot {
  return isRecord(value)
    && isRawTrackingWindowSnapshot(value.window)
    && isRawTrackingStatusSnapshot(value.status)
    && (
      value.sampled_at_ms === undefined
      || typeof value.sampled_at_ms === "number"
    )
    && (
      value.probe_status === undefined
      || isEnumValue(value.probe_status, [
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
      value.degraded_reason === undefined
      || value.degraded_reason === null
      || typeof value.degraded_reason === "string"
    );
}

export function isRawTrackingDataChangedPayload(value: unknown): value is RawTrackingDataChangedPayload {
  return isRecord(value)
    && typeof value.reason === "string"
    && typeof value.changed_at_ms === "number";
}

export function mapRawTrackingWindowSnapshot(
  raw: RawTrackingWindowSnapshot,
): TrackingWindowSnapshot {
  return {
    hwnd: raw.hwnd,
    rootOwnerHwnd: raw.root_owner_hwnd,
    processId: raw.process_id,
    windowClass: raw.window_class,
    title: raw.title,
    exeName: raw.exe_name,
    processPath: raw.process_path,
    isAfk: raw.is_afk,
    idleTimeMs: raw.idle_time_ms,
  };
}

function mapRawSustainedParticipationSignalSnapshot(
  raw: RawSustainedParticipationSignalSnapshot,
): SustainedParticipationSignalSnapshot {
  return {
    isAvailable: raw.is_available,
    isActive: raw.is_active,
    signalSource: raw.signal_source,
    sourceAppId: raw.source_app_id,
    sourceAppIdentity: raw.source_app_identity,
    playbackType: raw.playback_type,
  };
}

function mapRawSustainedParticipationSignalEvaluationSnapshot(
  raw: RawSustainedParticipationSignalEvaluationSnapshot,
): SustainedParticipationSignalEvaluationSnapshot {
  return {
    signal: mapRawSustainedParticipationSignalSnapshot(raw.signal),
    matchResult: raw.match_result,
  };
}

function mapRawSustainedParticipationDiagnosticsSnapshot(
  raw: RawSustainedParticipationDiagnosticsSnapshot,
): SustainedParticipationDiagnosticsSnapshot {
  return {
    state: raw.state,
    reason: raw.reason,
    windowIdentity: raw.window_identity,
    effectiveSignalSource: raw.effective_signal_source,
    lastMatchAtMs: raw.last_match_at_ms,
    graceDeadlineMs: raw.grace_deadline_ms,
    systemMedia: mapRawSustainedParticipationSignalEvaluationSnapshot(raw.system_media),
    audioSession: mapRawSustainedParticipationSignalEvaluationSnapshot(raw.audio_session),
  };
}

export function mapRawTrackingStatusSnapshot(
  raw: RawTrackingStatusSnapshot,
): TrackingStatusSnapshot {
  return {
    isTrackingActive: raw.is_tracking_active,
    sustainedParticipationEligible: raw.sustained_participation_eligible,
    sustainedParticipationActive: raw.sustained_participation_active,
    sustainedParticipationKind: raw.sustained_participation_kind,
    sustainedParticipationState: raw.sustained_participation_state,
    sustainedParticipationSignalSource: raw.sustained_participation_signal_source,
    sustainedParticipationReason: raw.sustained_participation_reason,
    sustainedParticipationDiagnostics: mapRawSustainedParticipationDiagnosticsSnapshot(
      raw.sustained_participation_diagnostics,
    ),
  };
}

export function mapRawCurrentTrackingSnapshot(
  raw: RawCurrentTrackingSnapshot,
): CurrentTrackingSnapshot {
  return {
    window: mapRawTrackingWindowSnapshot(raw.window),
    status: mapRawTrackingStatusSnapshot(raw.status),
    sampledAtMs: raw.sampled_at_ms,
    probeStatus: raw.probe_status,
    degradedReason: raw.degraded_reason,
  };
}

export function mapRawTrackingDataChangedPayload(
  raw: RawTrackingDataChangedPayload,
): TrackingDataChangedPayload {
  return {
    reason: raw.reason,
    changedAtMs: raw.changed_at_ms,
  };
}

export function parseTrackingWindowSnapshot(value: unknown): TrackingWindowSnapshot | null {
  return isRawTrackingWindowSnapshot(value) ? mapRawTrackingWindowSnapshot(value) : null;
}

export function parseCurrentTrackingSnapshot(value: unknown): CurrentTrackingSnapshot | null {
  return isRawCurrentTrackingSnapshot(value) ? mapRawCurrentTrackingSnapshot(value) : null;
}

export function parseTrackingDataChangedPayload(value: unknown): TrackingDataChangedPayload | null {
  return isRawTrackingDataChangedPayload(value) ? mapRawTrackingDataChangedPayload(value) : null;
}
