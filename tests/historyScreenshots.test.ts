import assert from "node:assert/strict";
import {
  findClosestScreenshotIndex,
  getAppScreenshots,
  getContextScreenshots,
  sliceContextScreenshots,
  groupScreenshotsByApp,
} from "../src/features/history/services/historyScreenshots.ts";
import type { ScreenshotEntry } from "../src/features/history/services/historyScreenshots.ts";
import type {
  HistoryAppTimelineAppItem,
  HistoryAppTimelineSegment,
} from "../src/features/history/services/historyAppTimelineViewModel";

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function makeScreenshot(id: number, capturedAt: number, thumbnailBase64 = "dummy"): ScreenshotEntry {
  return {
    id,
    capturedAt,
    sessionId: 1,
    width: 1920,
    height: 1080,
    thumbnailBase64,
  };
}

function makeAppItem(
  exeName: string,
  segments: HistoryAppTimelineSegment[],
): HistoryAppTimelineAppItem {
  const totalDuration = segments.reduce((sum, s) => sum + s.duration, 0);
  return {
    exeName,
    appName: exeName.replace(".exe", ""),
    category: "other",
    categoryLabel: "Other",
    totalDuration,
    percentage: 0,
    color: "#888",
    segments,
  };
}

let segmentId = 0;
function makeSegment(startTime: number, duration: number): HistoryAppTimelineSegment {
  segmentId += 1;
  return {
    id: String(segmentId),
    sourceSessionId: segmentId,
    startTime,
    endTime: startTime + duration,
    duration,
    startRatio: 0,
    widthRatio: 0,
    displayTitle: "",
    titleSamples: [],
  };
}

const BASE = new Date(2026, 0, 2, 9, 0, 0).getTime();

await runTest("findClosestScreenshotIndex returns -1 for empty array", () => {
  assert.equal(findClosestScreenshotIndex([], BASE), -1);
});

await runTest("findClosestScreenshotIndex finds exact match", () => {
  const shots = [
    makeScreenshot(1, BASE),
    makeScreenshot(2, BASE + 60_000),
    makeScreenshot(3, BASE + 120_000),
  ];
  assert.equal(findClosestScreenshotIndex(shots, BASE + 60_000), 1);
});

await runTest("findClosestScreenshotIndex finds closest before target", () => {
  const shots = [
    makeScreenshot(1, BASE),
    makeScreenshot(2, BASE + 60_000),
  ];
  assert.equal(findClosestScreenshotIndex(shots, BASE + 40_000), 1);
});

await runTest("findClosestScreenshotIndex finds closest after target", () => {
  const shots = [
    makeScreenshot(1, BASE),
    makeScreenshot(2, BASE + 60_000),
  ];
  assert.equal(findClosestScreenshotIndex(shots, BASE + 20_000), 0);
});

await runTest("findClosestScreenshotIndex returns first for earlier than all", () => {
  const shots = [
    makeScreenshot(1, BASE + 60_000),
    makeScreenshot(2, BASE + 120_000),
  ];
  assert.equal(findClosestScreenshotIndex(shots, BASE), 0);
});

await runTest("findClosestScreenshotIndex returns last for later than all", () => {
  const shots = [
    makeScreenshot(1, BASE),
    makeScreenshot(2, BASE + 60_000),
  ];
  assert.equal(findClosestScreenshotIndex(shots, BASE + 120_000), 1);
});

await runTest("getAppScreenshots returns empty for no screenshots", () => {
  const app = makeAppItem("test.exe", [makeSegment(BASE, 60_000)]);
  assert.deepEqual(getAppScreenshots(app, []), []);
});

await runTest("getAppScreenshots matches screenshots within segment", () => {
  const app = makeAppItem("test.exe", [makeSegment(BASE, 60_000)]);
  const shots = [
    makeScreenshot(1, BASE + 10_000),
    makeScreenshot(2, BASE + 30_000),
    makeScreenshot(3, BASE + 90_000),
  ];
  const result = getAppScreenshots(app, shots);
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 1);
  assert.equal(result[1].id, 2);
});

await runTest("getAppScreenshots includes boundary screenshots", () => {
  const app = makeAppItem("test.exe", [makeSegment(BASE, 60_000)]);
  const shots = [
    makeScreenshot(1, BASE),
    makeScreenshot(2, BASE + 60_000),
  ];
  const result = getAppScreenshots(app, shots);
  assert.equal(result.length, 2);
});

await runTest("getAppScreenshots deduplicates across segments", () => {
  const app = makeAppItem("test.exe", [
    makeSegment(BASE, 30_000),
    makeSegment(BASE + 20_000, 30_000),
  ]);
  const shots = [makeScreenshot(1, BASE + 25_000)];
  const result = getAppScreenshots(app, shots);
  assert.equal(result.length, 1);
});

await runTest("getAppScreenshots returns sorted by time", () => {
  const app = makeAppItem("test.exe", [makeSegment(BASE, 120_000)]);
  const shots = [
    makeScreenshot(1, BASE + 90_000),
    makeScreenshot(2, BASE + 30_000),
    makeScreenshot(3, BASE + 60_000),
  ];
  const result = getAppScreenshots(app, shots);
  assert.equal(result.length, 3);
  assert.equal(result[0].id, 2);
  assert.equal(result[1].id, 3);
  assert.equal(result[2].id, 1);
});

await runTest("sliceContextScreenshots returns empty for empty array", () => {
  assert.deepEqual(sliceContextScreenshots([], null), []);
});

await runTest("sliceContextScreenshots returns first 5 when no selected time", () => {
  const shots = Array.from({ length: 10 }, (_, i) => makeScreenshot(i + 1, BASE + i * 60_000));
  const result = sliceContextScreenshots(shots, null);
  assert.equal(result.length, 5);
  assert.equal(result[0].id, 1);
  assert.equal(result[4].id, 5);
});

await runTest("sliceContextScreenshots returns at most 5 when fewer exist", () => {
  const shots = Array.from({ length: 3 }, (_, i) => makeScreenshot(i + 1, BASE + i * 60_000));
  const result = sliceContextScreenshots(shots, BASE);
  assert.equal(result.length, 3);
});

await runTest("sliceContextScreenshots centers on selected time", () => {
  const shots = Array.from({ length: 10 }, (_, i) => makeScreenshot(i + 1, BASE + i * 60_000));
  const result = sliceContextScreenshots(shots, BASE + 5 * 60_000);
  assert.equal(result.length, 5);
  assert.equal(result[0].id, 4);
  assert.equal(result[2].id, 6);
  assert.equal(result[4].id, 8);
});

await runTest("sliceContextScreenshots clamps to start when target near beginning", () => {
  const shots = Array.from({ length: 10 }, (_, i) => makeScreenshot(i + 1, BASE + i * 60_000));
  const result = sliceContextScreenshots(shots, BASE + 1_000);
  assert.equal(result.length, 5);
  assert.equal(result[0].id, 1);
  assert.equal(result[4].id, 5);
});

await runTest("sliceContextScreenshots clamps to end when target near end", () => {
  const shots = Array.from({ length: 10 }, (_, i) => makeScreenshot(i + 1, BASE + i * 60_000));
  const result = sliceContextScreenshots(shots, BASE + 9 * 60_000);
  assert.equal(result.length, 3);
  assert.equal(result[0].id, 8);
  assert.equal(result[2].id, 10);
});

await runTest("getContextScreenshots produces same result as sliceContextScreenshots", () => {
  const app = makeAppItem("test.exe", [makeSegment(BASE, 600_000)]);
  const shots = Array.from({ length: 10 }, (_, i) => makeScreenshot(i + 1, BASE + i * 60_000));
  const selectedTime = BASE + 5 * 60_000;
  const fromGet = getContextScreenshots(app, shots, selectedTime);
  const appShots = getAppScreenshots(app, shots);
  const fromSlice = sliceContextScreenshots(appShots, selectedTime);
  assert.deepEqual(fromGet.map((s) => s.id), fromSlice.map((s) => s.id));
});

await runTest("groupScreenshotsByApp groups correctly per app", () => {
  const app1 = makeAppItem("a.exe", [makeSegment(BASE, 60_000)]);
  const app2 = makeAppItem("b.exe", [makeSegment(BASE + 120_000, 60_000)]);
  const shots = [
    makeScreenshot(1, BASE + 10_000),
    makeScreenshot(2, BASE + 150_000),
    makeScreenshot(3, BASE + 30_000),
    makeScreenshot(4, BASE + 170_000),
  ];
  const grouped = groupScreenshotsByApp([app1, app2], shots);
  assert.equal(grouped["a.exe"].length, 2);
  assert.equal(grouped["b.exe"].length, 2);
  assert.equal(grouped["a.exe"][0].id, 1);
  assert.equal(grouped["a.exe"][1].id, 3);
  assert.equal(grouped["b.exe"][0].id, 2);
  assert.equal(grouped["b.exe"][1].id, 4);
});

await runTest("groupScreenshotsByApp returns empty array for apps with no screenshots", () => {
  const app1 = makeAppItem("a.exe", [makeSegment(BASE, 60_000)]);
  const app2 = makeAppItem("b.exe", [makeSegment(BASE + 120_000, 60_000)]);
  const shots = [makeScreenshot(1, BASE + 10_000)];
  const grouped = groupScreenshotsByApp([app1, app2], shots);
  assert.equal(grouped["a.exe"].length, 1);
  assert.equal(grouped["b.exe"].length, 0);
});

console.log(`Passed ${passed} screenshot service tests`);
