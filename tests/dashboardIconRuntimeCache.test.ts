import { invalidateAppIcons } from "../src/platform/persistence/appIconRuntimeCache.ts";
import { publishAppIconChange, subscribeAppIconChanges } from "../src/shared/hooks/appIconChanges.ts";
import { installAppIconEvents } from "../src/platform/runtime/appIconEventGateway.ts";
import assert from "node:assert/strict";
import { AppClassification } from "../src/shared/classification/appClassification.ts";
import {
  getDashboardIcon,
  getRetryableMissingDashboardIconExecutables,
  loadDashboardIconsForExecutables,
  resetDashboardIconRuntimeCacheForTests,
} from "../src/features/dashboard/services/dashboardIconRuntimeCache.ts";
import {
  getAppIconRuntimeCacheStats,
  getAppIconRuntimeCacheSnapshot,
} from "../src/platform/persistence/appIconRuntimeCache.ts";
import {
  getCachedClassificationIconsForExecutables,
  loadClassificationIconsForExecutables,
  resetClassificationIconPresentationCacheForTests,
} from "../src/features/classification/services/classificationIconService.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  resetDashboardIconRuntimeCacheForTests();
  resetClassificationIconPresentationCacheForTests();
  await fn();
  resetDashboardIconRuntimeCacheForTests();
  resetClassificationIconPresentationCacheForTests();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("dashboard icon cache queries only requested executables and expands aliases", async () => {
  const calls: string[][] = [];
  const icons = await loadDashboardIconsForExecutables(["Code.exe"], {
    nowMs: () => 1_000,
    loadIcons: async (exeNames) => {
      calls.push(exeNames);
      return { "code.exe": "icon-code" };
    },
  });

  assert.deepEqual(calls, [["Code.exe"]]);
  assert.equal(icons["Code.exe"], "icon-code");
  assert.equal(getDashboardIcon(icons, "Code.exe"), "icon-code");

  const cachedIcons = await loadDashboardIconsForExecutables(["code.exe"], {
    nowMs: () => 1_500,
    loadIcons: async () => {
      throw new Error("cached icon should not query SQLite again");
    },
  });

  assert.equal(getDashboardIcon(cachedIcons, "code.exe"), "icon-code");
  assert.deepEqual(calls, [["Code.exe"]]);
});

await runTest("dashboard icon cache backs off missing icons instead of retrying every tick", async () => {
  const calls: string[][] = [];
  let nowMs = 10_000;
  const deps = {
    nowMs: () => nowMs,
    loadIcons: async (exeNames: string[]) => {
      calls.push(exeNames);
      return {};
    },
  };

  await loadDashboardIconsForExecutables(["Missing.exe"], deps);
  for (const [index, delay] of [2_000, 5_000, 15_000, 60_000, 60_000].entries()) {
    nowMs += delay - 1;
    await loadDashboardIconsForExecutables(["Missing.exe"], deps);
    assert.equal(calls.length, index + 1, "missing icons wait for the full retry delay");
    nowMs += 1;
    await loadDashboardIconsForExecutables(["Missing.exe"], deps);
    assert.equal(calls.length, index + 2, "retry delay saturates at one minute");
  }
  assert.ok(calls.every((names) => names.length === 1 && names[0] === "Missing.exe"));
});

await runTest("dashboard icon missing detector respects caller-owned icon maps", () => {
  assert.deepEqual(
    getRetryableMissingDashboardIconExecutables(["Code.exe"], { "code.exe": "icon-code" }, 1_000),
    [],
  );
  assert.deepEqual(
    getRetryableMissingDashboardIconExecutables(["Missing.exe"], {}, 1_000),
    ["Missing.exe"],
  );
});

await runTest("dashboard icon runtime cache keeps bounded icon and retry entries", async () => {
  const deps = {
    loadIcons: async (names: string[]) => Object.fromEntries(names.map((name) => [name, `icon:${name}`])),
  };
  await loadDashboardIconsForExecutables(Array.from({ length: 256 }, (_, index) => `app${index}.exe`), deps);
  await loadDashboardIconsForExecutables(["app0.exe"], deps);
  await loadDashboardIconsForExecutables(["app256.exe"], deps);
  const snapshot = getAppIconRuntimeCacheSnapshot();
  assert.equal(snapshot["app0.exe"], "icon:app0.exe", "recently read icons survive eviction");
  assert.equal(snapshot["app1.exe"], undefined, "the oldest unused icon is evicted");
  assert.equal(snapshot["app256.exe"], "icon:app256.exe");
  resetDashboardIconRuntimeCacheForTests();

  await loadDashboardIconsForExecutables(
    Array.from({ length: 300 }, (_, index) => `Found${index}.exe`),
    {
      nowMs: () => 1_000,
      loadIcons: async (exeNames) => Object.fromEntries(
        exeNames.map((exeName) => [exeName.toLowerCase(), `icon:${exeName}`]),
      ),
    },
  );

  assert.equal(getAppIconRuntimeCacheStats().entries, 256);

  await loadDashboardIconsForExecutables(
    Array.from({ length: 300 }, (_, index) => `Missing${index}.exe`),
    {
      nowMs: () => 2_000,
      loadIcons: async () => ({}),
    },
  );

  assert.equal(getAppIconRuntimeCacheStats().missingRetryEntries, 256);
});

await runTest("classification keeps its complete presentation snapshot beyond the shared LRU", async () => {
  const exeNames = Array.from({ length: 300 }, (_, index) => `Catalog${index}.exe`);
  const loaded = await loadClassificationIconsForExecutables(exeNames, {
    nowMs: () => 1_000,
    loadIcons: async (requested) => Object.fromEntries(
      requested.map((exeName) => [exeName.toLowerCase(), `icon:${exeName}`]),
    ),
  });

  assert.equal(exeNames.every((exeName) => Boolean(loaded[exeName])), true);
  assert.equal(getAppIconRuntimeCacheStats().entries, 256);

  const remounted = getCachedClassificationIconsForExecutables(exeNames);
  assert.equal(exeNames.every((exeName) => Boolean(remounted[exeName])), true);
});

await runTest("classification retains original member icons while saved links remain active", async () => {
  AppClassification.setAppLinks({ "child.exe": "parent.exe" });
  try {
    const modes: string[] = [];
    const icons = await loadClassificationIconsForExecutables(["parent.exe", "child.exe"], {
      loadIcons: async (_requested, identity = "statistical") => {
        modes.push(identity);
        return identity === "executable" ? { "child.exe": "CHILD" } : { "parent.exe": "PARENT" };
      },
    });
    assert.deepEqual(modes, ["statistical", "executable"]);
    assert.equal(icons["parent.exe"], "PARENT");
    assert.equal(icons["child.exe"], "CHILD");
    assert.equal(getCachedClassificationIconsForExecutables(["child.exe"])["child.exe"], "CHILD");
  } finally {
    AppClassification.setAppLinks({});
  }
});



await runTest("changed icon invalidates aliases while leaving unrelated icons cached", async () => {
  await loadDashboardIconsForExecutables(["Code.exe", "other.exe"], { loadIcons: async () => ({ "code.exe": "old", "other.exe": "other" }) });
  invalidateAppIcons("CODE.EXE");
  const calls: string[][] = [];
  const result = await loadDashboardIconsForExecutables(["Code.exe", "other.exe"], { loadIcons: async (names) => {
    calls.push(names); return { "code.exe": "new" };
  } });
  assert.deepEqual(calls, [["Code.exe"]]);
  assert.equal(getDashboardIcon(result, "Code.exe"), "new");
  assert.equal(getDashboardIcon(result, "other.exe"), "other");
});

await runTest("invalidation during a pending read rejects obsolete results and reloads", async () => {
  let release!: (value: Record<string, string>) => void;
  let calls = 0;
  const pending = loadDashboardIconsForExecutables(["race.exe"], { loadIcons: async () => {
    calls += 1;
    if (calls === 1) return new Promise<Record<string, string>>((resolve) => { release = resolve; });
    return { "race.exe": "new" };
  } });
  invalidateAppIcons("race.exe");
  release({ "race.exe": "old" });
  const result = await pending;
  assert.equal(result["race.exe"], "new");
  assert.equal(calls, 2);
});

await runTest("classification does not retain stale presentation icons after a change", async () => {
  await loadClassificationIconsForExecutables(["editor.exe"], { loadIcons: async () => ({ "editor.exe": "old" }) });
  invalidateAppIcons("editor.exe");
  publishAppIconChange("editor.exe");
  const result = await loadClassificationIconsForExecutables(["editor.exe"], { loadIcons: async () => ({ "editor.exe": "new" }) });
  assert.equal(result["editor.exe"], "new");
});

await runTest("native icon subscription validates payloads and cleans up late registration", async () => {
  const originals = ["window", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
  const target = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const events: Array<string | null> = [];
  const callbacks: Array<(event: { payload: unknown }) => void> = [];
  const registrations: Array<(id: number) => void> = [];
  const removed: number[] = [];
  const stopObserving = subscribeAppIconChanges((exe) => events.push(exe));
  Object.defineProperty(globalThis, "document", { configurable: true, value: target });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    __TAURI_INTERNALS__: {
      transformCallback: (callback: (event: { payload: unknown }) => void) => callbacks.push(callback),
      invoke: (command: string) => command === "plugin:event|listen"
        ? new Promise<number>((resolve) => registrations.push(resolve)) : Promise.resolve(),
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (_event: string, id: number) => removed.push(id) },
  } });
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  let stop = () => {};
  try {
    stop = installAppIconEvents();
    registrations[0](1);
    await settle();
    assert.deepEqual(events, [null], "registration reconciles changes that preceded the listener");
    for (const payload of [null, {}, 42, "", "  "]) callbacks[0]({ payload });
    assert.equal(events.length, 1);
    callbacks[0]({ payload: "editor.exe" });
    callbacks[0]({ payload: "editor.exe" });
    assert.deepEqual(events.slice(1), ["editor.exe", "editor.exe"]);
    target.visibilityState = "hidden";
    target.dispatchEvent(new Event("visibilitychange"));
    assert.equal(events.length, 3);
    target.visibilityState = "visible";
    target.dispatchEvent(new Event("visibilitychange"));
    assert.equal(events.at(-1), null);
    stop();
    const before = events.length;
    target.dispatchEvent(new Event("visibilitychange"));
    callbacks[0]({ payload: "obsolete.exe" });
    assert.equal(events.length, before);
    stop = installAppIconEvents();
    stop();
    registrations[1](2);
    await settle();
    assert.deepEqual(removed, [1, 2]);
    assert.equal(events.length, before, "late registration must not reconcile after disposal");
  } finally {
    stopObserving();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

await runTest("anonymous activity never queries or retries executable icons", async () => {
  const key = "activity:anonymous";
  const icons = await loadDashboardIconsForExecutables([key], {
    loadIcons: async () => { throw new Error("anonymous is not an executable"); },
  });
  assert.deepEqual(icons, {});
  assert.deepEqual(getRetryableMissingDashboardIconExecutables([key], {}), []);
});

console.log(`Passed ${passed} dashboard icon runtime cache tests`);
