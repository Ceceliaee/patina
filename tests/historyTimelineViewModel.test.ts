import assert from "node:assert/strict";
import { buildHistoryTimelineViewModel } from "../src/features/history/services/historyTimelineViewModel.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import type { CompiledSession } from "../src/shared/lib/sessionReadCompiler.ts";
import { createTestHarness } from "./helpers/trackingTestHarness.ts";

const harness = createTestHarness();
const runTest = harness.run;

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

runTest("short segments stay non-negative and sorted by time", () => {
  const dayStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  const viewModel = buildHistoryTimelineViewModel({
    sessions: [
      makeCompiledSession({
        id: 2,
        startTime: dayStart + 12 * 60 * 60_000,
        endTime: dayStart + 12 * 60 * 60_000 + 500,
        duration: 500,
      }),
      makeCompiledSession({
        id: 1,
        startTime: dayStart + 9 * 60 * 60_000,
        endTime: dayStart + 9 * 60 * 60_000 + 500,
        duration: 500,
      }),
    ],
    selectedDate: new Date(2026, 0, 2),
    nowMs: new Date(2026, 0, 3).getTime(),
    mode: "app",
  });

  assert.equal(viewModel.segments.length, 2);
  assert.ok((viewModel.segments[0]?.widthRatio ?? -1) > 0);
  assert.deepEqual(
    viewModel.segments.map((segment) => segment.sourceSessionId),
    [1, 2],
  );
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
  assert.equal(viewModel.segments[0]?.endTime, dayStart + 9 * 60 * 60_000 + 180_000);
  assert.equal(viewModel.segments[0]?.duration, 180_000);
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

runTest("timeline does not merge the same app across an empty minute", () => {
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

  assert.equal(viewModel.segments.length, 2);
  assert.deepEqual(
    viewModel.segments.map((segment) => [segment.startTime, segment.endTime]),
    [
      [firstMinuteStart, firstMinuteStart + 60_000],
      [secondMinuteStart, secondMinuteStart + 60_000],
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
