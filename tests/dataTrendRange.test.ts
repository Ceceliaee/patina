import assert from "node:assert/strict";
import {
  countInclusiveLocalDays,
  getAdjacentDataTrendRangeSelection,
  resolveDataTrendRange,
  selectDataTrendDraftDate,
  type DataTrendRangeDraft,
} from "../src/features/data/services/dataTrendRange.ts";
import {
  buildMondayFirstCalendarGrid,
  formatLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
} from "../src/shared/lib/localDate.ts";
import {
  clearDataTrendSnapshotCache,
  getCachedDataTrendSnapshot,
  getDataTrendSnapshotCacheSizeForTests,
  loadDataTrendSnapshot,
} from "../src/features/data/services/dataTrendSnapshot.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  clearDataTrendSnapshotCache();
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const nowMs = new Date(2026, 4, 20, 12, 0, 0).getTime();

await runTest("rolling ranges preserve day and recent twelve-month semantics", () => {
  const seven = resolveDataTrendRange({ kind: "rolling", days: 7 }, nowMs);
  const thirty = resolveDataTrendRange({ kind: "rolling", days: 30 }, nowMs);
  const year = resolveDataTrendRange({ kind: "rolling", days: 365 }, nowMs);

  assert.deepEqual([seven.startDateKey, seven.endDateKey, seven.granularity], ["2026-05-14", "2026-05-20", "day"]);
  assert.deepEqual([thirty.startDateKey, thirty.endDateKey, thirty.granularity], ["2026-04-21", "2026-05-20", "day"]);
  assert.deepEqual([year.startDateKey, year.endDateKey, year.granularity], ["2025-06-01", "2026-05-20", "month"]);
});

await runTest("custom selection swaps reverse clicks and permits a short range", () => {
  let draft: DataTrendRangeDraft = { mode: "custom", firstDateKey: null, range: null };
  draft = selectDataTrendDraftDate(draft, "2026-05-08", nowMs);
  draft = selectDataTrendDraftDate(draft, "2026-05-03", nowMs);

  assert.equal(draft.range?.startDateKey, "2026-05-03");
  assert.equal(draft.range?.endDateKey, "2026-05-08");
  assert.equal(draft.range?.label, "6天");
  assert.equal(countInclusiveLocalDays("2026-05-03", "2026-05-08"), 6);
});

await runTest("custom completed selection restarts on the next click", () => {
  let draft: DataTrendRangeDraft = { mode: "custom", firstDateKey: "2026-05-03", range: null };
  draft = selectDataTrendDraftDate(draft, "2026-05-03", nowMs);
  draft = selectDataTrendDraftDate(draft, "2026-05-10", nowMs);

  assert.equal(draft.firstDateKey, "2026-05-10");
  assert.equal(draft.range, null);
});

await runTest("natural week uses Monday through Sunday and ISO cross-year labels", () => {
  const week = resolveDataTrendRange({ kind: "week", anchorDateKey: "2025-12-29" }, nowMs);
  assert.deepEqual([week.startDateKey, week.endDateKey, week.label], ["2025-12-29", "2026-01-04", "第 1 周"]);
});

await runTest("current natural periods truncate at today", () => {
  const week = resolveDataTrendRange({ kind: "week", anchorDateKey: "2026-05-20" }, nowMs);
  const month = resolveDataTrendRange({ kind: "month", anchorDateKey: "2026-05-20" }, nowMs);
  const year = resolveDataTrendRange({ kind: "year", anchorDateKey: "2026-05-20" }, nowMs);

  assert.equal(week.endDateKey, "2026-05-20");
  assert.deepEqual([month.startDateKey, month.endDateKey, month.label], ["2026-05-01", "2026-05-20", "5月"]);
  assert.deepEqual([year.startDateKey, year.endDateKey, year.label, year.granularity], ["2026-01-01", "2026-05-20", "2026年", "month"]);
});

await runTest("rolling range arrows move only between the three preset lengths", () => {
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({ kind: "rolling", days: 7 }, 1, nowMs),
    { kind: "rolling", days: 30 },
  );
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({ kind: "rolling", days: 30 }, -1, nowMs),
    { kind: "rolling", days: 7 },
  );
  assert.equal(
    getAdjacentDataTrendRangeSelection({ kind: "rolling", days: 7 }, -1, nowMs),
    null,
  );
  assert.equal(
    getAdjacentDataTrendRangeSelection({ kind: "rolling", days: 365 }, 1, nowMs),
    null,
  );
});

await runTest("natural period arrows preserve the period and may enter but not pass the current period", () => {
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({ kind: "week", anchorDateKey: "2026-05-13" }, 1, nowMs),
    { kind: "week", anchorDateKey: "2026-05-18" },
  );
  assert.equal(
    getAdjacentDataTrendRangeSelection({ kind: "week", anchorDateKey: "2026-05-20" }, 1, nowMs),
    null,
  );
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({ kind: "month", anchorDateKey: "2026-04-12" }, 1, nowMs),
    { kind: "month", anchorDateKey: "2026-05-01" },
  );
  assert.equal(
    getAdjacentDataTrendRangeSelection({ kind: "month", anchorDateKey: "2026-05-20" }, 1, nowMs),
    null,
  );
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({ kind: "year", anchorDateKey: "2025-08-12" }, 1, nowMs),
    { kind: "year", anchorDateKey: "2026-01-01" },
  );
  assert.equal(
    getAdjacentDataTrendRangeSelection({ kind: "year", anchorDateKey: "2026-05-20" }, 1, nowMs),
    null,
  );
});

await runTest("ISO week labels and adjacent navigation stay correct across week and year boundaries", () => {
  const weekNineteen = { kind: "week", anchorDateKey: "2026-05-04" } as const;
  const previous = getAdjacentDataTrendRangeSelection(weekNineteen, -1, nowMs);
  const next = getAdjacentDataTrendRangeSelection(weekNineteen, 1, nowMs);

  assert.equal(resolveDataTrendRange(weekNineteen, nowMs).label, "第 19 周");
  assert.equal(previous && resolveDataTrendRange(previous, nowMs).label, "第 18 周");
  assert.equal(next && resolveDataTrendRange(next, nowMs).label, "第 20 周");
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({ kind: "week", anchorDateKey: "2026-01-01" }, -1, nowMs),
    { kind: "week", anchorDateKey: "2025-12-22" },
  );
});

await runTest("month and year navigation uses calendar boundaries through short months and leap years", () => {
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({ kind: "month", anchorDateKey: "2026-01-31" }, -1, nowMs),
    { kind: "month", anchorDateKey: "2025-12-01" },
  );
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({ kind: "month", anchorDateKey: "2025-12-31" }, 1, nowMs),
    { kind: "month", anchorDateKey: "2026-01-01" },
  );
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({ kind: "year", anchorDateKey: "2024-02-29" }, 1, nowMs),
    { kind: "year", anchorDateKey: "2025-01-01" },
  );
});

await runTest("custom range arrows shift the complete inclusive span without entering the future", () => {
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({
      kind: "custom",
      startDateKey: "2026-05-01",
      endDateKey: "2026-05-07",
    }, 1, nowMs),
    {
      kind: "custom",
      startDateKey: "2026-05-08",
      endDateKey: "2026-05-14",
    },
  );
  assert.deepEqual(
    getAdjacentDataTrendRangeSelection({
      kind: "custom",
      startDateKey: "2026-05-07",
      endDateKey: "2026-05-01",
    }, -1, nowMs),
    {
      kind: "custom",
      startDateKey: "2026-04-24",
      endDateKey: "2026-04-30",
    },
  );
  assert.equal(
    getAdjacentDataTrendRangeSelection({
      kind: "custom",
      startDateKey: "2026-05-14",
      endDateKey: "2026-05-20",
    }, 1, nowMs),
    null,
  );
  const seventeenDays = getAdjacentDataTrendRangeSelection({
    kind: "custom",
    startDateKey: "2026-04-01",
    endDateKey: "2026-04-17",
  }, 1, nowMs);
  assert.deepEqual(seventeenDays, {
    kind: "custom",
    startDateKey: "2026-04-18",
    endDateKey: "2026-05-04",
  });
  assert.equal(
    seventeenDays && resolveDataTrendRange(seventeenDays, nowMs).dayCount,
    17,
  );
});

await runTest("custom granularity changes after sixty-two days", () => {
  const sixtyTwo = resolveDataTrendRange({ kind: "custom", startDateKey: "2026-03-20", endDateKey: "2026-05-20" }, nowMs);
  const sixtyThree = resolveDataTrendRange({ kind: "custom", startDateKey: "2026-03-19", endDateKey: "2026-05-20" }, nowMs);
  assert.equal(sixtyTwo.dayCount, 62);
  assert.equal(sixtyTwo.granularity, "day");
  assert.equal(sixtyThree.dayCount, 63);
  assert.equal(sixtyThree.granularity, "month");
});

await runTest("shared local date helpers reject invalid keys and preserve local dates", () => {
  const leapDay = parseLocalDateKey("2024-02-29");
  assert.ok(leapDay);
  assert.equal(formatLocalDateKey(leapDay), "2024-02-29");
  assert.equal(parseLocalDateKey("2023-02-29"), null);
  assert.equal(parseLocalDateKey("2026-13-01"), null);
  assert.equal(formatLocalDateKey(startOfLocalDay(new Date(2026, 4, 20, 23, 59))), "2026-05-20");
});

await runTest("shared local calendar grid is Monday first and stable at forty two days", () => {
  const grid = buildMondayFirstCalendarGrid(new Date(2026, 4, 1));

  assert.equal(grid.length, 42);
  assert.equal(formatLocalDateKey(grid[0]), "2026-04-27");
  assert.equal(grid[0].getDay(), 1);
  assert.equal(formatLocalDateKey(grid[41]), "2026-06-07");
});

await runTest("trend snapshots dedupe matching in-flight range loads and cache the result", async () => {
  let loadCount = 0;
  const deps = {
    getSessionSummariesInRange: async () => {
      loadCount += 1;
      await Promise.resolve();
      return [];
    },
  };
  const selection = { kind: "custom", startDateKey: "2026-05-01", endDateKey: "2026-05-20" } as const;
  const [first, second] = await Promise.all([
    loadDataTrendSnapshot(selection, nowMs, deps),
    loadDataTrendSnapshot(selection, nowMs, deps),
  ]);

  assert.equal(first.sessions, second.sessions);
  assert.equal(loadCount, 1);
  assert.equal(getCachedDataTrendSnapshot(first.range)?.sessions, first.sessions);
});

await runTest("trend snapshot cache keeps a small LRU set", async () => {
  const deps = {
    getSessionSummariesInRange: async () => [],
  };

  for (let day = 1; day <= 3; day += 1) {
    await loadDataTrendSnapshot({
      kind: "custom",
      startDateKey: `2026-05-0${day}`,
      endDateKey: `2026-05-1${day}`,
    }, nowMs, deps);
  }

  assert.equal(getDataTrendSnapshotCacheSizeForTests(), 2);
});

console.log(`Passed ${passed} data trend range tests`);
