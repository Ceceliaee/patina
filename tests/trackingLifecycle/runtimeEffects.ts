import {
  assert,
  clearSessionsByRangeWithDeps,
  buildReadModelDiagnostics,
  compileSessions,
  isRawCurrentTrackingSnapshot,
  isRawTrackingDataChangedPayload,
  isRawTrackingWindowSnapshot,
  makeSession,
  materializeLiveSessions,
  resolveLiveCutoffMs,
  resolveSessionStartCleanupCutoffTime,
  resolveTrackerHealth,
  shouldInvalidateDataCaches,
  runTest,
  shouldDeleteSessionByStartTime,
} from "./shared.ts";
import {
  buildHistoryView,
  buildDashboardView,
  makeStaleTrackerHealth,
} from "../helpers/trackingReadModelFixtures.ts";
import { loadAppRuntimeBootstrapSnapshotWithDeps } from "../../src/app/services/appRuntimeBootstrapService.ts";
import { createLatestSnapshotRefresh } from "../../src/app/services/latestSnapshotRefresh.ts";
import { DEFAULT_SETTINGS } from "../../src/shared/settings/appSettings.ts";

export function runRuntimeEffectsTests() {
  runTest("one snapshot owner rejects old success, old failure, disposed work and cross-event races", async () => {
    type Snapshot = { paused: boolean; window: string; probe: string };
    const pending: Array<{ resolve: (value: Snapshot) => void; reject: (error: unknown) => void }> = [];
    let accepted: Snapshot | null = null;
    const errors: unknown[] = [];
    const owner = createLatestSnapshotRefresh({
      load: () => new Promise<Snapshot>((resolve, reject) => pending.push({ resolve, reject })),
      accept: snapshot => { accepted = snapshot; }, failed: error => errors.push(error),
    });
    const paused = { paused: true, window: "old.exe", probe: "inactive" };
    const resumed = { paused: false, window: "new.exe", probe: "ok" };
    const oldBootstrap = owner.refresh();
    const newerSettingsEvent = owner.refresh();
    pending[1].resolve(resumed); await newerSettingsEvent;
    pending[0].resolve(paused); await oldBootstrap;
    assert.deepEqual(accepted, resumed);
    const oldActiveWindow = owner.refresh();
    const newerPauseEvent = owner.refresh();
    pending[3].resolve(paused); await newerPauseEvent;
    pending[2].reject("old failure"); await oldActiveWindow;
    assert.deepEqual(accepted, paused); assert.deepEqual(errors, []);
    const oldRead = owner.refresh(); const newFailedRead = owner.refresh();
    pending[5].reject("current failure"); await newFailedRead;
    pending[4].resolve(resumed); await oldRead;
    assert.deepEqual(accepted, paused); assert.deepEqual(errors, ["current failure"]);
    const unmounted = owner.refresh(); owner.dispose();
    pending[6].resolve(resumed); await unmounted;
    assert.deepEqual(accepted, paused);
    await owner.refresh(); assert.equal(pending.length, 7);
    const remounted = createLatestSnapshotRefresh({ load: async () => resumed,
      accept: snapshot => { accepted = snapshot; }, failed: () => assert.fail("fresh owner failed") });
    await remounted.refresh(); assert.deepEqual(accepted, resumed); remounted.dispose();
  });

  runTest("app bootstrap preserves loaded settings when process mapper initialization fails", async () => {
    const mapperError = new Error("mapper init failed");
    const trackerHealth = resolveTrackerHealth(10_000, 10_000, 8_000);
    const warnings: Array<{ message: string; error: unknown }> = [];
    const settings = {
      ...DEFAULT_SETTINGS,
      themeMode: "system" as const,
    };

    const snapshot = await loadAppRuntimeBootstrapSnapshotWithDeps({
      loadCurrentAppSettings: async () => settings,
      setAfkThreshold: async () => undefined,
      initializeProcessMapperRuntime: async () => {
        throw mapperError;
      },
      loadTrackerHealthSnapshot: async () => trackerHealth,
      reportWarning: (message, error) => warnings.push({ message, error }),
    });

    assert.equal(snapshot.settings.themeMode, "system");
    assert.equal(snapshot.settings, settings);
    assert.equal(snapshot.trackerHealth, trackerHealth);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].error, mapperError);
  });

  runTest("tracking runtime payload guards accept expected contracts", () => {
    assert.equal(isRawTrackingWindowSnapshot({
      hwnd: "0x100",
      root_owner_hwnd: "0x100",
      process_id: 123,
      window_class: "Chrome_WidgetWin_1",
      title: "Window",
      exe_name: "QQ.exe",
      process_path: "C:\\Program Files\\QQ\\QQ.exe",
      is_afk: false,
      idle_time_ms: 0,
    }), true);
    assert.equal(isRawTrackingWindowSnapshot({
      hwnd: "0x100",
      root_owner_hwnd: "0x100",
      process_id: 123,
      window_class: "Chrome_WidgetWin_1",
      title: "Window",
      exe_name: "QQ.exe",
      process_path: "C:\\Program Files\\QQ\\QQ.exe",
      is_afk: "false",
      idle_time_ms: 0,
    }), false);
    assert.equal(isRawTrackingWindowSnapshot({
      root_owner_hwnd: "0x100",
      process_id: 123,
      window_class: "Chrome_WidgetWin_1",
      title: "Window",
      exe_name: "QQ.exe",
      process_path: "C:\\Program Files\\QQ\\QQ.exe",
      is_afk: false,
      idle_time_ms: 0,
    }), false);

    assert.equal(isRawTrackingDataChangedPayload({
      reason: "session-transition",
      changed_at_ms: 123,
    }), true);
    assert.equal(isRawTrackingDataChangedPayload({
      reason: "session-transition",
      changed_at_ms: "123",
    }), false);

    const validCurrentTrackingSnapshot = {
      tracking_paused: false,
      window: {
        hwnd: "0x100",
        root_owner_hwnd: "0x100",
        process_id: 123,
        window_class: "Chrome_WidgetWin_1",
        title: "Window",
        exe_name: "QQ.exe",
        process_path: "C:\\Program Files\\QQ\\QQ.exe",
        is_afk: false,
        idle_time_ms: 0,
      },
      status: {
        is_tracking_active: true,
        sustained_participation_eligible: true,
        sustained_participation_active: true,
        sustained_participation_kind: "audio",
        sustained_participation_state: "active",
        sustained_participation_signal_source: "system-media",
        sustained_participation_reason: "signal-matched",
        sustained_participation_diagnostics: {
          state: "active",
          reason: "signal-matched",
          window_identity: "douyin",
          effective_signal_source: "system-media",
          last_match_at_ms: 123,
          grace_deadline_ms: 456,
          system_media: {
            signal: {
              is_available: true,
              is_active: true,
              signal_source: "system-media",
              source_app_id: "electron.app.douyin",
              source_app_identity: "douyin",
              playback_type: "video",
            },
            match_result: "matched",
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
    };
    assert.equal(isRawCurrentTrackingSnapshot(validCurrentTrackingSnapshot), true);
    assert.equal(isRawCurrentTrackingSnapshot({
      tracking_paused: false,
      ...validCurrentTrackingSnapshot,
      sampled_at_ms: 123,
      probe_status: "hard-degraded-fallback",
      degraded_reason: "active window poll timed out after 3 seconds",
      probe_diagnostics: {
        last_successful_sample_at_ms: 120,
        fallback_started_at_ms: 121,
        fallback_count: 2,
        consecutive_fallback_count: 2,
        recovery_attempt_count: 1,
        last_recovery_attempt_at_ms: 122,
      },
    }), true);
    assert.equal(isRawCurrentTrackingSnapshot({
      ...validCurrentTrackingSnapshot,
      probe_status: "timeout",
    }), false);
  });

  runTest("external imports and deletion invalidate every data cache", () => {
    for (const reason of [
      "backup-restored",
      "external-data-imported",
      "external-import-deleted",
    ]) {
      assert.equal(shouldInvalidateDataCaches(reason), true);
    }
    assert.equal(shouldInvalidateDataCaches("tracking-status-changed"), false);
  });

  runTest("cleanup uses session start time cutoff and deletes active sessions started before cutoff", () => {
    const nowMs = new Date(2026, 3, 17, 12, 0, 0, 0).getTime();
    const cutoffTime = resolveSessionStartCleanupCutoffTime(7, nowMs);
    const activeBeforeCutoff = makeSession({
      id: 1001,
      exeName: "QQ.exe",
      startTime: cutoffTime - 1,
      endTime: null,
      duration: null,
    });
    const activeAtCutoff = makeSession({
      id: 1002,
      exeName: "Chrome.exe",
      appName: "Chrome",
      startTime: cutoffTime,
      endTime: null,
      duration: null,
    });

    assert.equal(shouldDeleteSessionByStartTime(activeBeforeCutoff.startTime, cutoffTime), true);
    assert.equal(shouldDeleteSessionByStartTime(activeAtCutoff.startTime, cutoffTime), false);
  });

  runTest("cleanup uses calendar days across month and year boundaries and propagates failure", async () => {
    for (const [now, days, expected] of [
      [new Date(2026, 0, 3, 12), 7, new Date(2025, 11, 27, 12)],
      [new Date(2024, 2, 2, 12), 7, new Date(2024, 1, 24, 12)],
    ] as const) {
      let calls = 0;
      await assert.rejects(clearSessionsByRangeWithDeps(days, now.getTime(), {
        clearSessionsBefore: async (cutoff) => {
          calls += 1;
          assert.equal(cutoff, expected.getTime());
          throw new Error("cleanup failed");
        },
      }), /cleanup failed/);
      assert.equal(calls, 1);
    }
  });

  runTest("cleanup execution uses the local calendar cutoff", async () => {
    const nowMs = new Date(2026, 3, 17, 12, 0, 0, 0).getTime();
    const expectedCutoff = new Date(2026, 2, 18, 12).getTime();
    let deletedCutoffTime: number | null = null;

    await clearSessionsByRangeWithDeps(30, nowMs, {
      clearSessionsBefore: async (cutoffTime) => {
        deletedCutoffTime = cutoffTime;
      },
    });

    assert.equal(deletedCutoffTime, expectedCutoff);
  });

  runTest("cleanup deletion removes old active sessions from live read model", () => {
    const nowMs = 100_000;
    const trackerHealth = resolveTrackerHealth(nowMs, nowMs, 8_000);
    const cutoffTime = 50_000;
    const sessions = [
      makeSession({
        id: 2001,
        exeName: "old-active.exe",
        appName: "Old Active",
        startTime: 40_000,
        endTime: null,
        duration: null,
      }),
      makeSession({
        id: 2002,
        exeName: "new-active.exe",
        appName: "New Active",
        startTime: 80_000,
        endTime: null,
        duration: null,
      }),
    ];

    const afterCleanup = sessions.filter((session) => (
      !shouldDeleteSessionByStartTime(session.startTime, cutoffTime)
    ));
    const dashboard = buildDashboardView(afterCleanup, trackerHealth, nowMs);

    assert.equal(
      dashboard.topApplications.some((item) => item.exeName === "old-active.exe"),
      false,
    );
    assert.equal(
      dashboard.topApplications.some((item) => item.exeName === "new-active.exe"),
      true,
    );
  });

  runTest("cleanup deletion on stale tracker does not resurrect removed live sessions", () => {
    const trackerHealth = makeStaleTrackerHealth();
    const nowMs = 30_000;
    const cutoffTime = 20_000;
    const sessions = [
      makeSession({
        id: 3001,
        exeName: "old-active.exe",
        appName: "Old Active",
        startTime: 10_000,
        endTime: null,
        duration: null,
      }),
      makeSession({
        id: 3002,
        exeName: "sealed.exe",
        appName: "Sealed Session",
        startTime: 12_000,
        endTime: 15_000,
        duration: 3_000,
      }),
    ];
    const afterCleanup = sessions.filter((session) => (
      !shouldDeleteSessionByStartTime(session.startTime, cutoffTime)
    ));
    const history = buildHistoryView({
      daySessions: afterCleanup,
      weeklySessions: afterCleanup,
      trackerHealth,
      nowMs,
      minSessionSecs: 0,
      mergeThresholdSecs: 180,
    });
    const dashboard = buildDashboardView(afterCleanup, trackerHealth, nowMs);

    assert.equal(history.timelineSessions.length, 0);
    assert.equal(history.diagnostics.suspiciousSessionCount, 0);
    assert.equal(dashboard.compiledSessions.length, 0);
    assert.equal(dashboard.diagnostics.suspiciousSessionCount, 0);
  });

  runTest("tracker health becomes stale when heartbeat exceeds grace window", () => {
    const healthy = resolveTrackerHealth(10_000, 16_000, 8_000);
    const stale = resolveTrackerHealth(10_000, 19_000, 8_000);
    const missing = resolveTrackerHealth(null, 19_000, 8_000);

    assert.equal(healthy.status, "healthy");
    assert.equal(stale.status, "stale");
    assert.equal(missing.status, "stale");
  });

  runTest("live cutoff uses now for healthy tracker and heartbeat fallback for stale tracker", () => {
    const healthy = resolveTrackerHealth(10_000, 12_000, 8_000);
    const stale = resolveTrackerHealth(10_000, 19_000, 8_000);
    const missingHeartbeat = resolveTrackerHealth(null, 19_000, 8_000);

    assert.equal(resolveLiveCutoffMs(healthy, 19_000), 19_000);
    assert.equal(resolveLiveCutoffMs(stale, 19_000), 10_000);
    assert.equal(resolveLiveCutoffMs(missingHeartbeat, 19_000), 0);
  });

  runTest("materializeLiveSessions caps stale live sessions and marks suspicious diagnostics", () => {
    const trackerHealth = makeStaleTrackerHealth();
    const sessions = [
      makeSession({
        id: 1,
        exeName: "QQ.exe",
        startTime: 10_000,
        endTime: null,
        duration: null,
      }),
      makeSession({
        id: 2,
        exeName: "Chrome.exe",
        appName: "Chrome",
        startTime: 1_000,
        endTime: 3_000,
        duration: 2_000,
      }),
    ];

    const materialized = materializeLiveSessions(sessions, trackerHealth, 30_000);

    assert.equal(materialized[0].duration, 5_000);
    assert.deepEqual(materialized[0].diagnosticCodes, ["tracker_stale_live_session"]);
    assert.equal(materialized[0].suspiciousDuration, 5_000);
    assert.equal(materialized[1], sessions[1]);
  });

  runTest("buildReadModelDiagnostics flags warnings and suspicious counts for stale live sessions", () => {
    const trackerHealth = makeStaleTrackerHealth();
    const nowMs = 30_000;
    const liveCutoffMs = resolveLiveCutoffMs(trackerHealth, nowMs);
    const materialized = materializeLiveSessions([
      makeSession({
        id: 1,
        exeName: "QQ.exe",
        appName: "QQ",
        startTime: 10_000,
        endTime: null,
        duration: null,
      }),
    ], trackerHealth, nowMs);
    const compiled = compileSessions(materialized, {
      startMs: 0,
      endMs: 40_000,
      minSessionSecs: 0,
    });

    const diagnostics = buildReadModelDiagnostics(compiled, trackerHealth, liveCutoffMs);

    assert.equal(diagnostics.hasWarnings, true);
    assert.equal(diagnostics.suspiciousSessionCount, 1);
    assert.equal(diagnostics.suspiciousDuration, 5_000);
    assert.equal(diagnostics.suspiciousAppCount, 1);
    assert.equal(diagnostics.trackerStatus, "stale");
    assert.equal(diagnostics.liveCutoffMs, 15_000);
  });
}
