import assert from "node:assert/strict";
import {
  loadDashboardSnapshotWithDeps,
  loadIconSnapshotWithDeps,
} from "../src/features/dashboard/services/dashboardReadModel.ts";
import type { HistorySession } from "../src/shared/types/sessions.ts";

function session(id: number, exeName: string): HistorySession {
  return {
    id,
    appName: exeName,
    exeName,
    windowTitle: "",
    startTime: 1,
    endTime: 2,
    duration: 1,
    continuityGroupStartTime: null,
  };
}

const requestedDates: string[] = [];
const iconRequests: string[][] = [];
const selectedDate = new Date(2026, 6, 15, 12);
const todaySessions = [session(1, "alpha.exe"), session(2, "alpha.exe"), session(3, "")];
const yesterdaySessions = [session(4, "beta.exe")];
const todayBuckets = [{ appName: "Imported", exeName: "imported.exe", startTime: 10, endTime: 20 }];

const snapshot = await loadDashboardSnapshotWithDeps(selectedDate, {
  now: () => 1234,
  getHistoryByDate: async (date) => {
    requestedDates.push(date.toISOString());
    return date.getDate() === selectedDate.getDate() ? todaySessions : yesterdaySessions;
  },
  getImportedTimeBucketsByDate: async (date) => (
    date.getDate() === selectedDate.getDate() ? todayBuckets : []
  ),
  loadIcons: async (exeNames) => {
    iconRequests.push(exeNames);
    return { "alpha.exe": "icon" };
  },
  getCachedIcons: () => ({}),
});

assert.equal(requestedDates.length, 2);
assert.equal(new Date(requestedDates[1]).getDate(), selectedDate.getDate() - 1);
assert.deepEqual(iconRequests, [["alpha.exe", "imported.exe"]]);
assert.deepEqual(snapshot, {
  fetchedAtMs: 1234,
  icons: { "alpha.exe": "icon" },
  sessions: todaySessions,
  yesterdaySessions,
  importedBuckets: todayBuckets,
  yesterdayImportedBuckets: [],
});

const loadedIcons = await loadIconSnapshotWithDeps(["alpha.exe"], {
  now: () => 2000,
  loadIcons: async (exeNames) => ({ [exeNames[0]]: "loaded" }),
  getCachedIcons: () => ({ cached: "unused" }),
});
assert.deepEqual(loadedIcons, { fetchedAtMs: 2000, icons: { "alpha.exe": "loaded" } });

const cachedIcons = await loadIconSnapshotWithDeps([], {
  now: () => 3000,
  loadIcons: async () => ({ loaded: "unused" }),
  getCachedIcons: () => ({ cached: "hit" }),
});
assert.deepEqual(cachedIcons, { fetchedAtMs: 3000, icons: { cached: "hit" } });

console.log("Passed 3 dashboard snapshot loader tests");
