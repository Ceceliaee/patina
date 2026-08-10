import assert from "node:assert/strict";
import type {
  DestinationDetailDayViewModel,
  DestinationDetailRecord,
} from "../src/features/destination/services/destinationDetailReadModel.ts";
import {
  buildDestinationDetailTimelineAxisTicks,
  buildDestinationDetailTimelineSegments,
  clipDestinationDetailActivitiesToViewport,
  DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS,
  getDestinationDetailTimelineWheelZoomHours,
  getInitialDestinationDetailTimelineViewport,
  normalizeDestinationDetailTimelineViewport,
  panDestinationDetailTimelineViewportByPixels,
  resizeDestinationDetailTimelineViewport,
  zoomDestinationDetailTimelineViewportAroundAnchor,
} from "../src/features/destination/services/destinationDetailTimelineViewport.ts";
import {
  readDetailMinSecs,
  readDestinationDetailTimelineZoomHours,
  rememberDestinationDetailTimelineZoomHours,
  saveDetailMinSecs,
} from "../src/features/destination/services/destinationDetailPreferenceStorage.ts";
import { MemoryStorage, withWindowValue } from "./helpers/browserTestGlobals.ts";

let passed = 0;

function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function at(hour: number, minute = 0, second = 0) {
  return new Date(2026, 6, 31, hour, minute, second).getTime();
}

function makeRecord(
  id: string,
  startTime: number,
  endTime: number,
): DestinationDetailRecord {
  return {
    id,
    activityId: "activity",
    startTime,
    endTime,
    duration: endTime - startTime,
    startRatio: (startTime - at(0)) / (24 * 3_600_000),
    endRatio: (endTime - at(0)) / (24 * 3_600_000),
    title: id,
    secondaryText: null,
    url: null,
    current: false,
  };
}

function makeDay(): DestinationDetailDayViewModel {
  const records = [
    makeRecord("first", at(9), at(10)),
    makeRecord("second", at(11), at(12)),
  ];
  return {
    dateKey: "2026-07-31",
    dayStartMs: at(0),
    dayEndMs: at(0) + 24 * 3_600_000,
    records,
    activities: records.map((record) => ({
      id: record.id,
      startTime: record.startTime,
      endTime: record.endTime,
      duration: record.duration,
      current: false,
      records: [record],
    })),
    totalDuration: 2 * 3_600_000,
    firstStartTime: at(9),
    lastEndTime: at(12),
  };
}

runTest("detail timeline opens the full 24-hour day by default", () => {
  const viewport = getInitialDestinationDetailTimelineViewport(
    makeDay(),
    at(13, 37),
  );
  assert.equal(DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS, 24);
  assert.equal(viewport.durationMs, 24 * 3_600_000);
  assert.equal(viewport.startMs, at(0));
  assert.equal(viewport.endMs, makeDay().dayEndMs);
});

runTest("detail timeline maps the reference clock time onto a historical day", () => {
  const viewport = getInitialDestinationDetailTimelineViewport(
    makeDay(),
    new Date(2026, 7, 8, 13, 37).getTime(),
    4,
  );
  assert.equal(viewport.startMs, at(11, 30));
  assert.equal(viewport.endMs, at(15, 30));
});

runTest("detail timeline clamps current-time focus at the beginning and end of day", () => {
  const day = makeDay();
  const earlyViewport = getInitialDestinationDetailTimelineViewport(
    day,
    at(0, 10),
    4,
  );
  assert.equal(earlyViewport.startMs, at(0));
  assert.equal(earlyViewport.endMs, at(4));

  const lateViewport = getInitialDestinationDetailTimelineViewport(
    day,
    at(23, 50),
    4,
  );
  assert.equal(lateViewport.startMs, at(20));
  assert.equal(lateViewport.endMs, day.dayEndMs);
});

runTest("detail timeline clamps panning to the selected day", () => {
  const day = makeDay();
  const startViewport = normalizeDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 4 * 3_600_000,
    requestedStartMs: at(1),
  });
  const leftEdge = panDestinationDetailTimelineViewportByPixels({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    viewport: startViewport,
    deltaPx: 1_000,
    trackWidthPx: 500,
  });
  assert.equal(leftEdge.startMs, day.dayStartMs);

  const rightEdge = panDestinationDetailTimelineViewportByPixels({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    viewport: startViewport,
    deltaPx: -10_000,
    trackWidthPx: 500,
  });
  assert.equal(rightEdge.endMs, day.dayEndMs);
});

runTest("detail timeline zoom keeps the current window center", () => {
  const day = makeDay();
  const initial = getInitialDestinationDetailTimelineViewport(day, at(13, 37), 4);
  const resized = resizeDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    viewport: initial,
    requestedZoomHours: 2,
  });
  assert.equal(resized.durationMs, 2 * 3_600_000);
  assert.equal(
    resized.startMs + resized.durationMs / 2,
    initial.startMs + initial.durationMs / 2,
  );
});

runTest("detail timeline wheel zoom preserves the pointer anchor", () => {
  const day = makeDay();
  const viewport = normalizeDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 12 * 3_600_000,
    requestedStartMs: at(6),
  });
  const anchorRatio = 0.75;
  const anchorBefore = viewport.startMs + anchorRatio * viewport.durationMs;
  const nextZoomHours = getDestinationDetailTimelineWheelZoomHours(12, -120);
  const nextViewport = zoomDestinationDetailTimelineViewportAroundAnchor({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    viewport,
    anchorRatio,
    requestedZoomHours: nextZoomHours,
  });

  assert.equal(nextZoomHours, 11.8);
  assert.ok(Math.abs(
    nextViewport.startMs + anchorRatio * nextViewport.durationMs - anchorBefore,
  ) < 1);
  assert.equal(getDestinationDetailTimelineWheelZoomHours(12, 120), 12.2);
  assert.equal(getDestinationDetailTimelineWheelZoomHours(12, 0.1), 12);
  assert.equal(getDestinationDetailTimelineWheelZoomHours(24, 120), 24);
  assert.equal(getDestinationDetailTimelineWheelZoomHours(1, -120), 1);
});

runTest("detail timeline zoom preference persists custom values after the 24-hour default", () => {
  assert.equal(readDestinationDetailTimelineZoomHours(), 24);

  const storage = new MemoryStorage();
  withWindowValue({ localStorage: storage }, () => {
    assert.equal(readDestinationDetailTimelineZoomHours(), 24);

    rememberDestinationDetailTimelineZoomHours(6.375);
    assert.equal(readDestinationDetailTimelineZoomHours(), 6.375);
    assert.equal(
      storage.getItem("patina:destination-detail-timeline-zoom-hours:v1"),
      "6.375",
    );

    storage.setItem(
      "patina:destination-detail-timeline-zoom-hours:v1",
      "invalid",
    );
    assert.equal(readDestinationDetailTimelineZoomHours(), 24);
  });

  const inaccessibleWindow = Object.defineProperty({}, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage blocked");
    },
  });
  withWindowValue(inaccessibleWindow, () => {
    assert.equal(readDestinationDetailTimelineZoomHours(), 24);
    assert.doesNotThrow(() => rememberDestinationDetailTimelineZoomHours(4));
  });
});

runTest("detail minimum duration owns an independent preference", () => {
  assert.equal(readDetailMinSecs(), 60);

  const storage = new MemoryStorage();
  withWindowValue({ localStorage: storage }, () => {
    assert.equal(readDetailMinSecs(), 60);

    saveDetailMinSecs(300);
    assert.equal(readDetailMinSecs(), 300);
    assert.equal(
      storage.getItem("patina:destination-detail-min-secs:v1"),
      "300",
    );
    assert.equal(storage.getItem("patina:data-detail-min-secs"), null);

    storage.setItem(
      "patina:destination-detail-min-secs:v1",
      "invalid",
    );
    storage.setItem("patina:data-detail-min-secs", "240");
    assert.equal(readDetailMinSecs(), 240);

    storage.setItem("patina:data-detail-min-secs", "invalid");
    assert.equal(readDetailMinSecs(), 60);
  });

  const inaccessibleWindow = Object.defineProperty({}, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage blocked");
    },
  });
  withWindowValue(inaccessibleWindow, () => {
    assert.equal(readDetailMinSecs(), 60);
    assert.doesNotThrow(() => saveDetailMinSecs(240));
  });
});

runTest("detail timeline builds viewport-relative ticks and clipped segments", () => {
  const day = makeDay();
  const viewport = normalizeDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 4 * 3_600_000,
    requestedStartMs: at(9),
  });
  assert.deepEqual(
    buildDestinationDetailTimelineAxisTicks(
      viewport,
      day.dayStartMs,
      day.dayEndMs,
    ).map((tick) => tick.label),
    ["09:00", "10:00", "11:00", "12:00", "13:00"],
  );
  assert.deepEqual(
    buildDestinationDetailTimelineSegments(day.activities, viewport).map((segment) => ({
      startTime: segment.startTime,
      endTime: segment.endTime,
      startRatio: segment.startRatio,
      endRatio: segment.endRatio,
    })),
    [
      { startTime: at(9), endTime: at(10), startRatio: 0, endRatio: 0.25 },
      { startTime: at(11), endTime: at(12), startRatio: 0.5, endRatio: 0.75 },
    ],
  );
});

runTest("detail timeline applies the visibility floor after read-model grouping", () => {
  const day = makeDay();
  const records = [
    makeRecord("ten-seconds", at(9), at(9, 0, 10)),
    makeRecord("twenty-seconds", at(9, 0, 10), at(9, 0, 30)),
    makeRecord("twenty-nine-seconds", at(10), at(10, 0, 29)),
  ];
  const viewport = normalizeDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 4 * 3_600_000,
    requestedStartMs: at(8),
  });
  const segments = buildDestinationDetailTimelineSegments([
    {
      id: "visible-activity",
      startTime: records[0]!.startTime,
      endTime: records[1]!.endTime,
      duration: records[0]!.duration + records[1]!.duration,
      current: false,
      records: records.slice(0, 2),
    },
    {
      id: "hidden-activity",
      startTime: records[2]!.startTime,
      endTime: records[2]!.endTime,
      duration: records[2]!.duration,
      current: false,
      records: [records[2]!],
    },
  ], viewport, 0);

  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.startTime, at(9));
  assert.equal(segments[0]?.endTime, at(9, 0, 30));
  assert.equal(segments[0]?.duration, 30_000);
});

runTest("detail timeline renders compiled activities without re-merging them", () => {
  const day = makeDay();
  const first = makeRecord("first", at(9), at(9, 1));
  const second = makeRecord("second", at(9, 3), at(9, 4));
  const viewport = normalizeDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 4 * 3_600_000,
    requestedStartMs: at(8),
  });
  const activities = [first, second].map((record) => ({
    id: record.id,
    startTime: record.startTime,
    endTime: record.endTime,
    duration: record.duration,
    current: false,
    records: [record],
  }));

  assert.deepEqual(
    buildDestinationDetailTimelineSegments(activities, viewport, 0).map((segment) => ({
      id: segment.id,
      startTime: segment.startTime,
      endTime: segment.endTime,
      duration: segment.duration,
    })),
    [
      { id: "first", startTime: at(9), endTime: at(9, 1), duration: 60_000 },
      { id: "second", startTime: at(9, 3), endTime: at(9, 4), duration: 60_000 },
    ],
  );
});

runTest("detail rows describe only the visible portion of an activity", () => {
  const day = makeDay();
  const viewport = normalizeDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 1 * 3_600_000,
    requestedStartMs: at(9, 30),
  });
  const activities = clipDestinationDetailActivitiesToViewport(
    day.activities,
    viewport,
  );
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.startTime, at(9, 30));
  assert.equal(activities[0]?.endTime, at(10));
  assert.equal(activities[0]?.duration, 30 * 60_000);
  assert.equal(activities[0]?.records.length, 1);
});

console.log(`PASS ${passed} data destination detail timeline viewport tests`);
