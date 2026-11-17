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
    tools: buildLoader("tools"),
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

  await preloadLazyViewChunk("tools", { loaders });
  await preloadLazyViewChunk("tools", { loaders });

  assert.deepEqual(calls, ["tools"]);
});

await runTest("preloaded components can be read synchronously", async () => {
  const TestView = () => null;
  const calls: PreloadableView[] = [];
  const loaders = {
    ...createLoaders(calls),
    tools: async () => {
      calls.push("tools");
      return { default: TestView };
    },
  };

  await preloadLazyViewChunk("tools", { loaders });

  assert.equal(readPreloadedViewComponent("tools"), TestView);
  assert.deepEqual(calls, ["tools"]);
});

await runTest("pending preloads reuse the same chunk promise", async () => {
  const calls: PreloadableView[] = [];
  const loadedModule = { default: () => null };
  const deferred = createDeferred<typeof loadedModule>();
  const loaders = {
    ...createLoaders(calls),
    tools: async () => {
      calls.push("tools");
      return deferred.promise;
    },
  };

  const first = preloadLazyViewChunk("tools", { loaders });
  const second = preloadLazyViewChunk("tools", { loaders });

  assert.equal(first, second);
  assert.equal(getPreloadableViewChunkStatus("tools"), "pending");

  deferred.resolve(loadedModule);
  await first;

  assert.equal(getPreloadableViewChunkStatus("tools"), "resolved");
  assert.deepEqual(calls, ["tools"]);
});

await runTest("failed preloads expose rejected status and can retry", async () => {
  const calls: PreloadableView[] = [];
  const TestView = () => null;
  let shouldFail = true;
  const loaders = {
    ...createLoaders(calls),
    tools: async () => {
      calls.push("tools");
      if (shouldFail) {
        throw new Error("about failed");
      }
      return { default: TestView };
    },
  };

  await assert.rejects(preloadLazyViewChunk("tools", { loaders }), /about failed/);
  assert.equal(getPreloadableViewChunkStatus("tools"), "rejected");

  shouldFail = false;
  await preloadLazyViewChunk("tools", { loaders });

  assert.equal(getPreloadableViewChunkStatus("tools"), "resolved");
  assert.equal(readPreloadedViewComponent("tools"), TestView);
  assert.deepEqual(calls, ["tools", "tools"]);
});

console.log(`Passed ${passed} view chunk preload tests`);
