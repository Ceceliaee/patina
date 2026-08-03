import assert from "node:assert/strict";
import {
  buildDataWebActivityHeatmap,
  buildDataWebTrendViewModel,
  clearDataWebActivitySnapshotCache,
  getCachedDataWebTrendSnapshot,
  getDataWebActivitySnapshotCacheStats,
  loadDataWebActivitySnapshot,
  loadDataWebHeatmapSnapshot,
} from "../src/features/data/services/dataWebActivityReadModel.ts";
import type { DataWebActivitySnapshotDependencies } from "../src/features/data/services/dataWebActivitySnapshotDependencies.ts";
import {
  DATA_DESTINATION_SELECTION_LIMIT,
  buildDataDestinationIconSources,
  buildDataDestinationTrendSeries,
  commitDataDestinationDetailSelection,
  encodeDataDestinationSelectionKey,
  reconcileDataDestinationSelection,
  replaceDataDestinationSelection,
  resolveDataDestinationMode,
  resolveDataWebTrendPresentation,
  toggleDataDestinationSelection,
} from "../src/features/data/services/dataDestinationState.ts";
import {
  getDataDestinationSessionOptions,
  getDataDestinationSessionSelectionRevision,
  getDataDestinationSessionSelectionState,
  rememberDataDestinationSessionOptions,
  rememberDataDestinationSessionSelectionRevision,
  rememberDataDestinationSessionSelectionState,
  resetDataDestinationSessionSelectionStateForTests,
} from "../src/features/data/services/dataDestinationSessionState.ts";
import {
  MAX_WEB_ACTIVITY_DOMAINS_PER_REQUEST,
  loadWebActivityAggregateRange,
  parseWebActivityAggregateRange,
} from "../src/platform/persistence/webActivityAnalysisGateway.ts";
import {
  resolveDataTrendRange,
  type DataTrendRangeSelection,
} from "../src/features/data/services/dataTrendRange.ts";
import {
  createInitialDataWebHeatmapRequestState,
  reduceDataWebHeatmapRequestState,
  resolveDataWebHeatmapRequestState,
} from "../src/features/data/services/dataWebHeatmapRequestState.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  clearDataWebActivitySnapshotCache();
  resetDataDestinationSessionSelectionStateForTests();
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("destination selection follows desktop replace and ctrl-toggle semantics", () => {
  assert.equal(
    DATA_DESTINATION_SELECTION_LIMIT,
    MAX_WEB_ACTIVITY_DOMAINS_PER_REQUEST,
  );
  assert.deepEqual(replaceDataDestinationSelection("a"), {
    keys: ["a"],
    outcome: "replaced",
  });
  assert.deepEqual(toggleDataDestinationSelection(["a"], "b"), {
    keys: ["a", "b"],
    outcome: "added",
  });
  assert.deepEqual(toggleDataDestinationSelection(["a", "b"], "a"), {
    keys: ["b"],
    outcome: "removed",
  });
  assert.deepEqual(toggleDataDestinationSelection(["a"], "a"), {
    keys: ["a"],
    outcome: "last-item",
  });
  assert.deepEqual(toggleDataDestinationSelection(["a", "b", "c", "d", "e", "f", "g"], "h"), {
    keys: ["a", "b", "c", "d", "e", "f", "g"],
    outcome: "limit-reached",
  });
});

await runTest("opening destination details commits the target without disturbing the other mode", () => {
  const snapshot = {
    appKeys: ["chatgpt.exe"],
    webKeys: ["docs.example"],
    mode: "app" as const,
    listScrollTop: 40,
  };

  assert.deepEqual(
    commitDataDestinationDetailSelection(snapshot, "app", "patina.exe"),
    {
      appKeys: ["patina.exe"],
      webKeys: ["docs.example"],
      mode: "app",
      listScrollTop: 40,
    },
  );
  assert.deepEqual(
    commitDataDestinationDetailSelection(snapshot, "web", "patina.example"),
    {
      appKeys: ["chatgpt.exe"],
      webKeys: ["patina.example"],
      mode: "web",
      listScrollTop: 40,
    },
  );
});

await runTest("destination detail theme sources include selected and unselected options", () => {
  const createOption = (key: string, iconUrl: string | null) => ({
    key,
    identityKeys: [key],
    displayName: key,
    secondaryText: key,
    iconUrl,
    totalDuration: 0,
    percentage: 0,
    averageDuration: 0,
    activeDayCount: 0,
  });

  assert.deepEqual(buildDataDestinationIconSources(
    [createOption("chatgpt.exe", "icon-chatgpt"), createOption("patina.exe", "icon-patina")],
    [createOption("docs.example", "icon-docs"), createOption("empty.example", null)],
  ), {
    "app:chatgpt.exe": "icon-chatgpt",
    "app:patina.exe": "icon-patina",
    "web:docs.example": "icon-docs",
  });
});

await runTest("web heatmap request state distinguishes cold and retained refresh failures", () => {
  const cold = reduceDataWebHeatmapRequestState(
    createInitialDataWebHeatmapRequestState<{ value: number }>(),
    { type: "begin", presentationKey: "2026:docs", requestKey: "r1" },
  );
  assert.equal(cold.status, "loading-cold");
  assert.equal(cold.snapshot, null);

  const coldFailed = reduceDataWebHeatmapRequestState(cold, {
    type: "failed",
    presentationKey: "2026:docs",
    requestKey: "r1",
  });
  assert.equal(coldFailed.status, "cold-failed");

  const ready = reduceDataWebHeatmapRequestState(cold, {
    type: "succeeded",
    presentationKey: "2026:docs",
    requestKey: "r1",
    snapshot: { value: 7 },
  });
  const refreshing = reduceDataWebHeatmapRequestState(ready, {
    type: "begin",
    presentationKey: "2026:docs",
    requestKey: "r2",
  });
  assert.equal(refreshing.status, "refreshing");
  assert.deepEqual(refreshing.snapshot, { value: 7 });

  const refreshFailed = reduceDataWebHeatmapRequestState(refreshing, {
    type: "failed",
    presentationKey: "2026:docs",
    requestKey: "r2",
  });
  assert.equal(refreshFailed.status, "refresh-failed-with-retained-data");
  assert.deepEqual(refreshFailed.snapshot, { value: 7 });
  assert.strictEqual(
    resolveDataWebHeatmapRequestState(refreshFailed, "2026:docs", "r2"),
    refreshFailed,
  );
  assert.deepEqual(
    reduceDataWebHeatmapRequestState(refreshFailed, { type: "reset" }),
    createInitialDataWebHeatmapRequestState(),
  );
});

await runTest("web heatmap request state rejects stale responses and abandoned presentations", () => {
  const ready = {
    presentationKey: "2026:docs",
    requestKey: "r1",
    snapshot: { value: 7 },
    status: "ready" as const,
  };
  const abandonedRender = resolveDataWebHeatmapRequestState(
    ready,
    "2025:chat",
    "r2",
  );
  assert.equal(abandonedRender.status, "loading-cold");
  assert.equal(abandonedRender.snapshot, null);
  assert.deepEqual(ready, {
    presentationKey: "2026:docs",
    requestKey: "r1",
    snapshot: { value: 7 },
    status: "ready",
  });

  const current = reduceDataWebHeatmapRequestState(ready, {
    type: "begin",
    presentationKey: "2025:chat",
    requestKey: "r2",
  });
  const afterStaleSuccess = reduceDataWebHeatmapRequestState(current, {
    type: "succeeded",
    presentationKey: "2026:docs",
    requestKey: "r1",
    snapshot: { value: 99 },
  });
  assert.strictEqual(afterStaleSuccess, current);
});

await runTest("destination selection reconciliation preserves order and falls back only when empty", () => {
  assert.deepEqual(
    reconcileDataDestinationSelection(["c", "missing", "a", "c"], ["a", "b", "c"]),
    ["c", "a"],
  );
  assert.deepEqual(reconcileDataDestinationSelection(["missing"], ["b", "a"]), ["b"]);
  assert.deepEqual(reconcileDataDestinationSelection(["missing"], []), []);
  assert.notEqual(
    encodeDataDestinationSelectionKey(["a,b", "c"]),
    encodeDataDestinationSelectionKey(["a", "b,c"]),
  );
});

await runTest("destination session selection stays in memory without exposing mutable arrays", () => {
  rememberDataDestinationSessionSelectionState({
    appKeys: ["cursor.exe", "chrome.exe"],
    webKeys: ["docs.example"],
  });
  const first = getDataDestinationSessionSelectionState();
  first.appKeys.push("mutated.exe");
  assert.deepEqual(getDataDestinationSessionSelectionState(), {
    appKeys: ["cursor.exe", "chrome.exe"],
    webKeys: ["docs.example"],
  });
  rememberDataDestinationSessionSelectionRevision("app", 4);
  assert.equal(getDataDestinationSessionSelectionRevision("app"), 4);
  rememberDataDestinationSessionOptions("app", [{
    key: "cursor.exe",
    identityKeys: ["cursor.exe"],
    displayName: "Cursor",
    secondaryText: "cursor.exe",
    iconUrl: null,
    totalDuration: 10,
    percentage: 100,
    averageDuration: 10,
    activeDayCount: 1,
  }]);
  const options = getDataDestinationSessionOptions("app", ["cursor.exe"]);
  options[0]!.displayName = "mutated";
  assert.equal(
    getDataDestinationSessionOptions("app", ["cursor.exe"])[0]?.displayName,
    "Cursor",
  );
});

await runTest("destination series keep app colors and one stable line style", () => {
  const options = ["a", "b", "c"].map((key) => ({
    key,
    identityKeys: [key],
    displayName: key.toUpperCase(),
    secondaryText: `${key}.exe`,
    iconUrl: null,
    totalDuration: 0,
    percentage: 0,
    averageDuration: 0,
    activeDayCount: 0,
  }));
  const colors: Record<string, string> = {
    a: "#336699",
    b: "#34679a",
    c: "#d97706",
  };
  const series = buildDataDestinationTrendSeries(options, (option) => colors[option.key]);
  assert.deepEqual(series.map(({ key, dataKey, color }) => ({
    key,
    dataKey,
    color,
  })), [
    { key: "a", dataKey: "series0", color: "#336699" },
    { key: "b", dataKey: "series1", color: "#34679a" },
    { key: "c", dataKey: "series2", color: "#d97706" },
  ]);
});

await runTest("five identical colors remain solid without synthetic line styles", () => {
  const options = ["a", "b", "c", "d", "e"].map((key) => ({
    key,
    identityKeys: [key],
    displayName: key,
    secondaryText: key,
    iconUrl: null,
    totalDuration: 0,
    percentage: 0,
    averageDuration: 0,
    activeDayCount: 0,
  }));
  const series = buildDataDestinationTrendSeries(options, () => "#336699");
  assert.equal(series.every((item) => !("strokeDasharray" in item)), true);
});

await runTest("web aggregate gateway accepts only the minimal typed payload", () => {
  const result = parseWebActivityAggregateRange({
    records: [{
      normalizedDomain: "example.com",
      bucketStartMs: 1_000,
      durationMs: 500,
      url: "https://example.com/private",
      title: "private title",
    }],
    domainCoverage: [{
      normalizedDomain: "example.com",
      earliestRecordedStartMs: 500,
    }],
    sourceRevision: "3",
    snapshotNowMs: 2_000,
  });

  assert.deepEqual(result, {
    records: [{
      normalizedDomain: "example.com",
      bucketStartMs: 1_000,
      durationMs: 500,
    }],
    domainCoverage: [{
      normalizedDomain: "example.com",
      earliestRecordedStartMs: 500,
    }],
    sourceRevision: "3",
    snapshotNowMs: 2_000,
  });
  assert.throws(
    () => parseWebActivityAggregateRange({
      records: [{
        normalizedDomain: "example.com",
        bucketStartMs: 1_000,
        durationMs: -1,
      }],
      domainCoverage: [],
      sourceRevision: "3",
      snapshotNowMs: 2_000,
    }),
    /invalid web activity aggregate payload/i,
  );
  assert.throws(
    () => parseWebActivityAggregateRange({
      records: [{
        normalizedDomain: "example.com",
        bucketStartMs: Number.MAX_SAFE_INTEGER + 1,
        durationMs: 1,
      }],
      domainCoverage: [],
      sourceRevision: "3",
      snapshotNowMs: 2_000,
    }),
    /invalid web activity aggregate payload/i,
  );
  assert.throws(
    () => parseWebActivityAggregateRange({
      records: [
        { normalizedDomain: "example.com", bucketStartMs: 1_000, durationMs: 500 },
        { normalizedDomain: "example.com", bucketStartMs: 1_000, durationMs: 250 },
      ],
      domainCoverage: [],
      sourceRevision: "3",
      snapshotNowMs: 2_000,
    }),
    /duplicate web activity aggregate record/i,
  );
  assert.throws(
    () => parseWebActivityAggregateRange({
      records: [],
      domainCoverage: [
        { normalizedDomain: "example.com", earliestRecordedStartMs: 500 },
        { normalizedDomain: "example.com", earliestRecordedStartMs: 250 },
      ],
      sourceRevision: "3",
      snapshotNowMs: 2_000,
    }),
    /duplicate web activity domain coverage/i,
  );
});

await runTest("web aggregate gateway rejects invalid ranges before IPC", async () => {
  await assert.rejects(
    loadWebActivityAggregateRange(-1, 10, [-1, 10]),
    /range is invalid/i,
  );
  await assert.rejects(
    loadWebActivityAggregateRange(0, 10, [0, 10], " "),
    /domain is invalid/i,
  );
  await assert.rejects(
    loadWebActivityAggregateRange(0, 10.5, [0, 10.5]),
    /range is invalid/i,
  );
  await assert.rejects(
    loadWebActivityAggregateRange(0, 10, [0, 10], []),
    /selection is invalid/i,
  );
  await assert.rejects(
    loadWebActivityAggregateRange(
      0,
      10,
      [0, 10],
      ["a.test", "b.test", "c.test", "d.test", "e.test", "f.test", "g.test", "h.test"],
    ),
    /selection is invalid/i,
  );
});

await runTest("web aggregate gateway sends one deduplicated multi-domain request", async () => {
  let receivedFilter: string | string[] | null = null;
  await loadWebActivityAggregateRange(
    0,
    10,
    [0, 10],
    ["docs.example", "chat.example", "docs.example"],
    async (_startMs, _endMs, _boundaries, domainFilter, snapshotNowMs) => {
      receivedFilter = domainFilter;
      return {
        records: [],
        domainCoverage: [],
        sourceRevision: "1",
        snapshotNowMs,
      };
    },
  );
  assert.deepEqual(receivedFilter, ["docs.example", "chat.example"]);
});

await runTest("web aggregate gateway sends all seven selected domains in one request", async () => {
  const domains = [
    "a.test",
    "b.test",
    "c.test",
    "d.test",
    "e.test",
    "f.test",
    "g.test",
  ];
  const receivedFilters: string[][] = [];
  const result = await loadWebActivityAggregateRange(
    0,
    10,
    [0, 10],
    domains,
    async (_startMs, _endMs, _boundaries, domainFilter, snapshotNowMs) => {
      assert.ok(Array.isArray(domainFilter));
      receivedFilters.push(domainFilter);
      return {
        records: domainFilter.map((normalizedDomain) => ({
          normalizedDomain,
          bucketStartMs: 0,
          durationMs: 1_000,
        })),
        domainCoverage: domainFilter.map((normalizedDomain) => ({
          normalizedDomain,
          earliestRecordedStartMs: 0,
        })),
        sourceRevision: "1",
        snapshotNowMs,
      };
    },
  );

  assert.deepEqual(receivedFilters, [domains]);
  assert.deepEqual(
    result.records.map((record) => record.normalizedDomain),
    domains,
  );
  assert.deepEqual(
    result.domainCoverage.map((coverage) => coverage.normalizedDomain),
    domains,
  );
});

await runTest("web aggregate gateway shards more than 400 buckets and merges stable results", async () => {
  const boundaries = Array.from({ length: 403 }, (_, index) => index * 1_000);
  const calls: Array<{ startMs: number; endMs: number; bucketCount: number }> = [];
  const result = await loadWebActivityAggregateRange(
    boundaries[0],
    boundaries.at(-1) ?? 0,
    boundaries,
    null,
    async (startMs, endMs, chunkBoundaries, _domainFilter, snapshotNowMs) => {
      calls.push({
        startMs,
        endMs,
        bucketCount: chunkBoundaries.length - 1,
      });
      return {
        records: [{
          normalizedDomain: endMs === boundaries.at(-1) ? "z.example" : "a.example",
          bucketStartMs: startMs,
          durationMs: 500,
        }],
        domainCoverage: [{
          normalizedDomain: "coverage.example",
          earliestRecordedStartMs: startMs,
        }],
        sourceRevision: "1",
        snapshotNowMs,
      };
    },
  );

  assert.deepEqual(calls, [
    { startMs: 0, endMs: 400_000, bucketCount: 400 },
    { startMs: 400_000, endMs: 402_000, bucketCount: 2 },
  ]);
  assert.deepEqual(result.records.map((record) => record.normalizedDomain), [
    "a.example",
    "z.example",
  ]);
  assert.deepEqual(result.domainCoverage, [{
    normalizedDomain: "coverage.example",
    earliestRecordedStartMs: 0,
  }]);
});

await runTest("web aggregate gateway rejects mismatched snapshot clocks and duration overflow", async () => {
  await assert.rejects(
    loadWebActivityAggregateRange(
      0,
      10,
      [0, 10],
      null,
      async (_startMs, _endMs, _boundaries, _domainFilter, snapshotNowMs) => ({
        records: [],
        domainCoverage: [],
        sourceRevision: "1",
        snapshotNowMs: snapshotNowMs + 1,
      }),
    ),
    /snapshot time did not match/i,
  );

  const boundaries = Array.from({ length: 403 }, (_, index) => index * 1_000);
  await assert.rejects(
    loadWebActivityAggregateRange(
      boundaries[0],
      boundaries.at(-1) ?? 0,
      boundaries,
      null,
      async (_startMs, _endMs, _chunkBoundaries, _domainFilter, snapshotNowMs) => ({
        records: [{
          normalizedDomain: "overflow.example",
          bucketStartMs: 0,
          durationMs: Number.MAX_SAFE_INTEGER,
        }],
        domainCoverage: [],
        sourceRevision: "1",
        snapshotNowMs,
      }),
    ),
    /duration overflowed/i,
  );
});

await runTest("web aggregate gateway retries a sharded read when source revision changes", async () => {
  const boundaries = Array.from({ length: 403 }, (_, index) => index * 1_000);
  const snapshotTimes: number[] = [];
  let calls = 0;
  const result = await loadWebActivityAggregateRange(
    boundaries[0],
    boundaries.at(-1) ?? 0,
    boundaries,
    null,
    async (startMs, _endMs, _chunkBoundaries, _domainFilter, snapshotNowMs) => {
      const attemptIndex = Math.floor(calls / 2);
      const chunkIndex = calls % 2;
      calls += 1;
      snapshotTimes.push(snapshotNowMs);
      return {
        records: [{
          normalizedDomain: `attempt-${attemptIndex}.example`,
          bucketStartMs: startMs,
          durationMs: 1_000,
        }],
        domainCoverage: [],
        sourceRevision: attemptIndex === 0 && chunkIndex === 1 ? "2" : attemptIndex === 0 ? "1" : "3",
        snapshotNowMs,
      };
    },
  );

  assert.equal(calls, 4);
  assert.equal(snapshotTimes[0], snapshotTimes[1]);
  assert.equal(snapshotTimes[2], snapshotTimes[3]);
  assert.equal(result.sourceRevision, "3");
  assert.deepEqual(
    Array.from(new Set(result.records.map((record) => record.normalizedDomain))),
    ["attempt-1.example"],
  );
});

await runTest("web aggregate gateway fails after bounded snapshot retries", async () => {
  const boundaries = Array.from({ length: 403 }, (_, index) => index * 1_000);
  let calls = 0;
  await assert.rejects(
    loadWebActivityAggregateRange(
      boundaries[0],
      boundaries.at(-1) ?? 0,
      boundaries,
      null,
      async (_startMs, _endMs, _chunkBoundaries, _domainFilter, snapshotNowMs) => {
        calls += 1;
        return {
          records: [],
          domainCoverage: [],
          sourceRevision: calls % 2 === 0 ? "2" : "1",
          snapshotNowMs,
        };
      },
    ),
    /changed while reading aggregate chunks/i,
  );
  assert.equal(calls, 4);
});

await runTest("web trend applies aliases and exclusions before percentages", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const range = resolveDataTrendRange({ kind: "rolling", days: 7 }, nowMs);
  const may7 = new Date(2026, 4, 7).getTime();
  const may8 = new Date(2026, 4, 8).getTime();
  const result = buildDataWebTrendViewModel({
    range,
    records: [
      { normalizedDomain: "docs.example", bucketStartMs: may7, durationMs: 60 * 60_000 },
      { normalizedDomain: "docs.example", bucketStartMs: may8, durationMs: 30 * 60_000 },
      { normalizedDomain: "blocked.example", bucketStartMs: may8, durationMs: 4 * 60 * 60_000 },
      { normalizedDomain: "search.example", bucketStartMs: may8, durationMs: 30 * 60_000 },
    ],
    domainCoverage: [
      { normalizedDomain: "docs.example", earliestRecordedStartMs: may7 },
      { normalizedDomain: "blocked.example", earliestRecordedStartMs: may7 },
      { normalizedDomain: "search.example", earliestRecordedStartMs: may7 },
    ],
    overrides: {
      "docs.example": { displayName: "产品文档" },
      "blocked.example": { enabled: false },
    },
    favicons: {
      "docs.example": "data:image/png;base64,docs",
    },
    selectedDomains: [],
  });

  assert.deepEqual(
    result.domainOptions.map((domain) => domain.normalizedDomain),
    ["docs.example", "search.example"],
  );
  assert.equal(result.selectedDomains[0]?.displayName, "产品文档");
  assert.equal(result.selectedDomains[0]?.totalDuration, 90 * 60_000);
  assert.equal(result.selectedDomains[0]?.percentage, 75);
  assert.equal(result.selectedDomains[0]?.activeDayCount, 2);
  assert.equal(result.selectedDomains[0]?.faviconUrl, "data:image/png;base64,docs");
  assert.equal(
    result.chartRows.find((point) => point.date === "2026-05-07")?.totalDuration,
    60 * 60_000,
  );
  assert.equal(
    result.chartRows.find((point) => point.date === "2026-05-08")?.totalDuration,
    30 * 60_000,
  );
});

await runTest("web trend preserves selected order and aggregates multiple domains", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const range = resolveDataTrendRange({ kind: "rolling", days: 7 }, nowMs);
  const may8 = new Date(2026, 4, 8).getTime();
  const result = buildDataWebTrendViewModel({
    range,
    records: [
      { normalizedDomain: "docs.example", bucketStartMs: may8, durationMs: 60 * 60_000 },
      { normalizedDomain: "chat.example", bucketStartMs: may8, durationMs: 30 * 60_000 },
      { normalizedDomain: "other.example", bucketStartMs: may8, durationMs: 10 * 60_000 },
    ],
    domainCoverage: [],
    overrides: {},
    favicons: {},
    selectedDomains: ["chat.example", "docs.example"],
  });

  assert.deepEqual(
    result.selectedDomains.map((domain) => domain.normalizedDomain),
    ["chat.example", "docs.example"],
  );
  assert.deepEqual(
    result.chartSeries.map((series) => [series.key, series.dataKey]),
    [["chat.example", "series0"], ["docs.example", "series1"]],
  );
  const may8Row = result.chartRows.find((row) => row.date === "2026-05-08");
  assert.equal(may8Row?.series0, 0.5);
  assert.equal(may8Row?.series1, 1);
  assert.equal(may8Row?.totalDuration, 90 * 60_000);
  assert.equal(result.summary.totalDuration, 90 * 60_000);
  assert.equal(result.summary.activeDayCount, 1);
});

await runTest("web trend keeps selected domains as zero series across empty ranges", () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const result = buildDataWebTrendViewModel({
    range: resolveDataTrendRange({ kind: "rolling", days: 7 }, nowMs),
    records: [],
    domainCoverage: [],
    overrides: {
      "docs.example": { displayName: "产品文档" },
    },
    favicons: {},
    selectedDomains: ["docs.example"],
  });

  assert.equal(result.selectedDomains[0]?.displayName, "产品文档");
  assert.equal(result.chartSeries[0]?.key, "docs.example");
  assert.ok(result.chartRows.every((row) => row.series0 === 0));
});

await runTest("single-domain web heatmap labels empty days like the app heatmap", () => {
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  const jan2 = new Date(2026, 0, 2).getTime();
  const rows = buildDataWebActivityHeatmap({
    selection: 2026,
    nowMs,
    normalizedDomains: ["example.com"],
    records: [{
      normalizedDomain: "example.com",
      bucketStartMs: jan2,
      durationMs: 60 * 60_000,
    }],
    earliestRecordedStartMs: jan2,
  });
  const cells = rows.flatMap((week) => week.cells);
  const beforeCoverage = cells.find((cell) => cell.date === "2026-01-01");
  const recorded = cells.find((cell) => cell.date === "2026-01-02");
  const noActivity = cells.find((cell) => cell.date === "2026-01-03");

  assert.match(beforeCoverage?.label ?? "", /^2026/);
  assert.match(beforeCoverage?.label ?? "", /0s/);
  assert.match(recorded?.label ?? "", /^2026/);
  assert.match(recorded?.label ?? "", /1h/);
  assert.match(noActivity?.label ?? "", /^2026/);
  assert.match(noActivity?.label ?? "", /0s/);
  assert.equal(beforeCoverage?.availability, "recorded");
  assert.equal(recorded?.availability, "recorded");
  assert.equal(noActivity?.availability, "recorded");
});

await runTest("failed single-domain reads stay unavailable instead of becoming zero activity", () => {
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  const rows = buildDataWebActivityHeatmap({
    selection: 2026,
    nowMs,
    normalizedDomains: ["example.com"],
    records: [],
    earliestRecordedStartMs: new Date(2026, 0, 1).getTime(),
    loadErrorMessage: "网页分析暂时不可用",
  });
  const failedCell = rows.flatMap((week) => week.cells)
    .find((cell) => cell.date === "2026-01-02");

  assert.equal(failedCell?.availability, "unavailable");
  assert.match(failedCell?.label ?? "", /^2026/);
  assert.match(failedCell?.label ?? "", /网页分析暂时不可用/);
  assert.doesNotMatch(failedCell?.label ?? "", /未记录到网页活动/);
});

await runTest("web heatmap aggregates only the selected domain set", () => {
  const nowMs = new Date(2026, 0, 3, 12, 0, 0).getTime();
  const jan2 = new Date(2026, 0, 2).getTime();
  const rows = buildDataWebActivityHeatmap({
    selection: 2026,
    nowMs,
    normalizedDomains: ["docs.example", "chat.example"],
    records: [
      { normalizedDomain: "docs.example", bucketStartMs: jan2, durationMs: 60 * 60_000 },
      { normalizedDomain: "chat.example", bucketStartMs: jan2, durationMs: 30 * 60_000 },
      { normalizedDomain: "other.example", bucketStartMs: jan2, durationMs: 5 * 60 * 60_000 },
    ],
    earliestRecordedStartMs: jan2,
  });
  const recorded = rows.flatMap((week) => week.cells)
    .find((cell) => cell.date === "2026-01-02");
  assert.equal(recorded?.duration, 90 * 60_000);
});

await runTest("multi-domain web heatmap keeps factual activity and app-style empty days", () => {
  const nowMs = new Date(2026, 0, 4, 12, 0, 0).getTime();
  const jan2 = new Date(2026, 0, 2).getTime();
  const jan3 = new Date(2026, 0, 3).getTime();
  const rows = buildDataWebActivityHeatmap({
    selection: 2026,
    nowMs,
    normalizedDomains: ["docs.example", "chat.example"],
    records: [{
      normalizedDomain: "docs.example",
      bucketStartMs: jan2,
      durationMs: 30 * 60_000,
    }],
    earliestRecordedStartMs: jan3,
  });
  const cells = rows.flatMap((week) => week.cells);
  assert.equal(cells.find((cell) => cell.date === "2026-01-02")?.availability, "recorded");
  assert.equal(cells.find((cell) => cell.date === "2026-01-01")?.availability, "recorded");
  assert.match(cells.find((cell) => cell.date === "2026-01-01")?.label ?? "", /0s/);
});

await runTest("web snapshot dedupes matching in-flight loads and excludes disabled domains", async () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  let aggregateLoads = 0;
  let releaseAggregate: (() => void) | null = null;
  let faviconDomains: string[] = [];
  const deps: DataWebActivitySnapshotDependencies = {
    loadAggregateRange: async () => {
      aggregateLoads += 1;
      await new Promise<void>((resolve) => {
        releaseAggregate = resolve;
      });
      return {
      records: [{
        normalizedDomain: "example.com",
        bucketStartMs: new Date(2026, 4, 8).getTime(),
        durationMs: 60 * 60_000,
      }, {
        normalizedDomain: "hidden.example",
        bucketStartMs: new Date(2026, 4, 8).getTime(),
        durationMs: 30 * 60_000,
      }],
        domainCoverage: [{
          normalizedDomain: "example.com",
          earliestRecordedStartMs: new Date(2026, 4, 1).getTime(),
        }],
      };
    },
    loadOverrides: async () => ({
      "hidden.example": { enabled: false },
    }),
    loadFavicons: async (domains) => {
      faviconDomains = domains;
      return { "example.com": "data:image/png;base64,icon" };
    },
  };

  const first = loadDataWebActivitySnapshot({
    selection: { kind: "rolling", days: 7 },
    nowMs,
    normalizedDomains: null,
    deps,
  });
  const second = loadDataWebActivitySnapshot({
    selection: { kind: "rolling", days: 7 },
    nowMs,
    normalizedDomains: null,
    deps,
  });
  releaseAggregate?.();
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(aggregateLoads, 1);
  assert.deepEqual(faviconDomains, ["example.com"]);
  assert.deepEqual(firstResult, secondResult);
  assert.equal(firstResult.favicons["example.com"], "data:image/png;base64,icon");
  assert.deepEqual(getDataWebActivitySnapshotCacheStats(), {
    entries: 1,
    pendingEntries: 0,
    limit: 4,
  });
});

await runTest("web heatmap cache identity includes the data revision", async () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  let aggregateLoads = 0;
  const deps: DataWebActivitySnapshotDependencies = {
    loadAggregateRange: async () => {
      aggregateLoads += 1;
      return { records: [], domainCoverage: [] };
    },
    loadOverrides: async () => ({}),
    loadFavicons: async () => ({}),
  };
  const first = await loadDataWebHeatmapSnapshot({
    selection: 2026,
    normalizedDomains: ["docs.example"],
    nowMs,
    cacheVersion: "revision:1",
    deps,
  });
  const second = await loadDataWebHeatmapSnapshot({
    selection: 2026,
    normalizedDomains: ["docs.example"],
    nowMs,
    cacheVersion: "revision:2",
    deps,
  });

  assert.notEqual(first.cacheKey, second.cacheKey);
  assert.equal(first.cacheVersion, "revision:1");
  assert.equal(second.cacheVersion, "revision:2");
  assert.equal(aggregateLoads, 2);
});

await runTest("cache invalidation prevents a late web snapshot from repopulating cache", async () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  let releaseAggregate: (() => void) | null = null;
  const deps: DataWebActivitySnapshotDependencies = {
    loadAggregateRange: async () => {
      await new Promise<void>((resolve) => {
        releaseAggregate = resolve;
      });
      return { records: [], domainCoverage: [] };
    },
    loadOverrides: async () => ({}),
    loadFavicons: async () => ({}),
  };
  const pending = loadDataWebActivitySnapshot({
    selection: { kind: "rolling", days: 7 },
    nowMs,
    deps,
  });

  clearDataWebActivitySnapshotCache();
  releaseAggregate?.();
  await pending;

  assert.deepEqual(getDataWebActivitySnapshotCacheStats(), {
    entries: 0,
    pendingEntries: 0,
    limit: 4,
  });
});

await runTest("optional web aliases and favicons degrade without losing durations", async () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const deps: DataWebActivitySnapshotDependencies = {
    loadAggregateRange: async () => ({
      records: [{
        normalizedDomain: "example.com",
        bucketStartMs: new Date(2026, 4, 8).getTime(),
        durationMs: 60_000,
      }],
      domainCoverage: [{
        normalizedDomain: "example.com",
        earliestRecordedStartMs: new Date(2026, 4, 1).getTime(),
      }],
    }),
    loadOverrides: async () => {
      throw new Error("optional settings unavailable");
    },
    loadFavicons: async () => {
      throw new Error("optional favicons unavailable");
    },
  };

  const snapshot = await loadDataWebActivitySnapshot({
    selection: { kind: "rolling", days: 7 },
    nowMs,
    deps,
  });

  assert.equal(snapshot.records[0]?.durationMs, 60_000);
  assert.deepEqual(snapshot.overrides, {});
  assert.deepEqual(snapshot.favicons, {});
});

await runTest("web trend presentation keeps loading, refresh, and error ownership keyed", () => {
  const base = {
    webActivityEnabled: true,
    mode: "web" as const,
    requestedCacheKey: "range:a",
    loadingCacheKey: null,
    errorCacheKey: null,
    snapshotCacheKey: null,
    snapshotCacheVersion: null,
    cacheVersion: "version:1",
  };

  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      webActivityEnabled: false,
      loadingCacheKey: "range:a",
    }),
    "hidden",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      mode: "app",
      loadingCacheKey: "range:a",
    }),
    "hidden",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      loadingCacheKey: "range:a",
    }),
    "initial-loading",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      snapshotCacheKey: "range:a",
      snapshotCacheVersion: "version:1",
    }),
    "ready",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      loadingCacheKey: "range:a",
      snapshotCacheKey: "range:a",
      snapshotCacheVersion: "version:1",
    }),
    "refreshing",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      loadingCacheKey: "range:a",
      snapshotCacheKey: "range:b",
      snapshotCacheVersion: "version:1",
    }),
    "refreshing-stale",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      errorCacheKey: "range:a",
    }),
    "blocking-error",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      errorCacheKey: "range:a",
      snapshotCacheKey: "range:b",
      snapshotCacheVersion: "version:1",
    }),
    "refresh-error",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      loadingCacheKey: "range:a",
      errorCacheKey: "range:b",
    }),
    "initial-loading",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      loadingCacheKey: "range:a",
      snapshotCacheKey: "range:a",
      snapshotCacheVersion: "version:0",
    }),
    "refreshing-stale",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      snapshotCacheKey: "range:a",
      snapshotCacheVersion: "version:0",
    }),
    "refreshing-stale",
  );
  assert.deepEqual(
    resolveDataWebTrendPresentation({
      ...base,
      errorCacheKey: "range:a",
      snapshotCacheKey: "range:a",
      snapshotCacheVersion: "version:0",
    }),
    "refresh-error",
  );
});

await runTest("web trend cache peeks synchronously without creating new IO", async () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  let aggregateLoads = 0;
  const deps: DataWebActivitySnapshotDependencies = {
    loadAggregateRange: async (startMs) => {
      aggregateLoads += 1;
      return {
        records: [{
          normalizedDomain: "example.com",
          bucketStartMs: startMs,
          durationMs: 60_000,
        }],
        domainCoverage: [{
          normalizedDomain: "example.com",
          earliestRecordedStartMs: startMs,
        }],
      };
    },
    loadOverrides: async () => ({}),
    loadFavicons: async () => ({}),
  };
  const sevenDays = { kind: "rolling" as const, days: 7 as const };
  const thirtyDays = { kind: "rolling" as const, days: 30 as const };

  assert.equal(getCachedDataWebTrendSnapshot({ selection: sevenDays, nowMs }), null);
  const loaded = await loadDataWebActivitySnapshot({
    selection: sevenDays,
    nowMs,
    deps,
  });
  assert.deepEqual(
    getCachedDataWebTrendSnapshot({ selection: sevenDays, nowMs }),
    loaded,
  );
  assert.equal(
    getCachedDataWebTrendSnapshot({
      selection: sevenDays,
      nowMs,
      cacheVersion: "version:2",
    }),
    null,
  );
  assert.equal(aggregateLoads, 1, "a synchronous cache peek must not issue IO");
  assert.equal(getCachedDataWebTrendSnapshot({ selection: thirtyDays, nowMs }), null);

  clearDataWebActivitySnapshotCache();
  assert.equal(getCachedDataWebTrendSnapshot({ selection: sevenDays, nowMs }), null);
});

await runTest("web snapshot cache keeps the active heatmap and three trend ranges warm", async () => {
  const nowMs = new Date(2026, 4, 8, 12, 0, 0).getTime();
  const deps: DataWebActivitySnapshotDependencies = {
    loadAggregateRange: async () => ({ records: [], domainCoverage: [] }),
    loadOverrides: async () => ({}),
    loadFavicons: async () => ({}),
  };
  const selections: DataTrendRangeSelection[] = [
    { kind: "rolling", days: 7 },
    { kind: "rolling", days: 30 },
    { kind: "rolling", days: 365 },
    { kind: "custom", startDateKey: "2026-04-01", endDateKey: "2026-04-15" },
  ];

  await loadDataWebActivitySnapshot({ selection: selections[0], nowMs, deps });
  await loadDataWebActivitySnapshot({ selection: selections[1], nowMs, deps });
  await loadDataWebActivitySnapshot({ selection: selections[2], nowMs, deps });
  await loadDataWebHeatmapSnapshot({
    selection: "recent",
    normalizedDomains: ["example.com"],
    nowMs,
    deps,
  });
  assert.ok(getCachedDataWebTrendSnapshot({ selection: selections[0], nowMs }));
  await loadDataWebActivitySnapshot({ selection: selections[3], nowMs, deps });

  assert.ok(getCachedDataWebTrendSnapshot({ selection: selections[0], nowMs }));
  assert.equal(getCachedDataWebTrendSnapshot({ selection: selections[1], nowMs }), null);
  assert.ok(getCachedDataWebTrendSnapshot({ selection: selections[2], nowMs }));
  assert.ok(getCachedDataWebTrendSnapshot({ selection: selections[3], nowMs }));
  assert.deepEqual(getDataWebActivitySnapshotCacheStats(), {
    entries: 4,
    pendingEntries: 0,
    limit: 4,
  });
});

await runTest("disabled web sync removes web destination mode", () => {
  assert.equal(resolveDataDestinationMode(false, "web"), "app");
  assert.equal(resolveDataDestinationMode(true, "web"), "web");
});

console.log(`Completed ${passed} data web activity read-model tests`);
