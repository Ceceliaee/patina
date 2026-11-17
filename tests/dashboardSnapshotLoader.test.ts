import assert from "node:assert/strict";
import {
  loadDashboardSnapshotWithDeps,
} from "../src/features/dashboard/services/dashboardReadModel.ts";
import {
  clearDashboardSnapshotCache,
  setDashboardSnapshotCache,
} from "../src/features/dashboard/services/dashboardSnapshotCache.ts";

const selectedDate = new Date(2026, 6, 1, 12);
const dayStart = new Date(2026, 6, 1).getTime();
const nextDayStart = new Date(2026, 6, 2).getTime();
const todayRecords = [
  { appName: "Alpha", exeName: "alpha.exe", startTime: dayStart, endTime: dayStart + 10 },
  { appName: "Alpha", exeName: "alpha.exe", startTime: dayStart + 20, endTime: dayStart + 30 },
  { appName: "Imported", exeName: "imported.exe", startTime: dayStart + 40, endTime: dayStart + 50 },
  { appName: "Unknown", exeName: "", startTime: dayStart + 60, endTime: dayStart + 70 },
];
const response = (records = todayRecords, hasActiveSession = true) => ({
  records,
  readPath: "projection" as const,
  fallbackReason: null,
  sourceRevision: 9,
  projectionRowCount: records.length,
  factRowCount: 0,
  hasActiveSession,
});
const requestedRanges: number[][] = [];
const iconRequests: string[][] = [];
const snapshot = await loadDashboardSnapshotWithDeps(selectedDate, {
  now: () => 1234,
  getActivityAggregateRange: async (startMs, endMs) => {
    requestedRanges.push([startMs, endMs]);
    return response();
  },
  loadIcons: async (exeNames) => {
    iconRequests.push(exeNames);
    return { "alpha.exe": "icon" };
  },
  getCachedIcons: () => ({}),
});
assert.deepEqual(requestedRanges, [[dayStart, nextDayStart]]);
assert.deepEqual(iconRequests, [["alpha.exe", "imported.exe"]]);
assert.deepEqual(snapshot, {
    fetchedAtMs: 1234,
    icons: { "alpha.exe": "icon" },
    hasActiveSession: true,
    activityRecords: todayRecords,
  });

const failure = new Error("aggregate unavailable");
await assert.rejects(loadDashboardSnapshotWithDeps(selectedDate, {
  now: () => 4000,
  getActivityAggregateRange: async () => { throw failure; },
  loadIcons: async () => assert.fail("Icons must wait for the aggregate read"),
  getCachedIcons: () => ({}),
}), (error) => error === failure);

const iconFailure = new Error("icon transport unavailable");
const warnings: unknown[][] = [];
const originalWarn = console.warn;
console.warn = (...args: unknown[]) => { warnings.push(args); };
try {
  const degradedSnapshot = await loadDashboardSnapshotWithDeps(selectedDate, {
    now: () => 5000,
    getActivityAggregateRange: async () => response(),
    loadIcons: async () => { throw iconFailure; },
    getCachedIcons: () => ({ "alpha.exe": "cached-icon" }),
  });
  assert.deepEqual(degradedSnapshot.activityRecords, todayRecords);
  assert.equal(degradedSnapshot.hasActiveSession, true);
  assert.deepEqual(degradedSnapshot.icons, { "alpha.exe": "cached-icon" });
  assert.deepEqual(warnings, [["Failed to refresh dashboard icons:", iconFailure]]);
} finally {
  console.warn = originalWarn;
}

const emptySnapshot = await loadDashboardSnapshotWithDeps(selectedDate, {
  now: () => 6000,
  getActivityAggregateRange: async () => response([], false),
  loadIcons: async () => ({}),
  getCachedIcons: () => ({}),
});
assert.deepEqual(emptySnapshot.activityRecords, []);
assert.equal(emptySnapshot.hasActiveSession, false);

setDashboardSnapshotCache(snapshot, selectedDate);
try {
} finally {
  clearDashboardSnapshotCache();
}

console.log("Passed dashboard aggregate loading, failure, icon degradation and history seed contracts");
