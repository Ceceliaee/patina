import { loadAppRuntimeBootstrapSnapshotWithDeps } from "../../src/app/services/appRuntimeBootstrapService.ts";
import { resolveTrackerHealth } from "../../src/shared/types/tracking.ts";
import { DEFAULT_SETTINGS, type AppSettings } from "../../src/shared/settings/appSettings.ts";
import { measureAsyncBenchmark, printBenchmarkReport } from "./benchmarkUtils.ts";

const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  idleTimeoutSecs: 300,
  timelineMergeGapSecs: 180,
  refreshIntervalSecs: 1,
  minSessionSecs: 60,
  trackingPaused: false,
  closeBehavior: "tray",
  minimizeBehavior: "widget",
  launchAtLogin: true,
  startMinimized: true,
  onboardingCompleted: true,
};

const nowMs = new Date(2026, 3, 18, 20, 0, 0, 0).getTime();
const iterations = 600;

const measurement = await measureAsyncBenchmark("startup-bootstrap", iterations, 1.5, async () => {
  await loadAppRuntimeBootstrapSnapshotWithDeps({
    loadCurrentAppSettings: async () => SETTINGS,
    setAfkThreshold: async () => {},
    initializeProcessMapperRuntime: async () => {},
    loadTrackerHealthSnapshot: async () => resolveTrackerHealth(nowMs, nowMs, 8_000),
  });
});

printBenchmarkReport({
  benchmark: "startup-bootstrap",
  measuredAt: new Date().toISOString(),
  measurements: [measurement],
  metadata: {
    nowMs,
    trackingWindow: "chrome.exe",
  },
});
