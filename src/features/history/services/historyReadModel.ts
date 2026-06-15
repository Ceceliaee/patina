import type { DailySummary, HistorySession } from "../../../shared/types/sessions.ts";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking.ts";
import type {
  WebActivitySegment,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
import {
  getHistoryByDate,
  getSessionsInRange,
} from "../../../platform/persistence/sessionReadRepository.ts";
import {
  getWebActivitySegmentsInRange,
  loadWebDomainOverrides,
} from "../../../platform/persistence/webActivityRepository.ts";
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
  dayWebSegments: WebActivitySegment[];
  webDomainOverrides: Record<string, WebDomainOverride>;
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

interface HistorySnapshotDeps {
  getHistoryByDate: typeof getHistoryByDate;
  getSessionsInRange: typeof getSessionsInRange;
  getWebActivitySegmentsInRange: typeof getWebActivitySegmentsInRange;
  loadWebDomainOverrides: typeof loadWebDomainOverrides;
}

const DEFAULT_HISTORY_SNAPSHOT_DEPS: HistorySnapshotDeps = {
  getHistoryByDate,
  getSessionsInRange,
  getWebActivitySegmentsInRange,
  loadWebDomainOverrides,
};

let warnedWebHistoryFallback = false;

async function loadOptionalWebSnapshotPart(
  deps: HistorySnapshotDeps,
  selectedDayRange: { startMs: number; endMs: number },
): Promise<Pick<HistorySnapshot, "dayWebSegments" | "webDomainOverrides">> {
  try {
    const [dayWebSegments, webDomainOverrides] = await Promise.all([
      deps.getWebActivitySegmentsInRange(selectedDayRange.startMs, selectedDayRange.endMs),
      deps.loadWebDomainOverrides(),
    ]);

    return {
      dayWebSegments,
      webDomainOverrides,
    };
  } catch (error) {
    if (!warnedWebHistoryFallback) {
      warnedWebHistoryFallback = true;
      console.warn("History web activity data is unavailable; continuing with app history only.", error);
    }
    return {
      dayWebSegments: [],
      webDomainOverrides: {},
    };
  }
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
  deps: HistorySnapshotDeps = DEFAULT_HISTORY_SNAPSHOT_DEPS,
): Promise<HistorySnapshot> {
  const selectedDayRange = getDayRange(date);
  const rollingRanges = getRollingDayRanges(rollingDayCount);
  const weeklyRangeStart = rollingRanges[0]?.startMs ?? selectedDayRange.startMs;
  const weeklyRangeEnd = rollingRanges[rollingRanges.length - 1]?.endMs ?? selectedDayRange.endMs;

  const [daySessions, weeklySessions, webSnapshotPart] = await Promise.all([
    deps.getHistoryByDate(date),
    deps.getSessionsInRange(weeklyRangeStart, weeklyRangeEnd),
    loadOptionalWebSnapshotPart(deps, selectedDayRange),
  ]);

  return {
    fetchedAtMs: Date.now(),
    daySessions,
    weeklySessions,
    dayWebSegments: webSnapshotPart.dayWebSegments,
    webDomainOverrides: webSnapshotPart.webDomainOverrides,
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
