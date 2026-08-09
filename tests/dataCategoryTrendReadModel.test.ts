import assert from "node:assert/strict";
import {
  buildDataCategoryTrendViewModelFromAggregate,
  filterDataCategoryOptionsForQuery,
  resolveDataCategorySourceAppKeys,
} from "../src/features/data/services/dataCategoryTrendReadModel.ts";
import {
  buildDataTrendAggregateContext,
  type AggregateSessionRecord,
} from "../src/features/data/services/dataReadModel.ts";
import { resolveDataTrendRange } from "../src/features/data/services/dataTrendRange.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import { getLocaleText } from "../src/shared/i18n/runtime.ts";

const ZH_TEXT = getLocaleText("zh-CN");
const HOUR = 3_600_000;
let passed = 0;

function makeSession(
  exeName: string,
  appName: string,
  startTime: number,
  duration: number,
): AggregateSessionRecord {
  return {
    exeName,
    appName,
    startTime,
    endTime: startTime + duration,
  };
}

function createContext(
  sessions: AggregateSessionRecord[],
  selection: Parameters<typeof buildDataTrendAggregateContext>[1],
  nowMs: number,
) {
  return buildDataTrendAggregateContext(
    sessions,
    selection,
    nowMs,
    ZH_TEXT,
    "zh-CN",
  );
}

async function runTest(name: string, fn: () => void | Promise<void>) {
  ProcessMapper.clearUserOverrides();
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } finally {
    ProcessMapper.clearUserOverrides();
  }
}

await runTest("category trend groups applications and conserves total, daily, and monthly durations", () => {
  ProcessMapper.setUserOverrides({
    "alpha.exe": { category: "development" },
    "beta.exe": { category: "development" },
    "gamma.exe": { category: "communication" },
  });
  const nowMs = new Date(2026, 4, 8, 18, 0, 0).getTime();
  const sessions = [
    makeSession("alpha.exe", "Alpha", new Date(2026, 4, 6, 9).getTime(), HOUR),
    makeSession("alpha.exe", "Alpha", new Date(2026, 4, 7, 9).getTime(), HOUR),
    makeSession("beta.exe", "Beta", new Date(2026, 4, 7, 11).getTime(), 2 * HOUR),
    makeSession("gamma.exe", "Gamma", new Date(2026, 4, 8, 9).getTime(), HOUR / 2),
  ];
  const context = createContext(sessions, 7, nowMs);
  const viewModel = buildDataCategoryTrendViewModelFromAggregate(
    context,
    ["development"],
  );
  const development = viewModel.categoryOptions.find(
    (option) => option.category === "development",
  );

  assert.ok(development);
  assert.equal(development.appCount, 2);
  assert.equal(development.totalDuration, 4 * HOUR);
  assert.equal(viewModel.summary.totalDuration, 4 * HOUR);
  assert.equal(viewModel.summary.activeDayCount, 2);
  assert.equal(viewModel.peakDay?.duration, 3 * HOUR);
  assert.deepEqual(
    new Set(viewModel.selectedSourceAppKeys),
    new Set(["alpha.exe", "beta.exe"]),
  );
  assert.equal(
    viewModel.categoryOptions.reduce((sum, option) => sum + option.totalDuration, 0),
    context.aggregate.totalDuration,
  );
  assert.equal(
    viewModel.chartRows.reduce((sum, row) => sum + row.totalDuration, 0),
    development.totalDuration,
  );
});

await runTest("category trend computes multi-selection metrics from the combined day series", () => {
  ProcessMapper.setUserOverrides({
    "alpha.exe": { category: "development" },
    "beta.exe": { category: "communication" },
  });
  const nowMs = new Date(2026, 4, 8, 18, 0, 0).getTime();
  const sessions = [
    makeSession("alpha.exe", "Alpha", new Date(2026, 4, 6, 9).getTime(), HOUR),
    makeSession("beta.exe", "Beta", new Date(2026, 4, 6, 11).getTime(), 2 * HOUR),
    makeSession("beta.exe", "Beta", new Date(2026, 4, 8, 9).getTime(), HOUR),
  ];
  const viewModel = buildDataCategoryTrendViewModelFromAggregate(
    createContext(sessions, 7, nowMs),
    ["development", "communication"],
  );

  assert.equal(viewModel.summary.totalDuration, 4 * HOUR);
  assert.equal(viewModel.summary.activeDayCount, 2);
  assert.equal(viewModel.peakDay?.date, "2026-05-06");
  assert.equal(viewModel.peakDay?.duration, 3 * HOUR);
  assert.equal(viewModel.chartSeries.length, 2);
});

await runTest("category search filters visible options without changing statistics", () => {
  ProcessMapper.setUserOverrides({
    "alpha.exe": { category: "development" },
    "beta.exe": { category: "communication" },
  });
  const nowMs = new Date(2026, 4, 8, 18, 0, 0).getTime();
  const viewModel = buildDataCategoryTrendViewModelFromAggregate(
    createContext([
      makeSession("alpha.exe", "Alpha", new Date(2026, 4, 7, 9).getTime(), HOUR),
      makeSession("beta.exe", "Beta", new Date(2026, 4, 8, 9).getTime(), 2 * HOUR),
    ], 7, nowMs),
    ["development"],
  );

  const totalBeforeSearch = viewModel.categoryOptions.reduce(
    (sum, option) => sum + option.totalDuration,
    0,
  );
  const filtered = filterDataCategoryOptionsForQuery(
    viewModel.categoryOptions,
    ZH_TEXT.categories.short.development,
  );
  assert.deepEqual(filtered.map((option) => option.category), ["development"]);
  assert.equal(
    viewModel.categoryOptions.reduce((sum, option) => sum + option.totalDuration, 0),
    totalBeforeSearch,
  );
});

await runTest("all-time category trend follows the selected categories' widest member-app bounds", () => {
  ProcessMapper.setUserOverrides({
    "archive.exe": { category: "office" },
    "alpha.exe": { category: "development" },
    "beta.exe": { category: "development" },
    "gamma.exe": { category: "communication" },
  });
  const nowMs = new Date(2026, 7, 9, 12, 0, 0).getTime();
  const range = resolveDataTrendRange({
    kind: "all",
    startDateKey: "2026-01-05",
    endDateKey: "2026-08-09",
  }, nowMs, ZH_TEXT);
  const sessions = [
    makeSession("archive.exe", "Archive", new Date(2026, 0, 5, 9).getTime(), HOUR),
    makeSession("alpha.exe", "Alpha", new Date(2026, 3, 10, 9).getTime(), HOUR),
    makeSession("beta.exe", "Beta", new Date(2026, 5, 3, 9).getTime(), HOUR),
    makeSession("gamma.exe", "Gamma", new Date(2026, 7, 2, 9).getTime(), 2 * HOUR),
  ];
  const context = createContext(sessions, range, nowMs);

  const development = buildDataCategoryTrendViewModelFromAggregate(
    context,
    ["development"],
  );
  assert.deepEqual(
    [development.range.startDateKey, development.range.endDateKey],
    ["2026-04-01", "2026-06-30"],
  );

  const multi = buildDataCategoryTrendViewModelFromAggregate(
    context,
    ["development", "communication"],
  );
  assert.deepEqual(
    [multi.range.startDateKey, multi.range.endDateKey],
    ["2026-04-01", "2026-08-09"],
  );
});

await runTest("category heatmap membership uses the widest selected category set without duplicates", () => {
  ProcessMapper.setUserOverrides({
    "alpha.exe": { category: "development" },
    "beta.exe": { category: "communication" },
  });
  const sessions = [
    makeSession("alpha.exe", "Alpha", new Date(2026, 4, 6, 9).getTime(), HOUR),
    makeSession("alpha.exe", "Alpha", new Date(2026, 4, 7, 9).getTime(), HOUR),
    makeSession("beta.exe", "Beta", new Date(2026, 4, 8, 9).getTime(), HOUR),
  ];

  assert.deepEqual(
    new Set(resolveDataCategorySourceAppKeys(
      sessions,
      ["development", "communication"],
    )),
    new Set(["alpha.exe", "beta.exe"]),
  );
  assert.deepEqual(
    resolveDataCategorySourceAppKeys(sessions, ["development"]),
    ["alpha.exe"],
  );
});

await runTest("category trend keeps unclassified applications in the other bucket", () => {
  const nowMs = new Date(2026, 4, 8, 18, 0, 0).getTime();
  const context = createContext([
    makeSession("unmapped.exe", "Unmapped", new Date(2026, 4, 8, 9).getTime(), HOUR),
  ], 7, nowMs);
  const viewModel = buildDataCategoryTrendViewModelFromAggregate(context, ["other"]);

  assert.equal(viewModel.categoryOptions.length, 1);
  assert.equal(viewModel.categoryOptions[0]?.category, "other");
  assert.equal(viewModel.categoryOptions[0]?.totalDuration, HOUR);
  assert.equal(viewModel.summary.totalDuration, HOUR);
});

await runTest("category trend keeps a valid selected category as a zero series in an empty range", () => {
  const nowMs = new Date(2026, 4, 8, 18, 0, 0).getTime();
  const viewModel = buildDataCategoryTrendViewModelFromAggregate(
    createContext([], 7, nowMs),
    ["development"],
  );

  assert.equal(viewModel.categoryOptions.length, 0);
  assert.equal(viewModel.selectedCategories[0]?.category, "development");
  assert.equal(viewModel.selectedCategories[0]?.totalDuration, 0);
  assert.equal(viewModel.chartSeries.length, 1);
  assert.equal(viewModel.summary.totalDuration, 0);
});

console.log(`Passed ${passed} data category trend read-model tests`);
