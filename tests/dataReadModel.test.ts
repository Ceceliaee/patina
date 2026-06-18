import assert from "node:assert/strict";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import { mapRawAggregateSessionCandidates } from "../src/platform/persistence/sessionReadRepository.ts";
import {
  buildActivityHeatmap,
  buildDataTrendViewModel,
  buildDataAppTrendViewModel,
  buildYearOptions,
  getDataHeatmapSessionCacheSizeForTests,
  getCachedDataHeatmapSessions,
  getHeatmapRange,
  loadDataHeatmapSnapshot,
  prewarmRecentDataHeatmapCache,
  resetDataReadModelCacheForTests,
  type AggregateSessionRecord,
  type DataHeatmapDependencies,
} from "../src/features/data/services/dataReadModel.ts";
import { clearDataHeavyCaches } from "../src/features/data/services/dataCacheLifecycle.ts";
import {
  prewarmDataFirstScreen,
  resetDataFirstScreenPrewarmForTests,
} from "../src/features/data/services/dataFirstScreenPrewarm.ts";
import {
  clearDataTrendSnapshotCache,
  getDataTrendSnapshotCacheSizeForTests,
  loadDataTrendSnapshot,
  type DataTrendSnapshot,
} from "../src/features/data/services/dataTrendSnapshot.ts";
import {
  loadPersistedDataBootstrapSnapshot,
  resetDataBootstrapSnapshotForTests,
  saveDataBootstrapSnapshot,
  type DataBootstrapSnapshot,
} from "../src/features/data/services/dataBootstrapSnapshot.ts";

let passed = 0;

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

await runTest("activity heatmap labels sub-second durations as zero minutes", () => {
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  const rows = buildActivityHeatmap([
    makeSession({
      startTime: new Date(2026, 0, 2, 9, 0, 0, 0).getTime(),
      endTime: new Date(2026, 0, 2, 9, 0, 0, 999).getTime(),
    }),
  ], 2026, nowMs);

  assert.equal(findCell(rows, "2026-01-01")?.label, "01/01 · 0m");
  assert.equal(findCell(rows, "2026-01-02")?.label, "01/02 · 0m");
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
  const may7 = rows.dayRows.find((row) => row.date === "2026-05-07");

  assert.equal(rows.selectedApp?.appName, "Blender");
  assert.equal(rows.granularity, "day");
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

  assert.equal(rows.granularity, "month");
  assert.equal(rows.selectedApp?.averageDuration, 60 * 60 * 1000);
});

await runTest("aggregate repository mapping keeps a minimal effective time slice", () => {
  const rows = mapRawAggregateSessionCandidates([{
    app_name: "Cursor",
    exe_name: "cursor.exe",
    window_title: "README.md",
    start_time: 10_000,
    effective_end_time: 8_000,
  }]);

  assert.deepEqual(rows, [{
    appName: "Cursor",
    exeName: "cursor.exe",
    startTime: 10_000,
    endTime: 10_000,
  }]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["appName", "endTime", "exeName", "startTime"]);
});

await runTest("aggregate repository mapping filters legacy lifecycle noise using title metadata", () => {
  const rows = mapRawAggregateSessionCandidates([
    {
      app_name: "Alma",
      exe_name: "alma-0.0.750-win-x64.exe",
      window_title: "Alma 安装",
      start_time: 10_000,
      effective_end_time: 20_000,
    },
    {
      app_name: "Alma",
      exe_name: "alma.exe",
      window_title: "Alma",
      start_time: 20_000,
      effective_end_time: 30_000,
    },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].exeName, "alma.exe");
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

  const snapshot = await prewarmDataFirstScreen({
    mappingVersion: 3,
    reason: "foreground-opened",
    uiLanguage: "zh-CN",
    nowMs,
  }, {
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
  assert.equal(savedSnapshot?.overviewTrendViewModel.totalDuration, 60 * 60 * 1000);
  assert.equal(savedSnapshot?.appTrendViewModel.selectedApp?.appName, "Cursor");
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

console.log(`Passed ${passed} data read model tests`);
