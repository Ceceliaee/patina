import assert from "node:assert/strict";
import { buildDataWebTrendViewModel, clearWebTrendViewModelCache } from "../src/features/data/services/dataWebTrendReadModel.ts";
import type { WebActivitySegment } from "../src/shared/types/webActivity.ts";
import type { ResolvedDataTrendRange } from "../src/features/data/services/dataTrendRange.ts";
import { startOfLocalDay } from "../src/shared/lib/localDate.ts";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  clearWebTrendViewModelCache();
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const nowMs = new Date(2026, 4, 15, 12, 0, 0).getTime();
const todayMs = startOfLocalDay(new Date(2026, 4, 15)).getTime();

function makeSegment(overrides: Partial<WebActivitySegment>): WebActivitySegment {
  return {
    id: 1,
    browserClientId: "test-client",
    browserKind: "chrome",
    browserExeName: "chrome.exe",
    domain: "example.com",
    normalizedDomain: "example.com",
    url: null,
    title: null,
    faviconUrl: null,
    startTime: todayMs + 3600000,
    endTime: todayMs + 7200000,
    duration: 3600000,
    ...overrides,
  };
}

const dayRange: ResolvedDataTrendRange = {
  selection: { kind: "rolling", days: 7 },
  startDateKey: "2026-05-09",
  endDateKey: "2026-05-15",
  startMs: new Date(2026, 4, 9).getTime(),
  endMs: new Date(2026, 4, 15, 23, 59, 59, 999).getTime(),
  dayCount: 7,
  label: "Past 7 days",
  granularity: "day",
  cacheKey: "rolling:7:2026-05-09:2026-05-15",
};

await runTest("buildDataWebTrendViewModel returns empty domain options for empty segments", () => {
  const result = buildDataWebTrendViewModel([], dayRange, nowMs, null);
  assert.equal(result.domainOptions.length, 0);
  assert.equal(result.selectedDomain, null);
  assert.equal(result.chartData.length, 7);
  assert.equal(result.dayRows.length, 7);
  assert.equal(result.peakDay, null);
});

await runTest("buildDataWebTrendViewModel aggregates single segment correctly", () => {
  const seg = makeSegment({
    startTime: new Date(2026, 4, 10, 10, 0, 0).getTime(),
    endTime: new Date(2026, 4, 10, 11, 0, 0).getTime(),
  });
  const result = buildDataWebTrendViewModel([seg], dayRange, nowMs, null);
  assert.equal(result.domainOptions.length, 1);
  assert.equal(result.domainOptions[0].domain, "example.com");
  assert.equal(result.domainOptions[0].totalDuration, 3600000);
  assert.equal(result.selectedDomain?.domainKey, "example.com");
  const dataPoint = result.chartData.find((p) => p.date === "2026-05-10");
  assert.ok(dataPoint);
  assert.equal(dataPoint?.duration, 3600000);
});

await runTest("buildDataWebTrendViewModel selects specified domain key", () => {
  const segA = makeSegment({ normalizedDomain: "alpha.com", domain: "alpha.com" });
  const segB = makeSegment({ normalizedDomain: "beta.com", domain: "beta.com" });
  const result = buildDataWebTrendViewModel([segA, segB], dayRange, nowMs, "beta.com");
  assert.equal(result.selectedDomain?.domainKey, "beta.com");
});

console.log(`\n${passed} passed`);
