import assert from "node:assert/strict";
import type {
  DataDestinationDetailDayViewModel,
  DataDestinationDetailRecord,
} from "../src/features/data/services/dataDestinationDetailReadModel.ts";
import {
  buildDataDestinationDetailTimelineAxisTicks,
  buildDataDestinationDetailTimelineSegments,
  clipDataDestinationDetailActivitiesToViewport,
  DEFAULT_DATA_DESTINATION_DETAIL_ZOOM_HOURS,
  getDataDestinationDetailTimelineWheelZoomHours,
  getInitialDataDestinationDetailTimelineViewport,
  normalizeDataDestinationDetailTimelineViewport,
  panDataDestinationDetailTimelineViewportByPixels,
  resizeDataDestinationDetailTimelineViewport,
  zoomDataDestinationDetailTimelineViewportAroundAnchor,
} from "../src/features/data/services/dataDestinationDetailTimelineViewport.ts";
import {
  readDetailMinSecs,
  readDataDestinationDetailTimelineZoomHours,
  rememberDataDestinationDetailTimelineZoomHours,
  saveDetailMinSecs,
} from "../src/features/data/services/dataDestinationDetailTimelinePreferenceStorage.ts";

let passed = 0;

function runTest(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function withWindowValue(value: unknown, fn: () => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value,
  });

  try {
    fn();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, "window", descriptor);
    } else {
      delete (globalThis as { window?: unknown }).window;
    }
  }
}

function at(hour: number, minute = 0, second = 0) {
  return new Date(2026, 6, 31, hour, minute, second).getTime();
}

function makeRecord(
  id: string,
  startTime: number,
  endTime: number,
): DataDestinationDetailRecord {
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

function makeDay(): DataDestinationDetailDayViewModel {
  const records = [
    makeRecord("first", at(9), at(10)),
    makeRecord("second", at(11), at(12)),
  ];
  return {
    dateKey: "2026-07-31",
    dayStartMs: at(0),
    dayEndMs: at(0) + 24 * 3_600_000,
    records,
    activities: [{
      id: "activity",
      startTime: at(9),
      endTime: at(12),
      duration: 2 * 3_600_000,
      current: false,
      records,
    }],
    totalDuration: 2 * 3_600_000,
    firstStartTime: at(9),
    lastEndTime: at(12),
  };
}

runTest("detail timeline opens the full 24-hour day by default", () => {
  const viewport = getInitialDataDestinationDetailTimelineViewport(
    makeDay(),
    at(13, 37),
  );
  assert.equal(DEFAULT_DATA_DESTINATION_DETAIL_ZOOM_HOURS, 24);
  assert.equal(viewport.durationMs, 24 * 3_600_000);
  assert.equal(viewport.startMs, at(0));
  assert.equal(viewport.endMs, makeDay().dayEndMs);
});

runTest("detail timeline maps the reference clock time onto a historical day", () => {
  const viewport = getInitialDataDestinationDetailTimelineViewport(
    makeDay(),
    new Date(2026, 7, 8, 13, 37).getTime(),
    4,
  );
  assert.equal(viewport.startMs, at(11, 30));
  assert.equal(viewport.endMs, at(15, 30));
});

runTest("detail timeline clamps current-time focus at the beginning and end of day", () => {
  const day = makeDay();
  const earlyViewport = getInitialDataDestinationDetailTimelineViewport(
    day,
    at(0, 10),
    4,
  );
  assert.equal(earlyViewport.startMs, at(0));
  assert.equal(earlyViewport.endMs, at(4));

  const lateViewport = getInitialDataDestinationDetailTimelineViewport(
    day,
    at(23, 50),
    4,
  );
  assert.equal(lateViewport.startMs, at(20));
  assert.equal(lateViewport.endMs, day.dayEndMs);
});

runTest("detail timeline clamps panning to the selected day", () => {
  const day = makeDay();
  const startViewport = normalizeDataDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 4 * 3_600_000,
    requestedStartMs: at(1),
  });
  const leftEdge = panDataDestinationDetailTimelineViewportByPixels({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    viewport: startViewport,
    deltaPx: 1_000,
    trackWidthPx: 500,
  });
  assert.equal(leftEdge.startMs, day.dayStartMs);

  const rightEdge = panDataDestinationDetailTimelineViewportByPixels({
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
  const initial = getInitialDataDestinationDetailTimelineViewport(day, at(13, 37), 4);
  const resized = resizeDataDestinationDetailTimelineViewport({
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
  const viewport = normalizeDataDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 12 * 3_600_000,
    requestedStartMs: at(6),
  });
  const anchorRatio = 0.75;
  const anchorBefore = viewport.startMs + anchorRatio * viewport.durationMs;
  const nextZoomHours = getDataDestinationDetailTimelineWheelZoomHours(12, -120);
  const nextViewport = zoomDataDestinationDetailTimelineViewportAroundAnchor({
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
  assert.equal(getDataDestinationDetailTimelineWheelZoomHours(12, 120), 12.2);
  assert.equal(getDataDestinationDetailTimelineWheelZoomHours(12, 0.1), 12);
  assert.equal(getDataDestinationDetailTimelineWheelZoomHours(24, 120), 24);
  assert.equal(getDataDestinationDetailTimelineWheelZoomHours(1, -120), 1);
});

runTest("detail timeline zoom preference persists custom values after the 24-hour default", () => {
  assert.equal(readDataDestinationDetailTimelineZoomHours(), 24);

  const storage = new MemoryStorage();
  withWindowValue({ localStorage: storage }, () => {
    assert.equal(readDataDestinationDetailTimelineZoomHours(), 24);

    rememberDataDestinationDetailTimelineZoomHours(6.375);
    assert.equal(readDataDestinationDetailTimelineZoomHours(), 6.375);
    assert.equal(
      storage.getItem("patina:data-destination-detail-timeline-zoom-hours:v1"),
      "6.375",
    );

    storage.setItem(
      "patina:data-destination-detail-timeline-zoom-hours:v1",
      "invalid",
    );
    assert.equal(readDataDestinationDetailTimelineZoomHours(), 24);
  });

  const inaccessibleWindow = Object.defineProperty({}, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage blocked");
    },
  });
  withWindowValue(inaccessibleWindow, () => {
    assert.equal(readDataDestinationDetailTimelineZoomHours(), 24);
    assert.doesNotThrow(() => rememberDataDestinationDetailTimelineZoomHours(4));
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
      storage.getItem("patina:data-detail-min-secs"),
      "300",
    );

    storage.setItem(
      "patina:data-detail-min-secs",
      "invalid",
    );
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
  const viewport = normalizeDataDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 4 * 3_600_000,
    requestedStartMs: at(9),
  });
  assert.deepEqual(
    buildDataDestinationDetailTimelineAxisTicks(
      viewport,
      day.dayStartMs,
      day.dayEndMs,
    ).map((tick) => tick.label),
    ["09:00", "10:00", "11:00", "12:00", "13:00"],
  );
  assert.deepEqual(
    buildDataDestinationDetailTimelineSegments(day.activities, viewport).map((segment) => ({
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

runTest("detail timeline merges adjacent fragments before applying the History visibility floor", () => {
  const day = makeDay();
  const records = [
    makeRecord("ten-seconds", at(9), at(9, 0, 10)),
    makeRecord("twenty-seconds", at(9, 0, 10), at(9, 0, 30)),
    makeRecord("twenty-nine-seconds", at(10), at(10, 0, 29)),
  ];
  const viewport = normalizeDataDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 4 * 3_600_000,
    requestedStartMs: at(8),
  });
  const segments = buildDataDestinationDetailTimelineSegments([{
    id: "short-activity",
    startTime: records[0]!.startTime,
    endTime: records[records.length - 1]!.endTime,
    duration: records.reduce((total, record) => total + record.duration, 0),
    current: false,
    records,
  }], viewport, 0);

  assert.equal(segments.length, 1);
  assert.equal(segments[0]?.startTime, at(9));
  assert.equal(segments[0]?.endTime, at(9, 0, 30));
  assert.equal(segments[0]?.duration, 30_000);
});

runTest("detail rows describe only the visible portion of an activity", () => {
  const day = makeDay();
  const viewport = normalizeDataDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: 1 * 3_600_000,
    requestedStartMs: at(9, 30),
  });
  const activities = clipDataDestinationDetailActivitiesToViewport(
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
