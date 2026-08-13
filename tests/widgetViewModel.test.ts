import assert from "node:assert/strict";
import {
  getWidgetIconCacheSizeForTests,
  loadWidgetObjectIconWithDeps,
  resetWidgetIconCacheForTests,
} from "../src/app/widget/widgetIconService.ts";
import { applyWidgetBootstrapSnapshot } from "../src/app/widget/widgetBootstrapService.ts";
import { buildWidgetViewModel as buildWidgetViewModelRaw, isWidgetSelfWindow } from "../src/app/widget/widgetViewModel.ts";
import { getLocaleText } from "../src/shared/i18n/runtime.ts";
import {
  parseWidgetBootstrapSnapshot,
  parseWidgetStatusSnapshot,
} from "../src/platform/desktop/widgetRuntimeGateway.ts";
import {
  buildWidgetStatusViewModel,
  formatWidgetToolDuration,
  formatWidgetTrackingDuration,
} from "../src/app/widget/widgetStatusViewModel.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import type { AppSettings } from "../src/shared/settings/appSettings.ts";
import type {
  TrackerHealthSnapshot,
  TrackingStatusSnapshot,
  TrackingWindowSnapshot,
} from "../src/shared/types/tracking.ts";

const buildWidgetViewModel = (
  activeWindow: TrackingWindowSnapshot | null,
  trackingStatus: TrackingStatusSnapshot,
  appSettings: AppSettings,
  trackerHealth: TrackerHealthSnapshot,
  probeStatus: Parameters<typeof buildWidgetViewModelRaw>[4] = null,
) => buildWidgetViewModelRaw(
  activeWindow,
  trackingStatus,
  appSettings,
  trackerHealth,
  probeStatus,
  getLocaleText("zh-CN"),
);

const BASE_SETTINGS: AppSettings = {
  idleTimeoutSecs: 900,
  timelineMergeGapSecs: 180,
  refreshIntervalSecs: 1,
  minSessionSecs: 120,
  trackingPaused: false,
  titleRecordingEnabled: true,
  closeBehavior: "exit",
  minimizeBehavior: "widget",
  themeMode: "light",
  language: "zh-CN",
  hourlyActivityChartMode: "total",
  dynamicEffects: true,
  colorSchemeLight: "default",
  colorSchemeDark: "default",
  launchAtLogin: true,
  startMinimized: true,
  backgroundOptimization: false,
  onboardingCompleted: true,
  webActivityEnabled: false,
  webActivityPort: 12345,
  webActivityToken: "",
  remoteStatusBridgeEnabled: false,
  remoteStatusBridgeUrl: "",
  remoteStatusBridgeToken: "",
  remoteStatusBridgeMachineId: "",
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
  exeName: "PickerHost.exe",
  processPath: "C:/Windows/System32/PickerHost.exe",
};

const WIDGET_WINDOW: TrackingWindowSnapshot = {
  ...ACTIVE_WINDOW,
  title: "Patina Widget",
  exeName: "patina.exe",
  processPath: "C:/Program Files/Patina/patina.exe",
};

const PATINA_MAIN_WINDOW: TrackingWindowSnapshot = {
  ...ACTIVE_WINDOW,
  title: "Patina",
  exeName: "patina.exe",
  processPath: "C:/Program Files/Patina/patina.exe",
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
  assert.equal(viewModel.appName, "Chrome");
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
  assert.equal(viewModel.statusLabel, "\u6301\u7eed\u8bb0\u5f55");
  assert.equal(viewModel.objectIconKey, "chrome.exe");
});

await runTest("buildWidgetViewModel keeps sustained participation active after generic AFK", () => {
  const viewModel = buildWidgetViewModel(
    { ...ACTIVE_WINDOW, isAfk: true, idleTimeMs: 300_001 },
    {
      ...BASE_TRACKING_STATUS,
      sustainedParticipationEligible: true,
      sustainedParticipationActive: true,
      sustainedParticipationKind: "audio",
      sustainedParticipationState: "active",
      sustainedParticipationSignalSource: "audio-session",
      sustainedParticipationReason: "signal-matched",
    },
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );

  assert.equal(viewModel.statusTone, "tracking-sustained");
  assert.equal(viewModel.statusLabel, "\u6301\u7eed\u8bb0\u5f55");
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

  const inactiveViewModel = buildWidgetViewModel(
    ACTIVE_WINDOW,
    { ...BASE_TRACKING_STATUS, isTrackingActive: false },
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );
  assert.equal(inactiveViewModel.statusTone, "idle");
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
  assert.equal(viewModel.appName, "\u5f53\u524d\u5e94\u7528\u672a\u8ffd\u8e2a");
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
});

await runTest("buildWidgetViewModel keeps short probe fallback silent", () => {
  const viewModel = buildWidgetViewModel(
    ACTIVE_WINDOW,
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
    "timeout-fallback",
  );

  assert.equal(viewModel.statusTone, "tracking");
  assert.equal(viewModel.statusLabel, "\u8ffd\u8e2a\u4e2d");
});

await runTest("buildWidgetViewModel maps hard degraded probe to existing error lamp", () => {
  const viewModel = buildWidgetViewModel(
    ACTIVE_WINDOW,
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
    "hard-degraded-fallback",
  );

  assert.equal(viewModel.statusTone, "error");
  assert.equal(viewModel.statusLabel, "\u5f02\u5e38");
});

await runTest("isWidgetSelfWindow detects Patina chrome without matching similarly titled apps", () => {
  assert.equal(isWidgetSelfWindow(WIDGET_WINDOW), true);
  assert.equal(isWidgetSelfWindow(PATINA_MAIN_WINDOW), true);
  assert.equal(isWidgetSelfWindow({ ...WIDGET_WINDOW, title: "工具 - Patina" }), true);
  assert.equal(isWidgetSelfWindow({ ...WIDGET_WINDOW, title: "" }), true);
  assert.equal(isWidgetSelfWindow({ ...WIDGET_WINDOW, exeName: "chrome.exe" }), false);
  assert.equal(isWidgetSelfWindow(ACTIVE_WINDOW), false);
});

await runTest("loadWidgetObjectIconWithDeps returns null for missing icon keys", async () => {
  resetWidgetIconCacheForTests();
  const icon = await loadWidgetObjectIconWithDeps("missing.exe", {
    getIcon: async () => null,
  });

  assert.equal(icon, null);
});

await runTest("loadWidgetObjectIconWithDeps reuses cached icons per executable", async () => {
  resetWidgetIconCacheForTests();
  let loadCount = 0;
  const deps = {
    getIcon: async (exeName: string) => {
      loadCount += 1;
      return `${exeName}-icon`;
    },
  };

  assert.equal(await loadWidgetObjectIconWithDeps("chrome.exe", deps), "chrome.exe-icon");
  assert.equal(await loadWidgetObjectIconWithDeps("Chrome.EXE", deps), "chrome.exe-icon");
  assert.equal(await loadWidgetObjectIconWithDeps("cursor.exe", deps), "cursor.exe-icon");
  assert.equal(loadCount, 2);
});

await runTest("loadWidgetObjectIconWithDeps retries after failed icon load", async () => {
  resetWidgetIconCacheForTests();
  let loadCount = 0;
  const deps = {
    getIcon: async () => {
      loadCount += 1;
      if (loadCount === 1) {
        throw new Error("db busy");
      }
      return "chrome-icon";
    },
  };

  await assert.rejects(
    () => loadWidgetObjectIconWithDeps("chrome.exe", deps),
    /db busy/,
  );
  assert.equal(await loadWidgetObjectIconWithDeps("chrome.exe", deps), "chrome-icon");
  assert.equal(loadCount, 2);
});

await runTest("loadWidgetObjectIconWithDeps caps the widget icon cache", async () => {
  resetWidgetIconCacheForTests();
  const deps = {
    getIcon: async (exeName: string) => `${exeName}-icon`,
  };

  for (let index = 0; index < 20; index += 1) {
    assert.equal(
      await loadWidgetObjectIconWithDeps(`app-${index}.exe`, deps),
      `app-${index}.exe-icon`,
    );
  }

  assert.equal(getWidgetIconCacheSizeForTests(), 16);
});

await runTest("parseWidgetBootstrapSnapshot rejects incomplete native payloads", () => {
  assert.equal(parseWidgetBootstrapSnapshot({}), null);
  assert.equal(parseWidgetBootstrapSnapshot({
    settings: {
      tracking_paused: "0",
      theme_mode: "light",
      language: "zh-CN",
      color_scheme_light: "default",
      color_scheme_dark: "default",
    },
    pinned: false,
    app_overrides: [{ key: "__app_override::editor.exe", value: 42 }],
  }), null);
});

await runTest("applyWidgetBootstrapSnapshot restores only widget settings and app overrides", () => {
  const parsed = parseWidgetBootstrapSnapshot({
    settings: {
      tracking_paused: "1",
      theme_mode: "dark",
      language: "en-US",
      color_scheme_light: "notion",
      color_scheme_dark: "nord",
    },
    pinned: true,
    app_overrides: [
      {
        key: "__app_override::editor.exe",
        value: JSON.stringify({
          displayName: "Quiet Editor",
          track: false,
          enabled: true,
        }),
      },
    ],
  });
  assert.ok(parsed);

  const bootstrap = applyWidgetBootstrapSnapshot(parsed);

  assert.equal(bootstrap.settings.trackingPaused, true);
  assert.equal(bootstrap.settings.themeMode, "dark");
  assert.equal(bootstrap.settings.language, "en-US");
  assert.equal(bootstrap.settings.colorSchemeLight, "notion");
  assert.equal(bootstrap.settings.colorSchemeDark, "nord");
  assert.equal(bootstrap.pinned, true);
  assert.equal(bootstrap.settings.webActivityToken, "");
  assert.equal(ProcessMapper.map("editor.exe").name, "Quiet Editor");
  assert.equal(ProcessMapper.shouldTrack("editor.exe"), false);
  ProcessMapper.clearUserOverrides();
});

await runTest("widget clocks keep tracking minute-only and tools second-accurate", () => {
  assert.equal(formatWidgetTrackingDuration(6_138_999), "01:42");
  assert.equal(formatWidgetTrackingDuration(500_000_000), "99:59");
  assert.equal(formatWidgetToolDuration(1_104_000), "18:24");
  assert.equal(formatWidgetToolDuration(3_661_000), "01:01:01");

  const viewModel = buildWidgetStatusViewModel({
    tracking: { appName: "Code", exeName: "code.exe", elapsedMs: 6_120_000, running: true },
    tools: [
      {
        kind: "stopwatch",
        state: "running",
        valueMs: 1_100_000,
        countsDown: false,
        visibleUntilMs: null,
      },
      {
        kind: "pomodoro",
        state: "running",
        valueMs: 275_000,
        countsDown: true,
        visibleUntilMs: null,
      },
    ],
    sampledAtMs: 10_000,
  }, 4_000);
  assert.equal(viewModel.trackingTimeText, "01:42");
  assert.deepEqual(viewModel.tools.map((tool) => tool.timeText), ["18:24", "04:31"]);

  assert.equal(buildWidgetStatusViewModel(null, 10_000).trackingTimeText, "—");
  assert.equal(buildWidgetStatusViewModel({
    tracking: null,
    tools: [],
    sampledAtMs: 500_000_000,
  }, 10_000).trackingTimeText, "—");
});

await runTest("widget status parser enforces the two semantic tool slots", () => {
  const base = {
    tracking: null,
    sampled_at_ms: 10_000,
  };
  const timer = {
    kind: "stopwatch",
    state: "running",
    value_ms: 1_000,
    counts_down: false,
    visible_until_ms: null,
  };
  const pomodoro = {
    kind: "pomodoro",
    state: "paused",
    value_ms: 2_000,
    counts_down: true,
    visible_until_ms: null,
  };
  assert.ok(parseWidgetStatusSnapshot({ ...base, tools: [timer, pomodoro] }));
  assert.ok(parseWidgetStatusSnapshot({ ...base, tools: [pomodoro] }));
  assert.equal(parseWidgetStatusSnapshot({ ...base, tools: [pomodoro, timer] }), null);
  assert.equal(parseWidgetStatusSnapshot({ ...base, tools: [timer, timer] }), null);
  assert.equal(parseWidgetStatusSnapshot({ ...base, tools: [timer, pomodoro, pomodoro] }), null);
});

console.log(`Passed ${passed} widget view model tests`);
