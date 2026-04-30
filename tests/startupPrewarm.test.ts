import assert from "node:assert/strict";
import {
  prewarmStartupBootstrapCachesWithDeps,
  prewarmStartupSnapshotCachesWithDeps,
} from "../src/app/services/startupPrewarmService.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("startup bootstrap prewarm keeps sibling task running when one fails", async () => {
  const events: string[] = [];
  const warnings: string[] = [];

  await prewarmStartupBootstrapCachesWithDeps({
    prewarmSettingsBootstrapCache: async () => {
      events.push("settings:start");
      throw new Error("settings busy");
    },
    prewarmClassificationBootstrapCache: async () => {
      events.push("classification:start");
      return "ready";
    },
    warn: (message, error) => {
      warnings.push(`${message}:${error instanceof Error ? error.message : String(error)}`);
    },
  });

  assert.deepEqual(events, ["settings:start", "classification:start"]);
  assert.deepEqual(warnings, ["Failed to prewarm startup bootstrap cache::settings busy"]);
});

await runTest("startup snapshot prewarm passes the same date to dashboard and history", async () => {
  const events: string[] = [];
  const warnings: string[] = [];
  const date = new Date("2026-04-18T09:30:00.000Z");

  await prewarmStartupSnapshotCachesWithDeps(date, {
    prewarmDashboardSnapshotCache: async (receivedDate) => {
      events.push(`dashboard:${receivedDate.toISOString()}`);
      return "dashboard";
    },
    prewarmHistorySnapshotCache: async (receivedDate) => {
      events.push(`history:${receivedDate.toISOString()}`);
      throw new Error("history busy");
    },
    warn: (message, error) => {
      warnings.push(`${message}:${error instanceof Error ? error.message : String(error)}`);
    },
  });

  assert.deepEqual(events, [
    `dashboard:${date.toISOString()}`,
    `history:${date.toISOString()}`,
  ]);
  assert.deepEqual(warnings, ["Failed to prewarm startup snapshot cache::history busy"]);
});

console.log(`Passed ${passed} startup prewarm tests`);
