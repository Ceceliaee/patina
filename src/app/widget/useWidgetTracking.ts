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
import { resolveTrackingDataChangedEffects } from "../hooks/trackingDataChangedPolicy.ts";
import { loadWidgetRuntimeBootstrapSnapshot } from "./widgetBootstrapService.ts";
import {
  getWidgetPresentationSnapshot,
  onWidgetToolsChanged,
  type WidgetStatusSnapshot,
} from "../../platform/desktop/widgetRuntimeGateway.ts";

interface WidgetTrackingSnapshot {
  activeWindow: TrackingWindowSnapshot | null;
  trackingStatus: TrackingStatusSnapshot;
  trackingRuntimeProbeStatus: TrackingRuntimeProbeStatus | null;
  widgetStatus: WidgetStatusSnapshot | null;
}

const EMPTY_TRACKING_SNAPSHOT: WidgetTrackingSnapshot = {
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
    let latestTrackingRequest = 0;
    const unlisteners: Array<() => void> = [];

    const applyTrackingSnapshot = (snapshot: WidgetTrackingSnapshot) => {
      if (cancelled) return;
      setTrackingSnapshot(snapshot);
    };

    const refreshBootstrap = async () => {
      const bootstrap = await loadWidgetRuntimeBootstrapSnapshot();
      if (cancelled) return;
      setAppSettings(bootstrap.settings);
      setPinned(bootstrap.pinned);
      setClassificationReady(true);
    };

    const refreshTracking = async () => {
      const request = ++latestTrackingRequest;
      const snapshot = await loadWidgetTrackingSnapshot();
      if (request === latestTrackingRequest) {
        applyTrackingSnapshot(snapshot);
      }
    };

    const guardRefresh = (request: Promise<unknown>) => request.catch((error) => {
      if (!cancelled) warnWidgetRefresh(error);
    });

    const init = async () => {
      try {
        const [
          activeWindowUnlisten,
          trackingDataUnlisten,
          appSettingsUnlisten,
          toolsUnlisten,
        ] =
          await Promise.all([
            onActiveWindowChanged(async () => {
              if (cancelled) return;
              await guardRefresh(refreshTracking());
            }),
            onTrackingDataChanged(async (payload) => {
              const effects = resolveTrackingDataChangedEffects(payload.reason);
              const refreshes: Promise<unknown>[] = [];
              if (effects.shouldRefresh) {
                refreshes.push(refreshTracking());
              }
              if (effects.shouldSyncPauseSetting) {
                refreshes.push(refreshBootstrap());
              }
              await guardRefresh(Promise.all(refreshes));
            }),
            onAppSettingsChanged(async () => {
              await guardRefresh(refreshBootstrap());
            }),
            onWidgetToolsChanged(() => {
              void guardRefresh(refreshTracking());
            }),
          ]);
        if (cancelled) {
          activeWindowUnlisten();
          trackingDataUnlisten();
          appSettingsUnlisten();
          toolsUnlisten();
          return;
        }
        unlisteners.push(
          activeWindowUnlisten,
          trackingDataUnlisten,
          appSettingsUnlisten,
          toolsUnlisten,
        );

        const [bootstrap] = await Promise.all([
          loadWidgetRuntimeBootstrapSnapshot(),
          refreshTracking(),
        ]);
        if (cancelled) return;
        setAppSettings(bootstrap.settings);
        setPinned(bootstrap.pinned);
        setClassificationReady(true);
      } catch (error) {
        if (cancelled) return;
        console.error("widget:init", error);
        setClassificationReady(true);
      }
    };

    void init();

    return () => {
      cancelled = true;
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
    appSettings,
    classificationReady,
    trackerHealth,
    trackingRuntimeProbeStatus: trackingSnapshot.trackingRuntimeProbeStatus,
    pinned,
    widgetStatus: trackingSnapshot.widgetStatus,
  };
}
