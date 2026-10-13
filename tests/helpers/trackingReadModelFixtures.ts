import { aggregateFixtureRecords } from "./aggregateFixtures.ts";
import { buildDashboardReadModel } from "../../src/features/dashboard/services/dashboardReadModel.ts";
import { buildHistoryReadModel } from "../../src/features/history/services/historyReadModel.ts";
import { resolveTrackerHealth } from "../../src/shared/types/tracking.ts";
import type { HistorySession } from "../../src/shared/types/sessions.ts";
import { makeSession } from "./trackingTestHarness.ts";

export function makeHealthyTrackerHealth(nowMs: number = 200_000, lastHeartbeatMs: number = nowMs) {
  return resolveTrackerHealth(lastHeartbeatMs, nowMs, 8_000);
}

export function makeStaleTrackerHealth(lastHeartbeatMs: number = 15_000, checkedAtMs: number = 30_000) {
  return resolveTrackerHealth(lastHeartbeatMs, checkedAtMs, 8_000);
}

export function makeInterruptedSameAppSessions(): HistorySession[] {
  return [
    makeSession({ id: 1, exeName: "QQ.exe", startTime: 0, endTime: 60_000, duration: 60_000 }),
    makeSession({ id: 2, exeName: "Chrome.exe", appName: "Chrome", startTime: 60_000, endTime: 90_000, duration: 30_000 }),
    makeSession({ id: 3, exeName: "QQ.exe", startTime: 90_000, endTime: 150_000, duration: 60_000 }),
  ];
}

export function makeShortTimelineSessions(): HistorySession[] {
  return [
    makeSession({ id: 1, exeName: "QQ.exe", startTime: 0, endTime: 20_000, duration: 20_000 }),
    makeSession({ id: 2, exeName: "Chrome.exe", appName: "Chrome", startTime: 25_000, endTime: 45_000, duration: 20_000 }),
  ];
}

export function buildHistoryView(params: {
  daySessions: HistorySession[];
  weeklySessions?: HistorySession[];
  trackerHealth?: ReturnType<typeof resolveTrackerHealth>;
  selectedDate?: Date;
  nowMs?: number;
  minSessionSecs?: number;
  mergeThresholdSecs?: number;
}) {
  const {
    daySessions,
    weeklySessions = [],
    trackerHealth = makeHealthyTrackerHealth(),
    selectedDate = new Date(0),
    nowMs = 200_000,
    minSessionSecs = 0,
    mergeThresholdSecs = 180,
  } = params;

  return buildHistoryReadModel({
    daySessions,
    selectedDate,
    trackerHealth,
    nowMs,
    minSessionSecs,
    mergeThresholdSecs,
    dayAggregateSessions: aggregateFixtureRecords(daySessions, trackerHealth, nowMs),
    weeklyAggregateSessions: aggregateFixtureRecords(weeklySessions, trackerHealth, nowMs)
  });
}

export function buildDashboardView(
  sessions: HistorySession[],
  trackerHealth: ReturnType<typeof resolveTrackerHealth> = makeHealthyTrackerHealth(),
  nowMs: number = 200_000,
) {
  return buildDashboardReadModel(aggregateFixtureRecords(sessions, trackerHealth, nowMs), trackerHealth, nowMs, []);
}
