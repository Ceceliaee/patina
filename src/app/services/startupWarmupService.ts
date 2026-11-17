import {
  prewarmClassificationBootstrapCache,
} from "../../features/classification/services/classificationService.ts";
import {
  getDashboardSnapshotCache,
} from "../../features/dashboard/services/dashboardSnapshotCache.ts";
import {
  prewarmToolsRuntimeSnapshot,
} from "../../features/tools/services/toolsRuntimeSnapshotStore.ts";
import {
  loadDashboardRuntimeSnapshot,
} from "./readModelRuntimeService.ts";
import {
  preloadLazyViewChunk,
  type PreloadableView,
} from "./viewChunkPreloadService.ts";

export type StartupWarmupTaskId =
  | "view-chunks"
  | "mapping-bootstrap"
  | "dashboard-snapshot"
  | "tools-runtime-snapshot"

type StartupWarmupTaskStatus =
  | "idle"
  | "scheduled"
  | "running"
  | "fulfilled"
  | "rejected"
  | "cancelled"
  | "skipped";

interface StartupWarmupTaskSnapshot {
  durationMs: number | null;
  errorMessage: string | null;
  startedAtMs: number | null;
  status: StartupWarmupTaskStatus;
}

interface StartupWarmupSnapshot {
  completedAtMs: number | null;
  startedAtMs: number | null;
  tasks: Record<StartupWarmupTaskId, StartupWarmupTaskSnapshot>;
}

interface StartupWarmupController {
  cancel: () => void;
  ready: Promise<void>;
  snapshot: () => StartupWarmupSnapshot;
}

type StartupWarmupMode =
  | "hidden-start"
  | "visible-start"
  | "foreground-open";

interface StartupWarmupOptions {
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
  loadDashboardRuntimeSnapshot: (date?: Date) => Promise<unknown>;
  preloadLazyViewChunk: (view: PreloadableView) => Promise<unknown>;
  prewarmClassificationBootstrapCache: () => Promise<unknown>;
  prewarmToolsRuntimeSnapshot: () => Promise<unknown>;
  scheduler: StartupWarmupScheduler;
  nowMs: () => number;
  warn: (message: string, error: unknown) => void;
}

interface StartupWarmupTaskPolicy {
  dashboardSnapshot: boolean;
  mappingBootstrap: boolean;
  toolsRuntimeSnapshot: boolean;
  viewChunks: boolean;
}


const STARTUP_WARMUP_TASKS: StartupWarmupTaskId[] = [
  "view-chunks",
  "mapping-bootstrap",
  "dashboard-snapshot",
  "tools-runtime-snapshot",
];

const DEFAULT_STARTUP_WARMUP_VIEWS: PreloadableView[] = [
  "tools",
];

const DEFAULT_INITIAL_DELAY_MS = 1_000;
const DEFAULT_TASK_GAP_MS = 250;

const defaultStartupWarmupDeps: StartupWarmupDeps = {
  getDashboardSnapshotCache,
  loadDashboardRuntimeSnapshot,
  preloadLazyViewChunk,
  prewarmClassificationBootstrapCache,
  prewarmToolsRuntimeSnapshot,
  scheduler: (callback, delayMs) => {
    const handle = globalThis.setTimeout(callback, delayMs);
    return () => globalThis.clearTimeout(handle);
  },
  nowMs: Date.now,
  warn: console.warn,
};

let activeStartupWarmup: StartupWarmupController | null = null;

function resolveStartupWarmupTaskPolicy(mode: StartupWarmupMode): StartupWarmupTaskPolicy {
  if (mode === "hidden-start") {
    return {
      dashboardSnapshot: false,
      mappingBootstrap: false,
      toolsRuntimeSnapshot: false,
      viewChunks: false,
    };
  }

  return {
    dashboardSnapshot: true,
    mappingBootstrap: true,
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
  const eagerClassificationBootstrap = taskPolicy.mappingBootstrap
    ? resolvedDeps.prewarmClassificationBootstrapCache().then(
      (value) => ({ error: null, value }),
      (error: unknown) => ({ error, value: null }),
    )
    : Promise.resolve({ error: null, value: null });
  let controller: StartupWarmupController;

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

    await runTask("mapping-bootstrap", async () => {
      if (!taskPolicy.mappingBootstrap) {
        return "skipped";
      }

      const result = await eagerClassificationBootstrap;
      if (result.error) throw result.error;
    });



    if (
      taskPolicy.dashboardSnapshot
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


    await runTask("tools-runtime-snapshot", async () => {
      if (!taskPolicy.toolsRuntimeSnapshot) {
        return "skipped";
      }

      await resolvedDeps.prewarmToolsRuntimeSnapshot();
    });

  })()
    .catch((error) => {
      if (!cancelled) {
        resolvedDeps.warn("Startup warm-up failed", error);
      }
    })
    .finally(() => {
      snapshot.completedAtMs = resolvedDeps.nowMs();
      if (activeStartupWarmup === controller) {
        activeStartupWarmup = null;
      }
    });

  controller = {
    cancel: () => {
      cancelled = true;
      for (const taskId of STARTUP_WARMUP_TASKS) {
        if (snapshot.tasks[taskId].status === "idle" || snapshot.tasks[taskId].status === "scheduled") {
          snapshot.tasks[taskId].status = "cancelled";
        }
      }
      if (activeStartupWarmup === controller) {
        activeStartupWarmup = null;
      }
    },
    ready,
    snapshot: () => cloneStartupWarmupSnapshot(snapshot),
  };
  activeStartupWarmup = controller;

  return controller;
}

export function resetStartupWarmupForTests(): void {
  activeStartupWarmup?.cancel();
  activeStartupWarmup = null;
}
