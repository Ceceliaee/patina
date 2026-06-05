import {
  applyTrackingDataChangedPayload,
  assert,
  buildSessionCleanupPlan,
  clearSessionsByRangeWithDeps,
  buildReadModelDiagnostics,
  compileSessions,
  isRawCurrentTrackingSnapshot,
  isRawTrackingDataChangedPayload,
  isRawTrackingWindowSnapshot,
  makeSession,
  makeWindow,
  materializeLiveSessions,
  resolveLiveCutoffMs,
  resolveSessionStartCleanupCutoffTime,
  resolveTrackerHealth,
  resolveTrackingDataChangedEffects,
  runTest,
  shouldDeleteSessionByStartTime,
} from "./shared.ts";
import {
  buildHistoryView,
  buildDashboardView,
  makeStaleTrackerHealth,
} from "../helpers/trackingReadModelFixtures.ts";
import { loadAppRuntimeBootstrapSnapshotWithDeps } from "../../src/app/services/appRuntimeBootstrapService.ts";
import { DEFAULT_SETTINGS } from "../../src/shared/settings/appSettings.ts";

export function runRuntimeEffectsTests() {
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
      getCurrentTrackingSnapshot: async () => null,
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
      ...validCurrentTrackingSnapshot,
      sampled_at_ms: 123,
      probe_status: "timeout-fallback",
      degraded_reason: "active window poll timed out after 3 seconds",
    }), true);
    assert.equal(isRawCurrentTrackingSnapshot({
      ...validCurrentTrackingSnapshot,
      probe_status: "timeout",
    }), false);
  });

  runTest("tracking data changed sealed reasons force refresh without pause setting sync", () => {
    const sealedReasons = [
      "watchdog-sealed",
      "startup-sealed",
      "tracking-paused-sealed",
      "passive-participation-sealed",
    ];

    for (const reason of sealedReasons) {
      const effects = resolveTrackingDataChangedEffects(reason);
      assert.equal(effects.shouldRefresh, true);
      assert.equal(effects.shouldSyncPauseSetting, false);
    }
  });

  runTest("tracking pause toggle reasons force refresh and sync pause setting", () => {
    for (const reason of ["tracking-paused", "tracking-resumed"]) {
      const effects = resolveTrackingDataChangedEffects(reason);
      assert.equal(effects.shouldRefresh, true);
      assert.equal(effects.shouldSyncPauseSetting, true);
    }
  });

  runTest("backup restored event keeps refresh=true and pause sync=false", () => {
    const effects = resolveTrackingDataChangedEffects("backup-restored");
    assert.equal(effects.shouldRefresh, true);
    assert.equal(effects.shouldSyncPauseSetting, false);
  });

  runTest("tracking status changed event refreshes without pause sync", () => {
    const effects = resolveTrackingDataChangedEffects("tracking-status-changed");
    assert.equal(effects.shouldRefresh, true);
    assert.equal(effects.shouldSyncPauseSetting, false);
  });

  runTest("power lifecycle end reasons keep refresh=true and pause sync=false", () => {
    for (const reason of ["session-ended-lock", "session-ended-suspend"]) {
      const effects = resolveTrackingDataChangedEffects(reason);
      assert.equal(effects.shouldRefresh, true);
      assert.equal(effects.shouldSyncPauseSetting, false);
    }
  });

  runTest("tracking data changed runtime syncs pause setting and refreshes on pause toggle", async () => {
    let syncTickCount = 0;
    let trackedPausedValue: boolean | null = null;
    let loadCalls = 0;

    await applyTrackingDataChangedPayload({
      reason: "tracking-paused",
      changedAtMs: 123,
    }, {
      loadLatestTrackingPauseSetting: async () => {
        loadCalls += 1;
        return true;
      },
      setAppSettings: (updater) => {
        trackedPausedValue = updater({
          refreshIntervalSecs: 5,
          minSessionSecs: 30,
          timelineMergeGapSecs: 180,
          trackingPaused: false,
        }).trackingPaused;
      },
      bumpSyncTick: () => {
        syncTickCount += 1;
      },
      warn: () => {
        throw new Error("pause toggle sync should not warn");
      },
    });

    assert.equal(loadCalls, 1);
    assert.equal(trackedPausedValue, true);
    assert.equal(syncTickCount, 1);
  });

  runTest("tracking data changed runtime refreshes without pause sync for sealed reasons", async () => {
    let syncTickCount = 0;
    let loadCalls = 0;
    let setCalls = 0;

    await applyTrackingDataChangedPayload({
      reason: "tracking-paused-sealed",
      changedAtMs: 456,
    }, {
      loadLatestTrackingPauseSetting: async () => {
        loadCalls += 1;
        return false;
      },
      setAppSettings: () => {
        setCalls += 1;
      },
      bumpSyncTick: () => {
        syncTickCount += 1;
      },
      warn: () => {
        throw new Error("sealed refresh should not warn");
      },
    });

    assert.equal(loadCalls, 0);
    assert.equal(setCalls, 0);
    assert.equal(syncTickCount, 1);
  });

  runTest("tracking data changed runtime syncs active window snapshot before refresh", async () => {
    let syncedWindowExeName: string | null = null;
    let syncTickCount = 0;

    await applyTrackingDataChangedPayload({
      reason: "continuity-window-sealed",
      changedAtMs: 900,
    }, {
      loadLatestTrackingPauseSetting: async () => false,
      loadCurrentWindowSnapshot: async () => makeWindow({
        exeName: "Cursor.exe",
        processPath: "C:\\Cursor\\Cursor.exe",
        idleTimeMs: 181_000,
      }),
      setAppSettings: () => {},
      setActiveWindow: (nextWindow) => {
        syncedWindowExeName = nextWindow?.exeName ?? null;
      },
      bumpSyncTick: () => {
        syncTickCount += 1;
      },
      warn: () => {
        throw new Error("active window sync should not warn");
      },
    });

    assert.equal(syncedWindowExeName, "Cursor.exe");
    assert.equal(syncTickCount, 1);
  });

  runTest("tracking data changed runtime prefers full tracking snapshot when available", async () => {
    let syncedWindowExeName: string | null = null;
    let syncedTrackingActive: boolean | null = null;

    await applyTrackingDataChangedPayload({
      reason: "passive-participation-sealed",
      changedAtMs: 901,
    }, {
      loadLatestTrackingPauseSetting: async () => false,
      loadCurrentTrackingSnapshot: async () => ({
        window: makeWindow({
          exeName: "chrome.exe",
          processPath: "C:\\Chrome\\chrome.exe",
          idleTimeMs: 200_000,
        }),
        status: {
          isTrackingActive: false,
          sustainedParticipationEligible: true,
          sustainedParticipationActive: false,
          sustainedParticipationKind: "audio",
          sustainedParticipationState: "expired",
          sustainedParticipationSignalSource: "audio-session",
          sustainedParticipationReason: "sustained-window-expired",
          sustainedParticipationDiagnostics: {
            state: "expired",
            reason: "sustained-window-expired",
            windowIdentity: "chrome",
            effectiveSignalSource: "audio-session",
            lastMatchAtMs: 800,
            graceDeadlineMs: null,
            systemMedia: {
              signal: {
                isAvailable: true,
                isActive: false,
                signalSource: "system-media",
                sourceAppId: "chrome",
                sourceAppIdentity: "chrome",
                playbackType: "video",
              },
              matchResult: "inactive",
            },
            audioSession: {
              signal: {
                isAvailable: true,
                isActive: true,
                signalSource: "audio-session",
                sourceAppId: "chrome.exe",
                sourceAppIdentity: "chrome",
                playbackType: null,
              },
              matchResult: "matched",
            },
          },
        },
      }),
      setAppSettings: () => {},
      setActiveWindow: (nextWindow) => {
        syncedWindowExeName = nextWindow?.exeName ?? null;
      },
      setTrackingStatus: (nextStatus) => {
        syncedTrackingActive = nextStatus.isTrackingActive;
      },
      bumpSyncTick: () => {},
      warn: () => {
        throw new Error("tracking snapshot sync should not warn");
      },
    });

    assert.equal(syncedWindowExeName, "chrome.exe");
    assert.equal(syncedTrackingActive, false);
  });

  runTest("tracking data changed runtime warns but still refreshes when pause sync fails", async () => {
    let syncTickCount = 0;
    let warned = false;

    await applyTrackingDataChangedPayload({
      reason: "tracking-resumed",
      changedAtMs: 789,
    }, {
      loadLatestTrackingPauseSetting: async () => {
        throw new Error("boom");
      },
      setAppSettings: () => {
        throw new Error("failed sync should not set app settings");
      },
      bumpSyncTick: () => {
        syncTickCount += 1;
      },
      warn: (message, error) => {
        warned = true;
        assert.equal(message, "Failed to sync tracking pause setting");
        assert.equal(error instanceof Error, true);
      },
    });

    assert.equal(warned, true);
    assert.equal(syncTickCount, 1);
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

  runTest("cleanup plan makes the current boundary explicit", () => {
    const nowMs = new Date(2026, 3, 17, 12, 0, 0, 0).getTime();
    const cleanupPlan = buildSessionCleanupPlan(7, nowMs);

    assert.equal(cleanupPlan.range, 7);
    assert.equal(cleanupPlan.nowMs, nowMs);
    assert.equal(cleanupPlan.cutoffTime, resolveSessionStartCleanupCutoffTime(7, nowMs));
    assert.equal(cleanupPlan.mode, "session-start-before-cutoff");
    assert.equal(cleanupPlan.deletesSessionsStartingBeforeCutoff, true);
    assert.equal(cleanupPlan.keepsSessionsStartingAtOrAfterCutoff, true);
    assert.equal(cleanupPlan.deletesCrossCutoffActiveSessionsByStartTime, true);
  });

  runTest("cleanup execution uses the explicit cleanup plan cutoff", async () => {
    const nowMs = new Date(2026, 3, 17, 12, 0, 0, 0).getTime();
    const expectedPlan = buildSessionCleanupPlan(30, nowMs);
    let deletedCutoffTime: number | null = null;

    await clearSessionsByRangeWithDeps(30, nowMs, {
      clearSessionsBefore: async (cutoffTime) => {
        deletedCutoffTime = cutoffTime;
      },
    });

    assert.equal(deletedCutoffTime, expectedPlan.cutoffTime);
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
