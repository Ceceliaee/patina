import {
  assert,
  makeSession,
  resolveTrackerHealth,
  runTest,
} from "./shared.ts";
import {
  buildDashboardView,
  buildHistoryView,
  makeHealthyTrackerHealth,
  makeInterruptedSameAppSessions,
  makeShortTimelineSessions,
} from "../helpers/trackingReadModelFixtures.ts";

export function runHistoryReadModelTests() {
  runTest("dashboard read model caps live session growth at the last successful sample when tracker is stale", () => {
    const trackerHealth = resolveTrackerHealth(10_000, 19_000, 8_000);
    const dashboard = buildDashboardView([
      makeSession({
        id: 1,
        exeName: "QQ.exe",
        startTime: 1_000,
        endTime: null,
        duration: null,
      }),
    ], trackerHealth, 19_000);

    assert.equal(dashboard.totalTrackedTime, 9_000);
    assert.equal(dashboard.diagnostics.suspiciousSessionCount, 1);
    assert.equal(dashboard.diagnostics.suspiciousDuration, 9_000);
    assert.equal(dashboard.topApplications[0].suspiciousDuration, 9_000);
  });

  runTest("history app summary stays on real active duration even when timeline merges interruptions for display", () => {
    const view = buildHistoryView({
      daySessions: makeInterruptedSameAppSessions(),
    });

    assert.equal(view.timelineSessions.length, 1);
    assert.equal(view.timelineSessions[0].duration, 120_000);
    assert.equal(view.timelineSessions[0].endTime, 150_000);
    const qqSummary = view.appSummary.find((item) => item.exeName === "QQ.exe");

    assert.ok(qqSummary);
    assert.equal(qqSummary.duration, 120_000);
  });

  runTest("history timeline merge threshold only changes timeline grouping and keeps app summary duration stable", () => {
    const sessions = makeInterruptedSameAppSessions();

    const mergedView = buildHistoryView({
      daySessions: sessions,
      trackerHealth: makeHealthyTrackerHealth(),
      mergeThresholdSecs: 180,
    });
    const splitView = buildHistoryView({
      daySessions: sessions,
      trackerHealth: makeHealthyTrackerHealth(),
      mergeThresholdSecs: 10,
    });

    assert.equal(mergedView.timelineSessions.length, 1);
    assert.equal(splitView.timelineSessions.length, 3);
    assert.equal(
      mergedView.appSummary.reduce((sum, item) => sum + item.duration, 0),
      splitView.appSummary.reduce((sum, item) => sum + item.duration, 0),
    );
  });

  runTest("history timeline honors persisted continuity groups for sustained participation returns", () => {
    const sessions = [
      makeSession({
        id: 1,
        exeName: "Zoom.exe",
        appName: "Zoom",
        startTime: 0,
        endTime: 60_000,
        duration: 60_000,
        continuityGroupStartTime: 0,
      }),
      makeSession({
        id: 2,
        exeName: "QQ.exe",
        appName: "QQ",
        startTime: 60_000,
        endTime: 120_000,
        duration: 60_000,
        continuityGroupStartTime: 60_000,
      }),
      makeSession({
        id: 3,
        exeName: "Zoom.exe",
        appName: "Zoom",
        startTime: 120_000,
        endTime: 180_000,
        duration: 60_000,
        continuityGroupStartTime: 0,
      }),
    ];

    const view = buildHistoryView({
      daySessions: sessions,
      trackerHealth: makeHealthyTrackerHealth(),
      mergeThresholdSecs: 10,
    });
    const qqSummary = view.appSummary.find((item) => item.exeName === "QQ.exe");

    assert.equal(view.timelineSessions.length, 1);
    assert.equal(view.timelineSessions[0].startTime, 0);
    assert.equal(view.timelineSessions[0].endTime, 180_000);
    assert.equal(view.timelineSessions[0].duration, 120_000);
    assert.ok(qqSummary);
    assert.equal(qqSummary.duration, 60_000);
  });

  runTest("history timeline merges directly adjacent same-app sessions within the continuity window without inflating stats", () => {
    const sessions = [
      makeSession({
        id: 1,
        exeName: "cursor.exe",
        appName: "Cursor",
        startTime: 0,
        endTime: 60_000,
        duration: 60_000,
      }),
      makeSession({
        id: 2,
        exeName: "cursor.exe",
        appName: "Cursor",
        startTime: 90_000,
        endTime: 150_000,
        duration: 60_000,
      }),
    ];

    const view = buildHistoryView({
      daySessions: sessions,
      trackerHealth: makeHealthyTrackerHealth(),
      mergeThresholdSecs: 180,
    });

    assert.equal(view.timelineSessions.length, 1);
    assert.equal(view.timelineSessions[0].duration, 120_000);
    assert.equal(view.timelineSessions[0].endTime, 150_000);
    assert.equal(
      view.appSummary.reduce((sum, item) => sum + item.duration, 0),
      120_000,
    );
  });

  runTest("min session threshold only affects timeline display, not real duration stats", () => {
    const sessions = makeShortTimelineSessions();
    const view = buildHistoryView({
      daySessions: sessions,
      weeklySessions: sessions,
      trackerHealth: makeHealthyTrackerHealth(100_000),
      nowMs: 100_000,
      minSessionSecs: 30,
    });

    assert.equal(view.timelineSessions.length, 0);
    assert.equal(view.appSummary.reduce((sum, item) => sum + item.duration, 0), 40_000);
    assert.equal(view.weekly.reduce((sum, item) => sum + item.totalDuration, 0), 40_000);
  });

  runTest("history timeline applies min session threshold to live sessions", () => {
    const trackerHealth = makeHealthyTrackerHealth(200_000);

    const shortLiveView = buildHistoryView({
      daySessions: [
        makeSession({
          id: 1,
          exeName: "vscodium.exe",
          appName: "VSCodium",
          startTime: 195_000,
          endTime: null,
          duration: null,
        }),
      ],
      trackerHealth,
      nowMs: 200_000,
      minSessionSecs: 180,
    });

    assert.equal(shortLiveView.timelineSessions.length, 0);

    const longLiveView = buildHistoryView({
      daySessions: [
        makeSession({
          id: 1,
          exeName: "vscodium.exe",
          appName: "VSCodium",
          startTime: 0,
          endTime: null,
          duration: null,
        }),
      ],
      trackerHealth,
      nowMs: 200_000,
      minSessionSecs: 180,
    });

    assert.equal(longLiveView.timelineSessions.length, 1);
    assert.equal(longLiveView.timelineSessions[0].duration, 200_000);
  });

  runTest("history timeline merged duration does not change with min session threshold", () => {
    const sessions = [
      makeSession({
        id: 1,
        exeName: "vscodium.exe",
        appName: "VSCodium",
        startTime: 0,
        endTime: 20_000,
        duration: 20_000,
      }),
      makeSession({
        id: 2,
        exeName: "qq.exe",
        appName: "QQ",
        startTime: 20_000,
        endTime: 22_000,
        duration: 2_000,
        windowTitle: "Chat",
      }),
      makeSession({
        id: 3,
        exeName: "vscodium.exe",
        appName: "VSCodium",
        startTime: 22_000,
        endTime: 42_000,
        duration: 20_000,
        windowTitle: "Code",
      }),
    ];

    const baseView = buildHistoryView({
      daySessions: sessions,
      trackerHealth: makeHealthyTrackerHealth(100_000),
      nowMs: 100_000,
    });

    const thresholdView = buildHistoryView({
      daySessions: sessions,
      trackerHealth: makeHealthyTrackerHealth(100_000),
      nowMs: 100_000,
      minSessionSecs: 30,
    });

    assert.equal(baseView.timelineSessions.length, 1);
    assert.equal(thresholdView.timelineSessions.length, 1);
    assert.equal(baseView.timelineSessions[0].duration, 40_000);
    assert.equal(thresholdView.timelineSessions[0].duration, 40_000);
    assert.equal(baseView.timelineSessions[0].endTime, 42_000);
    assert.equal(thresholdView.timelineSessions[0].endTime, 42_000);
  });
}
