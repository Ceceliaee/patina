import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { DEFAULT_SETTINGS, type AppSettings } from "../../shared/settings/appSettings";
import type {
  CurrentTrackingSnapshot,
  TrackerHealthSnapshot,
} from "../../shared/types/tracking";
import {
  DEFAULT_TRACKING_STATUS,
  resolveTrackerHealth,
  TRACKER_HEARTBEAT_STALE_AFTER_MS,
} from "../../shared/types/tracking";
import {
  loadAppRuntimeBootstrapSnapshot,
  loadTrackerHealthSnapshot,
} from "../services/appRuntimeBootstrapService";
import {
  loadCurrentTrackingSnapshot,
  subscribeActiveWindowChanged,
  subscribeTrackingDataChanged,
} from "../services/appRuntimeTrackingService";
import {
  loadCurrentAppSettings,
  subscribeAppSettingsChanged,
} from "../services/appSettingsRuntimeService.ts";
import { clearDashboardSnapshotCache } from "../../features/dashboard/services/dashboardSnapshotCache.ts";
import {
  clearDataBootstrapCache,
  clearDataHeavyCaches,
} from "../../features/data/services/dataCacheLifecycle.ts";
import { clearHistoryCachesAfterDataChange } from "../../features/history/services/historyCacheLifecycle.ts";
import { startTrackerHealthPolling } from "../services/trackerHealthPollingService";
import { shouldInvalidateDataCaches } from "./trackingDataChangedPolicy.ts";
import { createLatestSnapshotRefresh } from "../services/latestSnapshotRefresh.ts";
import { useDesktopLaunchBehaviorSync } from "./useDesktopLaunchBehaviorSync";

interface UseWindowTrackingOptions {
  syncDesktopLaunchBehavior?: boolean;
  trackerHealthPollingEnabled?: boolean;
}

export function useWindowTracking(options: UseWindowTrackingOptions = {}) {
  const shouldSyncDesktopLaunchBehavior = options.syncDesktopLaunchBehavior ?? true;
  const trackerHealthPollingEnabled = options.trackerHealthPollingEnabled ?? true;
  const [trackingSnapshot, setTrackingSnapshot] = useState<CurrentTrackingSnapshot | null>(null);
  const [storedSettings, setStoredSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const appSettings = useMemo(() => ({ ...storedSettings, trackingPaused: trackingSnapshot?.trackingPaused ?? storedSettings.trackingPaused }), [storedSettings, trackingSnapshot]);
  // Page preferences may be optimistic. Runtime pause state belongs exclusively
  // to the coherent tracking snapshot once it has been accepted.
  const setAppSettings: Dispatch<SetStateAction<AppSettings>> = useCallback((update) => {
    setStoredSettings(current => typeof update === "function" ? update(current) : update);
  }, []);
  const [appSettingsLoaded, setAppSettingsLoaded] = useState(false);
  const [appearanceResolved, setAppearanceResolved] = useState(false);
  const [syncTick, setSyncTick] = useState(0);
  const [classificationReady, setClassificationReady] = useState(false);
  const [trackerHealth, setTrackerHealth] = useState<TrackerHealthSnapshot>(() => (
    resolveTrackerHealth(null, Date.now(), TRACKER_HEARTBEAT_STALE_AFTER_MS)
  ));
  useDesktopLaunchBehaviorSync(
    appSettings,
    shouldSyncDesktopLaunchBehavior && appSettingsLoaded,
  );

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    const tracking = createLatestSnapshotRefresh({
      load: async () => {
        const snapshot = await loadCurrentTrackingSnapshot();
        if (!snapshot) throw new Error("Tracking snapshot is unavailable");
        return snapshot;
      },
      accept: (snapshot) => { setTrackingSnapshot(snapshot); },
      failed: (error) => console.warn("Failed to sync tracking snapshot", error),
    });
    const settings = createLatestSnapshotRefresh({
      load: loadCurrentAppSettings,
      accept: (nextSettings) => { setStoredSettings(nextSettings); setAppSettingsLoaded(true); setAppearanceResolved(true); },
      failed: (error) => console.warn("Failed to reload app settings", error),
    });
    const listen = async (subscription: Promise<() => void>) => {
      const off = await subscription;
      if (cancelled) off(); else unlisteners.push(off);
    };
    const refreshTracking = () => tracking.refresh();
    const refreshAfterDataChange = async (payload: { reason: string }) => {
      if (cancelled) return;
      if (shouldInvalidateDataCaches(payload.reason)) {
        clearDashboardSnapshotCache();
        void clearHistoryCachesAfterDataChange();
        clearDataHeavyCaches();
        void clearDataBootstrapCache();
      }
      // Data invalidation is an event fact, independent of whether snapshot reading
      // succeeds. An older response can neither accept state nor undo this tick.
      setSyncTick(tick => tick + 1);
      await tracking.refresh();
    };
    const init = async () => {
      try {
        // Register first, then read. No event can disappear in a read/subscribe gap.
        const subscriptions = await Promise.allSettled([
          listen(subscribeActiveWindowChanged(refreshTracking)),
          listen(subscribeTrackingDataChanged(refreshAfterDataChange)),
          listen(subscribeAppSettingsChanged(async () => {
            await Promise.all([settings.refresh(), tracking.refresh()]);
          })),
        ]);
        for (const result of subscriptions) {
          if (result.status === "rejected") console.warn("Failed to subscribe to runtime changes", result.reason);
        }
        if (cancelled) return;
        await Promise.all([
          tracking.refresh(),
          settings.refresh(async () => {
            const bootstrap = await loadAppRuntimeBootstrapSnapshot();
            if (!cancelled) setTrackerHealth(current => (
              current.checkedAtMs > bootstrap.trackerHealth.checkedAtMs ? current : bootstrap.trackerHealth
            ));
            return bootstrap.settings;
          }),
        ]);
      } catch (error) {
        if (!cancelled) console.error("Tracking init error", error);
      } finally {
        if (!cancelled) { setAppearanceResolved(true); setClassificationReady(true); }
      }
    };
    void init();
    return () => {
      cancelled = true;
      tracking.dispose();
      settings.dispose();
      for (const off of unlisteners) off();
    };
  }, []);

  useEffect(() => {
    if (!trackerHealthPollingEnabled) return undefined;

    return startTrackerHealthPolling((snapshot) => {
      setTrackerHealth(snapshot);
    }, {
      deps: {
        loadSnapshot: loadTrackerHealthSnapshot,
      },
    });
  }, [trackerHealthPollingEnabled]);

  return {
    activeWindow: trackingSnapshot?.window ?? null,
    trackingStatus: trackingSnapshot?.status ?? DEFAULT_TRACKING_STATUS,
    appSettings,
    appearanceResolved,
    setAppSettings,
    classificationReady,
    syncTick,
    trackerHealth,
    trackingRuntimeProbeStatus: trackingSnapshot?.probeStatus ?? null,
  };
}
