import { loadAppRuntimeBootstrapSnapshotWithDeps } from "../../src/app/services/appRuntimeBootstrapService.ts";
import { resolveTrackerHealth } from "../../src/shared/types/tracking.ts";
import type { AppSettings } from "../../src/shared/settings/appSettings.ts";
import { measureAsyncBenchmark, printBenchmarkReport } from "./benchmarkUtils.ts";

const SETTINGS: AppSettings = {
  idle_timeout_secs: 300,
  timeline_merge_gap_secs: 180,
  refresh_interval_secs: 1,
  min_session_secs: 60,
  tracking_paused: false,
  close_behavior: "tray",
  minimize_behavior: "widget",
  launch_at_login: true,
  start_minimized: true,
  onboarding_completed: true,
};

const nowMs = new Date(2026, 3, 18, 20, 0, 0, 0).getTime();
const iterations = 600;

const measurement = await measureAsyncBenchmark("startup-bootstrap", iterations, 1.5, async () => {
  await loadAppRuntimeBootstrapSnapshotWithDeps({
    loadCurrentAppSettings: async () => SETTINGS,
    setAfkThreshold: async () => {},
    initializeProcessMapperRuntime: async () => {},
    getCurrentTrackingSnapshot: async () => ({
      window: {
        hwnd: "0x100",
        root_owner_hwnd: "0x100",
        process_id: 123,
        window_class: "Chrome_WidgetWin_1",
        title: "Docs",
        exe_name: "chrome.exe",
        process_path: "C:/Program Files/Google/Chrome/Application/chrome.exe",
        is_afk: false,
        idle_time_ms: 0,
      },
      status: {
        is_tracking_active: true,
        sustained_participation_eligible: false,
        sustained_participation_active: false,
        sustained_participation_kind: null,
        sustained_participation_state: "inactive",
        sustained_participation_signal_source: null,
        sustained_participation_reason: "no-signal",
        sustained_participation_diagnostics: {
          state: "inactive",
          reason: "no-signal",
          window_identity: null,
          effective_signal_source: null,
          last_match_at_ms: null,
          grace_deadline_ms: null,
          system_media: {
            signal: {
              is_available: false,
              is_active: false,
              signal_source: null,
              source_app_id: null,
              source_app_identity: null,
              playback_type: null,
            },
            match_result: "unavailable",
          },
          audio_session: {
            signal: {
              is_available: false,
              is_active: false,
              signal_source: null,
              source_app_id: null,
              source_app_identity: null,
              playback_type: null,
            },
            match_result: "unavailable",
          },
        },
      },
    }),
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
