import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { useAppShellRuntimeLifecycle } from "../../src/app/hooks/useAppShellRuntimeLifecycle.ts";
import { LONG_BACKGROUND_DELAY_MS } from "../../src/app/services/backgroundReturnHomePolicy.ts";
import { getHistorySnapshotCache, setHistorySnapshotCache, clearHistorySnapshotCache } from "../../src/features/history/services/historySnapshotCache.ts";

export function mountBackgroundCacheProbe() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const originalTimeout = window.setTimeout;
  const originalClear = window.clearTimeout;
  const motion = document.documentElement.dataset.qpMotion;
  const pending = new Map<number, { dueAt: number; callback: () => void }>();
  let now = 0;
  let nextId = -1;
  // Control only the cache-release clock; application readiness keeps real timers.
  window.setTimeout = ((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
    if (delay !== LONG_BACKGROUND_DELAY_MS || typeof callback !== "function") {
      return originalTimeout(callback, delay, ...args);
    }
    const id = nextId--;
    pending.set(id, { dueAt: now + delay, callback: () => callback(...args) });
    return id;
  }) as typeof window.setTimeout;
  window.clearTimeout = (id?: number) => {
    if (id !== undefined && pending.delete(id)) return;
    originalClear(id);
  };
  const date = new Date(2030, 0, 2);
  function Probe({ foreground }: { foreground: boolean }) {
    useAppShellRuntimeLifecycle({ classificationReady: false, isDataRefreshEnabled: false,
      isDashboardRefreshEnabled: false, isForegroundReady: foreground, isHistoryRefreshEnabled: false,
      isWindowForegroundLike: foreground, mappingVersion: 0, quietMotionMode: "baseline", syncTick: 0,
      uiTextLanguage: "zh-CN" });
    return null;
  }
  return {
    render(foreground: boolean) {
      flushSync(() => root.render(createElement(Probe, { foreground })));
    },
    seed() {
      setHistorySnapshotCache({ fetchedAtMs: 1, icons: {}, daySessions: [], dayAggregateSessions: [],
        weeklyAggregateSessions: [], hasActiveSession: false, dayWebSegments: [], webDomainFavicons: {},
        webDomainOverrides: {} }, date);
    },
    read: () => ({ timers: pending.size, cached: getHistorySnapshotCache(date) !== null }),
    advance(milliseconds: number) {
      now += milliseconds;
      for (const [id, timer] of pending) {
        if (timer.dueAt <= now) {
          pending.delete(id);
          timer.callback();
        }
      }
    },
    dispose() {
      flushSync(() => root.unmount());
      const remainingTimers = pending.size;
      pending.clear();
      window.setTimeout = originalTimeout;
      window.clearTimeout = originalClear;
      if (motion === undefined) delete document.documentElement.dataset.qpMotion;
      else document.documentElement.dataset.qpMotion = motion;
      clearHistorySnapshotCache();
      host.remove();
      return remainingTimers;
    },
  };
}
