import assert from "node:assert/strict";
import {
  buildActivityHeatmap,
  buildDataAppTrendViewModel,
  buildYearOptions,
  getCachedDataHeatmapSessions,
  getHeatmapRange,
  loadDataHeatmapSnapshot,
  resetDataReadModelCacheForTests,
  type DataHeatmapDependencies,
  type HistorySession,
} from "../src/features/data/services/dataReadModel.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function makeSession(overrides: Partial<HistorySession>): HistorySession {
  return {
    id: 1,
    appName: "Cursor",
    exeName: "cursor.exe",
    windowTitle: "Code",
    startTime: 0,
    endTime: 0,
    duration: 0,
    continuityGroupStartTime: null,
    ...overrides,
  };
}

function findCell(rows: ReturnType<typeof buildActivityHeatmap>, date: string) {
  return rows.flatMap((week) => week.cells).find((cell) => cell.date === date);
}

await runTest("activity heatmap splits sessions across local days", () => {
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  const rows = buildActivityHeatmap([
    makeSession({
      startTime: new Date(2026, 0, 1, 23, 0, 0).getTime(),
      endTime: new Date(2026, 0, 2, 1, 30, 0).getTime(),
    }),
  ], 2026, nowMs);

  assert.equal(findCell(rows, "2026-01-01")?.duration, 60 * 60 * 1000);
  assert.equal(findCell(rows, "2026-01-02")?.duration, 90 * 60 * 1000);
});

await runTest("activity heatmap suppresses intensity for future and outside-year cells", () => {
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  const rows = buildActivityHeatmap([
    makeSession({
      startTime: new Date(2026, 0, 4, 10, 0, 0).getTime(),
      endTime: new Date(2026, 0, 4, 11, 0, 0).getTime(),
    }),
  ], 2026, nowMs);
  const future = findCell(rows, "2026-01-04");
  const outsideYear = findCell(rows, "2025-12-29");

  assert.equal(future?.isFuture, true);
  assert.equal(future?.intensity, 0);
  assert.equal(outsideYear?.isOutsideYear, true);
  assert.equal(outsideYear?.intensity, 0);
});

await runTest("activity heatmap keeps empty ranges renderable", () => {
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  const rows = buildActivityHeatmap([], 2026, nowMs);
  const visibleDay = findCell(rows, "2026-01-02");

  assert.ok(rows.length > 0);
  assert.equal(visibleDay?.duration, 0);
  assert.equal(visibleDay?.intensity, 0);
});

await runTest("year options include every year from current back to earliest activity", () => {
  assert.deepEqual(
    buildYearOptions(new Date(2024, 6, 1).getTime(), 2026),
    [2026, 2025, 2024],
  );
  assert.deepEqual(buildYearOptions(null, 2026), [2026]);
});

await runTest("app trend groups sessions by application and day", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const rows = buildDataAppTrendViewModel([
    makeSession({
      appName: "Blender",
      exeName: "blender.exe",
      startTime: new Date(2026, 4, 6, 10, 0, 0).getTime(),
      endTime: new Date(2026, 4, 6, 12, 0, 0).getTime(),
    }),
    makeSession({
      id: 2,
      appName: "Blender",
      exeName: "blender.exe",
      startTime: new Date(2026, 4, 7, 9, 0, 0).getTime(),
      endTime: new Date(2026, 4, 7, 10, 30, 0).getTime(),
    }),
    makeSession({
      id: 3,
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: new Date(2026, 4, 7, 14, 0, 0).getTime(),
      endTime: new Date(2026, 4, 7, 15, 0, 0).getTime(),
    }),
  ], 7, nowMs, null);
  const may7 = rows.dayRows.find((row) => row.date === "2026-05-07");

  assert.equal(rows.selectedApp?.appName, "Blender");
  assert.equal(rows.selectedApp?.totalDuration, 210 * 60 * 1000);
  assert.equal(rows.selectedApp?.activeDayCount, 2);
  assert.equal(rows.dayRows.length, 7);
  assert.equal(may7?.duration, 90 * 60 * 1000);
  assert.equal(rows.peakDay?.date, "2026-05-06");
});

await runTest("app trend preserves explicit selected application", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const rows = buildDataAppTrendViewModel([
    makeSession({
      appName: "Blender",
      exeName: "blender.exe",
      startTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 11, 0, 0).getTime(),
    }),
    makeSession({
      id: 2,
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: new Date(2026, 4, 8, 8, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 11, 0, 0).getTime(),
    }),
  ], 7, nowMs, "blender.exe");

  assert.equal(rows.selectedApp?.appName, "Blender");
  assert.equal(rows.selectedApp?.totalDuration, 60 * 60 * 1000);
  assert.equal(rows.chartData.at(-1)?.duration, 60 * 60 * 1000);
});

await runTest("app trend merges duplicate display options", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const rows = buildDataAppTrendViewModel([
    makeSession({
      appName: "Antigravity",
      exeName: "antigravity.exe",
      startTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 10, 0, 22).getTime(),
    }),
    makeSession({
      id: 2,
      appName: "Antigravity",
      exeName: "Antigravity.exe",
      startTime: new Date(2026, 4, 8, 11, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 11, 0, 22).getTime(),
    }),
  ], 7, nowMs, null);

  assert.equal(rows.appOptions.length, 1);
  assert.equal(rows.selectedApp?.appName, "Antigravity");
  assert.equal(rows.selectedApp?.totalDuration, 44 * 1000);
  assert.equal(rows.chartData.at(-1)?.duration, 44 * 1000);
});

await runTest("yearly app trend averages by month", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const rows = buildDataAppTrendViewModel([
    makeSession({
      appName: "Blender",
      exeName: "blender.exe",
      startTime: new Date(2026, 3, 8, 10, 0, 0).getTime(),
      endTime: new Date(2026, 3, 8, 22, 0, 0).getTime(),
    }),
  ], 365, nowMs, "blender.exe");

  assert.equal(rows.selectedApp?.averageDuration, 60 * 60 * 1000);
});

await runTest("recent heatmap range is aligned to whole local weeks", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const range = getHeatmapRange("recent", nowMs);

  assert.equal(range.weekCount, 53);
  assert.equal(range.start.getDay(), 1);
  assert.equal(range.end.getDay(), 1);
});

await runTest("heatmap snapshot caches earliest activity and refreshes sessions", async () => {
  resetDataReadModelCacheForTests();
  let earliestLoadCount = 0;
  let sessionLoadCount = 0;
  const sessions = [
    makeSession({
      startTime: new Date(2026, 0, 1, 9, 0, 0).getTime(),
      endTime: new Date(2026, 0, 1, 10, 0, 0).getTime(),
    }),
  ];
  const deps: DataHeatmapDependencies = {
    getEarliestSessionStartTime: async () => {
      earliestLoadCount += 1;
      return sessions[0].startTime;
    },
    getSessionsInRange: async () => {
      sessionLoadCount += 1;
      return sessions;
    },
  };
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();

  const first = await loadDataHeatmapSnapshot(2026, nowMs, deps);
  const cached = getCachedDataHeatmapSessions(2026, nowMs);
  const second = await loadDataHeatmapSnapshot(2026, nowMs, deps);

  assert.equal(first.earliestStartTime, sessions[0].startTime);
  assert.equal(cached, sessions);
  assert.equal(second.sessions, sessions);
  assert.equal(earliestLoadCount, 1);
  assert.equal(sessionLoadCount, 2);
});

console.log(`Passed ${passed} data read model tests`);
