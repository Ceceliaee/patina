import { useEffect, useRef } from "react";
import { clearToolsPageCaches } from "../../features/tools/services/toolsCacheLifecycle.ts";
import { readCurrentWindowForegroundState } from "../../platform/desktop/windowControlGateway.ts";
import type { QuietMotionMode } from "../../shared/motion/quietMotion.ts";
import { LONG_BACKGROUND_DELAY_MS } from "../services/backgroundReturnHomePolicy.ts";
import {
  startStartupWarmup,
} from "../services/startupWarmupService.ts";

const BACKGROUND_CACHE_RELEASE_DELAY_MS = LONG_BACKGROUND_DELAY_MS;

interface AppShellRuntimeLifecycleOptions {
  classificationReady: boolean;
  isForegroundReady: boolean;
  isWindowForegroundLike: boolean;
  quietMotionMode: QuietMotionMode;
}

export function useAppShellRuntimeLifecycle({
  classificationReady,
  isForegroundReady,
  isWindowForegroundLike,
  quietMotionMode,
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
    if (isForegroundReady) return undefined;

    const timer = window.setTimeout(() => {
      if (document.visibilityState !== "hidden" && isWindowForegroundLike) return;

      try {
        clearToolsPageCaches();
      } catch (error) {
        console.warn("clear page heavy caches after background delay failed", error);
      }
    }, BACKGROUND_CACHE_RELEASE_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isForegroundReady, isWindowForegroundLike]);
}
