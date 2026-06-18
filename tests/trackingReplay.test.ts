import assert from "node:assert/strict";
import { buildDashboardReadModel } from "../src/features/dashboard/services/dashboardReadModel.ts";
import { buildHistoryReadModel } from "../src/features/history/services/historyReadModel.ts";
import { buildTopApplications } from "../src/features/dashboard/services/dashboardFormatting.ts";
import {
  buildHourlyActivity,
  buildHourlyCategoryActivity,
  limitHourlyCategoryActivity,
} from "../src/shared/lib/hourlyActivityCompiler.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import { resolveTrackerHealth } from "../src/shared/types/tracking.ts";
import {
  shouldDeleteSessionByStartTime,
} from "../src/features/settings/services/sessionCleanupPolicy.ts";
import {
  createTestHarness,
  makeSession,
} from "./helpers/trackingTestHarness.ts";

const harness = createTestHarness();
const runTest = harness.run;

const trackerHealth = resolveTrackerHealth(400_000, 400_000, 8_000);

runTest("history replay filters pickerhost and keeps alias aggregation stable", () => {
  const daySessions = [
    makeSession({
      id: 1,
      appName: "Google Chrome",
      exeName: "chrome.exe",
      startTime: 0,
      endTime: 60_000,
      duration: 60_000,
    }),
    makeSession({
      id: 2,
      appName: "Douyin_tray",
      exeName: "Douyin_tray.exe",
      startTime: 65_000,
      endTime: 125_000,
      duration: 60_000,
    }),
    makeSession({
      id: 3,
      appName: "抖音",
      exeName: "douyin.exe",
      startTime: 130_000,
      endTime: 190_000,
      duration: 60_000,
    }),
    makeSession({
      id: 4,
      appName: "QQ",
      exeName: "QQ.exe",
      startTime: 200_000,
      endTime: 260_000,
      duration: 60_000,
    }),
    makeSession({
      id: 5,
      appName: "PickerHost",
      exeName: "PickerHost.exe",
      startTime: 270_000,
      endTime: 330_000,
      duration: 60_000,
    }),
  ];

  const readModel = buildHistoryReadModel({
    daySessions,
    weeklySessions: daySessions,
    selectedDate: new Date(0),
    trackerHealth,
    nowMs: 400_000,
    minSessionSecs: 0,
    mergeThresholdSecs: 180,
  });

  assert.equal(
    readModel.appSummary.some((item) => item.exeName.toLowerCase().includes("pickerhost")),
    false,
  );
  assert.equal(
    readModel.appSummary.filter((item) => item.exeName.toLowerCase() === "douyin.exe").length,
    1,
  );
  assert.equal(
    readModel.appSummary.find((item) => item.exeName.toLowerCase() === "douyin.exe")?.duration,
    120_000,
  );
});

runTest("dashboard replay keeps alias aggregation stable and filters pickerhost", () => {
  const sessions = [
    makeSession({
      id: 1,
      appName: "Google Chrome",
      exeName: "chrome.exe",
      startTime: 0,
      endTime: 60_000,
      duration: 60_000,
    }),
    makeSession({
      id: 2,
      appName: "Douyin_tray",
      exeName: "Douyin_tray.exe",
      startTime: 65_000,
      endTime: 125_000,
      duration: 60_000,
    }),
    makeSession({
      id: 3,
      appName: "抖音",
      exeName: "douyin.exe",
      startTime: 130_000,
      endTime: 190_000,
      duration: 60_000,
    }),
    makeSession({
      id: 4,
      appName: "QQ",
      exeName: "QQ.exe",
      startTime: 200_000,
      endTime: 260_000,
      duration: 60_000,
    }),
    makeSession({
      id: 5,
      appName: "PickerHost",
      exeName: "PickerHost.exe",
      startTime: 270_000,
      endTime: 330_000,
      duration: 60_000,
    }),
  ];

  const dashboard = buildDashboardReadModel(sessions, trackerHealth, 400_000);
  assert.equal(
    dashboard.topApplications.some((item) => item.exeName.toLowerCase().includes("pickerhost")),
    false,
  );
  assert.equal(
    dashboard.topApplications.filter((item) => item.exeName.toLowerCase() === "douyin.exe").length,
    1,
  );
  assert.equal(
    dashboard.topApplications.some((item) => item.exeName.toLowerCase() === "qq.exe"),
    true,
  );
});

runTest("replay keeps stale live session growth capped in history and dashboard", () => {
  const staleTrackerHealth = resolveTrackerHealth(18_000, 30_000, 8_000);
  const sessions = [
    makeSession({
      id: 1,
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: 10_000,
      endTime: null,
      duration: null,
      windowTitle: "Refactor",
    }),
  ];

  const history = buildHistoryReadModel({
    daySessions: sessions,
    weeklySessions: sessions,
    selectedDate: new Date(0),
    trackerHealth: staleTrackerHealth,
    nowMs: 30_000,
    minSessionSecs: 0,
    mergeThresholdSecs: 180,
  });
  const dashboard = buildDashboardReadModel(
    sessions,
    staleTrackerHealth,
    30_000,
  );

  assert.equal(history.timelineSessions[0]?.duration, 8_000);
  assert.equal(history.diagnostics.trackerStatus, "stale");
  assert.equal(dashboard.compiledSessions[0]?.duration, 8_000);
  assert.equal(dashboard.diagnostics.trackerStatus, "stale");
});

runTest("replay keeps startup-sealed sessions closed under stale tracker", () => {
  const staleTrackerHealth = resolveTrackerHealth(18_000, 30_000, 8_000);
  const sessions = [
    makeSession({
      id: 1,
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: 10_000,
      endTime: 18_000,
      duration: 8_000,
      windowTitle: "Recovered",
    }),
  ];

  const history = buildHistoryReadModel({
    daySessions: sessions,
    weeklySessions: sessions,
    selectedDate: new Date(0),
    trackerHealth: staleTrackerHealth,
    nowMs: 30_000,
    minSessionSecs: 0,
    mergeThresholdSecs: 180,
  });
  const dashboard = buildDashboardReadModel(
    sessions,
    staleTrackerHealth,
    30_000,
  );

  assert.equal(history.timelineSessions[0]?.duration, 8_000);
  assert.equal(history.diagnostics.suspiciousSessionCount, 0);
  assert.equal(dashboard.compiledSessions[0]?.duration, 8_000);
  assert.equal(dashboard.diagnostics.suspiciousSessionCount, 0);
});

runTest("replay keeps startup-sealed sessions stable after cleanup on stale tracker", () => {
  const staleTrackerHealth = resolveTrackerHealth(18_000, 30_000, 8_000);
  const cutoffTime = 20_000;
  const allSessions = [
    makeSession({
      id: 1,
      appName: "Old Active",
      exeName: "old-active.exe",
      startTime: 10_000,
      endTime: null,
      duration: null,
      windowTitle: "Old Active",
    }),
    makeSession({
      id: 2,
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: 21_000,
      endTime: 24_000,
      duration: 3_000,
      windowTitle: "Recovered",
    }),
  ];
  const sessions = allSessions.filter((session) => (
    !shouldDeleteSessionByStartTime(session.startTime, cutoffTime)
  ));

  const history = buildHistoryReadModel({
    daySessions: sessions,
    weeklySessions: sessions,
    selectedDate: new Date(0),
    trackerHealth: staleTrackerHealth,
    nowMs: 30_000,
    minSessionSecs: 0,
    mergeThresholdSecs: 180,
  });
  const dashboard = buildDashboardReadModel(
    sessions,
    staleTrackerHealth,
    30_000,
  );

  assert.equal(history.timelineSessions.length, 1);
  assert.equal(history.timelineSessions[0]?.duration, 3_000);
  assert.equal(history.diagnostics.suspiciousSessionCount, 0);
  assert.equal(dashboard.compiledSessions.length, 1);
  assert.equal(dashboard.compiledSessions[0]?.duration, 3_000);
  assert.equal(dashboard.diagnostics.suspiciousSessionCount, 0);
});

runTest("replay keeps sessions starting at cleanup cutoff in stale tracker views", () => {
  const staleTrackerHealth = resolveTrackerHealth(26_000, 35_000, 8_000);
  const cutoffTime = 20_000;
  const allSessions = [
    makeSession({
      id: 1,
      appName: "Before Cutoff",
      exeName: "before-cutoff.exe",
      startTime: 19_999,
      endTime: 22_000,
      duration: 2_001,
      windowTitle: "Before Cutoff",
    }),
    makeSession({
      id: 2,
      appName: "At Cutoff",
      exeName: "at-cutoff.exe",
      startTime: cutoffTime,
      endTime: 24_000,
      duration: 4_000,
      windowTitle: "At Cutoff",
    }),
  ];
  const sessions = allSessions.filter((session) => (
    !shouldDeleteSessionByStartTime(session.startTime, cutoffTime)
  ));

  const history = buildHistoryReadModel({
    daySessions: sessions,
    weeklySessions: sessions,
    selectedDate: new Date(0),
    trackerHealth: staleTrackerHealth,
    nowMs: 35_000,
    minSessionSecs: 0,
    mergeThresholdSecs: 180,
  });
  const dashboard = buildDashboardReadModel(
    sessions,
    staleTrackerHealth,
    35_000,
  );

  assert.equal(history.timelineSessions.length, 1);
  assert.equal(history.timelineSessions[0]?.exeName, "at-cutoff.exe");
  assert.equal(history.timelineSessions[0]?.duration, 4_000);
  assert.equal(history.diagnostics.suspiciousSessionCount, 0);
  assert.equal(dashboard.compiledSessions.length, 1);
  assert.equal(dashboard.compiledSessions[0]?.exeName, "at-cutoff.exe");
  assert.equal(dashboard.compiledSessions[0]?.duration, 4_000);
  assert.equal(dashboard.diagnostics.suspiciousSessionCount, 0);
});

runTest("replay keeps active sessions starting at cleanup cutoff and caps them from stale heartbeat", () => {
  const staleTrackerHealth = resolveTrackerHealth(26_000, 35_000, 8_000);
  const cutoffTime = 20_000;
  const allSessions = [
    makeSession({
      id: 1,
      appName: "Old Active",
      exeName: "old-active.exe",
      startTime: 10_000,
      endTime: null,
      duration: null,
      windowTitle: "Old Active",
    }),
    makeSession({
      id: 2,
      appName: "Boundary Active",
      exeName: "boundary-active.exe",
      startTime: cutoffTime,
      endTime: null,
      duration: null,
      windowTitle: "Boundary Active",
    }),
  ];
  const sessions = allSessions.filter((session) => (
    !shouldDeleteSessionByStartTime(session.startTime, cutoffTime)
  ));

  const history = buildHistoryReadModel({
    daySessions: sessions,
    weeklySessions: sessions,
    selectedDate: new Date(0),
    trackerHealth: staleTrackerHealth,
    nowMs: 35_000,
    minSessionSecs: 0,
    mergeThresholdSecs: 180,
  });
  const dashboard = buildDashboardReadModel(
    sessions,
    staleTrackerHealth,
    35_000,
  );

  assert.equal(history.timelineSessions.length, 1);
  assert.equal(history.timelineSessions[0]?.exeName, "boundary-active.exe");
  assert.equal(history.timelineSessions[0]?.duration, 6_000);
  assert.equal(history.diagnostics.suspiciousSessionCount, 1);
  assert.equal(dashboard.compiledSessions.length, 1);
  assert.equal(dashboard.compiledSessions[0]?.exeName, "boundary-active.exe");
  assert.equal(dashboard.compiledSessions[0]?.duration, 6_000);
  assert.equal(dashboard.diagnostics.suspiciousSessionCount, 1);
});

runTest("dashboard formatting replay honors display name overrides", () => {
  ProcessMapper.setUserOverrides({
    "dism++x64.exe": {
      displayName: "Dism++",
      enabled: true,
    },
  });

  try {
    const overriddenTopApps = buildTopApplications([{
      appName: "Dism++主程序",
      exeName: "Dism++x64.exe",
      totalDuration: 60_000,
      suspiciousDuration: 0,
    }]);
    assert.equal(overriddenTopApps[0]?.name, "Dism++");
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

runTest("hourly category compiler splits sessions across hours and preserves total minutes", () => {
  const hourStart = new Date(2026, 0, 2, 9, 0, 0, 0).getTime();
  ProcessMapper.setUserOverrides({
    "cursor.exe": { category: "development", enabled: true },
    "chrome.exe": { category: "browser", enabled: true },
  });
  const sessions = [
    makeSession({
      id: 1,
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: hourStart + 50 * 60_000,
      endTime: hourStart + 70 * 60_000,
      duration: 20 * 60_000,
    }),
    makeSession({
      id: 2,
      appName: "Google Chrome",
      exeName: "chrome.exe",
      startTime: hourStart + 5 * 60_000,
      endTime: hourStart + 20 * 60_000,
      duration: 15 * 60_000,
    }),
  ];

  try {
    const totalActivity = buildHourlyActivity(sessions);
    const categoryActivity = buildHourlyCategoryActivity(sessions);
    const nineOClock = categoryActivity.points[9];
    const tenOClock = categoryActivity.points[10];
    const nineOClockSegments = Object.values(nineOClock?.segmentDetails ?? {});
    const tenOClockSegments = Object.values(tenOClock?.segmentDetails ?? {});

    assert.equal(totalActivity[9]?.minutes, 25);
    assert.equal(totalActivity[10]?.minutes, 10);
    assert.equal(nineOClock?.minutes, 25);
    assert.equal(tenOClock?.minutes, 10);
    assert.equal(nineOClockSegments.find((item) => item.category === "development")?.minutes, 10);
    assert.equal(nineOClockSegments.find((item) => item.category === "browser")?.minutes, 15);
    assert.equal(tenOClockSegments.find((item) => item.category === "development")?.minutes, 10);
    assert.equal(categoryActivity.points.length, 24);
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

runTest("hourly compilers suppress sub-minute hour slivers", () => {
  const hourStart = new Date(2026, 0, 2, 0, 0, 0, 0).getTime();
  ProcessMapper.setUserOverrides({
    "cursor.exe": { category: "development", enabled: true },
  });
  const sessions = [
    makeSession({
      id: 1,
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: hourStart,
      endTime: hourStart + 30_000,
      duration: 30_000,
    }),
  ];

  try {
    const totalActivity = buildHourlyActivity(sessions);
    const categoryActivity = buildHourlyCategoryActivity(sessions);

    assert.equal(totalActivity[0]?.minutes, 0);
    assert.equal(categoryActivity.points[0]?.minutes, 0);
    assert.equal(Object.keys(categoryActivity.points[0]?.segmentDetails ?? {}).length, 0);
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

runTest("hourly category compiler sorts each stacked hour by its own category duration", () => {
  const hourStart = new Date(2026, 0, 2, 9, 0, 0, 0).getTime();
  ProcessMapper.setUserOverrides({
    "cursor.exe": { category: "development", enabled: true },
    "chrome.exe": { category: "browser", enabled: true },
  });

  try {
    const categoryActivity = buildHourlyCategoryActivity([
      makeSession({
        id: 1,
        appName: "Cursor",
        exeName: "cursor.exe",
        startTime: hourStart,
        endTime: hourStart + 10 * 60_000,
        duration: 10 * 60_000,
      }),
      makeSession({
        id: 2,
        appName: "Google Chrome",
        exeName: "chrome.exe",
        startTime: hourStart,
        endTime: hourStart + 20 * 60_000,
        duration: 20 * 60_000,
      }),
      makeSession({
        id: 3,
        appName: "Cursor",
        exeName: "cursor.exe",
        startTime: hourStart + 60 * 60_000,
        endTime: hourStart + 90 * 60_000,
        duration: 30 * 60_000,
      }),
      makeSession({
        id: 4,
        appName: "Google Chrome",
        exeName: "chrome.exe",
        startTime: hourStart + 60 * 60_000,
        endTime: hourStart + 65 * 60_000,
        duration: 5 * 60_000,
      }),
    ]);
    const nineOClockSegments = Object.values(categoryActivity.points[9]?.segmentDetails ?? {});
    const tenOClockSegments = Object.values(categoryActivity.points[10]?.segmentDetails ?? {});

    assert.deepEqual(nineOClockSegments.map((item) => item.category), ["development", "browser"]);
    assert.deepEqual(tenOClockSegments.map((item) => item.category), ["browser", "development"]);
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

runTest("hourly category compiler keeps remainder distinct from the real other category", () => {
  const hourStart = new Date(2026, 0, 2, 9, 0, 0, 0).getTime();
  ProcessMapper.setUserOverrides({
    "cursor.exe": { category: "development", enabled: true },
    "chrome.exe": { category: "browser", enabled: true },
    "qq.exe": { category: "communication", enabled: true },
    "spotify.exe": { category: "music", enabled: true },
    "figma.exe": { category: "design", enabled: true },
    "winword.exe": { category: "office", enabled: true },
    "terminal.exe": { category: "utility", enabled: true },
  });
  const sessions = [
    ["cursor.exe", "Cursor", 30],
    ["chrome.exe", "Chrome", 25],
    ["qq.exe", "QQ", 20],
    ["spotify.exe", "Spotify", 15],
    ["figma.exe", "Figma", 10],
    ["winword.exe", "Word", 8],
    ["mystery.exe", "Mystery", 9],
    ["terminal.exe", "Terminal", 4],
  ].map(([exeName, appName, minutes], index) => makeSession({
    id: index + 1,
    exeName: String(exeName),
    appName: String(appName),
    startTime: hourStart,
    endTime: hourStart + Number(minutes) * 60_000,
    duration: Number(minutes) * 60_000,
  }));

  try {
    const categoryActivity = buildHourlyCategoryActivity(sessions);
    const visibleCategoryActivity = limitHourlyCategoryActivity(categoryActivity, 6);
    const otherSeries = categoryActivity.series.find((item) => item.category === "other");
    const nineOClock = visibleCategoryActivity.points[9];
    const remainderSeries = Object.values(nineOClock?.segmentDetails ?? {}).find((item) => item.isRemainder);
    const stackedTotal = Object.values(nineOClock?.segmentDetails ?? {}).reduce(
      (total, item) => total + item.minutes,
      0,
    );

    assert.equal(categoryActivity.series.length, 8);
    assert.equal(otherSeries?.name, "未分类");
    assert.equal(remainderSeries?.name, "其他");
    assert.equal(remainderSeries?.category, null);
    assert.equal(stackedTotal, nineOClock?.minutes);
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

runTest("hourly category compiler only adds remainder after the per-hour limit is exceeded", () => {
  const hourStart = new Date(2026, 0, 2, 9, 0, 0, 0).getTime();
  ProcessMapper.setUserOverrides({
    "cursor.exe": { category: "development", enabled: true },
    "chrome.exe": { category: "browser", enabled: true },
    "qq.exe": { category: "communication", enabled: true },
    "spotify.exe": { category: "music", enabled: true },
    "figma.exe": { category: "design", enabled: true },
  });
  const sessions = [
    ["cursor.exe", "Cursor", 30],
    ["chrome.exe", "Chrome", 25],
    ["qq.exe", "QQ", 20],
    ["spotify.exe", "Spotify", 15],
    ["figma.exe", "Figma", 10],
  ].map(([exeName, appName, minutes], index) => makeSession({
    id: index + 1,
    exeName: String(exeName),
    appName: String(appName),
    startTime: hourStart,
    endTime: hourStart + Number(minutes) * 60_000,
    duration: Number(minutes) * 60_000,
  }));
  try {
    const categoryActivity = buildHourlyCategoryActivity(sessions);
    const fourPlusRemainder = Object.values(
      limitHourlyCategoryActivity(categoryActivity, 4).points[9]?.segmentDetails ?? {},
    );
    const sixWithoutRemainder = Object.values(
      limitHourlyCategoryActivity(categoryActivity, 6).points[9]?.segmentDetails ?? {},
    );

    assert.equal(fourPlusRemainder.length, 5);
    assert.equal(fourPlusRemainder.filter((item) => item.isRemainder).length, 1);
    assert.equal(sixWithoutRemainder.length, 5);
    assert.equal(sixWithoutRemainder.filter((item) => item.isRemainder).length, 0);
  } finally {
    ProcessMapper.clearUserOverrides();
  }
});

runTest("hourly category compiler honors category and category color overrides", () => {
  const hourStart = new Date(2026, 0, 2, 9, 0, 0, 0).getTime();
  ProcessMapper.setUserOverrides({
    "mystery.exe": {
      category: "design",
      enabled: true,
    },
  });
  ProcessMapper.setCategoryColorOverrides({
    design: "#123456",
  });

  try {
    const categoryActivity = buildHourlyCategoryActivity([
      makeSession({
        id: 1,
        exeName: "mystery.exe",
        appName: "Mystery",
        startTime: hourStart,
        endTime: hourStart + 10 * 60_000,
        duration: 10 * 60_000,
      }),
    ]);
    assert.equal(categoryActivity.series[0]?.category, "design");
    assert.equal(categoryActivity.series[0]?.color, "#123456");
  } finally {
    ProcessMapper.clearUserOverrides();
    ProcessMapper.clearCategoryColorOverrides();
  }
});

runTest("dashboard and history replay produce matching hourly category activity", () => {
  const hourStart = new Date(2026, 0, 2, 9, 0, 0, 0).getTime();
  const nowMs = hourStart + 60 * 60_000;
  const currentTrackerHealth = resolveTrackerHealth(nowMs, nowMs, 8_000);
  const sessions = [
    makeSession({
      id: 1,
      appName: "Cursor",
      exeName: "cursor.exe",
      startTime: hourStart,
      endTime: hourStart + 20 * 60_000,
      duration: 20 * 60_000,
    }),
    makeSession({
      id: 2,
      appName: "QQ",
      exeName: "qq.exe",
      startTime: hourStart + 20 * 60_000,
      endTime: hourStart + 35 * 60_000,
      duration: 15 * 60_000,
    }),
  ];

  const dashboard = buildDashboardReadModel(sessions, currentTrackerHealth, nowMs);
  const history = buildHistoryReadModel({
    daySessions: sessions,
    weeklySessions: sessions,
    selectedDate: new Date(nowMs),
    trackerHealth: currentTrackerHealth,
    nowMs,
    minSessionSecs: 0,
    mergeThresholdSecs: 180,
  });

  assert.deepEqual(history.hourlyCategoryActivity, dashboard.hourlyCategoryActivity);
});

await harness.finish("tracking replay");
