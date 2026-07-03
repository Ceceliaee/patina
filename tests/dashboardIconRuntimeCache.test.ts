import assert from "node:assert/strict";
import {
  getDashboardIcon,
  getRetryableMissingDashboardIconExecutables,
  loadDashboardIconsForExecutables,
  resetDashboardIconRuntimeCacheForTests,
} from "../src/features/dashboard/services/dashboardIconRuntimeCache.ts";
import {
  getAppIconRuntimeCacheStats,
} from "../src/platform/persistence/appIconRuntimeCache.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  resetDashboardIconRuntimeCacheForTests();
  await fn();
  resetDashboardIconRuntimeCacheForTests();
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
  await loadDashboardIconsForExecutables(["Missing.exe"], deps);

  assert.deepEqual(calls, [["Missing.exe"]]);

  nowMs += 2_001;
  await loadDashboardIconsForExecutables(["Missing.exe"], deps);

  assert.deepEqual(calls, [["Missing.exe"], ["Missing.exe"]]);
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

console.log(`Passed ${passed} dashboard icon runtime cache tests`);
