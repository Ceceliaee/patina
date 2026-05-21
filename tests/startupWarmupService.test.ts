import assert from "node:assert/strict";
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
    preloadLazyViewChunk: async (view: PreloadableView) => {
      events.push(`chunk:${view}`);
      maybeFail("view-chunks");
    },
    prewarmClassificationBootstrapCache: async () => {
      events.push("mapping-bootstrap");
      maybeFail("mapping-bootstrap");
    },
    prewarmRecentDataHeatmapCache: async () => {
      events.push("data-heatmap");
      maybeFail("data-recent-heatmap");
    },
    prewarmSettingsBootstrapCache: async () => {
      events.push("settings-bootstrap");
      maybeFail("settings-bootstrap");
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
  await fn();
  resetStartupWarmupForTests();
  passed += 1;
  console.log(`PASS ${name}`);
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
    "dashboard-snapshot",
    "history-snapshot",
    "data-heatmap",
    "settings-bootstrap",
  ]);
  assert.deepEqual(warnings, []);
  assert.equal(controller.snapshot().tasks["data-default-snapshot"].status, "skipped");
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
  assert.ok(events.includes("history-snapshot"));
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

  scheduleStartupWarmupRefresh(30, deps);
  scheduleStartupWarmupRefresh(30, deps);

  assert.equal(scheduler.tasks.length, 2);
  const cancelledTask = scheduler.runNext();
  assert.equal(cancelledTask?.cancelled, true);
  scheduler.runNext();
  await flushPromises();

  assert.deepEqual(events, [
    "dashboard-snapshot",
    "history-snapshot",
    "data-heatmap",
  ]);
  assert.deepEqual(warnings, []);
});

console.log(`Passed ${passed} startup warmup tests`);
