import { useEffect, useState } from "react";
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
import { applyWidgetBootstrapSnapshot } from "./widgetBootstrapService.ts";
import {
  getWidgetPresentationSnapshot,
  getWidgetBootstrapSnapshot,
  onWidgetToolsChanged,
  type WidgetStatusSnapshot,
} from "../../platform/desktop/widgetRuntimeGateway.ts";

interface WidgetTrackingSnapshot {
  trackingPaused: boolean | null;
  activeWindow: TrackingWindowSnapshot | null;
  trackingStatus: TrackingStatusSnapshot;
  trackingRuntimeProbeStatus: TrackingRuntimeProbeStatus | null;
  widgetStatus: WidgetStatusSnapshot | null;
}

const EMPTY_TRACKING_SNAPSHOT: WidgetTrackingSnapshot = {
  trackingPaused: null,
  activeWindow: null,
  trackingStatus: DEFAULT_TRACKING_STATUS,
  trackingRuntimeProbeStatus: null,
  widgetStatus: null,
};

function warnWidgetRefresh(error: unknown) {
  console.warn("widget:refresh", error);
}

async function loadWidgetTrackingSnapshot(): Promise<WidgetTrackingSnapshot> {
  const snapshot = await getWidgetPresentationSnapshot();

  return {
    trackingPaused: snapshot.trackingPaused,
    activeWindow: snapshot.activeWindow,
    trackingStatus: snapshot.trackingStatus,
    trackingRuntimeProbeStatus: snapshot.trackingProbeStatus,
    widgetStatus: snapshot.status,
  };
}

async function loadWidgetTrackerHealth(nowMs: number): Promise<TrackerHealthSnapshot> {
  const runtimeSnapshot = await getTrackerHealthRuntimeSnapshot();
  return resolveTrackerHealth(
    runtimeSnapshot?.lastHeartbeatMs ?? null,
    nowMs,
    TRACKER_HEARTBEAT_STALE_AFTER_MS,
  );
}

export function useWidgetTracking() {
  const [trackingSnapshot, setTrackingSnapshot] = useState<WidgetTrackingSnapshot>(
    EMPTY_TRACKING_SNAPSHOT,
  );
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [classificationReady, setClassificationReady] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [trackerHealth, setTrackerHealth] = useState<TrackerHealthSnapshot>(() => (
    resolveTrackerHealth(null, Date.now(), TRACKER_HEARTBEAT_STALE_AFTER_MS)
  ));

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const tracking = createLatestSnapshotRefresh({
      load: loadWidgetTrackingSnapshot, accept: setTrackingSnapshot, failed: warnWidgetRefresh,
    });
    const bootstrap = createLatestSnapshotRefresh({
      load: getWidgetBootstrapSnapshot,
      accept: (raw) => {
        const snapshot = applyWidgetBootstrapSnapshot(raw);
        setAppSettings(snapshot.settings); setPinned(snapshot.pinned); setClassificationReady(true);
      },
      failed: warnWidgetRefresh,
    });
    const refreshBootstrap = () => bootstrap.refresh();
    const refreshTracking = () => tracking.refresh();

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
        listen(onWidgetToolsChanged(() => { void refreshTracking(); })),
      ]);
      for (const result of subscriptions) {
        if (result.status === "rejected") warnWidgetRefresh(result.reason);
      }
      if (cancelled) return;
      await Promise.all([refreshBootstrap(), refreshTracking()]);
      if (!cancelled) setClassificationReady(true);
    };

    void init();

    return () => {
      cancelled = true;
      tracking.dispose();
      bootstrap.dispose();
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => startTrackerHealthPolling(setTrackerHealth, {
    deps: {
      loadSnapshot: loadWidgetTrackerHealth,
    },
  }), []);

  return {
    activeWindow: trackingSnapshot.activeWindow,
    trackingStatus: trackingSnapshot.trackingStatus,
    appSettings: { ...appSettings, trackingPaused: trackingSnapshot.trackingPaused ?? appSettings.trackingPaused },
    classificationReady,
    trackerHealth,
    trackingRuntimeProbeStatus: trackingSnapshot.trackingRuntimeProbeStatus,
    pinned,
    widgetStatus: trackingSnapshot.widgetStatus,
  };
}
