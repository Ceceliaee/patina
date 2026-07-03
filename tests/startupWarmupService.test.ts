import assert from "node:assert/strict";
import {
  clearDashboardSnapshotCache,
  getDashboardSnapshotCache,
  getDashboardSnapshotCacheSizeForTests,
  setDashboardSnapshotCache,
} from "../src/features/dashboard/services/dashboardSnapshotCache.ts";
import {
  clearHistorySnapshotCache,
  getHistorySnapshotCache,
  getHistorySnapshotCacheSizeForTests,
  setHistorySnapshotCache,
} from "../src/features/history/services/historySnapshotCache.ts";
import {
  resetStartupWarmupForTests,
  scheduleStartupWarmupRefresh,
  startStartupWarmup,
  type StartupWarmupTaskId,
} from "../src/app/services/startupWarmupService.ts";
import type { PreloadableView } from "../src/app/services/viewChunkPreloadService.ts";

type ScheduledTask = {
  callback: () => void;
  cancelled: boolean;
  delayMs: number;
};

function createTaskScheduler() {
  const tasks: ScheduledTask[] = [];
  return {
    tasks,
    schedule(callback: () => void, delayMs: number) {
      const task = {
        callback,
        cancelled: false,
        delayMs,
      };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    runNext() {
      const task = tasks.shift();
      if (!task || task.cancelled) {
        return task;
      }

      task.callback();
      return task;
    },
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

async function waitForEventCount(events: string[], count: number) {
  for (let index = 0; index < 12 && events.length < count; index += 1) {
    await flushPromises();
  }
}

function createWarmupDeps(events: string[], options: {
  failTask?: StartupWarmupTaskId;
  nowStepMs?: number;
} = {}) {
  let dashboardCached = false;
  let historyCached = false;
  let nowMs = 1_000;
  const maybeFail = (taskId: StartupWarmupTaskId) => {
    if (options.failTask === taskId) {
      throw new Error(`${taskId} busy`);
    }
  };

  return {
    getDashboardSnapshotCache: () => dashboardCached ? { ready: true } : null,
    getCachedDataTrendSnapshot: () => null,
    getHistorySnapshotCache: () => historyCached ? { ready: true } : null,
    loadDashboardRuntimeSnapshot: async () => {
      events.push("dashboard-snapshot");
      maybeFail("dashboard-snapshot");
      dashboardCached = true;
    },
    loadHistoryRuntimeSnapshot: async () => {
      events.push("history-snapshot");
      maybeFail("history-today-snapshot");
      historyCached = true;
    },
    loadDataTrendRuntimeSnapshot: async () => {
      events.push("data-trend-refresh");
    },
    loadPersistedDataBootstrapSnapshot: async () => {
      events.push("data-bootstrap-snapshot-cache");
      return null;
    },
    preloadLazyViewChunk: async (view: PreloadableView) => {
      events.push(`chunk:${view}`);
      maybeFail("view-chunks");
    },
    prewarmClassificationBootstrapCache: async () => {
      events.push("mapping-bootstrap");
      maybeFail("mapping-bootstrap");
    },
    prewarmSettingsBootstrapCache: async () => {
      events.push("settings-bootstrap");
      maybeFail("settings-bootstrap");
    },
    prewarmToolsRuntimeSnapshot: async () => {
      events.push("tools-snapshot");
      maybeFail("tools-runtime-snapshot");
    },
    nowMs: () => {
      nowMs += options.nowStepMs ?? 5;
      return nowMs;
    },
  };
}

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  resetStartupWarmupForTests();
  clearDashboardSnapshotCache();
  clearHistorySnapshotCache();
  await fn();
  resetStartupWarmupForTests();
  clearDashboardSnapshotCache();
  clearHistorySnapshotCache();
  passed += 1;
  console.log(`PASS ${name}`);
}

function makeDashboardSnapshot(fetchedAtMs: number) {
  return {
    fetchedAtMs,
    icons: {},
    sessions: [],
    yesterdaySessions: [],
  };
}

function makeHistorySnapshot(fetchedAtMs: number) {
  return {
    daySessions: [],
    fetchedAtMs,
    weeklySessions: [],
    dayWebSegments: [],
    webDomainFavicons: {},
    webDomainOverrides: {},
  };
}

await runTest("startup warmup runs default tasks in a stable order", async () => {
  const events: string[] = [];
  const warnings: string[] = [];
  const controller = startStartupWarmup({
    initialDelayMs: 0,
    taskGapMs: 0,
    runtimeReady: Promise.resolve(),
    views: ["history", "data"],
  }, {
    ...createWarmupDeps(events),
    warn: (message, error) => warnings.push(`${message}:${error instanceof Error ? error.message : String(error)}`),
  });

  await controller.ready;

  assert.deepEqual(events, [
    "chunk:history",
    "chunk:data",
    "settings-bootstrap",
    "mapping-bootstrap",
    "data-bootstrap-snapshot-cache",
    "dashboard-snapshot",
    "tools-snapshot",
    "settings-bootstrap",
  ]);
  assert.deepEqual(warnings, []);
  assert.equal(controller.snapshot().tasks["history-today-snapshot"].status, "skipped");
});

await runTest("startup warmup preloads Tools chunk and runtime snapshot by default", async () => {
  const events: string[] = [];
  const warnings: string[] = [];
  const controller = startStartupWarmup({
    initialDelayMs: 0,
    taskGapMs: 0,
    runtimeReady: Promise.resolve(),
  }, {
    ...createWarmupDeps(events),
    warn: (message, error) => warnings.push(`${message}:${error instanceof Error ? error.message : String(error)}`),
  });

  await controller.ready;

  assert.deepEqual(events.slice(0, 6), [
    "chunk:history",
    "chunk:data",
    "chunk:tools",
    "chunk:mapping",
    "chunk:settings",
    "chunk:about",
  ]);
  assert.ok(events.includes("tools-snapshot"));
  assert.equal(controller.snapshot().tasks["tools-runtime-snapshot"].status, "fulfilled");
  assert.deepEqual(warnings, []);
});

await runTest("startup warmup keeps later tasks running after a failure", async () => {
  const events: string[] = [];
  const warnings: string[] = [];
  const controller = startStartupWarmup({
    initialDelayMs: 0,
    taskGapMs: 0,
    runtimeReady: Promise.resolve(),
    views: ["history"],
  }, {
    ...createWarmupDeps(events, { failTask: "settings-bootstrap" }),
    warn: (message, error) => warnings.push(`${message}:${error instanceof Error ? error.message : String(error)}`),
  });

  await controller.ready;

  assert.ok(events.includes("mapping-bootstrap"));
  assert.ok(events.includes("dashboard-snapshot"));
  assert.deepEqual(warnings, [
    "Startup warm-up task failed: settings-bootstrap:settings-bootstrap busy",
    "Startup warm-up task failed: about-bootstrap:settings-bootstrap busy",
  ]);
  assert.equal(controller.snapshot().tasks["settings-bootstrap"].status, "rejected");
});

await runTest("startup warmup waits for runtime readiness before runtime tasks", async () => {
  const events: string[] = [];
  const runtimeReady = createDeferred();
  const controller = startStartupWarmup({
    initialDelayMs: 0,
    taskGapMs: 0,
    runtimeReady: runtimeReady.promise,
    views: ["history"],
  }, {
    ...createWarmupDeps(events),
    warn: () => {
      throw new Error("unexpected warning");
    },
  });

  await waitForEventCount(events, 3);
  assert.deepEqual(events.slice(0, 3), [
    "chunk:history",
    "settings-bootstrap",
    "mapping-bootstrap",
  ]);
  assert.equal(events.includes("dashboard-snapshot"), false);

  runtimeReady.resolve();
  await controller.ready;

  assert.ok(events.includes("dashboard-snapshot"));
  assert.equal(events.includes("history-snapshot"), false);
});

await runTest("hidden autostart warmup skips chunks and heavy read models", async () => {
  const events: string[] = [];
  const runtimeReady = createDeferred();
  const controller = startStartupWarmup({
    initialDelayMs: 0,
    mode: "hidden-autostart",
    runtimeReady: runtimeReady.promise,
    taskGapMs: 0,
  }, {
    ...createWarmupDeps(events),
    warn: () => {
      throw new Error("unexpected warning");
    },
  });

  await controller.ready;

  assert.deepEqual(events, []);
  assert.equal(controller.snapshot().tasks["view-chunks"].status, "skipped");
  assert.equal(controller.snapshot().tasks["dashboard-snapshot"].status, "skipped");
  assert.equal(controller.snapshot().tasks["history-today-snapshot"].status, "skipped");
  assert.equal(controller.snapshot().tasks["tools-runtime-snapshot"].status, "skipped");
});

await runTest("startup warmup exposes scheduling and cancels queued work", async () => {
  const scheduler = createTaskScheduler();
  const events: string[] = [];
  const controller = startStartupWarmup({
    initialDelayMs: 12,
    taskGapMs: 4,
    runtimeReady: Promise.resolve(),
    views: ["history"],
  }, {
    ...createWarmupDeps(events),
    scheduler: scheduler.schedule,
    warn: () => {
      throw new Error("unexpected warning");
    },
  });

  assert.equal(scheduler.tasks[0].delayMs, 12);
  scheduler.runNext();
  await flushPromises();
  assert.equal(scheduler.tasks[0].delayMs, 4);

  controller.cancel();
  scheduler.runNext();
  await flushPromises();

  assert.deepEqual(events, []);
  assert.equal(controller.snapshot().tasks["view-chunks"].status, "cancelled");
});

await runTest("startup warmup refresh debounces repeated tracking changes", async () => {
  const scheduler = createTaskScheduler();
  const events: string[] = [];
  const warnings: string[] = [];
  const deps = {
    ...createWarmupDeps(events),
    scheduler: scheduler.schedule,
    warn: (message: string, error: unknown) => {
      warnings.push(`${message}:${error instanceof Error ? error.message : String(error)}`);
    },
  };

  scheduleStartupWarmupRefresh(30, {}, deps);
  scheduleStartupWarmupRefresh(30, {}, deps);

  assert.equal(scheduler.tasks.length, 2);
  const cancelledTask = scheduler.runNext();
  assert.equal(cancelledTask?.cancelled, true);
  scheduler.runNext();
  await flushPromises();

  assert.deepEqual(events, [
    "dashboard-snapshot",
    "history-snapshot",
  ]);
  assert.deepEqual(warnings, []);
});

await runTest("startup warmup refresh includes data only when requested", async () => {
  const scheduler = createTaskScheduler();
  const events: string[] = [];
  const deps = {
    ...createWarmupDeps(events),
    scheduler: scheduler.schedule,
    warn: () => {
      throw new Error("unexpected warning");
    },
  };

  scheduleStartupWarmupRefresh(30, { includeData: true }, deps);
  scheduler.runNext();
  await flushPromises();

  assert.deepEqual(events, [
    "dashboard-snapshot",
    "history-snapshot",
    "data-trend-refresh",
  ]);
});

await runTest("startup warmup refresh can skip invisible page refreshes", async () => {
  const scheduler = createTaskScheduler();
  const events: string[] = [];
  const deps = {
    ...createWarmupDeps(events),
    scheduler: scheduler.schedule,
    warn: () => {
      throw new Error("unexpected warning");
    },
  };

  scheduleStartupWarmupRefresh(30, {
    includeDashboard: false,
    includeHistory: false,
    includeData: false,
  }, deps);
  scheduler.runNext();
  await flushPromises();

  assert.deepEqual(events, []);
});

await runTest("dashboard snapshot cache keeps a small LRU set", () => {
  for (let day = 1; day <= 2; day += 1) {
    setDashboardSnapshotCache(
      makeDashboardSnapshot(day),
      new Date(2026, 0, day),
    );
  }

  assert.equal(getDashboardSnapshotCacheSizeForTests(), 1);
  assert.equal(getDashboardSnapshotCache(new Date(2026, 0, 1)), null);
  assert.equal(getDashboardSnapshotCache(new Date(2026, 0, 2))?.fetchedAtMs, 2);
});

await runTest("history snapshot cache keeps a bounded LRU set", () => {
  for (let day = 1; day <= 8; day += 1) {
    setHistorySnapshotCache(
      makeHistorySnapshot(day),
      new Date(2026, 0, day),
      7,
    );
  }

  assert.equal(getHistorySnapshotCacheSizeForTests(), 7);
  assert.equal(getHistorySnapshotCache(new Date(2026, 0, 1), 7), null);
  assert.equal(getHistorySnapshotCache(new Date(2026, 0, 8), 7)?.fetchedAtMs, 8);
});

console.log(`Passed ${passed} startup warmup tests`);
