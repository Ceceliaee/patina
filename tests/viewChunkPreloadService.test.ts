import assert from "node:assert/strict";
import {
  getPreloadableViewChunkStatus,
  preloadLazyViewChunk,
  readPreloadedViewComponent,
  resetPreloadableViewChunksForTests,
  type PreloadableView,
} from "../src/app/services/viewChunkPreloadService.ts";

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
    tools: buildLoader("tools"),
    about: buildLoader("about"),
  };
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
