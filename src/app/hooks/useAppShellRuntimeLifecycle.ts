import { useEffect, useRef } from "react";
import { clearDataHeavyCaches } from "../../features/data/services/dataCacheLifecycle.ts";
import { clearHistorySnapshotCache } from "../../features/history/services/historySnapshotCache.ts";
import { clearToolsPageCaches } from "../../features/tools/services/toolsCacheLifecycle.ts";
import { readCurrentWindowForegroundState } from "../../platform/desktop/windowControlGateway.ts";
import type { AppLanguage } from "../../shared/settings/appSettings.ts";
import type { QuietMotionMode } from "../../shared/motion/quietMotion.ts";
import { LONG_BACKGROUND_DELAY_MS } from "../services/backgroundReturnHomePolicy.ts";
import {
  scheduleStartupWarmupRefresh,
  startStartupWarmup,
} from "../services/startupWarmupService.ts";

const DATA_FOREGROUND_PREWARM_DELAY_MS = 1_200;
const BACKGROUND_CACHE_RELEASE_DELAY_MS = LONG_BACKGROUND_DELAY_MS;

interface AppShellRuntimeLifecycleOptions {
  backgroundOptimization: boolean;
  classificationReady: boolean;
  isDataRefreshEnabled: boolean;
  isDashboardRefreshEnabled: boolean;
  isForegroundReady: boolean;
  isHistoryRefreshEnabled: boolean;
  isWindowForegroundLike: boolean;
  mappingVersion: number;
  quietMotionMode: QuietMotionMode;
  syncTick: number;
  uiTextLanguage: AppLanguage;
}

export function useAppShellRuntimeLifecycle({
  backgroundOptimization,
  classificationReady,
  isDataRefreshEnabled,
  isDashboardRefreshEnabled,
  isForegroundReady,
  isHistoryRefreshEnabled,
  isWindowForegroundLike,
  mappingVersion,
  quietMotionMode,
  syncTick,
  uiTextLanguage,
}: AppShellRuntimeLifecycleOptions): void {
  const runtimeReadyResolveRef = useRef<(() => void) | null>(null);
  const runtimeReadyPromiseRef = useRef<Promise<void> | null>(null);

  if (!runtimeReadyPromiseRef.current) {
    runtimeReadyPromiseRef.current = new Promise((resolve) => {
      runtimeReadyResolveRef.current = resolve;
    });
  }

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    document.documentElement.dataset.qpMotion = quietMotionMode;
    return () => {
      delete document.documentElement.dataset.qpMotion;
    };
  }, [quietMotionMode]);

  useEffect(() => {
    let active = true;
    let cancelWarmup: (() => void) | null = null;
    const startWarmup = (foregroundLike: boolean) => {
      if (!active) return;

      const controller = startStartupWarmup({
        mode: foregroundLike ? "visible-start" : "hidden-start",
        runtimeReady: runtimeReadyPromiseRef.current ?? Promise.resolve(),
      });
      cancelWarmup = controller.cancel;
      if (!active) {
        controller.cancel();
      }
    };

    void readCurrentWindowForegroundState()
      .then((state) => startWarmup(state.foregroundLike))
      .catch((error) => {
        console.warn("read foreground state for startup warmup failed", error);
        startWarmup(true);
      });

    return () => {
      active = false;
      cancelWarmup?.();
    };
  }, []);

  useEffect(() => {
    if (!classificationReady) return;

    runtimeReadyResolveRef.current?.();
    runtimeReadyResolveRef.current = null;
  }, [classificationReady]);

  useEffect(() => {
    if (!classificationReady || syncTick <= 0) return undefined;

    return scheduleStartupWarmupRefresh(undefined, {
      includeDashboard: isDashboardRefreshEnabled,
      includeHistory: isHistoryRefreshEnabled,
      includeData: isDataRefreshEnabled,
    });
  }, [
    classificationReady,
    isDashboardRefreshEnabled,
    isDataRefreshEnabled,
    isHistoryRefreshEnabled,
    syncTick,
  ]);

  useEffect(() => {
    if (!classificationReady || !isForegroundReady) return undefined;

    const timer = window.setTimeout(() => {
      if (!classificationReady || !isForegroundReady) return;

      void import("../../features/data/services/dataFirstScreenPrewarm.ts")
        .then(({ prewarmDataFirstScreen }) => prewarmDataFirstScreen({
          mappingVersion,
          reason: "foreground-opened",
          uiLanguage: uiTextLanguage,
        }))
        .catch((error: unknown) => {
          console.warn("load Data first-screen prewarm owner failed", error);
        });
    }, DATA_FOREGROUND_PREWARM_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [classificationReady, isForegroundReady, mappingVersion, uiTextLanguage]);

  useEffect(() => {
    if (isForegroundReady || !backgroundOptimization) return undefined;

    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "hidden" && isWindowForegroundLike) return;

      try {
        clearHistorySnapshotCache();
        clearDataHeavyCaches();
        clearToolsPageCaches();
      } catch (error) {
        console.warn("clear page heavy caches after background delay failed", error);
      }
    }, BACKGROUND_CACHE_RELEASE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [backgroundOptimization, isForegroundReady, isWindowForegroundLike]);
}
