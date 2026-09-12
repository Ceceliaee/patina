import assert from "node:assert/strict";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import {
  buildActivityHeatmap as buildActivityHeatmapRaw,
  buildDataAppTrendViewModelFromAggregate,
  buildDataTrendAggregateContext as buildDataTrendAggregateContextRaw,
  buildDataTrendViewModelFromAggregate,
  buildDataTrendViewModel as buildDataTrendViewModelRaw,
  buildDataAppTrendViewModel as buildDataAppTrendViewModelRaw,
  buildYearOptions,
  getDataHeatmapSessionCacheSizeForTests,
  getDataHeatmapSessionCacheStats,
  getCachedEarliestSessionStartTime,
  getCachedDataHeatmapSessions,
  getHeatmapRange,
  loadDataHeatmapSnapshot,
  prewarmRecentDataHeatmapCache,
  resetDataReadModelCacheForTests,
  type AggregateSessionRecord,
  type DataHeatmapDependencies,
} from "../src/features/data/services/dataReadModel.ts";
import { isDataHeatmapSelectionSettled } from "../src/features/data/services/dataHeatmapReadModel.ts";
import { clearDataHeavyCaches } from "../src/features/data/services/dataCacheLifecycle.ts";
import {
  prewarmDataFirstScreen,
  resetDataFirstScreenPrewarmForTests,
} from "../src/features/data/services/dataFirstScreenPrewarm.ts";
import {
  clearDataTrendSnapshotCache,
  getDataTrendSnapshotCacheSizeForTests,
  loadDataTrendSnapshot as loadDataTrendSnapshotRaw,
  type DataTrendSnapshotDependencies,
  type DataTrendSnapshot,
} from "../src/features/data/services/dataTrendSnapshot.ts";
import {
  loadPersistedDataBootstrapSnapshot,
  clearDataBootstrapSnapshot,
  getCachedDataBootstrapSnapshot,
  resetDataBootstrapSnapshotForTests,
  saveDataBootstrapSnapshot,
  type DataBootstrapSnapshot,
} from "../src/features/data/services/dataBootstrapSnapshot.ts";
import {
  pickPreferredAppName,
  scoreDisplayNameForStats,
} from "../src/shared/lib/displayNameScoring.ts";
import { getLocaleText, loadLocaleText } from "../src/shared/i18n/runtime.ts";
import { resolveDataTrendRange } from "../src/features/data/services/dataTrendRange.ts";

const ZH_TEXT = getLocaleText("zh-CN");
type BuildActivityArgs = Parameters<typeof buildActivityHeatmapRaw>;
const buildActivityHeatmap = (
  sessions: BuildActivityArgs[0],
  selection: BuildActivityArgs[1],
  atMs: BuildActivityArgs[2],
  selectedApps?: BuildActivityArgs[5],
) => buildActivityHeatmapRaw(sessions, selection, atMs, ZH_TEXT, "zh-CN", selectedApps);
type TrendContextArgs = Parameters<typeof buildDataTrendAggregateContextRaw>;
const buildDataTrendAggregateContext = (
  sessions: TrendContextArgs[0],
  selection: TrendContextArgs[1],
  atMs: TrendContextArgs[2],
  options?: TrendContextArgs[5],
) => buildDataTrendAggregateContextRaw(sessions, selection, atMs, ZH_TEXT, "zh-CN", options);
const buildDataTrendViewModel = (
  sessions: Parameters<typeof buildDataTrendViewModelRaw>[0],
  selection: Parameters<typeof buildDataTrendViewModelRaw>[1],
  atMs: number,
) => buildDataTrendViewModelRaw(sessions, selection, atMs, ZH_TEXT, "zh-CN");
const buildDataAppTrendViewModel = (
  sessions: Parameters<typeof buildDataAppTrendViewModelRaw>[0],
  selection: Parameters<typeof buildDataAppTrendViewModelRaw>[1],
  atMs: number,
  selectedApps: Parameters<typeof buildDataAppTrendViewModelRaw>[3],
) => buildDataAppTrendViewModelRaw(sessions, selection, atMs, selectedApps, ZH_TEXT, "zh-CN");
const loadDataTrendSnapshot = (
  selection: Parameters<typeof loadDataTrendSnapshotRaw>[0],
  atMs: number,
  deps?: DataTrendSnapshotDependencies,
) => loadDataTrendSnapshotRaw(selection, atMs, ZH_TEXT, deps);

let passed = 0;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function runTest(name: string, fn: () => Promise<void> | void) {
  resetDataBootstrapSnapshotForTests();
  resetDataFirstScreenPrewarmForTests();
  clearDataTrendSnapshotCache();
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function makeSession(overrides: Partial<AggregateSessionRecord>): AggregateSessionRecord {
  return {
    appName: "Cursor",
    exeName: "cursor.exe",
    startTime: 0,
    endTime: 0,
    ...overrides,
  };
}

function findCell(rows: ReturnType<typeof buildActivityHeatmap>, date: string) {
  return rows.flatMap((week) => week.cells).find((cell) => cell.date === date);
}

function makeBootstrapSnapshot(overrides: Partial<DataBootstrapSnapshot> = {}): DataBootstrapSnapshot {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const sessions = [
    makeSession({
      startTime: new Date(2026, 4, 8, 9, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
    }),
  ];
  const overviewRange = 7;
  const appRange = 7;
  const overviewTrendViewModel = buildDataTrendViewModel(sessions, overviewRange, nowMs);
  const appTrendViewModel = buildDataAppTrendViewModel(sessions, appRange, nowMs, null);

  return {
    createdAtMs: nowMs,
    overviewRangeCacheKey: "rolling:7:2026-05-02:2026-05-08",
    appRangeCacheKey: "rolling:7:2026-05-02:2026-05-08",
    heatmapSelection: "recent",
    mappingVersion: 0,
    uiLanguage: "zh-CN",
    overviewTrendViewModel,
    appTrendViewModel,
    heatmapRows: buildActivityHeatmap(sessions, "recent", nowMs),
    earliestStartTime: sessions[0].startTime,
    ...overrides,
  };
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

await runTest("current-app heatmap excludes every other application", () => {
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  const rows = buildActivityHeatmap([
    makeSession({
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: new Date(2026, 0, 2, 9, 0, 0).getTime(),
      endTime: new Date(2026, 0, 2, 10, 0, 0).getTime(),
    }),
    makeSession({
      appName: "Blender",
      exeName: "blender.exe",
      startTime: new Date(2026, 0, 2, 10, 0, 0).getTime(),
      endTime: new Date(2026, 0, 2, 12, 0, 0).getTime(),
    }),
  ], 2026, nowMs, "cursor.exe");

  assert.equal(findCell(rows, "2026-01-02")?.duration, 60 * 60 * 1000);
  assert.equal(findCell(rows, "2026-01-01")?.availability, "recorded");
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

await runTest("activity heatmap labels sub-second durations as zero seconds", () => {
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  const rows = buildActivityHeatmap([
    makeSession({
      startTime: new Date(2026, 0, 2, 9, 0, 0, 0).getTime(),
      endTime: new Date(2026, 0, 2, 9, 0, 0, 999).getTime(),
    }),
  ], 2026, nowMs);

  assert.match(findCell(rows, "2026-01-01")?.label ?? "", /^2026.*0s$/);
  assert.match(findCell(rows, "2026-01-02")?.label ?? "", /^2026.*0s$/);
});

await runTest("year options include every year from current back to earliest activity", () => {
  assert.deepEqual(
    buildYearOptions(new Date(2024, 6, 1).getTime(), 2026),
    [2026, 2025, 2024],
  );
  assert.deepEqual(buildYearOptions(null, 2026), [2026]);
});

await runTest("activity trend exposes dates only for day granularity", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const sessions = [
    makeSession({
      startTime: new Date(2026, 4, 7, 9, 0, 0).getTime(),
      endTime: new Date(2026, 4, 7, 10, 0, 0).getTime(),
    }),
  ];
  const weekly = buildDataTrendViewModel(sessions, 7, nowMs);
  const monthly = buildDataTrendViewModel(sessions, 30, nowMs);
  const yearly = buildDataTrendViewModel(sessions, 365, nowMs);

  assert.equal(weekly.granularity, "day");
  assert.equal(monthly.granularity, "day");
  assert.equal(yearly.granularity, "month");
  assert.equal(weekly.chartData.at(-2)?.date, "2026-05-07");
  assert.match(monthly.chartData.at(-1)?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(yearly.chartData.at(-1)?.date, null);
  assert.equal(yearly.chartData.at(-1)?.hours, 1);
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
      appName: "Blender",
      exeName: "blender.exe",
      startTime: new Date(2026, 4, 7, 9, 0, 0).getTime(),
      endTime: new Date(2026, 4, 7, 10, 30, 0).getTime(),
    }),
    makeSession({
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: new Date(2026, 4, 7, 14, 0, 0).getTime(),
      endTime: new Date(2026, 4, 7, 15, 0, 0).getTime(),
    }),
  ], 7, nowMs, null);
  const may7 = rows.chartRows.find((row) => row.date === "2026-05-07");

  assert.equal(rows.selectedApps[0]?.appName, "Blender");
  assert.equal(rows.granularity, "day");
  assert.equal(rows.selectedApps[0]?.totalDuration, 210 * 60 * 1000);
  assert.equal(rows.selectedApps[0]?.activeDayCount, 2);
  assert.equal(rows.chartRows.length, 7);
  assert.equal(may7?.totalDuration, 90 * 60 * 1000);
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
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: new Date(2026, 4, 8, 8, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 11, 0, 0).getTime(),
    }),
  ], 7, nowMs, "blender.exe");

  assert.equal(rows.selectedApps[0]?.appName, "Blender");
  assert.equal(rows.selectedApps[0]?.totalDuration, 60 * 60 * 1000);
  assert.equal(rows.chartRows.at(-1)?.totalDuration, 60 * 60 * 1000);
});

await runTest("app trend builds ordered comparison series and aggregate metrics for multiple apps", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const may7 = new Date(2026, 4, 7).getTime();
  const may8 = new Date(2026, 4, 8).getTime();
  const rows = buildDataAppTrendViewModel([
    makeSession({
      appName: "Blender",
      exeName: "blender.exe",
      startTime: may7 + (9 * 60 * 60_000),
      endTime: may7 + (10 * 60 * 60_000),
    }),
    makeSession({
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: may7 + (10 * 60 * 60_000),
      endTime: may7 + (12 * 60 * 60_000),
    }),
    makeSession({
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: may8 + (9 * 60 * 60_000),
      endTime: may8 + (9.5 * 60 * 60_000),
    }),
  ], 7, nowMs, ["cursor.exe", "blender.exe"]);

  assert.deepEqual(rows.selectedApps.map((app) => app.appName), ["Cursor", "Blender"]);
  assert.deepEqual(rows.chartSeries.map((series) => series.dataKey), ["series0", "series1"]);
  assert.equal(rows.summary.totalDuration, 3.5 * 60 * 60_000);
  assert.equal(rows.summary.averageDuration, 30 * 60_000);
  assert.equal(rows.summary.activeDayCount, 2);
  assert.equal(rows.peakDay?.date, "2026-05-07");
  assert.equal(rows.peakDay?.duration, 3 * 60 * 60_000);
  const may7Row = rows.chartRows.find((point) => point.date === "2026-05-07");
  assert.equal(may7Row?.series0, 2);
  assert.equal(may7Row?.series1, 1);
  assert.equal(may7Row?.totalHours, 3);
});

await runTest("app trend keeps an explicit selection as a zero series when the range has no records", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const rows = buildDataAppTrendViewModel([], 7, nowMs, ["cursor.exe"]);

  assert.deepEqual(rows.selectedApps.map((app) => app.appKey), ["cursor.exe"]);
  assert.equal(rows.summary.totalDuration, 0);
  assert.equal(rows.chartSeries[0]?.key, "cursor.exe");
  assert.ok(rows.chartRows.every((row) => row.series0 === 0));
});

await runTest("current-app heatmap aggregates an explicit application selection set", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const may8 = new Date(2026, 4, 8).getTime();
  const rows = buildActivityHeatmap([
    makeSession({
      appName: "Blender",
      exeName: "blender.exe",
      startTime: may8 + (8 * 60 * 60_000),
      endTime: may8 + (9 * 60 * 60_000),
    }),
    makeSession({
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: may8 + (9 * 60 * 60_000),
      endTime: may8 + (11 * 60 * 60_000),
    }),
    makeSession({
      appName: "Chrome",
      exeName: "chrome.exe",
      startTime: may8 + (11 * 60 * 60_000),
      endTime: may8 + (12 * 60 * 60_000),
    }),
  ], 2026, nowMs, ["cursor.exe", "blender.exe"]);

  assert.equal(findCell(rows, "2026-05-08")?.duration, 3 * 60 * 60_000);
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
      appName: "Antigravity",
      exeName: "Antigravity.exe",
      startTime: new Date(2026, 4, 8, 11, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 11, 0, 22).getTime(),
    }),
  ], 7, nowMs, null);

  assert.equal(rows.appOptions.length, 1);
  assert.equal(rows.selectedApps[0]?.appName, "Antigravity");
  assert.equal(rows.selectedApps[0]?.totalDuration, 44 * 1000);
  assert.equal(rows.chartRows.at(-1)?.totalDuration, 44 * 1000);
});

await runTest("display name scoring prefers readable localized names over tray aliases", () => {
  assert.equal(scoreDisplayNameForStats("Patina Tray"), 1);
  assert.equal(scoreDisplayNameForStats("foo_bar"), 2);
  assert.equal(scoreDisplayNameForStats("Visual Studio Code"), 3);
  assert.equal(scoreDisplayNameForStats("微信"), 4);
  assert.equal(pickPreferredAppName("Patina Widget", "微信"), "微信");
  assert.equal(pickPreferredAppName("Visual Studio Code", "code-helper"), "Visual Studio Code");
});

await runTest("data aggregation prefers canonical runtime names over alias fallbacks on ASCII ties", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const context = buildDataTrendAggregateContext([
    makeSession({
      appName: "SteamWebHelper",
      exeName: "steamwebhelper.exe",
      startTime: new Date(2026, 4, 8, 8, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 9, 0, 0).getTime(),
    }),
    makeSession({
      appName: "Steam Client",
      exeName: "steam.exe",
      startTime: new Date(2026, 4, 8, 9, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
    }),
  ], 7, nowMs);

  assert.equal(context.aggregate.appBuckets.get("steam.exe")?.appName, "Steam Client");
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

  assert.equal(rows.granularity, "month");
  assert.equal(rows.selectedApps[0]?.averageDuration, 60 * 60 * 1000);
  assert.equal(
    rows.chartRows.find((point) => point.date === "2026-04-01")?.totalDuration,
    12 * 60 * 60 * 1000,
  );
});

await runTest("all-time app trend follows the selected apps' widest activity bounds", () => {
  const nowMs = new Date(2026, 7, 9, 12, 0, 0).getTime();
  const range = resolveDataTrendRange({
    kind: "all",
    startDateKey: "2026-01-05",
    endDateKey: "2026-08-09",
  }, nowMs, ZH_TEXT);
  const sessions = [
    makeSession({
      appName: "Archive",
      exeName: "archive.exe",
      startTime: new Date(2026, 0, 5, 9, 0, 0).getTime(),
      endTime: new Date(2026, 0, 5, 13, 0, 0).getTime(),
    }),
    makeSession({
      appName: "Chrome",
      exeName: "chrome.exe",
      startTime: new Date(2026, 3, 10, 9, 0, 0).getTime(),
      endTime: new Date(2026, 3, 10, 10, 0, 0).getTime(),
    }),
    makeSession({
      appName: "Patina",
      exeName: "patina.exe",
      startTime: new Date(2026, 5, 3, 9, 0, 0).getTime(),
      endTime: new Date(2026, 5, 3, 10, 0, 0).getTime(),
    }),
    makeSession({
      appName: "Patina",
      exeName: "patina.exe",
      startTime: new Date(2026, 6, 20, 9, 0, 0).getTime(),
      endTime: new Date(2026, 6, 20, 11, 0, 0).getTime(),
    }),
    makeSession({
      appName: "Chrome",
      exeName: "chrome.exe",
      startTime: new Date(2026, 7, 2, 9, 0, 0).getTime(),
      endTime: new Date(2026, 7, 2, 11, 0, 0).getTime(),
    }),
  ];

  const patina = buildDataAppTrendViewModel(sessions, range, nowMs, ["patina.exe"]);
  assert.deepEqual(
    [patina.range.startDateKey, patina.range.endDateKey],
    ["2026-06-01", "2026-07-31"],
  );
  assert.deepEqual(
    patina.chartRows.map((row) => row.date),
    ["2026-06-01", "2026-07-01"],
  );
  assert.equal(patina.summary.totalDuration, 3 * 60 * 60_000);
  assert.equal(
    patina.appOptions.find((app) => app.appKey === "archive.exe")?.totalDuration,
    4 * 60 * 60_000,
  );

  const comparison = buildDataAppTrendViewModel(
    sessions,
    range,
    nowMs,
    ["patina.exe", "chrome.exe"],
  );
  assert.deepEqual(
    [comparison.range.startDateKey, comparison.range.endDateKey],
    ["2026-04-01", "2026-08-09"],
  );
  assert.deepEqual(
    comparison.chartRows.map((row) => row.date),
    ["2026-04-01", "2026-05-01", "2026-06-01", "2026-07-01", "2026-08-01"],
  );
  assert.equal(comparison.summary.totalDuration, 6 * 60 * 60_000);
});

await runTest("shared trend aggregate matches standalone overview and app read models", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const sessions = [
    makeSession({
      appName: "Blender",
      exeName: "blender.exe",
      startTime: new Date(2026, 3, 30, 23, 0, 0).getTime(),
      endTime: new Date(2026, 4, 1, 1, 0, 0).getTime(),
    }),
    makeSession({
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: new Date(2026, 4, 8, 8, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 11, 0, 0).getTime(),
    }),
  ];
  const context = buildDataTrendAggregateContext(sessions, 365, nowMs);

  assert.deepEqual(
    buildDataTrendViewModelFromAggregate(context),
    buildDataTrendViewModel(sessions, 365, nowMs),
  );
  assert.deepEqual(
    buildDataAppTrendViewModelFromAggregate(context, "blender.exe"),
    buildDataAppTrendViewModel(sessions, 365, nowMs, "blender.exe"),
  );
});

await runTest("selected app derivation from shared aggregate does not mutate overview trend", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const sessions = [
    makeSession({
      appName: "Blender",
      exeName: "blender.exe",
      startTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 11, 0, 0).getTime(),
    }),
    makeSession({
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: new Date(2026, 4, 8, 8, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 11, 0, 0).getTime(),
    }),
  ];
  const context = buildDataTrendAggregateContext(sessions, 7, nowMs);
  const overviewBefore = buildDataTrendViewModelFromAggregate(context);
  const blender = buildDataAppTrendViewModelFromAggregate(context, "blender.exe");
  const cursor = buildDataAppTrendViewModelFromAggregate(context, "cursor.exe");
  const overviewAfter = buildDataTrendViewModelFromAggregate(context);

  assert.deepEqual(overviewAfter, overviewBefore);
  assert.equal(blender.selectedApps[0]?.appName, "Blender");
  assert.equal(cursor.selectedApps[0]?.appName, "Cursor");
});

await runTest("activity trend clips sessions at range boundaries", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const rows = buildDataTrendViewModel([
    makeSession({
      startTime: new Date(2026, 4, 7, 23, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 1, 0, 0).getTime(),
    }),
  ], 7, nowMs);

  assert.equal(rows.chartData.at(-2)?.hours, 1);
  assert.equal(rows.chartData.at(-1)?.hours, 1);
});

await runTest("app trend respects user exclusions after aggregate DTO tightening", () => {
  ProcessMapper.setUserOverride("cursor.exe", { track: false });
  try {
    const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
    const rows = buildDataAppTrendViewModel([
      makeSession({
        startTime: new Date(2026, 4, 8, 9, 0, 0).getTime(),
        endTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
      }),
      makeSession({
        appName: "Blender",
        exeName: "blender.exe",
        startTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
        endTime: new Date(2026, 4, 8, 11, 0, 0).getTime(),
      }),
    ], 7, nowMs, null);

    assert.deepEqual(rows.appOptions.map((app) => app.exeName), ["blender.exe"]);
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

await runTest("activity heatmap excludes currently disabled apps and restores retained history", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const sessions = [
    makeSession({
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: new Date(2026, 4, 8, 9, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
    }),
    makeSession({
      appName: "Blender",
      exeName: "blender.exe",
      startTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 11, 0, 0).getTime(),
    }),
  ];

  ProcessMapper.setUserOverride("cursor.exe", { track: false });
  try {
    const excludedRows = buildActivityHeatmap(sessions, "recent", nowMs);
    const excludedCell = excludedRows
      .flatMap((week) => week.cells)
      .find((cell) => cell.date === "2026-05-08");
    assert.equal(excludedCell?.duration, 60 * 60_000);
  } finally {
    ProcessMapper.clearUserOverrides();
  }

  const restoredRows = buildActivityHeatmap(sessions, "recent", nowMs);
  const restoredCell = restoredRows
    .flatMap((week) => week.cells)
    .find((cell) => cell.date === "2026-05-08");
  assert.equal(restoredCell?.duration, 2 * 60 * 60_000);
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

await runTest("heatmap snapshot dedupes matching in-flight range loads", async () => {
  resetDataReadModelCacheForTests();
  let earliestLoadCount = 0;
  let sessionLoadCount = 0;
  let releaseSessions: (() => void) | null = null;
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
      await new Promise<void>((resolve) => {
        releaseSessions = resolve;
      });
      return sessions;
    },
  };
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();

  const first = loadDataHeatmapSnapshot("recent", nowMs, deps);
  const second = prewarmRecentDataHeatmapCache(nowMs, deps);
  releaseSessions?.();
  const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);

  assert.equal(firstSnapshot.sessions, sessions);
  assert.equal(secondSnapshot.sessions, sessions);
  assert.equal(firstSnapshot.sessions, secondSnapshot.sessions);
  assert.equal(earliestLoadCount, 1);
  assert.equal(sessionLoadCount, 1);
});

await runTest("failed heatmap snapshots release pending state and remain retryable", async () => {
  resetDataReadModelCacheForTests();
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  let attempts = 0;
  const deps: DataHeatmapDependencies = {
    getEarliestSessionStartTime: async () => null,
    getSessionsInRange: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("heatmap unavailable");
      return [];
    },
  };

  await assert.rejects(loadDataHeatmapSnapshot("recent", nowMs, deps), /heatmap unavailable/);
  assert.deepEqual(getDataHeatmapSessionCacheStats(), {
    entries: 0,
    limit: 2,
    pendingEntries: 0,
    earliestSessionStartTimeCached: false,
  });

  const recovered = await loadDataHeatmapSnapshot("recent", nowMs, deps);
  assert.deepEqual(recovered.sessions, []);
  assert.equal(attempts, 2);
});

await runTest("cold heatmap failures settle the requested selection without claiming stale data", () => {
  assert.equal(isDataHeatmapSelectionSettled(null, "recent", true), true);
  assert.equal(isDataHeatmapSelectionSettled(null, "recent", false), false);
  assert.equal(isDataHeatmapSelectionSettled(2025, 2026, false), false);
  assert.equal(isDataHeatmapSelectionSettled(2026, 2026, false), true);
});

await runTest("recent heatmap prewarm reuses a warm cache", async () => {
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

  const first = await prewarmRecentDataHeatmapCache(nowMs, deps);
  const second = await prewarmRecentDataHeatmapCache(nowMs, deps);

  assert.equal(first.sessions, sessions);
  assert.equal(second.sessions, sessions);
  assert.equal(earliestLoadCount, 1);
  assert.equal(sessionLoadCount, 1);
});

await runTest("heatmap session cache keeps a small LRU set", async () => {
  resetDataReadModelCacheForTests();
  const deps: DataHeatmapDependencies = {
    getEarliestSessionStartTime: async () => null,
    getSessionsInRange: async () => [],
  };
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();

  await loadDataHeatmapSnapshot("recent", nowMs, deps);
  await loadDataHeatmapSnapshot(2025, nowMs, deps);
  await loadDataHeatmapSnapshot(2026, nowMs, deps);

  assert.equal(getDataHeatmapSessionCacheSizeForTests(), 2);
  assert.equal(getCachedDataHeatmapSessions("recent", nowMs), undefined);
});

await runTest("data bootstrap snapshot loads a valid persisted payload into cache", async () => {
  const snapshot = makeBootstrapSnapshot();
  const loaded = await loadPersistedDataBootstrapSnapshot({
    loadPayload: async () => JSON.stringify(snapshot),
    savePayload: async () => {
      throw new Error("unexpected save");
    },
    clearPayload: async () => {
      throw new Error("unexpected clear");
    },
    warn: () => {
      throw new Error("unexpected warning");
    },
  });

  assert.equal(loaded?.createdAtMs, snapshot.createdAtMs);
  assert.equal(loaded?.overviewTrendViewModel.totalDuration, snapshot.overviewTrendViewModel.totalDuration);
});

await runTest("data bootstrap snapshot rejects persisted app options without source keys", async () => {
  const staleSnapshot = makeBootstrapSnapshot();
  const staleOption = staleSnapshot.appTrendViewModel.appOptions[0] as unknown as Record<string, unknown>;
  delete staleOption.sourceAppKeys;
  let cleared = false;

  const loaded = await loadPersistedDataBootstrapSnapshot({
    loadPayload: async () => JSON.stringify(staleSnapshot),
    savePayload: async () => {
      throw new Error("unexpected save");
    },
    clearPayload: async () => {
      cleared = true;
    },
    warn: () => {
      throw new Error("unexpected warning");
    },
  });

  assert.equal(loaded, null);
  assert.equal(cleared, true);
});

await runTest("data bootstrap rejects damaged first-render fields before publishing cache", async () => {
  const damagedFields: Array<[string, unknown?]> = [
    ["overviewTrendViewModel", {}],
    ["overviewTrendViewModel.chartAxis"],
    ["overviewTrendViewModel.chartAxis.ticks", [0, "bad"]],
    ["overviewTrendViewModel.chartAxis.domainMax", null],
    ["overviewTrendViewModel.metricLabels"],
    ["overviewTrendViewModel.metricLabels.total", {}],
    ["overviewTrendViewModel.chartData"],
    ["overviewTrendViewModel.chartData.0", null],
    ["overviewTrendViewModel.chartData.0.hours", null],
    ["overviewTrendViewModel.totalDuration", {}],
    ["appTrendViewModel", { appOptions: [], selectedApps: [] }],
    ["appTrendViewModel.range"],
    ["appTrendViewModel.range.selection"],
    ["appTrendViewModel.range.selection", { kind: "rolling", days: 0 }],
    ["appTrendViewModel.range.selection", { kind: "custom", startDateKey: "2026-02-30", endDateKey: "2026-05-08" }],
    ["appTrendViewModel.summary"],
    ["appTrendViewModel.summary.activeDayCount", {}],
    ["appTrendViewModel.chartAxis.ticks", null],
    ["appTrendViewModel.chartRows"],
    ["appTrendViewModel.chartRows.0", null],
    ["appTrendViewModel.chartRows.0.label", {}],
    ["appTrendViewModel.chartRows.0.series0"],
    ["appTrendViewModel.chartRows.0.series0", {}],
    ["appTrendViewModel.appOptions.0.appName"],
    ["appTrendViewModel.appOptions.0.exeName", {}],
    ["appTrendViewModel.selectedApps.0.averageDuration", null],
    ["appTrendViewModel.peakDay", { duration: {} }],
    ["heatmapRows.0.cells"],
    ["heatmapRows.0.cells.0", null],
    ["heatmapRows.0.cells.0.date", "2026-02-30"],
    ["heatmapRows.0.cells.0.label", {}],
    ["heatmapRows.0.cells.0.duration", null],
    ["heatmapRows.0.monthLabel", {}],
  ];
  for (const [path, replacement] of damagedFields) {
    resetDataBootstrapSnapshotForTests();
    const snapshot = makeBootstrapSnapshot();
    const seeded = await loadPersistedDataBootstrapSnapshot({
      loadPayload: async () => JSON.stringify(snapshot),
      clearPayload: async () => { throw new Error("valid fixture was discarded"); },
      warn: () => { throw new Error("unexpected seed warning"); },
    });
    assert.ok(seeded, path);
    const parts = path.split(".");
    const field = parts.pop()!;
    const owner = parts.reduce((value, key) => value[key] as Record<string, unknown>, snapshot as unknown as Record<string, unknown>);
    if (replacement === undefined) delete owner[field];
    else owner[field] = replacement;
    let clears = 0;
    const loaded = await loadPersistedDataBootstrapSnapshot({
      loadPayload: async () => JSON.stringify(snapshot),
      clearPayload: async () => { clears += 1; },
      warn: () => { throw new Error(`unexpected warning for ${path}`); },
    });
    assert.equal(loaded === null, true, path);
    assert.equal(getCachedDataBootstrapSnapshot() === null, true, path);
    assert.equal(clears, 1, path);
  }
});

await runTest("data bootstrap retains valid empty and calendar range first-render models", async () => {
  const nowMs = new Date(2026, 4, 8, 12).getTime();
  const selections = [
    { kind: "rolling", days: 7 },
    { kind: "rolling", days: 30 },
    { kind: "rolling", days: 365 },
    { kind: "custom", startDateKey: "2026-02-01", endDateKey: "2026-05-08" },
    { kind: "all", startDateKey: "2026-02-01", endDateKey: "2026-05-08" },
    { kind: "week", anchorDateKey: "2026-05-08" },
    { kind: "month", anchorDateKey: "2026-05-08" },
    { kind: "year", anchorDateKey: "2026-05-08" },
  ] as const;
  for (const selection of selections) {
    resetDataBootstrapSnapshotForTests();
    const range = resolveDataTrendRange(selection, nowMs, ZH_TEXT);
    const snapshot = makeBootstrapSnapshot({
      overviewTrendViewModel: buildDataTrendViewModel([], range, nowMs),
      appTrendViewModel: buildDataAppTrendViewModel([], range, nowMs, null),
      heatmapRows: buildActivityHeatmap([], 2026, nowMs),
    });
    const loaded = await loadPersistedDataBootstrapSnapshot({
      loadPayload: async () => JSON.stringify(snapshot),
      clearPayload: async () => { throw new Error("valid builder snapshot was discarded"); },
      warn: () => { throw new Error("unexpected warning"); },
    });
    assert.deepEqual(loaded, snapshot, JSON.stringify(selection));
  }
});

await runTest("data bootstrap snapshot refuses oversized payloads", async () => {
  const warnings: string[] = [];
  let saved = false;
  const snapshot = makeBootstrapSnapshot({
    heatmapRows: Array.from({ length: 12_000 }, (_, index) => ({
      key: `week-${index}`,
      monthLabel: "5月",
      cells: [],
    })),
  });

  const didSave = await saveDataBootstrapSnapshot(snapshot, { minSaveIntervalMs: 0 }, {
    loadPayload: async () => null,
    savePayload: async () => {
      saved = true;
    },
    clearPayload: async () => undefined,
    warn: (message) => warnings.push(message),
  });

  assert.equal(didSave, false);
  assert.equal(saved, false);
  assert.equal(warnings.length, 1);
});

await runTest("late Data bootstrap reads cannot undo clear or a newer snapshot", async () => {
  for (const oldResult of [JSON.stringify(makeBootstrapSnapshot()), "invalid-json", null, new Error("read failed")]) {
    for (const writeNewSnapshot of [false, true]) {
      resetDataBootstrapSnapshotForTests();
      const gate = deferred<string | null>();
      const started = deferred<void>();
      let persisted: string | null = "old";
      let clears = 0;
      const deps = {
        loadPayload: () => { started.resolve(); return gate.promise; },
        clearPayload: async () => { clears += 1; persisted = null; },
        savePayload: async (payload: string) => { persisted = payload; },
        warn: () => { throw new Error("stale failures must not warn or clear newer state"); },
      };
      const loading = loadPersistedDataBootstrapSnapshot(deps);
      await started.promise;
      const clearing = clearDataBootstrapSnapshot(deps);
      const fresh = makeBootstrapSnapshot({ mappingVersion: 99 });
      const saving = writeNewSnapshot
        ? saveDataBootstrapSnapshot(fresh, { minSaveIntervalMs: 0 }, deps)
        : Promise.resolve(false);
      if (oldResult instanceof Error) gate.reject(oldResult);
      else gate.resolve(oldResult);
      const [loaded] = await Promise.all([loading, clearing, saving]);
      assert.equal(loaded, writeNewSnapshot ? fresh : null);
      assert.equal(getCachedDataBootstrapSnapshot(), writeNewSnapshot ? fresh : null);
      assert.equal(persisted, writeNewSnapshot ? JSON.stringify(fresh) : null);
      assert.equal(clears, 1);
    }
  }
});

await runTest("Data bootstrap storage orders old save, clear and new save", async () => {
  const gate = deferred<void>();
  const started = deferred<void>();
  const writes: string[] = [];
  let persisted: string | null = null;
  const deps = {
    savePayload: async (payload: string) => {
      const version = JSON.parse(payload).mappingVersion;
      if (version === 1) { started.resolve(); await gate.promise; }
      writes.push(`save-${version}`);
      persisted = payload;
    },
    clearPayload: async () => { writes.push("clear"); persisted = null; },
    warn: () => { throw new Error("unexpected storage failure"); },
  };
  const oldSave = saveDataBootstrapSnapshot(makeBootstrapSnapshot({ mappingVersion: 1 }), {}, deps);
  await started.promise;
  const clearing = clearDataBootstrapSnapshot(deps);
  const fresh = makeBootstrapSnapshot({ mappingVersion: 2 });
  const newSave = saveDataBootstrapSnapshot(fresh, {}, deps);
  gate.resolve();
  await Promise.all([oldSave, clearing, newSave]);
  assert.deepEqual(writes, ["save-1", "clear", "save-2"]);
  assert.equal(getCachedDataBootstrapSnapshot(), fresh);
  assert.equal(persisted, JSON.stringify(fresh));
});

await runTest("Data bootstrap retries failed storage and persists changed identity inside the throttle", async () => {
  let attempts = 0;
  const deps = {
    savePayload: async () => { attempts += 1; if (attempts === 1) throw new Error("storage initializing"); },
    warn: () => {},
  };
  const snapshot = makeBootstrapSnapshot();
  assert.equal(await saveDataBootstrapSnapshot(snapshot, { nowMs: 1_000 }, deps), false);
  assert.equal(await saveDataBootstrapSnapshot(snapshot, { nowMs: 1_001 }, deps), true);
  assert.equal(await saveDataBootstrapSnapshot(snapshot, { nowMs: 1_002 }, deps), false);
  assert.equal(await saveDataBootstrapSnapshot({ ...snapshot, uiLanguage: "en-US" }, { nowMs: 1_003 }, deps), true);
  assert.equal(attempts, 3);
});

await runTest("Data bootstrap failed clear releases storage for a fresh save and load", async () => {
  let persisted: string | null = "old";
  const deps = {
    clearPayload: async () => { throw new Error("storage initializing"); },
    savePayload: async (payload: string) => { persisted = payload; },
    loadPayload: async () => persisted,
    warn: () => {},
  };
  await clearDataBootstrapSnapshot(deps);
  const fresh = makeBootstrapSnapshot({ mappingVersion: 44 });
  assert.equal(await saveDataBootstrapSnapshot(fresh, {}, deps), true);
  assert.deepEqual(await loadPersistedDataBootstrapSnapshot(deps), fresh);
  assert.equal(persisted, JSON.stringify(fresh));
});

await runTest("Data bootstrap applies the UTF-8 budget before throttling and before loading", async () => {
  const snapshot = makeBootstrapSnapshot();
  const oversized = makeBootstrapSnapshot({
    heatmapRows: [{ key: "week", monthLabel: "界".repeat(90_000), cells: [] }],
  });
  const payload = JSON.stringify(oversized);
  assert.ok(payload.length < 256 * 1024);
  assert.ok(Buffer.byteLength(payload, "utf8") > 256 * 1024);
  let writes = 0;
  let clears = 0;
  const deps = {
    savePayload: async () => { writes += 1; },
    clearPayload: async () => { clears += 1; },
    loadPayload: async () => payload,
    warn: () => {},
  };
  await saveDataBootstrapSnapshot(snapshot, { nowMs: 1_000 }, deps);
  assert.equal(await saveDataBootstrapSnapshot(oversized, { nowMs: 1_001 }, deps), false);
  assert.equal(getCachedDataBootstrapSnapshot(), snapshot);
  assert.equal(writes, 1);
  assert.equal(await loadPersistedDataBootstrapSnapshot(deps), null);
  assert.equal(clears, 1);
});

await runTest("Data prewarm clear and changed identities reject old work without dropping newer pending work", async () => {
  for (const [change, oldCompletesFirst] of [
    ["clear", true], ["clear", false],
    ["mapping-and-language", true], ["mapping-and-language", false],
  ] as const) {
    resetDataBootstrapSnapshotForTests();
    resetDataFirstScreenPrewarmForTests();
    const nowMs = new Date(2026, 4, 8, 12).getTime();
    const gates = [deferred<DataTrendSnapshot>(), deferred<DataTrendSnapshot>()];
    const started = [deferred<void>(), deferred<void>()];
    const range = resolveDataTrendRange({ kind: "rolling", days: 7 }, nowMs, ZH_TEXT);
    const trend = { fetchedAtMs: nowMs, range, sessions: [], icons: {} };
    const saves: DataBootstrapSnapshot[] = [];
    let loads = 0;
    const deps = {
      loadLocaleText: async () => ZH_TEXT,
      loadTrendSnapshot: () => { const index = loads++; started[index].resolve(); return gates[index].promise; },
      prewarmRecentHeatmap: async () => ({ earliestStartTime: null, range: getHeatmapRange("recent", nowMs), cacheKey: "recent", sessions: [] }),
      saveBootstrapSnapshot: async (snapshot: DataBootstrapSnapshot) => { saves.push(snapshot); return true; },
      warn: () => { throw new Error("unexpected prewarm failure"); },
    };
    const options = { mappingVersion: 1, uiLanguage: "zh-CN" as const, reason: "data-opened" as const, nowMs };
    const old = prewarmDataFirstScreen(options, deps);
    await started[0].promise;
    if (change === "clear") await clearDataBootstrapSnapshot({ clearPayload: async () => {} });
    const nextOptions = change === "clear" ? options : { ...options, mappingVersion: 2, uiLanguage: "en-US" as const };
    const fresh = prewarmDataFirstScreen(nextOptions, deps);
    await started[1].promise;
    let deduped: Promise<DataBootstrapSnapshot | null>;
    if (oldCompletesFirst) {
      gates[0].resolve(trend);
      assert.equal(await old, null);
      deduped = prewarmDataFirstScreen(nextOptions, deps);
      gates[1].resolve(trend);
    } else {
      deduped = prewarmDataFirstScreen(nextOptions, deps);
      gates[1].resolve(trend);
      await fresh;
      gates[0].resolve(trend);
      assert.equal(await old, null);
    }
    const [result, same] = await Promise.all([fresh, deduped]);
    assert.equal(same, result);
    assert.equal(loads, 2);
    assert.equal(saves.length, 1);
    assert.equal(result?.mappingVersion, nextOptions.mappingVersion);
    assert.equal(result?.uiLanguage, nextOptions.uiLanguage);
  }
});

await runTest("Data prewarm failures retry immediately and late persistence cannot reinstate a cleared success", async () => {
  const nowMs = new Date(2026, 4, 8, 12).getTime();
  const gate = deferred<void>();
  const saveStarted = deferred<void>();
  let attempts = 0;
  let saves = 0;
  const deps = {
    loadLocaleText: async () => { if (++attempts === 1) throw new Error("locale initializing"); return ZH_TEXT; },
    loadTrendSnapshot: async () => ({ fetchedAtMs: nowMs, range: resolveDataTrendRange({ kind: "rolling", days: 7 }, nowMs, ZH_TEXT), sessions: [], icons: {} }),
    prewarmRecentHeatmap: async () => ({ earliestStartTime: null, range: getHeatmapRange("recent", nowMs), cacheKey: "recent", sessions: [] }),
    saveBootstrapSnapshot: async () => { if (++saves === 1) { saveStarted.resolve(); await gate.promise; } return true; },
    warn: () => {},
  };
  const options = { mappingVersion: 1, uiLanguage: "zh-CN" as const, reason: "data-opened" as const, nowMs };
  assert.equal(await prewarmDataFirstScreen(options, deps), null);
  const retry = prewarmDataFirstScreen(options, deps);
  await saveStarted.promise;
  await clearDataBootstrapSnapshot({ clearPayload: async () => {} });
  gate.resolve();
  assert.equal(await retry, null);
  assert.ok(await prewarmDataFirstScreen(options, deps));
  assert.equal(attempts, 3);
  assert.equal(saves, 2);
});

await runTest("Data prewarm dedupes while its real save is pending and retries a failed save", async () => {
  const nowMs = new Date(2026, 4, 8, 12).getTime();
  const gate = deferred<void>();
  const saveStarted = deferred<void>();
  let loads = 0;
  let saves = 0;
  const deps = {
    loadLocaleText: async () => ZH_TEXT,
    loadTrendSnapshot: async () => {
      loads += 1;
      return { fetchedAtMs: nowMs, range: resolveDataTrendRange({ kind: "rolling", days: 7 }, nowMs, ZH_TEXT), sessions: [], icons: {} };
    },
    prewarmRecentHeatmap: async () => ({ earliestStartTime: null, range: getHeatmapRange("recent", nowMs), cacheKey: "recent", sessions: [] }),
    saveBootstrapSnapshot: (snapshot: DataBootstrapSnapshot) => saveDataBootstrapSnapshot(snapshot, { nowMs }, {
      savePayload: async () => {
        if (++saves === 1) {
          saveStarted.resolve();
          await gate.promise;
          throw new Error("storage initializing");
        }
      },
      warn: () => {},
    }),
    warn: () => {},
  };
  const options = { mappingVersion: 1, uiLanguage: "zh-CN" as const, reason: "data-opened" as const, nowMs };
  const first = prewarmDataFirstScreen(options, deps);
  await saveStarted.promise;
  const same = prewarmDataFirstScreen(options, deps);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, same]), [null, null]);
  assert.equal(loads, 1);
  assert.equal(saves, 1);
  assert.ok(await prewarmDataFirstScreen(options, deps));
  assert.equal(loads, 2);
  assert.equal(saves, 2);
});

await runTest("data first screen prewarm saves a bootstrap snapshot", async () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const sessions = [
    makeSession({
      startTime: new Date(2026, 4, 8, 9, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
    }),
  ];
  const trendSnapshot = await loadDataTrendSnapshot({ kind: "rolling", days: 7 }, nowMs, {
    getSessionSummariesInRange: async () => sessions,
  });
  let savedSnapshot: DataBootstrapSnapshot | null = null;
  const loadedLocales: string[] = [];

  const snapshot = await prewarmDataFirstScreen({
    mappingVersion: 3,
    reason: "foreground-opened",
    uiLanguage: "en-US",
    nowMs,
  }, {
    loadLocaleText: async (locale) => {
      loadedLocales.push(locale);
      return loadLocaleText(locale);
    },
    loadTrendSnapshot: async () => trendSnapshot,
    prewarmRecentHeatmap: async () => ({
      earliestStartTime: sessions[0].startTime,
      range: getHeatmapRange("recent", nowMs),
      cacheKey: "recent:2025-05-05:2026-05-11",
      sessions,
    }),
    saveBootstrapSnapshot: async (nextSnapshot) => {
      savedSnapshot = nextSnapshot;
      return true;
    },
    warn: () => {
      throw new Error("unexpected warning");
    },
  });

  assert.equal(snapshot?.mappingVersion, 3);
  assert.equal(snapshot?.uiLanguage, "en-US");
  assert.deepEqual(loadedLocales, ["en-US"]);
  assert.equal(savedSnapshot?.overviewTrendViewModel.totalDuration, 60 * 60 * 1000);
  assert.equal(savedSnapshot?.appTrendViewModel.selectedApps[0]?.appName, "Cursor");
  assert.ok(savedSnapshot?.heatmapRows.length);
});

await runTest("data first screen prewarm dedupes pending matching work and throttles repeats", async () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const sessions = [
    makeSession({
      startTime: new Date(2026, 4, 8, 9, 0, 0).getTime(),
      endTime: new Date(2026, 4, 8, 10, 0, 0).getTime(),
    }),
  ];
  const trendSnapshot = await loadDataTrendSnapshot({ kind: "rolling", days: 7 }, nowMs, {
    getSessionSummariesInRange: async () => sessions,
  });
  let loadCount = 0;
  let releaseLoad: (() => void) | null = null;
  const deps = {
    loadTrendSnapshot: async (): Promise<DataTrendSnapshot> => {
      loadCount += 1;
      await new Promise<void>((resolve) => {
        releaseLoad = resolve;
      });
      return trendSnapshot;
    },
    prewarmRecentHeatmap: async () => ({
      earliestStartTime: sessions[0].startTime,
      range: getHeatmapRange("recent", nowMs),
      cacheKey: "recent:2025-05-05:2026-05-11",
      sessions,
    }),
    saveBootstrapSnapshot: async () => true,
    warn: () => {
      throw new Error("unexpected warning");
    },
  };

  const first = prewarmDataFirstScreen({
    mappingVersion: 1,
    reason: "foreground-opened",
    uiLanguage: "zh-CN",
    nowMs,
  }, deps);
  const second = prewarmDataFirstScreen({
    mappingVersion: 1,
    reason: "data-opened",
    uiLanguage: "zh-CN",
    nowMs,
  }, deps);
  await Promise.resolve();
  assert.ok(releaseLoad);
  releaseLoad?.();
  await Promise.all([first, second]);

  const throttled = await prewarmDataFirstScreen({
    mappingVersion: 1,
    reason: "foreground-opened",
    uiLanguage: "zh-CN",
    nowMs: nowMs + 1_000,
  }, deps);

  assert.equal(loadCount, 1);
  assert.equal(throttled, null);
});

await runTest("data heavy cache cleanup clears trend and heatmap caches without bootstrap", async () => {
  resetDataReadModelCacheForTests();
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  await loadDataTrendSnapshot({ kind: "rolling", days: 7 }, nowMs, {
    getSessionSummariesInRange: async () => [],
  });
  await loadDataHeatmapSnapshot("recent", nowMs, {
    getEarliestSessionStartTime: async () => null,
    getSessionsInRange: async () => [],
  });
  await saveDataBootstrapSnapshot(makeBootstrapSnapshot(), { minSaveIntervalMs: 0 }, {
    clearPayload: async () => undefined,
    loadPayload: async () => null,
    savePayload: async () => undefined,
  });

  assert.equal(getDataTrendSnapshotCacheSizeForTests(), 1);
  assert.equal(getDataHeatmapSessionCacheSizeForTests(), 1);

  clearDataHeavyCaches();

  assert.equal(getDataTrendSnapshotCacheSizeForTests(), 0);
  assert.equal(getDataHeatmapSessionCacheSizeForTests(), 0);
  assert.equal((await loadPersistedDataBootstrapSnapshot({
    clearPayload: async () => undefined,
    loadPayload: async () => JSON.stringify(makeBootstrapSnapshot()),
    savePayload: async () => undefined,
  }))?.overviewRangeCacheKey, "rolling:7:2026-05-02:2026-05-08");
});

await runTest("data heavy cache cleanup prevents late in-flight snapshots from repopulating caches", async () => {
  resetDataReadModelCacheForTests();
  clearDataTrendSnapshotCache();
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  let releaseHeatmap: (() => void) | null = null;
  let releaseTrend: (() => void) | null = null;

  const heatmapPromise = loadDataHeatmapSnapshot("recent", nowMs, {
    getEarliestSessionStartTime: async () => nowMs - 60_000,
    getSessionsInRange: async () => {
      await new Promise<void>((resolve) => {
        releaseHeatmap = resolve;
      });
      return [];
    },
  });
  const trendPromise = loadDataTrendSnapshot({ kind: "rolling", days: 7 }, nowMs, {
    getSessionSummariesInRange: async () => {
      await new Promise<void>((resolve) => {
        releaseTrend = resolve;
      });
      return [];
    },
  });

  clearDataHeavyCaches();
  releaseHeatmap?.();
  releaseTrend?.();
  await Promise.all([heatmapPromise, trendPromise]);

  assert.equal(getDataHeatmapSessionCacheSizeForTests(), 0);
  assert.equal(getCachedEarliestSessionStartTime(), undefined);
  assert.equal(getDataTrendSnapshotCacheSizeForTests(), 0);
});

console.log(`Passed ${passed} data read model tests`);
