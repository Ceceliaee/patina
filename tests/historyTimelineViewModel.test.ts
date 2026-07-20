import assert from "node:assert/strict";
import {
  readHistoryDayDistributionMode,
  readHistoryTimelineMode,
  readHistoryTimelineZoomHours,
  rememberHistoryDayDistributionMode,
  rememberHistoryTimelineMode,
  rememberHistoryTimelineZoomHours,
  resolveEffectiveDayDistributionMode,
} from "../src/features/history/services/historyLayoutPreferenceStorage.ts";
import {
  buildHistoryTimelineViewModel,
  DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS,
  normalizeHistoryTimelineViewport,
  normalizeHistoryTimelineViewportAroundFocus,
  panHistoryTimelineViewport,
  panHistoryTimelineViewportByPixels,
  snapHistoryTimelineFocusToNearestHalfHour,
  zoomHistoryTimelineViewportAroundAnchor,
} from "../src/features/history/services/historyTimelineViewModel.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import type { CompiledSession } from "../src/shared/lib/sessionReadCompiler.ts";
import { createTestHarness } from "./helpers/trackingTestHarness.ts";

const harness = createTestHarness();
const runTest = harness.run;
const HOUR_MS = 60 * 60_000;

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
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

function withWindowStorage(storage: MemoryStorage, fn: () => void) {
  withWindowValue({ localStorage: storage }, fn);
}

function makeCompiledSession(overrides: Partial<CompiledSession> = {}): CompiledSession {
  const startTime = overrides.startTime ?? new Date(2026, 0, 2, 9, 0, 0, 0).getTime();
  const endTime = overrides.endTime ?? startTime + 60 * 60_000;
  const displayName = overrides.displayName ?? overrides.appName ?? "Cursor";
  const exeName = overrides.exeName ?? "cursor.exe";

  return {
    id: 1,
    appName: displayName,
    exeName,
    windowTitle: "Work",
    startTime,
    endTime,
    duration: endTime === null ? null : endTime - startTime,
    continuityGroupStartTime: startTime,
    appKey: exeName,
    mergedCount: 1,
    displayName,
    displayNameRank: overrides.displayNameRank ?? 2,
    displayTitle: "Work",
    titleSamples: ["Work"],
    titleSampleDetails: [{
      title: "Work",
      startTime,
      endTime: endTime ?? startTime,
    }],
    sourceIds: [1],
    diagnosticCodes: [],
    suspiciousDuration: 0,
    isLive: endTime === null,
    ...overrides,
  };
}

runTest("empty timeline keeps a stable axis", () => {
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
  });

  assert.equal(viewModel.segments.length, 0);
  assert.equal(viewModel.legendItems.length, 0);
  assert.deepEqual(
    viewModel.axisTicks.map((tick) => tick.label),
    ["00:00", "06:00", "12:00", "18:00", "24:00"],
  );
});

runTest("day distribution mode persists locally", () => {
  assert.equal(readHistoryDayDistributionMode(), "app");

  withWindowStorage(new MemoryStorage(), () => {
    assert.equal(readHistoryDayDistributionMode(), "app");

    rememberHistoryDayDistributionMode("category");
    assert.equal(readHistoryDayDistributionMode(), "category");
    assert.equal(window.localStorage.getItem("patina:history-day-distribution-mode"), "category");

    window.localStorage.setItem("patina:history-day-distribution-mode", "timeline");
    assert.equal(readHistoryDayDistributionMode(), "app");
  });
});

runTest("day distribution keeps category available when web sync is disabled", () => {
  assert.equal(resolveEffectiveDayDistributionMode("category", false), "category");
  assert.equal(resolveEffectiveDayDistributionMode("web", false), "app");
  assert.equal(resolveEffectiveDayDistributionMode("web", true), "web");
});

runTest("timeline display mode persists locally", () => {
  assert.equal(readHistoryTimelineMode(), "app");

  withWindowStorage(new MemoryStorage(), () => {
    assert.equal(readHistoryTimelineMode(), "app");

    rememberHistoryTimelineMode("category");
    assert.equal(readHistoryTimelineMode(), "category");
    assert.equal(window.localStorage.getItem("patina:history-timeline-mode"), "category");

    window.localStorage.setItem("patina:history-timeline-mode", "timeline");
    assert.equal(readHistoryTimelineMode(), "app");
  });
});

runTest("timeline window hours persist continuous zoom values with a four-hour default", () => {
  assert.equal(readHistoryTimelineZoomHours(), DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS);
  assert.equal(DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS, 4);

  withWindowStorage(new MemoryStorage(), () => {
    assert.equal(readHistoryTimelineZoomHours(), 4);

    rememberHistoryTimelineZoomHours(4);
    assert.equal(readHistoryTimelineZoomHours(), 4);
    assert.equal(window.localStorage.getItem("patina:history-timeline-zoom-hours"), "4");

    rememberHistoryTimelineZoomHours(6.375);
    assert.equal(readHistoryTimelineZoomHours(), 6.375);
    assert.equal(window.localStorage.getItem("patina:history-timeline-zoom-hours"), "6.375");

    window.localStorage.setItem("patina:history-timeline-zoom-hours", "category");
    assert.equal(readHistoryTimelineZoomHours(), 4);

    for (const invalidValue of ["", "0.99", "24.01", "NaN", "Infinity"]) {
      window.localStorage.setItem("patina:history-timeline-zoom-hours", invalidValue);
      assert.equal(readHistoryTimelineZoomHours(), 4);
    }
  });
});

runTest("timeline zoom preference remains best-effort when localStorage access throws", () => {
  const inaccessibleWindow = Object.defineProperty({}, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage blocked");
    },
  });

  withWindowValue(inaccessibleWindow, () => {
    assert.equal(readHistoryTimelineZoomHours(), 4);
    assert.doesNotThrow(() => rememberHistoryTimelineZoomHours(4));
  });
});

runTest("timeline ratios use the full local day", () => {
  const day = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [makeCompiledSession({
      startTime: dayStart + 6 * 60 * 60_000,
      endTime: dayStart + 9 * 60 * 60_000,
      duration: 3 * 60 * 60_000,
    })],
    selectedDate: day,
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
  });

  assert.equal(viewModel.segments.length, 1);
  assert.equal(viewModel.segments[0]?.startRatio, 0.25);
  assert.equal(viewModel.segments[0]?.endRatio, 0.375);
  assert.equal(viewModel.segments[0]?.widthRatio, 0.125);
});

runTest("timeline viewport clamps requested windows within the selected day", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const dayEnd = dayStart + 24 * HOUR_MS;

  const earlyViewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 8 * HOUR_MS,
    requestedStartMs: dayStart - HOUR_MS,
  });
  assert.deepEqual(earlyViewport, {
    startMs: dayStart,
    endMs: dayStart + 8 * HOUR_MS,
    durationMs: 8 * HOUR_MS,
  });

  const lateViewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 8 * HOUR_MS,
    requestedStartMs: dayStart + 22 * HOUR_MS,
  });
  assert.deepEqual(lateViewport, {
    startMs: dayEnd - 8 * HOUR_MS,
    endMs: dayEnd,
    durationMs: 8 * HOUR_MS,
  });

  const fullDayViewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 24 * HOUR_MS,
    requestedStartMs: dayStart + 12 * HOUR_MS,
  });
  assert.deepEqual(fullDayViewport, {
    startMs: dayStart,
    endMs: dayEnd,
    durationMs: 24 * HOUR_MS,
  });
});

runTest("timeline zoom focus snaps to the nearest selected-day half hour", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const dayEnd = dayStart + 24 * HOUR_MS;

  assert.equal(
    snapHistoryTimelineFocusToNearestHalfHour({
      selectedDate,
      requestedTimeMs: new Date(2026, 0, 2, 10, 14, 0, 0).getTime(),
    }),
    new Date(2026, 0, 2, 10, 0, 0, 0).getTime(),
  );
  assert.equal(
    snapHistoryTimelineFocusToNearestHalfHour({
      selectedDate,
      requestedTimeMs: new Date(2026, 0, 2, 10, 16, 0, 0).getTime(),
    }),
    new Date(2026, 0, 2, 10, 30, 0, 0).getTime(),
  );
  assert.equal(
    snapHistoryTimelineFocusToNearestHalfHour({
      selectedDate,
      requestedTimeMs: dayStart - HOUR_MS,
    }),
    dayStart,
  );
  assert.equal(
    snapHistoryTimelineFocusToNearestHalfHour({
      selectedDate,
      requestedTimeMs: dayEnd + HOUR_MS,
    }),
    dayEnd,
  );
});

runTest("timeline viewport around focus centers on the snapped half hour when possible", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();

  const centeredViewport = normalizeHistoryTimelineViewportAroundFocus({
    selectedDate,
    durationMs: 4 * HOUR_MS,
    focusTimeMs: new Date(2026, 0, 2, 10, 16, 0, 0).getTime(),
  });
  assert.deepEqual(centeredViewport, {
    startMs: dayStart + 8.5 * HOUR_MS,
    endMs: dayStart + 12.5 * HOUR_MS,
    durationMs: 4 * HOUR_MS,
  });

  const boundaryViewport = normalizeHistoryTimelineViewportAroundFocus({
    selectedDate,
    durationMs: 8 * HOUR_MS,
    focusTimeMs: new Date(2026, 0, 2, 23, 50, 0, 0).getTime(),
  });
  assert.deepEqual(boundaryViewport, {
    startMs: dayStart + 16 * HOUR_MS,
    endMs: dayStart + 24 * HOUR_MS,
    durationMs: 8 * HOUR_MS,
  });
});

runTest("timeline viewport clamps continuous duration and rejects non-finite inputs", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();

  assert.equal(normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 30 * 60_000,
  }).durationMs, HOUR_MS);
  assert.equal(normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 30 * HOUR_MS,
  }).durationMs, 24 * HOUR_MS);
  assert.deepEqual(normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: Number.NaN,
    requestedStartMs: Number.POSITIVE_INFINITY,
  }), {
    startMs: dayStart,
    endMs: dayStart + 24 * HOUR_MS,
    durationMs: 24 * HOUR_MS,
  });
});

runTest("continuous zoom preserves pointer anchors away from day boundaries", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 8 * HOUR_MS,
    requestedStartMs: dayStart + 8 * HOUR_MS,
  });

  for (const anchorRatio of [0, 0.25, 0.5, 0.75, 1]) {
    const anchorBefore = viewport.startMs + anchorRatio * viewport.durationMs;
    const nextViewport = zoomHistoryTimelineViewportAroundAnchor({
      selectedDate,
      viewport,
      anchorRatio,
      requestedDurationMs: 4 * HOUR_MS,
    });
    const anchorAfter = nextViewport.startMs + anchorRatio * nextViewport.durationMs;
    assert.equal(anchorAfter, anchorBefore);
  }
});

runTest("timeline pan uses time deltas and pointer pixels with predictable directions", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 4 * HOUR_MS,
    requestedStartMs: dayStart + 8 * HOUR_MS,
  });
  const wheelPan = panHistoryTimelineViewport({
    selectedDate,
    viewport,
    deltaMs: HOUR_MS,
  });
  const pointerPan = panHistoryTimelineViewportByPixels({
    selectedDate,
    viewport,
    deltaPx: 100,
    trackWidthPx: 400,
  });
  assert.equal(wheelPan.startMs, dayStart + 9 * HOUR_MS);
  assert.equal(pointerPan.startMs, dayStart + 7 * HOUR_MS);
  assert.equal(pointerPan.durationMs, viewport.durationMs);
});

runTest("continuous timeline durations use clock-aligned readable axis ticks", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 6.375 * HOUR_MS,
    requestedStartMs: dayStart + 9 * HOUR_MS + 17 * 60_000,
  });
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [],
    selectedDate,
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    viewport,
  });

  assert.equal(viewModel.zoomHours, 6.375);
  assert.deepEqual(
    viewModel.axisTicks.map((tick) => tick.label),
    ["09:17", "10:00", "12:00", "14:00", "15:39"],
  );
  assert.equal(viewModel.axisTicks[0]?.ratio, 0);
  assert.equal(viewModel.axisTicks.at(-1)?.ratio, 1);
});

runTest("timeline axis collapses a clock tick that formats like the viewport boundary", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 4 * HOUR_MS + 5_000,
    requestedStartMs: dayStart + 13 * HOUR_MS,
  });
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [],
    selectedDate,
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    viewport,
  });

  assert.deepEqual(
    viewModel.axisTicks.map((tick) => tick.label),
    ["13:00", "14:00", "16:00", "17:00"],
  );
  assert.equal(viewModel.axisTicks.at(-1)?.ratio, 1);
});

runTest("timeline axis omits aligned ticks that would overlap either viewport edge", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 4 * HOUR_MS + 12 * 60_000,
    requestedStartMs: dayStart + 11 * HOUR_MS + 54 * 60_000,
  });
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [],
    selectedDate,
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    viewport,
  });

  assert.deepEqual(
    viewModel.axisTicks.map((tick) => tick.label),
    ["11:54", "14:00", "16:06"],
  );
  assert.equal(viewModel.axisTicks[0]?.ratio, 0);
  assert.equal(viewModel.axisTicks.at(-1)?.ratio, 1);
});

runTest("timeline viewport ratios and axis use the zoom window", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: 8 * HOUR_MS,
    requestedStartMs: dayStart + 8 * HOUR_MS,
  });
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 1,
        startTime: dayStart + 7 * HOUR_MS,
        endTime: dayStart + 10 * HOUR_MS,
        duration: 3 * HOUR_MS,
      }),
      makeCompiledSession({
        id: 2,
        startTime: dayStart + 15 * HOUR_MS,
        endTime: dayStart + 17 * HOUR_MS,
        duration: 2 * HOUR_MS,
      }),
    ],
    selectedDate,
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    viewport,
  });

  assert.equal(viewModel.zoomHours, 8);
  assert.equal(viewModel.viewportStartMs, dayStart + 8 * HOUR_MS);
  assert.equal(viewModel.viewportEndMs, dayStart + 16 * HOUR_MS);
  assert.deepEqual(
    viewModel.axisTicks.map((tick) => tick.label),
    ["08:00", "10:00", "12:00", "14:00", "16:00"],
  );
  assert.equal(viewModel.segments.length, 2);
  assert.equal(viewModel.segments[0]?.startRatio, 0);
  assert.equal(viewModel.segments[0]?.endRatio, 0.25);
  assert.equal(viewModel.segments[1]?.startRatio, 0.875);
  assert.equal(viewModel.segments[1]?.endRatio, 1);
});

runTest("one hour timeline viewport uses quarter hour axis ticks", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewport = normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: HOUR_MS,
    requestedStartMs: dayStart + 9.5 * HOUR_MS,
  });
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [],
    selectedDate,
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    viewport,
  });

  assert.deepEqual(
    viewModel.axisTicks.map((tick) => tick.label),
    ["09:30", "09:45", "10:00", "10:15", "10:30"],
  );
});

runTest("timeline clips sessions crossing midnight", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const sessionStart = new Date(2026, 0, 1, 23, 0, 0, 0).getTime();
  const sessionEnd = new Date(2026, 0, 2, 1, 0, 0, 0).getTime();
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [makeCompiledSession({
      startTime: sessionStart,
      endTime: sessionEnd,
      duration: sessionEnd - sessionStart,
    })],
    selectedDate,
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
  });

  assert.equal(viewModel.segments[0]?.startTime, dayStart);
  assert.equal(viewModel.segments[0]?.endTime, dayStart + 60 * 60_000);
  assert.equal(viewModel.segments[0]?.startRatio, 0);
});

runTest("today timeline clips visible activity at now", () => {
  const nowMs = new Date(2026, 0, 2, 10, 30, 0, 0).getTime();
  const sessionStart = new Date(2026, 0, 2, 10, 0, 0, 0).getTime();
  const sessionEnd = new Date(2026, 0, 2, 11, 0, 0, 0).getTime();
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [makeCompiledSession({
      startTime: sessionStart,
      endTime: sessionEnd,
      duration: sessionEnd - sessionStart,
      isLive: true,
    })],
    selectedDate: new Date(nowMs),
    nowMs,
    mode: "app",
  });

  assert.equal(viewModel.visibleEndMs, nowMs);
  assert.equal(viewModel.segments[0]?.endTime, nowMs);
});

runTest("app legend groups sessions by app duration", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 1,
        appKey: "chrome.exe",
        exeName: "chrome.exe",
        displayName: "Chrome",
        appName: "Chrome",
        startTime: dayStart + 9 * 60 * 60_000,
        endTime: dayStart + 10 * 60 * 60_000,
        duration: 60 * 60_000,
      }),
      makeCompiledSession({
        id: 2,
        appKey: "cursor.exe",
        exeName: "cursor.exe",
        displayName: "Cursor",
        appName: "Cursor",
        startTime: dayStart + 10 * 60 * 60_000,
        endTime: dayStart + 12 * 60 * 60_000,
        duration: 2 * 60 * 60_000,
      }),
    ],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
  });

  assert.deepEqual(
    viewModel.legendItems.map((item) => item.key),
    ["cursor.exe", "chrome.exe"],
  );
});

runTest("app lanes group visible segments and sort by viewport duration", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 1,
        appKey: "chrome.exe",
        exeName: "chrome.exe",
        displayName: "Chrome",
        appName: "Chrome",
        startTime: dayStart + 9 * HOUR_MS,
        endTime: dayStart + 10 * HOUR_MS,
        duration: HOUR_MS,
      }),
      makeCompiledSession({
        id: 2,
        appKey: "cursor.exe",
        exeName: "cursor.exe",
        displayName: "Cursor",
        appName: "Cursor",
        startTime: dayStart + 10 * HOUR_MS,
        endTime: dayStart + 11 * HOUR_MS,
        duration: HOUR_MS,
      }),
      makeCompiledSession({
        id: 3,
        appKey: "chrome.exe",
        exeName: "chrome.exe",
        displayName: "Chrome",
        appName: "Chrome",
        startTime: dayStart + 11 * HOUR_MS,
        endTime: dayStart + 12 * HOUR_MS,
        duration: HOUR_MS,
      }),
    ],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
  });

  assert.deepEqual(viewModel.lanes.map((lane) => lane.key), ["chrome.exe", "cursor.exe"]);
  assert.equal(viewModel.lanes[0]?.segments.length, 2);
  assert.equal(viewModel.lanes[0]?.duration, 2 * HOUR_MS);
  assert.equal(viewModel.lanes[1]?.segments.length, 1);
});

runTest("category legend groups sessions by category duration", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  ProcessMapper.setUserOverrides({
    "cursor.exe": { category: "development", enabled: true },
    "chrome.exe": { category: "browser", enabled: true },
  });

  try {
    const viewModel = buildHistoryTimelineViewModel({
      sessions: [
        makeCompiledSession({
          id: 1,
          appKey: "chrome.exe",
          exeName: "chrome.exe",
          displayName: "Chrome",
          appName: "Chrome",
          startTime: dayStart + 9 * 60 * 60_000,
          endTime: dayStart + 10 * 60 * 60_000,
          duration: 60 * 60_000,
        }),
        makeCompiledSession({
          id: 2,
          appKey: "cursor.exe",
          exeName: "cursor.exe",
          displayName: "Cursor",
          appName: "Cursor",
          startTime: dayStart + 10 * 60 * 60_000,
          endTime: dayStart + 12 * 60 * 60_000,
          duration: 2 * 60 * 60_000,
        }),
      ],
      selectedDate: new Date(2026, 0, 2),
      nowMs: new Date(2026, 0, 3).getTime(),
      mode: "category",
    });

    assert.deepEqual(
      viewModel.legendItems.map((item) => item.category),
      ["development", "browser"],
    );
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

runTest("timeline hides merged segments under thirty seconds", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const firstMinuteStart = dayStart + 9 * 60 * 60_000 + 33 * 60_000;
  const secondMinuteStart = firstMinuteStart + 60_000;
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 1,
        startTime: firstMinuteStart + 40_000,
        endTime: firstMinuteStart + 55_000,
        duration: 15_000,
      }),
      makeCompiledSession({
        id: 2,
        startTime: secondMinuteStart + 5_000,
        endTime: secondMinuteStart + 19_000,
        duration: 14_000,
      }),
    ],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    mergeThresholdSecs: 60,
  });

  assert.equal(viewModel.segments.length, 0);
  assert.equal(viewModel.legendItems.length, 0);
});

runTest("timeline keeps merged segments at thirty seconds", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const firstMinuteStart = dayStart + 9 * 60 * 60_000 + 33 * 60_000;
  const secondMinuteStart = firstMinuteStart + 60_000;
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 1,
        startTime: firstMinuteStart + 40_000,
        endTime: firstMinuteStart + 55_000,
        duration: 15_000,
      }),
      makeCompiledSession({
        id: 2,
        startTime: secondMinuteStart + 5_000,
        endTime: secondMinuteStart + 20_000,
        duration: 15_000,
      }),
    ],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    mergeThresholdSecs: 60,
  });

  assert.equal(viewModel.segments.length, 1);
  assert.equal(viewModel.segments[0]?.startTime, firstMinuteStart + 40_000);
  assert.equal(viewModel.segments[0]?.endTime, secondMinuteStart + 20_000);
  assert.equal(viewModel.segments[0]?.duration, 30_000);
});

runTest("timeline hides tiny midnight carryover after clipping", () => {
  const selectedDate = new Date(2026, 0, 2);
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const sessionStart = new Date(2026, 0, 1, 23, 59, 55, 0).getTime();
  const sessionEnd = new Date(2026, 0, 2, 0, 0, 5, 0).getTime();
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [makeCompiledSession({
      startTime: sessionStart,
      endTime: sessionEnd,
      duration: sessionEnd - sessionStart,
    })],
    selectedDate,
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
  });

  assert.equal(viewModel.segments.length, 0);
});

runTest("timeline merges continuous dominant minutes for the same app", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 1,
        appKey: "cursor.exe",
        exeName: "cursor.exe",
        displayName: "Cursor",
        appName: "Cursor",
        startTime: dayStart + 9 * 60 * 60_000,
        endTime: dayStart + 9 * 60 * 60_000 + 60_000,
        duration: 60_000,
        titleSampleDetails: [{
          title: "File A",
          startTime: dayStart + 9 * 60 * 60_000,
          endTime: dayStart + 9 * 60 * 60_000 + 60_000,
        }],
      }),
      makeCompiledSession({
        id: 2,
        appKey: "cursor.exe",
        exeName: "cursor.exe",
        displayName: "Cursor",
        appName: "Cursor",
        startTime: dayStart + 9 * 60 * 60_000 + 90_000,
        endTime: dayStart + 9 * 60 * 60_000 + 150_000,
        duration: 60_000,
        titleSampleDetails: [{
          title: "File B",
          startTime: dayStart + 9 * 60 * 60_000 + 90_000,
          endTime: dayStart + 9 * 60 * 60_000 + 150_000,
        }],
      }),
    ],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    mergeThresholdSecs: 60,
  });

  assert.equal(viewModel.segments.length, 1);
  assert.equal(viewModel.segments[0]?.startTime, dayStart + 9 * 60 * 60_000);
  assert.equal(viewModel.segments[0]?.endTime, dayStart + 9 * 60 * 60_000 + 150_000);
  assert.equal(viewModel.segments[0]?.duration, 120_000);
  assert.deepEqual(
    viewModel.segments[0]?.titleSamples,
    ["File A", "File B"],
  );
});

runTest("timeline assigns each minute to the longest app and records short switches", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const minuteStart = dayStart + 9 * 60 * 60_000 + 33 * 60_000;
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 1,
        appKey: "vscodium.exe",
        exeName: "vscodium.exe",
        displayName: "VSCodium",
        appName: "VSCodium",
        startTime: minuteStart,
        endTime: minuteStart + 43_000,
        duration: 43_000,
      }),
      makeCompiledSession({
        id: 2,
        appKey: "chrome.exe",
        exeName: "chrome.exe",
        displayName: "Chrome",
        appName: "Chrome",
        startTime: minuteStart + 43_000,
        endTime: minuteStart + 49_000,
        duration: 6_000,
      }),
      makeCompiledSession({
        id: 3,
        appKey: "snowshot.exe",
        exeName: "snowshot.exe",
        displayName: "Snow Shot",
        appName: "Snow Shot",
        startTime: minuteStart + 49_000,
        endTime: minuteStart + 60_000,
        duration: 11_000,
      }),
      makeCompiledSession({
        id: 4,
        appKey: "vscodium.exe",
        exeName: "vscodium.exe",
        displayName: "VSCodium",
        appName: "VSCodium",
        startTime: minuteStart + 60_000,
        endTime: minuteStart + 120_000,
        duration: 60_000,
      }),
    ],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
  });

  assert.equal(viewModel.segments.length, 1);
  assert.equal(viewModel.segments[0]?.appKey, "vscodium.exe");
  assert.equal(viewModel.segments[0]?.startTime, minuteStart);
  assert.equal(viewModel.segments[0]?.endTime, minuteStart + 120_000);
  assert.deepEqual(
    [...(viewModel.segments[0]?.alternateLabels ?? [])].sort(),
    ["Chrome", "Snow Shot"].sort(),
  );
});

runTest("timeline merges the same app across a short empty gap", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const firstMinuteStart = dayStart + 9 * 60 * 60_000 + 33 * 60_000;
  const secondMinuteStart = dayStart + 9 * 60 * 60_000 + 35 * 60_000;
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 1,
        appKey: "vscodium.exe",
        exeName: "vscodium.exe",
        displayName: "VSCodium",
        appName: "VSCodium",
        startTime: firstMinuteStart + 10_000,
        endTime: firstMinuteStart + 50_000,
        duration: 40_000,
      }),
      makeCompiledSession({
        id: 2,
        appKey: "vscodium.exe",
        exeName: "vscodium.exe",
        displayName: "VSCodium",
        appName: "VSCodium",
        startTime: secondMinuteStart + 10_000,
        endTime: secondMinuteStart + 50_000,
        duration: 40_000,
      }),
    ],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    mergeThresholdSecs: 180,
  });

  assert.equal(viewModel.segments.length, 1);
  assert.deepEqual(
    viewModel.segments.map((segment) => [segment.startTime, segment.endTime]),
    [
      [firstMinuteStart + 10_000, secondMinuteStart + 50_000],
    ],
  );
});

runTest("category timeline merges the same category across a short empty gap", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const firstMinuteStart = dayStart + 15 * 60 * 60_000 + 15 * 60_000;
  const secondMinuteStart = dayStart + 15 * 60 * 60_000 + 23 * 60_000;
  ProcessMapper.setUserOverrides({
    "cursor.exe": { category: "development", enabled: true },
    "vscodium.exe": { category: "development", enabled: true },
  });

  try {
    const viewModel = buildHistoryTimelineViewModel({
      sessions: [
        makeCompiledSession({
          id: 1,
          appKey: "cursor.exe",
          exeName: "cursor.exe",
          displayName: "Cursor",
          appName: "Cursor",
          startTime: firstMinuteStart,
          endTime: firstMinuteStart + 7 * 60_000,
          duration: 7 * 60_000,
        }),
        makeCompiledSession({
          id: 2,
          appKey: "vscodium.exe",
          exeName: "vscodium.exe",
          displayName: "VSCodium",
          appName: "VSCodium",
          startTime: secondMinuteStart,
          endTime: secondMinuteStart + 2 * 60_000,
          duration: 2 * 60_000,
        }),
      ],
      selectedDate: new Date(2026, 0, 2),
      nowMs: new Date(2026, 0, 3).getTime(),
      mode: "category",
      mergeThresholdSecs: 180,
    });

    assert.equal(viewModel.segments.length, 1);
    assert.equal(viewModel.segments[0]?.category, "development");
    assert.deepEqual(
      viewModel.segments.map((segment) => [segment.startTime, segment.endTime]),
      [
        [firstMinuteStart, secondMinuteStart + 2 * 60_000],
      ],
    );
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

runTest("category timeline merges adjacent dominant minute buckets", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const firstSegmentStart = dayStart + 15 * 60 * 60_000 + 15 * 60_000;
  const secondSegmentStart = dayStart + 15 * 60 * 60_000 + 23 * 60_000;
  ProcessMapper.setUserOverrides({
    "cursor.exe": { category: "development", enabled: true },
    "vscodium.exe": { category: "development", enabled: true },
  });

  try {
    const viewModel = buildHistoryTimelineViewModel({
      sessions: [
        makeCompiledSession({
          id: 1,
          appKey: "cursor.exe",
          exeName: "cursor.exe",
          displayName: "Cursor",
          appName: "Cursor",
          startTime: firstSegmentStart,
          endTime: secondSegmentStart - 1,
          duration: secondSegmentStart - 1 - firstSegmentStart,
        }),
        makeCompiledSession({
          id: 2,
          appKey: "vscodium.exe",
          exeName: "vscodium.exe",
          displayName: "VSCodium",
          appName: "VSCodium",
          startTime: secondSegmentStart,
          endTime: secondSegmentStart + 2 * 60_000,
          duration: 2 * 60_000,
        }),
      ],
      selectedDate: new Date(2026, 0, 2),
      nowMs: new Date(2026, 0, 3).getTime(),
      mode: "category",
      mergeThresholdSecs: 0,
    });

    assert.equal(viewModel.segments.length, 1);
    assert.equal(viewModel.segments[0]?.category, "development");
    assert.deepEqual(
      viewModel.segments.map((segment) => [segment.startTime, segment.endTime]),
      [
        [firstSegmentStart, secondSegmentStart + 2 * 60_000],
      ],
    );
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

runTest("timeline keeps the same app split when the empty gap exceeds the merge threshold", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const firstMinuteStart = dayStart + 9 * 60 * 60_000 + 33 * 60_000;
  const secondMinuteStart = dayStart + 9 * 60 * 60_000 + 35 * 60_000;
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 1,
        appKey: "vscodium.exe",
        exeName: "vscodium.exe",
        displayName: "VSCodium",
        appName: "VSCodium",
        startTime: firstMinuteStart + 10_000,
        endTime: firstMinuteStart + 50_000,
        duration: 40_000,
      }),
      makeCompiledSession({
        id: 2,
        appKey: "vscodium.exe",
        exeName: "vscodium.exe",
        displayName: "VSCodium",
        appName: "VSCodium",
        startTime: secondMinuteStart + 10_000,
        endTime: secondMinuteStart + 50_000,
        duration: 40_000,
      }),
    ],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    mergeThresholdSecs: 30,
  });

  assert.equal(viewModel.segments.length, 2);
  assert.deepEqual(
    viewModel.segments.map((segment) => [segment.startTime, segment.endTime]),
    [
      [firstMinuteStart + 10_000, firstMinuteStart + 50_000],
      [secondMinuteStart + 10_000, secondMinuteStart + 50_000],
    ],
  );
});

runTest("timeline preserves app switches between same app segments", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 1,
        appKey: "cursor.exe",
        exeName: "cursor.exe",
        displayName: "Cursor",
        appName: "Cursor",
        startTime: dayStart + 9 * 60 * 60_000,
        endTime: dayStart + 9 * 60 * 60_000 + 60_000,
        duration: 60_000,
      }),
      makeCompiledSession({
        id: 2,
        appKey: "chrome.exe",
        exeName: "chrome.exe",
        displayName: "Chrome",
        appName: "Chrome",
        startTime: dayStart + 9 * 60 * 60_000 + 60_000,
        endTime: dayStart + 9 * 60 * 60_000 + 90_000,
        duration: 30_000,
      }),
      makeCompiledSession({
        id: 3,
        appKey: "cursor.exe",
        exeName: "cursor.exe",
        displayName: "Cursor",
        appName: "Cursor",
        startTime: dayStart + 9 * 60 * 60_000 + 90_000,
        endTime: dayStart + 9 * 60 * 60_000 + 150_000,
        duration: 60_000,
      }),
    ],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
    mergeThresholdSecs: 180,
  });

  assert.equal(viewModel.segments.length, 3);
  assert.deepEqual(
    viewModel.segments.map((segment) => segment.appKey),
    ["cursor.exe", "chrome.exe", "cursor.exe"],
  );
});

await harness.finish("history timeline view model");
