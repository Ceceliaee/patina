import assert from "node:assert/strict";
import {
  loadWidgetObjectIconWithDeps,
  resetWidgetIconCacheForTests,
} from "../src/app/widget/widgetIconService.ts";
import { buildWidgetViewModel, isWidgetSelfWindow } from "../src/app/widget/widgetViewModel.ts";
import type { AppSettings } from "../src/shared/settings/appSettings.ts";
import type {
  TrackerHealthSnapshot,
  TrackingStatusSnapshot,
  TrackingWindowSnapshot,
} from "../src/shared/types/tracking.ts";

const BASE_SETTINGS: AppSettings = {
  idleTimeoutSecs: 900,
  timelineMergeGapSecs: 180,
  refreshIntervalSecs: 1,
  minSessionSecs: 120,
  trackingPaused: false,
  closeBehavior: "exit",
  minimizeBehavior: "widget",
  launchAtLogin: true,
  startMinimized: true,
  onboardingCompleted: true,
};

const BASE_TRACKING_STATUS: TrackingStatusSnapshot = {
  isTrackingActive: true,
  sustainedParticipationEligible: false,
  sustainedParticipationActive: false,
  sustainedParticipationKind: null,
  sustainedParticipationState: "inactive",
  sustainedParticipationSignalSource: null,
  sustainedParticipationReason: "no-signal",
  sustainedParticipationDiagnostics: {
    state: "inactive",
    reason: "no-signal",
    windowIdentity: null,
    effectiveSignalSource: null,
    lastMatchAtMs: null,
    graceDeadlineMs: null,
    systemMedia: {
      signal: {
        isAvailable: false,
        isActive: false,
        signalSource: null,
        sourceAppId: null,
        sourceAppIdentity: null,
        playbackType: null,
      },
      matchResult: "unavailable",
    },
    audioSession: {
      signal: {
        isAvailable: false,
        isActive: false,
        signalSource: null,
        sourceAppId: null,
        sourceAppIdentity: null,
        playbackType: null,
      },
      matchResult: "unavailable",
    },
  },
};

const BASE_TRACKER_HEALTH: TrackerHealthSnapshot = {
  status: "healthy",
  lastHeartbeatMs: 1,
  checkedAtMs: 2,
  staleAfterMs: 3,
};

const ACTIVE_WINDOW: TrackingWindowSnapshot = {
  hwnd: "1",
  rootOwnerHwnd: "1",
  processId: 7,
  windowClass: "Chrome_WidgetWin_1",
  title: "Docs",
  exeName: "chrome.exe",
  processPath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  isAfk: false,
  idleTimeMs: 0,
};

const UNTRACKED_WINDOW: TrackingWindowSnapshot = {
  ...ACTIVE_WINDOW,
  exeName: "explorer.exe",
  processPath: "C:/Windows/explorer.exe",
};

const WIDGET_WINDOW: TrackingWindowSnapshot = {
  ...ACTIVE_WINDOW,
  title: "Time Tracker Widget",
  exeName: "time-tracker.exe",
  processPath: "C:/Program Files/Time Tracker/time-tracker.exe",
};

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("buildWidgetViewModel maps healthy active tracking to tracking state", () => {
  const viewModel = buildWidgetViewModel(
    ACTIVE_WINDOW,
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );

  assert.equal(viewModel.statusTone, "tracking");
  assert.equal(viewModel.statusLabel, "\u8ffd\u8e2a\u4e2d");
  assert.equal(viewModel.appName, "Google Chrome");
  assert.equal(viewModel.pauseActionLabel, "\u6682\u505c");
  assert.equal(viewModel.showObjectSlot, true);
  assert.equal(viewModel.objectIconKey, "chrome.exe");
});

await runTest("buildWidgetViewModel distinguishes sustained participation tracking", () => {
  const viewModel = buildWidgetViewModel(
    ACTIVE_WINDOW,
    {
      ...BASE_TRACKING_STATUS,
      sustainedParticipationEligible: true,
      sustainedParticipationActive: true,
      sustainedParticipationKind: "audio",
      sustainedParticipationState: "active",
      sustainedParticipationSignalSource: "system-media",
      sustainedParticipationReason: "signal-matched",
    },
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );

  assert.equal(viewModel.statusTone, "tracking-sustained");
  assert.equal(viewModel.statusLabel, "\u6301\u7eed\u53c2\u4e0e");
  assert.equal(viewModel.showObjectSlot, true);
  assert.equal(viewModel.objectIconKey, "chrome.exe");
});

await runTest("buildWidgetViewModel prioritizes paused state", () => {
  const viewModel = buildWidgetViewModel(
    ACTIVE_WINDOW,
    BASE_TRACKING_STATUS,
    { ...BASE_SETTINGS, trackingPaused: true },
    BASE_TRACKER_HEALTH,
  );

  assert.equal(viewModel.statusTone, "paused");
  assert.equal(viewModel.statusLabel, "\u5df2\u6682\u505c");
  assert.equal(viewModel.pauseActionLabel, "\u6062\u590d");
  assert.equal(viewModel.showObjectSlot, false);
  assert.equal(viewModel.objectIconKey, null);
});

await runTest("buildWidgetViewModel treats afk or inactive tracking as idle", () => {
  const idleViewModel = buildWidgetViewModel(
    { ...ACTIVE_WINDOW, isAfk: true },
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );
  assert.equal(idleViewModel.statusTone, "idle");
  assert.equal(idleViewModel.statusLabel, "\u7a7a\u95f2");
  assert.equal(idleViewModel.showObjectSlot, false);

  const inactiveViewModel = buildWidgetViewModel(
    ACTIVE_WINDOW,
    { ...BASE_TRACKING_STATUS, isTrackingActive: false },
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );
  assert.equal(inactiveViewModel.statusTone, "idle");
  assert.equal(inactiveViewModel.showObjectSlot, false);
});

await runTest("buildWidgetViewModel hides untracked foreground apps behind idle copy", () => {
  const viewModel = buildWidgetViewModel(
    UNTRACKED_WINDOW,
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );

  assert.equal(viewModel.statusTone, "idle");
  assert.equal(viewModel.statusLabel, "\u7a7a\u95f2");
  assert.equal(viewModel.appName, "\u5f53\u524d\u5e94\u7528\u4e0d\u8ffd\u8e2a");
  assert.equal(viewModel.helperText, "\u5f53\u524d\u7a97\u53e3\u4e0d\u4f1a\u8fdb\u5165\u8bb0\u5f55");
  assert.equal(viewModel.showObjectSlot, false);
});

await runTest("buildWidgetViewModel prioritizes stale tracker health as error", () => {
  const viewModel = buildWidgetViewModel(
    ACTIVE_WINDOW,
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    { ...BASE_TRACKER_HEALTH, status: "stale" },
  );

  assert.equal(viewModel.statusTone, "error");
  assert.equal(viewModel.statusLabel, "\u5f02\u5e38");
  assert.equal(viewModel.showObjectSlot, false);
});

await runTest("isWidgetSelfWindow detects widget chrome without matching real apps", () => {
  assert.equal(isWidgetSelfWindow(WIDGET_WINDOW), true);
  assert.equal(isWidgetSelfWindow(ACTIVE_WINDOW), false);
});

await runTest("loadWidgetObjectIconWithDeps returns null for missing icon keys", async () => {
  resetWidgetIconCacheForTests();
  const icon = await loadWidgetObjectIconWithDeps("missing.exe", {
    getIconMap: async () => ({ "chrome.exe": "chrome-icon" }),
  });

  assert.equal(icon, null);
});

await runTest("loadWidgetObjectIconWithDeps reuses the icon map cache", async () => {
  resetWidgetIconCacheForTests();
  let loadCount = 0;
  const deps = {
    getIconMap: async () => {
      loadCount += 1;
      return {
        "chrome.exe": "chrome-icon",
        "cursor.exe": "cursor-icon",
      };
    },
  };

  assert.equal(await loadWidgetObjectIconWithDeps("chrome.exe", deps), "chrome-icon");
  assert.equal(await loadWidgetObjectIconWithDeps("cursor.exe", deps), "cursor-icon");
  assert.equal(loadCount, 1);
});

await runTest("loadWidgetObjectIconWithDeps retries after failed icon map load", async () => {
  resetWidgetIconCacheForTests();
  let loadCount = 0;
  const deps = {
    getIconMap: async () => {
      loadCount += 1;
      if (loadCount === 1) {
        throw new Error("db busy");
      }
      return { "chrome.exe": "chrome-icon" };
    },
  };

  await assert.rejects(
    () => loadWidgetObjectIconWithDeps("chrome.exe", deps),
    /db busy/,
  );
  assert.equal(await loadWidgetObjectIconWithDeps("chrome.exe", deps), "chrome-icon");
  assert.equal(loadCount, 2);
});

console.log(`Passed ${passed} widget view model tests`);
