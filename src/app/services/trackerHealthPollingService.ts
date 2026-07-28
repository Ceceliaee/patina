import type { TrackerHealthSnapshot } from "../../shared/types/tracking";

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
  const deps = resolveTrackerHealthPollingDeps(options.deps);
  const intervalMs = options.intervalMs ?? TRACKER_HEARTBEAT_POLL_MS;

  const refreshTrackerHealth = async () => {
    if (refreshInFlight) {
      return;
    }

    refreshInFlight = true;
    try {
      const snapshot = await deps.loadSnapshot(deps.now());
      if (!disposed) {
        onSnapshot(snapshot);
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
