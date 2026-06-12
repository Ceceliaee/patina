import type { DailySummary, HistorySession } from "../../../shared/types/sessions.ts";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking.ts";
import {
  getHistoryByDate,
  getSessionsInRange,
} from "../../../platform/persistence/sessionReadRepository.ts";
import {
  buildChartAxis,
  buildChartData,
  type HistoryChartPoint,
} from "./historyFormatting.ts";
import {
  buildHourlyActivity,
  buildHourlyCategoryActivity,
  type HourlyActivityPoint,
  type HourlyCategoryActivity,
} from "../../../shared/lib/hourlyActivityCompiler.ts";
import {
  buildAppSummary,
  buildDailySummaries,
  buildNormalizedAppStats,
  buildTimelineSessions,
  getDayRange,
  getRollingDayRanges,
  type NormalizedAppSummaryItem,
  type TimelineSession,
} from "../../../shared/lib/sessionReadCompiler.ts";
import {
  buildReadModelDiagnostics,
  compileForRange,
  materializeLiveSessions,
  resolveLiveCutoffMs,
  type ReadModelDiagnostics,
} from "../../../shared/lib/readModelCore.ts";

export interface HistorySnapshot {
  fetchedAtMs: number;
  daySessions: HistorySession[];
  weeklySessions: HistorySession[];
}

export interface HistoryReadModel {
  compiledSessions: ReturnType<typeof compileForRange>;
  timelineSessions: TimelineSession[];
  appSummary: NormalizedAppSummaryItem[];
  weekly: DailySummary[];
  chartData: HistoryChartPoint[];
  chartAxis: ReturnType<typeof buildChartAxis>;
  hourlyActivity: HourlyActivityPoint[];
  hourlyCategoryActivity: HourlyCategoryActivity;
  diagnostics: ReadModelDiagnostics;
}

function filterTimelineSessionsForDisplay(
  sessions: TimelineSession[],
  minSessionSecs: number,
) {
  const minDurationMs = Math.max(0, minSessionSecs) * 1000;
  if (minDurationMs <= 0) {
    return sessions;
  }

  return sessions.filter((session) => (
    (session.duration ?? 0) >= minDurationMs
  ));
}

export async function loadHistorySnapshot(
  date: Date,
  rollingDayCount: number = 7,
): Promise<HistorySnapshot> {
  const selectedDayRange = getDayRange(date);
  const rollingRanges = getRollingDayRanges(rollingDayCount);
  const weeklyRangeStart = rollingRanges[0]?.startMs ?? selectedDayRange.startMs;
  const weeklyRangeEnd = rollingRanges[rollingRanges.length - 1]?.endMs ?? selectedDayRange.endMs;

  const [daySessions, weeklySessions] = await Promise.all([
    getHistoryByDate(date),
    getSessionsInRange(weeklyRangeStart, weeklyRangeEnd),
  ]);

  return {
    fetchedAtMs: Date.now(),
    daySessions,
    weeklySessions,
  };
}

export function buildHistoryReadModel(params: {
  daySessions: HistorySession[];
  weeklySessions: HistorySession[];
  trackerHealth: TrackerHealthSnapshot;
  selectedDate: Date;
  nowMs: number;
  minSessionSecs: number;
  mergeThresholdSecs: number;
}): HistoryReadModel {
  const {
    daySessions,
    weeklySessions,
    trackerHealth,
    selectedDate,
    nowMs,
    minSessionSecs,
    mergeThresholdSecs,
  } = params;
  const selectedDayRange = getDayRange(selectedDate, nowMs);
  const rollingRanges = getRollingDayRanges(7, nowMs);
  const liveDaySessions = materializeLiveSessions(daySessions, trackerHealth, nowMs);
  const liveWeeklySessions = materializeLiveSessions(weeklySessions, trackerHealth, nowMs);
  const compiledSessions = compileForRange(liveDaySessions, selectedDayRange, 0);
  const mergedTimelineSessions = buildTimelineSessions(compiledSessions, mergeThresholdSecs);
  const timelineSessions = filterTimelineSessionsForDisplay(
    mergedTimelineSessions,
    minSessionSecs,
  ).slice().reverse();
  const appSummary = buildAppSummary(buildNormalizedAppStats(compiledSessions));
  const hourlyActivity = buildHourlyActivity(compiledSessions);
  const hourlyCategoryActivity = buildHourlyCategoryActivity(compiledSessions);
  const weekly = buildDailySummaries(
    liveWeeklySessions,
    rollingRanges,
    0,
  );
  const chartData = buildChartData(weekly);
  const diagnostics = buildReadModelDiagnostics(
    compiledSessions,
    trackerHealth,
    resolveLiveCutoffMs(trackerHealth, nowMs),
  );

  // Keep read-model shaping in memory only for now. The hot paths get lighter
  // without introducing persistent summary tables or premature caching.
  return {
    compiledSessions,
    timelineSessions,
    appSummary,
    weekly,
    chartData,
    chartAxis: buildChartAxis(chartData),
    hourlyActivity,
    hourlyCategoryActivity,
    diagnostics,
  };
}
