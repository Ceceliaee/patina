import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, type AppSettings } from "../../shared/settings/appSettings";
import type {
  TrackerHealthSnapshot,
  TrackingRuntimeProbeStatus,
  TrackingStatusSnapshot,
  TrackingWindowSnapshot,
} from "../../shared/types/tracking";
import { DEFAULT_TRACKING_STATUS, resolveTrackerHealth } from "../../shared/types/tracking";
import {
  loadAppRuntimeBootstrapSnapshot,
  TRACKER_HEARTBEAT_STALE_AFTER_MS,
} from "../services/appRuntimeBootstrapService";
import {
  loadCurrentTrackingSnapshot,
  loadCurrentWindowSnapshot,
  subscribeActiveWindowChanged,
  subscribeTrackingDataChanged,
} from "../services/appRuntimeTrackingService";
import {
  loadLatestTrackingPauseSetting,
  loadCurrentAppSettings,
  subscribeAppSettingsChanged,
} from "../services/appSettingsRuntimeService.ts";
import { clearDashboardSnapshotCache } from "../../features/dashboard/services/dashboardSnapshotCache.ts";
import { clearDataBootstrapCache } from "../../features/data/services/dataCacheLifecycle.ts";
import { clearHistoryCachesAfterDataChange } from "../../features/history/services/historyCacheLifecycle.ts";
import { startTrackerHealthPolling } from "../services/trackerHealthPollingService";
import { applyTrackingDataChangedPayload } from "./trackingDataChangedRuntime";
import { useDesktopLaunchBehaviorSync } from "./useDesktopLaunchBehaviorSync";

interface UseWindowTrackingOptions {
  syncDesktopLaunchBehavior?: boolean;
  trackerHealthPollingEnabled?: boolean;
}

export function useWindowTracking(options: UseWindowTrackingOptions = {}) {
  const shouldSyncDesktopLaunchBehavior = options.syncDesktopLaunchBehavior ?? true;
  const trackerHealthPollingEnabled = options.trackerHealthPollingEnabled ?? true;
  const [activeWindow, setActiveWindow] = useState<TrackingWindowSnapshot | null>(null);
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatusSnapshot>(DEFAULT_TRACKING_STATUS);
  const [trackingRuntimeProbeStatus, setTrackingRuntimeProbeStatus] = useState<TrackingRuntimeProbeStatus | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [syncTick, setSyncTick] = useState(0);
  const [classificationReady, setClassificationReady] = useState(false);
  const [trackerHealth, setTrackerHealth] = useState<TrackerHealthSnapshot>(() => (
    resolveTrackerHealth(null, Date.now(), TRACKER_HEARTBEAT_STALE_AFTER_MS)
  ));
  useDesktopLaunchBehaviorSync(appSettings, shouldSyncDesktopLaunchBehavior);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];

    const init = async () => {
      try {
        const bootstrap = await loadAppRuntimeBootstrapSnapshot();
        if (cancelled) return;

        setAppSettings(bootstrap.settings);
        setActiveWindow(bootstrap.activeWindow);
        setTrackingStatus(bootstrap.trackingStatus);
        setTrackingRuntimeProbeStatus(bootstrap.trackingRuntimeProbeStatus);
        setTrackerHealth(bootstrap.trackerHealth);
        setClassificationReady(true);
      } catch (err) {
        if (cancelled) return;
        console.error("Tracking init error", err);
        setClassificationReady(true);
      }

      if (cancelled) return;

      const activeWindowUnlisten = await subscribeActiveWindowChanged(async (window) => {
        if (cancelled) return;
        setActiveWindow(window);

        const snapshot = await loadCurrentTrackingSnapshot().catch((error) => {
          if (!cancelled) {
            console.warn("Failed to sync tracking snapshot after active-window change", error);
          }
          return null;
        });
        if (cancelled || !snapshot) return;

        setActiveWindow(snapshot.window);
        setTrackingStatus(snapshot.status);
        setTrackingRuntimeProbeStatus(snapshot.probeStatus ?? null);
      });
      if (cancelled) {
        activeWindowUnlisten();
        return;
      }
      unlisteners.push(activeWindowUnlisten);

      const trackingDataUnlisten = await subscribeTrackingDataChanged(
        async (payload) => {
          if (cancelled) return;
          if (payload.reason === "backup-restored") {
            clearDashboardSnapshotCache();
            void clearHistoryCachesAfterDataChange();
            void clearDataBootstrapCache();
          }
          await applyTrackingDataChangedPayload(payload, {
            loadLatestTrackingPauseSetting,
            loadCurrentTrackingSnapshot,
            loadCurrentWindowSnapshot,
            setAppSettings: (updater) => {
              if (!cancelled) {
                setAppSettings(updater);
              }
            },
            setActiveWindow: (nextWindow) => {
              if (!cancelled) {
                setActiveWindow(nextWindow);
              }
            },
            setTrackingStatus: (nextStatus) => {
              if (!cancelled) {
                setTrackingStatus(nextStatus);
              }
            },
            setTrackingRuntimeProbeStatus: (nextStatus) => {
              if (!cancelled) {
                setTrackingRuntimeProbeStatus(nextStatus);
              }
            },
            bumpSyncTick: () => {
              if (!cancelled) {
                setSyncTick((tick) => tick + 1);
              }
            },
            warn: (message, error) => {
              if (!cancelled) {
                console.warn(message, error);
              }
            },
          });
        },
      );
      if (cancelled) {
        trackingDataUnlisten();
        return;
      }
      unlisteners.push(trackingDataUnlisten);

      const appSettingsChangedUnlisten = await subscribeAppSettingsChanged(async () => {
        const nextSettings = await loadCurrentAppSettings().catch((error) => {
          if (!cancelled) {
            console.warn("Failed to reload app settings after settings change", error);
          }
          return null;
        });
        if (!cancelled && nextSettings) {
          setAppSettings(nextSettings);
        }
      });
      if (cancelled) {
        appSettingsChangedUnlisten();
        return;
      }
      unlisteners.push(appSettingsChangedUnlisten);
    };

    void init();

    return () => {
      cancelled = true;
      for (const off of unlisteners) {
        off();
      }
    };
  }, []);

  useEffect(() => {
    if (!trackerHealthPollingEnabled) return undefined;

    return startTrackerHealthPolling((snapshot) => {
      setTrackerHealth(snapshot);
    });
  }, [trackerHealthPollingEnabled]);

  return {
    activeWindow,
    trackingStatus,
    appSettings,
    setAppSettings,
    classificationReady,
    syncTick,
    trackerHealth,
    trackingRuntimeProbeStatus,
  };
}
