import {
  prewarmClassificationBootstrapCache,
} from "../../features/classification/services/classificationService.ts";
import {
  getDashboardSnapshotCache,
} from "../../features/dashboard/services/dashboardSnapshotCache.ts";
import {
  loadPersistedDataBootstrapSnapshot,
} from "../../features/data/services/dataBootstrapSnapshot.ts";
import {
  getHistorySnapshotCache,
} from "../../features/history/services/historySnapshotCache.ts";
import {
  prewarmSettingsBootstrapCache,
} from "../../features/settings/services/settingsBootstrapService.ts";
import {
  prewarmToolsRuntimeSnapshot,
} from "../../features/tools/services/toolsRuntimeSnapshotStore.ts";
import {
  loadDashboardRuntimeSnapshot,
  loadDataTrendRuntimeSnapshot,
  loadHistoryRuntimeSnapshot,
} from "./readModelRuntimeService.ts";
import {
  preloadLazyViewChunk,
  type PreloadableView,
} from "./viewChunkPreloadService.ts";

export type StartupWarmupTaskId =
  | "view-chunks"
  | "settings-bootstrap"
  | "mapping-bootstrap"
  | "data-bootstrap-snapshot-cache"
  | "dashboard-snapshot"
  | "history-today-snapshot"
  | "tools-runtime-snapshot"
  | "about-bootstrap";

export type StartupWarmupTaskStatus =
  | "idle"
  | "scheduled"
  | "running"
  | "fulfilled"
  | "rejected"
  | "cancelled"
  | "skipped";

export interface StartupWarmupTaskSnapshot {
  durationMs: number | null;
  errorMessage: string | null;
  startedAtMs: number | null;
  status: StartupWarmupTaskStatus;
}

export interface StartupWarmupSnapshot {
  completedAtMs: number | null;
  startedAtMs: number | null;
  tasks: Record<StartupWarmupTaskId, StartupWarmupTaskSnapshot>;
}

export interface StartupWarmupController {
  cancel: () => void;
  ready: Promise<void>;
  snapshot: () => StartupWarmupSnapshot;
}

export type StartupWarmupMode =
  | "hidden-autostart"
  | "visible-start"
  | "foreground-open";

export interface StartupWarmupOptions {
  initialDelayMs?: number;
  mode?: StartupWarmupMode;
  runtimeReady?: Promise<unknown>;
  taskGapMs?: number;
  views?: PreloadableView[];
}

type StartupWarmupScheduler = (
  callback: () => void,
  delayMs: number,
) => () => void;

interface StartupWarmupDeps {
  getDashboardSnapshotCache: (date?: Date) => unknown | null;
  getHistorySnapshotCache: (date?: Date, rollingDayCount?: number) => unknown | null;
  loadDashboardRuntimeSnapshot: (date?: Date) => Promise<unknown>;
  loadDataTrendRuntimeSnapshot: typeof loadDataTrendRuntimeSnapshot;
  loadHistoryRuntimeSnapshot: (date: Date, rollingDayCount?: number) => Promise<unknown>;
  loadPersistedDataBootstrapSnapshot: typeof loadPersistedDataBootstrapSnapshot;
  preloadLazyViewChunk: (view: PreloadableView) => Promise<unknown>;
  prewarmClassificationBootstrapCache: () => Promise<unknown>;
  prewarmSettingsBootstrapCache: () => Promise<unknown>;
  prewarmToolsRuntimeSnapshot: () => Promise<unknown>;
  scheduler: StartupWarmupScheduler;
  nowMs: () => number;
  warn: (message: string, error: unknown) => void;
}

interface StartupWarmupTaskPolicy {
  aboutBootstrap: boolean;
  dashboardSnapshot: boolean;
  dataBootstrapSnapshotCache: boolean;
  historyTodaySnapshot: boolean;
  mappingBootstrap: boolean;
  settingsBootstrap: boolean;
  toolsRuntimeSnapshot: boolean;
  viewChunks: boolean;
}

export interface StartupWarmupRefreshOptions {
  includeDashboard?: boolean;
  includeData?: boolean;
  includeHistory?: boolean;
}

const STARTUP_WARMUP_TASKS: StartupWarmupTaskId[] = [
  "view-chunks",
  "settings-bootstrap",
  "mapping-bootstrap",
  "data-bootstrap-snapshot-cache",
  "dashboard-snapshot",
  "history-today-snapshot",
  "tools-runtime-snapshot",
  "about-bootstrap",
];

const DEFAULT_STARTUP_WARMUP_VIEWS: PreloadableView[] = [
  "history",
  "data",
  "tools",
  "mapping",
  "settings",
  "about",
];

const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_TASK_GAP_MS = 250;
const DEFAULT_REFRESH_DEBOUNCE_MS = 45_000;

const defaultStartupWarmupDeps: StartupWarmupDeps = {
  getDashboardSnapshotCache,
  getHistorySnapshotCache,
  loadDashboardRuntimeSnapshot,
  loadDataTrendRuntimeSnapshot,
  loadHistoryRuntimeSnapshot,
  loadPersistedDataBootstrapSnapshot,
  preloadLazyViewChunk,
  prewarmClassificationBootstrapCache,
  prewarmSettingsBootstrapCache,
  prewarmToolsRuntimeSnapshot,
  scheduler: (callback, delayMs) => {
    const handle = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(handle);
  },
  nowMs: () => Date.now(),
  warn: console.warn,
};

let activeStartupWarmup: StartupWarmupController | null = null;
let cancelScheduledRefresh: (() => void) | null = null;

function resolveStartupWarmupTaskPolicy(mode: StartupWarmupMode): StartupWarmupTaskPolicy {
  if (mode === "hidden-autostart") {
    return {
      aboutBootstrap: false,
      dashboardSnapshot: false,
      dataBootstrapSnapshotCache: false,
      historyTodaySnapshot: false,
      mappingBootstrap: false,
      settingsBootstrap: false,
      toolsRuntimeSnapshot: false,
      viewChunks: false,
    };
  }

  return {
    aboutBootstrap: true,
    dashboardSnapshot: true,
    dataBootstrapSnapshotCache: true,
    historyTodaySnapshot: false,
    mappingBootstrap: true,
    settingsBootstrap: true,
    toolsRuntimeSnapshot: true,
    viewChunks: true,
  };
}

function createInitialTaskSnapshot(): Record<StartupWarmupTaskId, StartupWarmupTaskSnapshot> {
  return Object.fromEntries(
    STARTUP_WARMUP_TASKS.map((taskId) => [
      taskId,
      {
        durationMs: null,
        errorMessage: null,
        startedAtMs: null,
        status: "idle",
      },
    ]),
  ) as Record<StartupWarmupTaskId, StartupWarmupTaskSnapshot>;
}

function cloneStartupWarmupSnapshot(snapshot: StartupWarmupSnapshot): StartupWarmupSnapshot {
  return {
    completedAtMs: snapshot.completedAtMs,
    startedAtMs: snapshot.startedAtMs,
    tasks: Object.fromEntries(
      Object.entries(snapshot.tasks).map(([taskId, task]) => [
        taskId,
        { ...task },
      ]),
    ) as Record<StartupWarmupTaskId, StartupWarmupTaskSnapshot>,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createDelay(
  scheduler: StartupWarmupScheduler,
  cancelled: () => boolean,
) {
  return (delayMs: number) => new Promise<void>((resolve) => {
    if (cancelled() || delayMs <= 0) {
      resolve();
      return;
    }

    const cancel = scheduler(() => {
      cancel();
      resolve();
    }, delayMs);
  });
}

async function waitForRuntimeReady(
  runtimeReady: Promise<unknown> | undefined,
  cancelled: () => boolean,
) {
  if (!runtimeReady || cancelled()) {
    return;
  }

  await runtimeReady.catch(() => undefined);
}

async function runStartupWarmupTask(
  taskId: StartupWarmupTaskId,
  task: () => Promise<"fulfilled" | "skipped" | void>,
  snapshot: StartupWarmupSnapshot,
  deps: StartupWarmupDeps,
  cancelled: () => boolean,
) {
  const taskSnapshot = snapshot.tasks[taskId];
  if (cancelled()) {
    taskSnapshot.status = "cancelled";
    return;
  }

  const startedAtMs = deps.nowMs();
  taskSnapshot.status = "running";
  taskSnapshot.startedAtMs = startedAtMs;
  taskSnapshot.durationMs = null;
  taskSnapshot.errorMessage = null;

  try {
    const result = await task();
    if (cancelled()) {
      taskSnapshot.status = "cancelled";
      return;
    }

    taskSnapshot.status = result === "skipped" ? "skipped" : "fulfilled";
  } catch (error) {
    if (cancelled()) {
      taskSnapshot.status = "cancelled";
      return;
    }

    taskSnapshot.status = "rejected";
    taskSnapshot.errorMessage = toErrorMessage(error);
    deps.warn(`Startup warm-up task failed: ${taskId}`, error);
  } finally {
    taskSnapshot.durationMs = deps.nowMs() - startedAtMs;
  }
}

export function startStartupWarmup(
  options: StartupWarmupOptions = {},
  deps: Partial<StartupWarmupDeps> = {},
): StartupWarmupController {
  if (activeStartupWarmup) {
    return activeStartupWarmup;
  }

  const resolvedDeps: StartupWarmupDeps = {
    ...defaultStartupWarmupDeps,
    ...deps,
  };
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const mode = options.mode ?? "visible-start";
  const taskPolicy = resolveStartupWarmupTaskPolicy(mode);
  const taskGapMs = options.taskGapMs ?? DEFAULT_TASK_GAP_MS;
  const views = options.views ?? DEFAULT_STARTUP_WARMUP_VIEWS;
  let cancelled = false;
  const snapshot: StartupWarmupSnapshot = {
    completedAtMs: null,
    startedAtMs: resolvedDeps.nowMs(),
    tasks: createInitialTaskSnapshot(),
  };
  const delay = createDelay(resolvedDeps.scheduler, () => cancelled);

  const ready = (async () => {
    await delay(initialDelayMs);

    const runTask = async (
      taskId: StartupWarmupTaskId,
      task: () => Promise<"fulfilled" | "skipped" | void>,
    ) => {
      if (cancelled) {
        snapshot.tasks[taskId].status = "cancelled";
        return;
      }

      snapshot.tasks[taskId].status = "scheduled";
      await delay(taskGapMs);
      await runStartupWarmupTask(taskId, task, snapshot, resolvedDeps, () => cancelled);
    };

    await runTask("view-chunks", async () => {
      if (!taskPolicy.viewChunks) {
        return "skipped";
      }

      for (const view of views) {
        if (cancelled) return;
        await resolvedDeps.preloadLazyViewChunk(view);
      }
    });

    await runTask("settings-bootstrap", async () => {
      if (!taskPolicy.settingsBootstrap) {
        return "skipped";
      }

      await resolvedDeps.prewarmSettingsBootstrapCache();
    });

    await runTask("mapping-bootstrap", async () => {
      if (!taskPolicy.mappingBootstrap) {
        return "skipped";
      }

      await resolvedDeps.prewarmClassificationBootstrapCache();
    });

    await runTask("data-bootstrap-snapshot-cache", async () => {
      if (!taskPolicy.dataBootstrapSnapshotCache) {
        return "skipped";
      }

      const snapshot = await resolvedDeps.loadPersistedDataBootstrapSnapshot();
      return snapshot ? "fulfilled" : "skipped";
    });

    if (
      taskPolicy.dashboardSnapshot
      || taskPolicy.historyTodaySnapshot
      || taskPolicy.toolsRuntimeSnapshot
    ) {
      await waitForRuntimeReady(options.runtimeReady, () => cancelled);
    }

    await runTask("dashboard-snapshot", async () => {
      if (!taskPolicy.dashboardSnapshot) {
        return "skipped";
      }

      const date = new Date();
      if (resolvedDeps.getDashboardSnapshotCache(date)) {
        return "skipped";
      }

      await resolvedDeps.loadDashboardRuntimeSnapshot(date);
    });

    await runTask("history-today-snapshot", async () => {
      if (!taskPolicy.historyTodaySnapshot) {
        return "skipped";
      }

      const date = new Date();
      if (resolvedDeps.getHistorySnapshotCache(date, 7)) {
        return "skipped";
      }

      await resolvedDeps.loadHistoryRuntimeSnapshot(date, 7);
    });

    await runTask("tools-runtime-snapshot", async () => {
      if (!taskPolicy.toolsRuntimeSnapshot) {
        return "skipped";
      }

      await resolvedDeps.prewarmToolsRuntimeSnapshot();
    });

    await runTask("about-bootstrap", async () => {
      if (!taskPolicy.aboutBootstrap) {
        return "skipped";
      }

      await resolvedDeps.prewarmSettingsBootstrapCache();
    });
  })()
    .catch((error) => {
      if (!cancelled) {
        resolvedDeps.warn("Startup warm-up failed", error);
      }
    })
    .finally(() => {
      snapshot.completedAtMs = resolvedDeps.nowMs();
      activeStartupWarmup = null;
    });

  activeStartupWarmup = {
    cancel: () => {
      cancelled = true;
      for (const taskId of STARTUP_WARMUP_TASKS) {
        if (snapshot.tasks[taskId].status === "idle" || snapshot.tasks[taskId].status === "scheduled") {
          snapshot.tasks[taskId].status = "cancelled";
        }
      }
      activeStartupWarmup = null;
    },
    ready,
    snapshot: () => cloneStartupWarmupSnapshot(snapshot),
  };

  return activeStartupWarmup;
}

export function scheduleStartupWarmupRefresh(
  debounceMs: number = DEFAULT_REFRESH_DEBOUNCE_MS,
  options: StartupWarmupRefreshOptions = {},
  deps: Pick<
    StartupWarmupDeps,
    | "loadDashboardRuntimeSnapshot"
    | "loadDataTrendRuntimeSnapshot"
    | "loadHistoryRuntimeSnapshot"
    | "scheduler"
    | "warn"
  > = defaultStartupWarmupDeps,
): () => void {
  cancelScheduledRefresh?.();

  let cancelled = false;
  cancelScheduledRefresh = deps.scheduler(() => {
    cancelScheduledRefresh = null;
    if (cancelled) {
      return;
    }

    const tasks: Array<Promise<unknown>> = [];

    if (options.includeDashboard ?? true) {
      tasks.push(deps.loadDashboardRuntimeSnapshot(new Date()));
    }

    if (options.includeHistory ?? true) {
      tasks.push(deps.loadHistoryRuntimeSnapshot(new Date(), 7));
    }

    if (options.includeData) {
      tasks.push(deps.loadDataTrendRuntimeSnapshot({ kind: "rolling", days: 7 }));
    }

    if (tasks.length === 0) {
      return;
    }

    void Promise.allSettled(tasks).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          deps.warn("Startup warm-up refresh failed", result.reason);
        }
      }
    });
  }, debounceMs);

  return () => {
    cancelled = true;
    cancelScheduledRefresh?.();
    cancelScheduledRefresh = null;
  };
}

export function resetStartupWarmupForTests(): void {
  activeStartupWarmup?.cancel();
  activeStartupWarmup = null;
  cancelScheduledRefresh?.();
  cancelScheduledRefresh = null;
}
