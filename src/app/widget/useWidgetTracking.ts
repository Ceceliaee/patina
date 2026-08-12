import { useEffect, useState } from "react";
import { onAppSettingsChanged } from "../../platform/runtime/appSettingsEventGateway.ts";
import {
  getCurrentTrackingSnapshot,
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
  getWidgetStatusSnapshot,
  onWidgetToolsChanged,
  type WidgetStatusSnapshot,
} from "../../platform/desktop/widgetRuntimeGateway.ts";

interface WidgetTrackingSnapshot {
  activeWindow: TrackingWindowSnapshot | null;
  trackingStatus: TrackingStatusSnapshot;
  trackingRuntimeProbeStatus: TrackingRuntimeProbeStatus | null;
}

const EMPTY_TRACKING_SNAPSHOT: WidgetTrackingSnapshot = {
  activeWindow: null,
  trackingStatus: DEFAULT_TRACKING_STATUS,
  trackingRuntimeProbeStatus: null,
};

function warnWidgetRefresh(error: unknown) {
  console.warn("widget:refresh", error);
}

async function loadWidgetTrackingSnapshot(): Promise<WidgetTrackingSnapshot> {
  const snapshot = await getCurrentTrackingSnapshot();
  if (!snapshot) {
    return EMPTY_TRACKING_SNAPSHOT;
  }

  return {
    activeWindow: snapshot.window,
    trackingStatus: snapshot.status,
    trackingRuntimeProbeStatus: snapshot.probeStatus ?? null,
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
  const [activeWindow, setActiveWindow] = useState<TrackingWindowSnapshot | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatusSnapshot>(
    DEFAULT_TRACKING_STATUS,
  );
  const [trackingRuntimeProbeStatus, setTrackingRuntimeProbeStatus] =
    useState<TrackingRuntimeProbeStatus | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [classificationReady, setClassificationReady] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [widgetStatus, setWidgetStatus] = useState<WidgetStatusSnapshot | null>(null);
  const [trackerHealth, setTrackerHealth] = useState<TrackerHealthSnapshot>(() => (
    resolveTrackerHealth(null, Date.now(), TRACKER_HEARTBEAT_STALE_AFTER_MS)
  ));

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const applyTrackingSnapshot = (snapshot: WidgetTrackingSnapshot) => {
      if (cancelled) return;
      setActiveWindow(snapshot.activeWindow);
      setTrackingStatus(snapshot.trackingStatus);
      setTrackingRuntimeProbeStatus(snapshot.trackingRuntimeProbeStatus);
    };

    const refreshBootstrap = async () => {
      const bootstrap = await loadWidgetRuntimeBootstrapSnapshot();
      if (cancelled) return;
      setAppSettings(bootstrap.settings);
      setPinned(bootstrap.pinned);
      setClassificationReady(true);
    };

    const refreshTracking = async () => {
      applyTrackingSnapshot(await loadWidgetTrackingSnapshot());
    };

    const refreshWidgetStatus = async () => {
      const next = await getWidgetStatusSnapshot();
      if (!cancelled) setWidgetStatus(next);
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
            onActiveWindowChanged(async (window) => {
              if (cancelled) return;
              setActiveWindow(window);
              await guardRefresh(refreshTracking());
              await guardRefresh(refreshWidgetStatus());
            }),
            onTrackingDataChanged(async (payload) => {
              const effects = resolveTrackingDataChangedEffects(payload.reason);
              const refreshes: Promise<unknown>[] = [];
              if (effects.shouldRefresh) {
                refreshes.push(refreshTracking());
                refreshes.push(refreshWidgetStatus());
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
              void guardRefresh(refreshWidgetStatus());
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

        const [bootstrap, trackingSnapshot, statusSnapshot] = await Promise.all([
          loadWidgetRuntimeBootstrapSnapshot(),
          loadWidgetTrackingSnapshot(),
          getWidgetStatusSnapshot(),
        ]);
        if (cancelled) return;
        setAppSettings(bootstrap.settings);
        setPinned(bootstrap.pinned);
        setClassificationReady(true);
        applyTrackingSnapshot(trackingSnapshot);
        setWidgetStatus(statusSnapshot);
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
    activeWindow,
    trackingStatus,
    appSettings,
    classificationReady,
    trackerHealth,
    trackingRuntimeProbeStatus,
    pinned,
    widgetStatus,
  };
}
