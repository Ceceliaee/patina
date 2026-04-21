import type {
  TrackerHealthSnapshot,
  TrackingStatusSnapshot,
  TrackingWindowSnapshot,
} from "../../shared/types/tracking.ts";
import type { AppSettings } from "./appSettingsRuntimeService.ts";
import { resolveTrackerHealth } from "../../shared/types/tracking.ts";
import {
  getCurrentTrackingSnapshot,
  setAfkThreshold,
} from "../../platform/runtime/trackingRuntimeGateway.ts";
import {
  loadCurrentAppSettings,
  loadTrackerHealthTimestampMs,
} from "./appSettingsRuntimeService.ts";
import { initializeProcessMapperRuntime } from "./processMapperRuntimeService.ts";

export const TRACKER_HEARTBEAT_STALE_AFTER_MS = 8_000;

export interface AppRuntimeBootstrapSnapshot {
  settings: AppSettings;
  activeWindow: TrackingWindowSnapshot | null;
  trackingStatus: TrackingStatusSnapshot;
  trackerHealth: TrackerHealthSnapshot;
}

interface AppRuntimeBootstrapDeps {
  loadCurrentAppSettings: () => Promise<AppSettings>;
  setAfkThreshold: (seconds: number) => Promise<void>;
  initializeProcessMapperRuntime: () => Promise<void>;
  getCurrentTrackingSnapshot: typeof getCurrentTrackingSnapshot;
  loadTrackerHealthSnapshot: (nowMs?: number) => Promise<TrackerHealthSnapshot>;
}

const DEFAULT_TRACKING_STATUS: TrackingStatusSnapshot = {
  is_tracking_active: false,
  sustained_participation_eligible: false,
  sustained_participation_active: false,
  sustained_participation_kind: null,
  sustained_participation_state: "inactive",
  sustained_participation_signal_source: null,
  sustained_participation_reason: "no-signal",
  sustained_participation_diagnostics: {
    state: "inactive",
    reason: "no-signal",
    window_identity: null,
    effective_signal_source: null,
    last_match_at_ms: null,
    grace_deadline_ms: null,
    system_media: {
      signal: {
        is_available: false,
        is_active: false,
        signal_source: null,
        source_app_id: null,
        source_app_identity: null,
        playback_type: null,
      },
      match_result: "unavailable",
    },
    audio_session: {
      signal: {
        is_available: false,
        is_active: false,
        signal_source: null,
        source_app_id: null,
        source_app_identity: null,
        playback_type: null,
      },
      match_result: "unavailable",
    },
  },
};

const appRuntimeBootstrapDeps: AppRuntimeBootstrapDeps = {
  loadCurrentAppSettings,
  setAfkThreshold,
  initializeProcessMapperRuntime,
  getCurrentTrackingSnapshot,
  loadTrackerHealthSnapshot,
};

export async function loadTrackerHealthSnapshot(nowMs: number = Date.now()): Promise<TrackerHealthSnapshot> {
  try {
    const lastHeartbeatMs = await loadTrackerHealthTimestampMs();
    return resolveTrackerHealth(lastHeartbeatMs, nowMs, TRACKER_HEARTBEAT_STALE_AFTER_MS);
  } catch (error) {
    console.warn("Failed to load tracker heartbeat", error);
    return resolveTrackerHealth(null, nowMs, TRACKER_HEARTBEAT_STALE_AFTER_MS);
  }
}

export async function loadAppRuntimeBootstrapSnapshot(): Promise<AppRuntimeBootstrapSnapshot> {
  return loadAppRuntimeBootstrapSnapshotWithDeps(appRuntimeBootstrapDeps);
}

export async function loadAppRuntimeBootstrapSnapshotWithDeps(
  deps: AppRuntimeBootstrapDeps,
): Promise<AppRuntimeBootstrapSnapshot> {
  const settings = await deps.loadCurrentAppSettings();
  await deps.setAfkThreshold(settings.timeline_merge_gap_secs).catch(console.warn);

  await deps.initializeProcessMapperRuntime();

  const [trackingSnapshot, trackerHealth] = await Promise.all([
    deps.getCurrentTrackingSnapshot(),
    deps.loadTrackerHealthSnapshot(),
  ]);

  return {
    settings,
    activeWindow: trackingSnapshot?.window ?? null,
    trackingStatus: trackingSnapshot?.status ?? DEFAULT_TRACKING_STATUS,
    trackerHealth,
  };
}
