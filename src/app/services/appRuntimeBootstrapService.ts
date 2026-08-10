import type {
  TrackerHealthRuntimeSnapshot,
  TrackerHealthSnapshot,
  TrackingRuntimeProbeStatus,
  TrackingStatusSnapshot,
  TrackingWindowSnapshot,
} from "../../shared/types/tracking.ts";
import {
  DEFAULT_TRACKING_STATUS,
  resolveTrackerHealth,
  TRACKER_HEARTBEAT_STALE_AFTER_MS,
} from "../../shared/types/tracking.ts";
import type { AppSettings } from "./appSettingsRuntimeService.ts";
import {
  getCurrentTrackingSnapshot,
  getTrackerHealthRuntimeSnapshot,
  setAfkThreshold,
} from "../../platform/runtime/trackingRuntimeGateway.ts";
import {
  loadCurrentAppSettings,
  loadTrackerHealthTimestampMs,
} from "./appSettingsRuntimeService.ts";
import { initializeProcessMapperRuntime } from "./processMapperRuntimeService.ts";

interface AppRuntimeBootstrapSnapshot {
  settings: AppSettings;
  activeWindow: TrackingWindowSnapshot | null;
  trackingStatus: TrackingStatusSnapshot;
  trackingRuntimeProbeStatus: TrackingRuntimeProbeStatus | null;
  trackerHealth: TrackerHealthSnapshot;
}

interface AppRuntimeBootstrapDeps {
  loadCurrentAppSettings: () => Promise<AppSettings>;
  setAfkThreshold: (seconds: number) => Promise<void>;
  initializeProcessMapperRuntime: () => Promise<void>;
  getCurrentTrackingSnapshot: typeof getCurrentTrackingSnapshot;
  loadTrackerHealthSnapshot: (nowMs?: number) => Promise<TrackerHealthSnapshot>;
  reportWarning?: (message: string, error: unknown) => void;
}

interface TrackerHealthSnapshotDeps {
  getTrackerHealthRuntimeSnapshot: () => Promise<TrackerHealthRuntimeSnapshot | null>;
  loadTrackerHealthTimestampMs: () => Promise<number | null>;
  warn: (message: string, error?: unknown) => void;
}

const appRuntimeBootstrapDeps: AppRuntimeBootstrapDeps = {
  loadCurrentAppSettings,
  setAfkThreshold,
  initializeProcessMapperRuntime,
  getCurrentTrackingSnapshot,
  loadTrackerHealthSnapshot,
};

let warnedTrackerHealthFallback = false;

export async function loadTrackerHealthSnapshot(nowMs: number = Date.now()): Promise<TrackerHealthSnapshot> {
  return loadTrackerHealthSnapshotWithDeps(nowMs, {
    getTrackerHealthRuntimeSnapshot,
    loadTrackerHealthTimestampMs,
    warn: console.warn,
  });
}

export async function loadTrackerHealthSnapshotWithDeps(
  nowMs: number,
  deps: TrackerHealthSnapshotDeps,
): Promise<TrackerHealthSnapshot> {
  const runtimeSnapshot = await deps.getTrackerHealthRuntimeSnapshot();
  if (runtimeSnapshot) {
    return resolveTrackerHealth(
      runtimeSnapshot.lastHeartbeatMs,
      nowMs,
      TRACKER_HEARTBEAT_STALE_AFTER_MS,
    );
  }

  if (!warnedTrackerHealthFallback) {
    warnedTrackerHealthFallback = true;
    deps.warn("Falling back to stored tracker heartbeat; runtime health snapshot unavailable");
  }

  try {
    const lastHeartbeatMs = await deps.loadTrackerHealthTimestampMs();
    return resolveTrackerHealth(lastHeartbeatMs, nowMs, TRACKER_HEARTBEAT_STALE_AFTER_MS);
  } catch (error) {
    deps.warn("Failed to load tracker heartbeat", error);
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
  const reportWarning = deps.reportWarning ?? console.warn;
  await deps.setAfkThreshold(settings.timelineMergeGapSecs).catch((error) => {
    reportWarning("Failed to sync AFK threshold during app bootstrap", error);
  });

  await deps.initializeProcessMapperRuntime().catch((error) => {
    reportWarning("Failed to initialize process mapper during app bootstrap", error);
  });

  const [trackingSnapshot, trackerHealth] = await Promise.all([
    deps.getCurrentTrackingSnapshot(),
    deps.loadTrackerHealthSnapshot(),
  ]);

  return {
    settings,
    activeWindow: trackingSnapshot?.window ?? null,
    trackingStatus: trackingSnapshot?.status ?? DEFAULT_TRACKING_STATUS,
    trackingRuntimeProbeStatus: trackingSnapshot?.probeStatus ?? null,
    trackerHealth,
  };
}
