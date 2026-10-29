import { onToolsRuntimeChanged } from "../../platform/runtime/toolsRuntimeGateway.ts";
import { useEffect, useLayoutEffect, useState } from "react";
import { onAppSettingsChanged } from "../../platform/runtime/appSettingsEventGateway.ts";
import {
  getTrackerHealthRuntimeSnapshot,
  onActiveWindowChanged,
  onTrackingDataChanged,
} from "../../platform/runtime/trackingRuntimeGateway.ts";
import { DEFAULT_SETTINGS, type AppSettings } from "../../shared/settings/appSettings.ts";
import {
  DEFAULT_TRACKING_STATUS,
  resolveTrackerHealth,
  TRACKER_HEARTBEAT_STALE_AFTER_MS,
  type TrackerHealthSnapshot,
  type TrackingRuntimeProbeStatus,
  type TrackingStatusSnapshot,
  type TrackingWindowSnapshot,
} from "../../shared/types/tracking.ts";
import { startTrackerHealthPolling } from "../services/trackerHealthPollingService.ts";
import { createLatestSnapshotRefresh } from "../services/latestSnapshotRefresh.ts";
import { applyMiniBootstrapSnapshot } from "./miniBootstrapService.ts";
import {
  getMiniPresentationSnapshot,
  getMiniBootstrapSnapshot,
  type MiniStatusSnapshot,
} from "../../platform/desktop/miniContentRuntimeGateway.ts";

interface MiniTrackingSnapshot {
  trackingPaused: boolean | null;
  activeWindow: TrackingWindowSnapshot | null;
  trackingStatus: TrackingStatusSnapshot;
  trackingRuntimeProbeStatus: TrackingRuntimeProbeStatus | null;
  miniStatus: MiniStatusSnapshot | null;
}

const EMPTY_TRACKING_SNAPSHOT: MiniTrackingSnapshot = {
  trackingPaused: null,
  activeWindow: null,
  trackingStatus: DEFAULT_TRACKING_STATUS,
  trackingRuntimeProbeStatus: null,
  miniStatus: null,
};

function warnMiniRefresh(error: unknown) {
  console.warn("mini:refresh", error);
}

async function loadMiniTrackingSnapshot(): Promise<MiniTrackingSnapshot> {
  const snapshot = await getMiniPresentationSnapshot();

  return {
    trackingPaused: snapshot.trackingPaused,
    activeWindow: snapshot.activeWindow,
    trackingStatus: snapshot.trackingStatus,
    trackingRuntimeProbeStatus: snapshot.trackingProbeStatus,
    miniStatus: snapshot.status,
  };
}

async function loadMiniTrackerHealth(nowMs: number): Promise<TrackerHealthSnapshot> {
  const runtimeSnapshot = await getTrackerHealthRuntimeSnapshot();
  return resolveTrackerHealth(
    runtimeSnapshot?.lastHeartbeatMs ?? null,
    nowMs,
    TRACKER_HEARTBEAT_STALE_AFTER_MS,
  );
}

export function useMiniTracking(contentActive = true, toolsActive = contentActive) {
  const [retryVersion, setRetryVersion] = useState(0);
  const [presentationReady, setPresentationReady] = useState(false);
  const [presentationFailed, setPresentationFailed] = useState(false);
  useLayoutEffect(() => { setPresentationReady(false); setPresentationFailed(false); }, [contentActive, toolsActive, retryVersion]);
  const [trackingSnapshot, setTrackingSnapshot] = useState<MiniTrackingSnapshot>(
    EMPTY_TRACKING_SNAPSHOT,
  );
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [trackerHealth, setTrackerHealth] = useState<TrackerHealthSnapshot>(() => (
    resolveTrackerHealth(null, Date.now(), TRACKER_HEARTBEAT_STALE_AFTER_MS)
  ));

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    let bootstrapAccepted = false;
    let trackingAccepted = false;
    let bootstrapFailed = false;
    let trackingFailed = false;
    const acceptReady = () => {
      if (!contentActive || cancelled) return;
      setPresentationFailed(bootstrapFailed || trackingFailed);
      if (bootstrapAccepted && trackingAccepted) setPresentationReady(true);
    };

    const tracking = createLatestSnapshotRefresh({
      load: loadMiniTrackingSnapshot,
      accept: (snapshot) => { setTrackingSnapshot(snapshot); trackingAccepted = true; trackingFailed = false; acceptReady(); },
      failed: (error) => { trackingFailed = true; acceptReady(); warnMiniRefresh(error); },
    });
    const bootstrap = createLatestSnapshotRefresh({
      load: getMiniBootstrapSnapshot,
      accept: (raw) => {
        const snapshot = applyMiniBootstrapSnapshot(raw);
        setAppSettings(snapshot.settings);
        bootstrapAccepted = true; bootstrapFailed = false; acceptReady();
      },
      failed: (error) => { bootstrapFailed = true; acceptReady(); warnMiniRefresh(error); },
    });
    const health = createLatestSnapshotRefresh({
      load: () => loadMiniTrackerHealth(Date.now()),
      accept: setTrackerHealth,
      failed: warnMiniRefresh,
    });
    const refreshBootstrap = () => bootstrap.refresh();
    const refreshTracking = async () => {
      await Promise.all([tracking.refresh(), ...(!contentActive ? [health.refresh()] : [])]);
    };

    const listen = async (subscription: Promise<() => void>) => {
      const off = await subscription;
      if (cancelled) off(); else unlisteners.push(off);
    };
    const init = async () => {
      const subscriptions = await Promise.allSettled([
        listen(onActiveWindowChanged(refreshTracking)),
        listen(onTrackingDataChanged(refreshTracking)),
        listen(onAppSettingsChanged(async () => {
          await Promise.all([refreshBootstrap(), refreshTracking()]);
        })),
        ...(toolsActive ? [listen(onToolsRuntimeChanged(() => { void refreshTracking(); }))] : []),
      ]);
      for (const result of subscriptions) {
        if (result.status === "rejected") warnMiniRefresh(result.reason);
      }
      if (cancelled) return;
      await Promise.all([refreshBootstrap(), refreshTracking()]);
    };

    void init();

    return () => {
      cancelled = true;
      tracking.dispose();
      bootstrap.dispose();
      health.dispose();
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [contentActive, toolsActive, retryVersion]);

  useEffect(() => contentActive ? startTrackerHealthPolling(setTrackerHealth, {
    deps: {
      loadSnapshot: loadMiniTrackerHealth,
    },
  }) : undefined, [contentActive]);

  return {
    activeWindow: trackingSnapshot.activeWindow,
    trackingStatus: trackingSnapshot.trackingStatus,
    appSettings: { ...appSettings, trackingPaused: trackingSnapshot.trackingPaused ?? appSettings.trackingPaused },
    presentationReady,
    presentationFailed,
    trackerHealth,
    trackingRuntimeProbeStatus: trackingSnapshot.trackingRuntimeProbeStatus,
    miniStatus: trackingSnapshot.miniStatus,
    retry: () => setRetryVersion(version => version + 1),
  };
}
