import assert from "node:assert/strict";
import { AppClassification } from "../src/shared/classification/appClassification.ts";
import { applyMiniBootstrapSnapshot } from "../src/app/mini/miniBootstrapService.ts";
import { buildMiniViewModel as buildMiniViewModelRaw } from "../src/app/mini/miniViewModel.ts";
import { getLocaleText } from "../src/shared/i18n/runtime.ts";
import {
  parseMiniBootstrapSnapshot,
  parseMiniStatusSnapshot,
} from "../src/platform/desktop/miniContentRuntimeGateway.ts";
import {
  buildMiniStatusViewModel,
  formatMiniToolDuration,
} from "../src/app/mini/miniStatusViewModel.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import type { AppSettings } from "../src/shared/settings/appSettings.ts";
import type {
  TrackerHealthSnapshot,
  TrackingStatusSnapshot,
  TrackingWindowSnapshot,
} from "../src/shared/types/tracking.ts";

const buildMiniViewModel = (
  activeWindow: TrackingWindowSnapshot | null,
  trackingStatus: TrackingStatusSnapshot,
  appSettings: AppSettings,
  trackerHealth: TrackerHealthSnapshot,
  probeStatus: Parameters<typeof buildMiniViewModelRaw>[4] = null,
) => buildMiniViewModelRaw(
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
  showTrayIcon: true,
  closeBehavior: "exit",
  themeMode: "light",
  language: "zh-CN",
  hourlyActivityChartMode: "total",
  dynamicEffects: true,
  colorSchemeLight: "default",
  colorSchemeDark: "default",
  launchAtLogin: true,
  startMinimized: true,
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
  windowClass: "Chrome_MiniWin_1",
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

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("buildMiniViewModel maps healthy active tracking to tracking state", () => {
  const viewModel = buildMiniViewModel(
    ACTIVE_WINDOW,
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );

  assert.equal(viewModel.statusTone, "tracking");
  assert.equal(viewModel.statusLabel, "\u8ffd\u8e2a\u4e2d");
});

await runTest("buildMiniViewModel distinguishes sustained participation tracking", () => {
  const viewModel = buildMiniViewModel(
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
});

await runTest("buildMiniViewModel keeps sustained participation active after generic AFK", () => {
  const viewModel = buildMiniViewModel(
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
});

await runTest("buildMiniViewModel prioritizes paused state", () => {
  const viewModel = buildMiniViewModel(
    ACTIVE_WINDOW,
    BASE_TRACKING_STATUS,
    { ...BASE_SETTINGS, trackingPaused: true },
    BASE_TRACKER_HEALTH,
  );

  assert.equal(viewModel.statusTone, "paused");
  assert.equal(viewModel.statusLabel, "\u5df2\u6682\u505c");
});

await runTest("buildMiniViewModel treats afk or inactive tracking as idle", () => {
  const idleViewModel = buildMiniViewModel(
    { ...ACTIVE_WINDOW, isAfk: true },
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );
  assert.equal(idleViewModel.statusTone, "idle");
  assert.equal(idleViewModel.statusLabel, "\u7a7a\u95f2");

  const inactiveViewModel = buildMiniViewModel(
    ACTIVE_WINDOW,
    { ...BASE_TRACKING_STATUS, isTrackingActive: false },
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );
  assert.equal(inactiveViewModel.statusTone, "idle");
});

await runTest("buildMiniViewModel identifies untracked foreground apps as idle", () => {
  const viewModel = buildMiniViewModel(
    UNTRACKED_WINDOW,
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
  );

  assert.equal(viewModel.statusTone, "idle");
  assert.equal(viewModel.statusLabel, "\u7a7a\u95f2");
});

await runTest("buildMiniViewModel prioritizes stale tracker health as error", () => {
  const viewModel = buildMiniViewModel(
    ACTIVE_WINDOW,
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    { ...BASE_TRACKER_HEALTH, status: "stale" },
  );

  assert.equal(viewModel.statusTone, "error");
  assert.equal(viewModel.statusLabel, "\u5f02\u5e38");
});

await runTest("buildMiniViewModel keeps short probe fallback silent", () => {
  const viewModel = buildMiniViewModel(
    ACTIVE_WINDOW,
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
    "timeout-fallback",
  );

  assert.equal(viewModel.statusTone, "tracking");
  assert.equal(viewModel.statusLabel, "\u8ffd\u8e2a\u4e2d");
});

await runTest("buildMiniViewModel maps hard degraded probe to existing error lamp", () => {
  const viewModel = buildMiniViewModel(
    ACTIVE_WINDOW,
    BASE_TRACKING_STATUS,
    BASE_SETTINGS,
    BASE_TRACKER_HEALTH,
    "hard-degraded-fallback",
  );

  assert.equal(viewModel.statusTone, "error");
  assert.equal(viewModel.statusLabel, "\u5f02\u5e38");
});

await runTest("parseMiniBootstrapSnapshot rejects incomplete native payloads", () => {
  assert.equal(parseMiniBootstrapSnapshot({}), null);
  assert.equal(parseMiniBootstrapSnapshot({
    settings: {
      tracking_paused: "0",
      theme_mode: "light",
      language: "zh-CN",
      color_scheme_light: "default",
      color_scheme_dark: "default",
    },
    app_overrides: [{ key: "__app_override::editor.exe", value: 42 }],
  }), null);
});

await runTest("applyMiniBootstrapSnapshot restores only mini settings and app overrides", () => {
  const parsed = parseMiniBootstrapSnapshot({
    settings: {
      tracking_paused: "1",
      theme_mode: "dark",
      language: "en-US",
      color_scheme_light: "notion",
      color_scheme_dark: "nord",
    },
    app_links: [{ key: "__app_link::child.exe", value: "editor.exe" }],
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

  const bootstrap = applyMiniBootstrapSnapshot(parsed);

  assert.equal(bootstrap.settings.trackingPaused, true);
  assert.equal(bootstrap.settings.themeMode, "dark");
  assert.equal(bootstrap.settings.language, "en-US");
  assert.equal(bootstrap.settings.colorSchemeLight, "notion");
  assert.equal(bootstrap.settings.colorSchemeDark, "nord");
  assert.equal(bootstrap.settings.webActivityToken, "");
  assert.equal(ProcessMapper.map("editor.exe").name, "Quiet Editor");
  assert.equal(ProcessMapper.shouldTrack("editor.exe"), false);
  assert.equal(AppClassification.mapApp("child.exe").name, "Quiet Editor");
  assert.equal(AppClassification.resolveStatisticalApp("child.exe"), "editor.exe");
  AppClassification.setAppLinks({});
  ProcessMapper.clearUserOverrides();
});

await runTest("mini tool clocks remain second-accurate", () => {
  assert.equal(formatMiniToolDuration(1_104_000), "18:24");
  assert.equal(formatMiniToolDuration(3_661_000), "01:01:01");

  const viewModel = buildMiniStatusViewModel({
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
  assert.deepEqual(viewModel.tools.map((tool) => tool.timeText), ["18:24", "04:31"]);

  assert.deepEqual(buildMiniStatusViewModel(null, 10_000), { tools: [] });
  assert.deepEqual(buildMiniStatusViewModel({
    tools: [],
    sampledAtMs: 500_000_000,
  }, 10_000), { tools: [] });
});

await runTest("mini status parser enforces the two semantic tool slots", () => {
  const base = {
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
  assert.ok(parseMiniStatusSnapshot({ ...base, tools: [timer, pomodoro] }));
  assert.ok(parseMiniStatusSnapshot({ ...base, tools: [pomodoro] }));
  assert.equal(parseMiniStatusSnapshot({ ...base, tools: [pomodoro, timer] }), null);
  assert.equal(parseMiniStatusSnapshot({ ...base, tools: [timer, timer] }), null);
  assert.equal(parseMiniStatusSnapshot({ ...base, tools: [timer, pomodoro, pomodoro] }), null);
});

console.log(`Passed ${passed} mini view model tests`);
