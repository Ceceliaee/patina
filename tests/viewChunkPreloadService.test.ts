import assert from "node:assert/strict";
import {
  getPreloadableViewChunkStatus,
  preloadLazyViewChunk,
  readPreloadedViewComponent,
  resetPreloadableViewChunksForTests,
  scheduleLazyViewChunkPreload,
  type PreloadableView,
} from "../src/app/services/viewChunkPreloadService.ts";

type ScheduledTask = {
  callback: () => void;
  cancelled: boolean;
  delayMs: number;
  idleTimeoutMs: number;
};

function createTaskScheduler() {
  const tasks: ScheduledTask[] = [];
  return {
    tasks,
    schedule(callback: () => void, delayMs: number, idleTimeoutMs: number) {
      const task = {
        callback,
        cancelled: false,
        delayMs,
        idleTimeoutMs,
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

function createLoaders(
  calls: PreloadableView[],
  failingView?: PreloadableView,
) {
  const buildLoader = (view: PreloadableView) => async () => {
    calls.push(view);
    if (view === failingView) {
      throw new Error(`${view} failed`);
    }
  };

  return {
    history: buildLoader("history"),
    settings: buildLoader("settings"),
    mapping: buildLoader("mapping"),
    data: buildLoader("data"),
    about: buildLoader("about"),
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

let passed = 0;
async function runTest(name: string, fn: () => void | Promise<void>) {
  resetPreloadableViewChunksForTests();
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("preloads configured chunks sequentially", async () => {
  const scheduler = createTaskScheduler();
  const calls: PreloadableView[] = [];

  scheduleLazyViewChunkPreload({
    views: ["history", "settings", "mapping"],
    initialDelayMs: 12,
    staggerMs: 3,
    idleTimeoutMs: 8,
  }, {
    loaders: createLoaders(calls),
    schedule: scheduler.schedule,
    warn: () => {
      throw new Error("unexpected warning");
    },
  });

  assert.equal(scheduler.tasks.length, 1);
  assert.equal(scheduler.tasks[0].delayMs, 12);
  assert.equal(scheduler.tasks[0].idleTimeoutMs, 8);

  scheduler.runNext();
  await flushPromises();
  assert.deepEqual(calls, ["history"]);
  assert.equal(scheduler.tasks[0].delayMs, 3);

  scheduler.runNext();
  await flushPromises();
  assert.deepEqual(calls, ["history", "settings"]);

  scheduler.runNext();
  await flushPromises();
  assert.deepEqual(calls, ["history", "settings", "mapping"]);
  assert.equal(scheduler.tasks.length, 0);
});

await runTest("keeps preloading after a chunk failure and reports the warning", async () => {
  const scheduler = createTaskScheduler();
  const calls: PreloadableView[] = [];
  const warnings: Array<{ message: string; error: unknown }> = [];

  scheduleLazyViewChunkPreload({
    views: ["history", "settings", "data"],
    initialDelayMs: 0,
    staggerMs: 0,
  }, {
    loaders: createLoaders(calls, "settings"),
    schedule: scheduler.schedule,
    warn: (message, error) => warnings.push({ message, error }),
  });

  scheduler.runNext();
  await flushPromises();
  scheduler.runNext();
  await flushPromises();
  scheduler.runNext();
  await flushPromises();

  assert.deepEqual(calls, ["history", "settings", "data"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /settings/);
  assert.ok(warnings[0].error instanceof Error);
});

await runTest("does not run queued tasks after cancellation", async () => {
  const scheduler = createTaskScheduler();
  const calls: PreloadableView[] = [];

  const cancel = scheduleLazyViewChunkPreload({
    views: ["history", "settings"],
    initialDelayMs: 0,
    staggerMs: 0,
  }, {
    loaders: createLoaders(calls),
    schedule: scheduler.schedule,
    warn: () => {
      throw new Error("unexpected warning");
    },
  });

  cancel();
  const cancelledTask = scheduler.runNext();
  await flushPromises();

  assert.equal(cancelledTask?.cancelled, true);
  assert.deepEqual(calls, []);
  assert.equal(scheduler.tasks.length, 0);
});

await runTest("cancels later chunks after the current preload settles", async () => {
  const scheduler = createTaskScheduler();
  const calls: PreloadableView[] = [];

  const cancel = scheduleLazyViewChunkPreload({
    views: ["history", "settings"],
    initialDelayMs: 0,
    staggerMs: 0,
  }, {
    loaders: createLoaders(calls),
    schedule: scheduler.schedule,
    warn: () => {
      throw new Error("unexpected warning");
    },
  });

  scheduler.runNext();
  await flushPromises();
  assert.deepEqual(calls, ["history"]);
  assert.equal(scheduler.tasks.length, 1);

  cancel();
  const cancelledTask = scheduler.runNext();
  await flushPromises();

  assert.equal(cancelledTask?.cancelled, true);
  assert.deepEqual(calls, ["history"]);
});

await runTest("defaults preload the core lazy view chunks", async () => {
  const scheduler = createTaskScheduler();
  const calls: PreloadableView[] = [];

  scheduleLazyViewChunkPreload({}, {
    loaders: createLoaders(calls),
    schedule: scheduler.schedule,
    warn: () => {
      throw new Error("unexpected warning");
    },
  });

  assert.equal(scheduler.tasks[0].delayMs, 1200);
  assert.equal(scheduler.tasks[0].idleTimeoutMs, 1500);

  for (let index = 0; index < 5; index += 1) {
    scheduler.runNext();
    await flushPromises();
  }

  assert.deepEqual(calls, ["history", "data", "mapping", "settings", "about"]);
  assert.equal(scheduler.tasks.length, 0);
});

await runTest("preload cache reuses an already loaded chunk", async () => {
  const calls: PreloadableView[] = [];
  const loaders = createLoaders(calls);

  await preloadLazyViewChunk("history", { loaders });
  await preloadLazyViewChunk("history", { loaders });

  assert.deepEqual(calls, ["history"]);
});

await runTest("preloaded components can be read synchronously", async () => {
  const TestView = () => null;
  const calls: PreloadableView[] = [];
  const loaders = {
    ...createLoaders(calls),
    data: async () => {
      calls.push("data");
      return { default: TestView };
    },
  };

  await preloadLazyViewChunk("data", { loaders });

  assert.equal(readPreloadedViewComponent("data"), TestView);
  assert.deepEqual(calls, ["data"]);
});

await runTest("pending preloads reuse the same chunk promise", async () => {
  const calls: PreloadableView[] = [];
  const loadedModule = { default: () => null };
  const deferred = createDeferred<typeof loadedModule>();
  const loaders = {
    ...createLoaders(calls),
    mapping: async () => {
      calls.push("mapping");
      return deferred.promise;
    },
  };

  const first = preloadLazyViewChunk("mapping", { loaders });
  const second = preloadLazyViewChunk("mapping", { loaders });

  assert.equal(first, second);
  assert.equal(getPreloadableViewChunkStatus("mapping"), "pending");

  deferred.resolve(loadedModule);
  await first;

  assert.equal(getPreloadableViewChunkStatus("mapping"), "resolved");
  assert.deepEqual(calls, ["mapping"]);
});

await runTest("failed preloads expose rejected status and can retry", async () => {
  const calls: PreloadableView[] = [];
  const TestView = () => null;
  let shouldFail = true;
  const loaders = {
    ...createLoaders(calls),
    about: async () => {
      calls.push("about");
      if (shouldFail) {
        throw new Error("about failed");
      }
      return { default: TestView };
    },
  };

  await assert.rejects(preloadLazyViewChunk("about", { loaders }), /about failed/);
  assert.equal(getPreloadableViewChunkStatus("about"), "rejected");

  shouldFail = false;
  await preloadLazyViewChunk("about", { loaders });

  assert.equal(getPreloadableViewChunkStatus("about"), "resolved");
  assert.equal(readPreloadedViewComponent("about"), TestView);
  assert.deepEqual(calls, ["about", "about"]);
});

console.log(`Passed ${passed} view chunk preload tests`);
