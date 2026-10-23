import type { TrackerHealthSnapshot } from "../../shared/types/tracking";
import { resolveTrackerHealth, TRACKER_HEARTBEAT_STALE_AFTER_MS } from "../../shared/types/tracking.ts";

const TRACKER_HEARTBEAT_POLL_MS = 1_000;

interface TrackerHealthPollingDeps {
  clearInterval: (timerId: number) => void;
  loadSnapshot: (nowMs: number) => Promise<TrackerHealthSnapshot>;
  now: () => number;
  setInterval: (callback: () => void, intervalMs: number) => number;
  warn: (message: string, error: unknown) => void;
}

interface TrackerHealthPollingOptions {
  deps: Pick<TrackerHealthPollingDeps, "loadSnapshot"> & Partial<TrackerHealthPollingDeps>;
  intervalMs?: number;
  refreshImmediately?: boolean;
}

function resolveTrackerHealthPollingDeps(
  deps: TrackerHealthPollingOptions["deps"],
): TrackerHealthPollingDeps {
  return {
    clearInterval: deps.clearInterval ?? ((timerId) => window.clearInterval(timerId)),
    loadSnapshot: deps.loadSnapshot,
    now: deps.now ?? (() => Date.now()),
    setInterval: deps.setInterval ?? ((callback, intervalMs) => window.setInterval(callback, intervalMs)),
    warn: deps.warn ?? ((message, error) => console.warn(message, error)),
  };
}

export function startTrackerHealthPolling(
  onSnapshot: (snapshot: TrackerHealthSnapshot) => void,
  options: TrackerHealthPollingOptions,
) {
  let disposed = false;
  let refreshInFlight = false;
  let lastSnapshot: TrackerHealthSnapshot | null = null;
  const deps = resolveTrackerHealthPollingDeps(options.deps);
  const intervalMs = options.intervalMs ?? TRACKER_HEARTBEAT_POLL_MS;
  const startedAtMs = deps.now();

  const publishStaleHealth = () => {
    const nowMs = deps.now();
    const staleAfterMs = lastSnapshot?.staleAfterMs ?? TRACKER_HEARTBEAT_STALE_AFTER_MS;
    if (!lastSnapshot && nowMs - startedAtMs <= staleAfterMs) return;
    const snapshot = resolveTrackerHealth(lastSnapshot?.lastHeartbeatMs ?? null, nowMs, staleAfterMs);
    if (snapshot.status === "stale" && lastSnapshot?.status !== "stale") {
      lastSnapshot = snapshot;
      onSnapshot(snapshot);
    }
  };

  const refreshTrackerHealth = async () => {
    if (disposed) return;
    // A pending IPC request must not keep an old healthy result alive forever.
    publishStaleHealth();
    if (refreshInFlight) {
      return;
    }

    refreshInFlight = true;
    try {
      const snapshot = await deps.loadSnapshot(deps.now());
      if (!disposed) {
        lastSnapshot = resolveTrackerHealth(snapshot.lastHeartbeatMs, deps.now(), snapshot.staleAfterMs);
        onSnapshot(lastSnapshot);
      }
    } catch (error) {
      if (!disposed) {
        deps.warn("load tracker health failed", error);
      }
    } finally {
      refreshInFlight = false;
    }
  };

  if (options.refreshImmediately ?? true) {
    void refreshTrackerHealth();
  }

  const timerId = deps.setInterval(() => {
    void refreshTrackerHealth();
  }, intervalMs);

  return () => {
    disposed = true;
    deps.clearInterval(timerId);
  };
}
