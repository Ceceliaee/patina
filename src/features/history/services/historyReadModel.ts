import type { DailySummary, HistorySession } from "../../../shared/types/sessions.ts";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking.ts";
import type {
  WebActivitySegment,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
import {
  getHistoryByDate,
  getSessionsInRange,
  getSessionsInRangeWithoutTitleSamples,
} from "../../../platform/persistence/sessionReadRepository.ts";
import {
  getWebFaviconsForDomains,
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
import { getCachedHistoryIconsForExecutables } from "./historyIconService.ts";

export interface HistorySnapshot {
  fetchedAtMs: number;
  icons: Record<string, string>;
  daySessions: HistorySession[];
  weeklySessions: HistorySession[];
  dayWebSegments: WebActivitySegment[];
  webDomainFavicons: Record<string, string>;
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

export interface HistorySnapshotDeps {
  getHistoryByDate: typeof getHistoryByDate;
  getSessionsInRange: typeof getSessionsInRange;
  getDaySessionsInRange?: typeof getSessionsInRangeWithoutTitleSamples;
  getWeeklySessionsInRange?: typeof getSessionsInRangeWithoutTitleSamples;
  getWebActivitySegmentsInRange: typeof getWebActivitySegmentsInRange;
  getWebFaviconsForDomains: typeof getWebFaviconsForDomains;
  loadWebDomainOverrides: typeof loadWebDomainOverrides;
}

export interface HistorySnapshotLoadOptions {
  includeWebActivity?: boolean;
  includeTitleDetails?: boolean;
}

const DEFAULT_HISTORY_SNAPSHOT_DEPS: HistorySnapshotDeps = {
  getHistoryByDate,
  getSessionsInRange,
  getDaySessionsInRange: getSessionsInRangeWithoutTitleSamples,
  getWeeklySessionsInRange: getSessionsInRangeWithoutTitleSamples,
  getWebActivitySegmentsInRange,
  getWebFaviconsForDomains,
  loadWebDomainOverrides,
};

let warnedWebHistoryFallback = false;
let warnedWebFaviconFallback = false;

function collectHistoryIconExecutables(...sessionGroups: HistorySession[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const sessions of sessionGroups) {
    for (const session of sessions) {
      const exeName = session.exeName.trim();
      if (!exeName || seen.has(exeName)) continue;

      seen.add(exeName);
      result.push(exeName);
    }
  }

  return result;
}

function getCachedHistoryIconMap(
  daySessions: HistorySession[],
  weeklySessions: HistorySession[],
): Record<string, string> {
  return getCachedHistoryIconsForExecutables(
    collectHistoryIconExecutables(daySessions, weeklySessions),
  );
}

async function loadOptionalWebFaviconMap(
  deps: HistorySnapshotDeps,
  dayWebSegments: WebActivitySegment[],
): Promise<Record<string, string>> {
  try {
    return await deps.getWebFaviconsForDomains(
      Array.from(new Set(dayWebSegments.map((segment) => segment.normalizedDomain))),
    );
  } catch (error) {
    if (!warnedWebFaviconFallback) {
      warnedWebFaviconFallback = true;
      console.warn("History web favicon cache is unavailable; continuing without domain favicons.", error);
    }
    return {};
  }
}

export async function loadHistoryWebFaviconsForSegments(
  dayWebSegments: WebActivitySegment[],
  deps: HistorySnapshotDeps = DEFAULT_HISTORY_SNAPSHOT_DEPS,
): Promise<Record<string, string>> {
  return loadOptionalWebFaviconMap(deps, dayWebSegments);
}

export async function loadHistoryDaySessionDetails(
  date: Date,
  deps: HistorySnapshotDeps = DEFAULT_HISTORY_SNAPSHOT_DEPS,
): Promise<HistorySession[]> {
  return deps.getHistoryByDate(date);
}

async function loadOptionalWebSnapshotPart(
  deps: HistorySnapshotDeps,
  selectedDayRange: { startMs: number; endMs: number },
): Promise<Pick<HistorySnapshot, "dayWebSegments" | "webDomainFavicons" | "webDomainOverrides">> {
  try {
    const [dayWebSegments, webDomainOverrides] = await Promise.all([
      deps.getWebActivitySegmentsInRange(selectedDayRange.startMs, selectedDayRange.endMs),
      deps.loadWebDomainOverrides(),
    ]);
    return {
      dayWebSegments,
      webDomainFavicons: {},
      webDomainOverrides,
    };
  } catch (error) {
    if (!warnedWebHistoryFallback) {
      warnedWebHistoryFallback = true;
      console.warn("History web activity data is unavailable; continuing with app history only.", error);
    }
    return {
      dayWebSegments: [],
      webDomainFavicons: {},
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
  options: HistorySnapshotLoadOptions = {},
): Promise<HistorySnapshot> {
  const selectedDayRange = getDayRange(date);
  const rollingRanges = getRollingDayRanges(rollingDayCount);
  const weeklyRangeStart = rollingRanges[0]?.startMs ?? selectedDayRange.startMs;
  const weeklyRangeEnd = rollingRanges[rollingRanges.length - 1]?.endMs ?? selectedDayRange.endMs;

  const includeWebActivity = options.includeWebActivity ?? true;
  const includeTitleDetails = options.includeTitleDetails ?? true;
  const loadDaySessions = includeTitleDetails
    ? () => deps.getHistoryByDate(date)
    : () => (deps.getDaySessionsInRange ?? deps.getWeeklySessionsInRange ?? deps.getSessionsInRange)(
      selectedDayRange.startMs,
      selectedDayRange.endMs,
    );
  const [daySessions, weeklySessions, webSnapshotPart] = await Promise.all([
    loadDaySessions(),
    (deps.getWeeklySessionsInRange ?? deps.getSessionsInRange)(weeklyRangeStart, weeklyRangeEnd),
    includeWebActivity
      ? loadOptionalWebSnapshotPart(deps, selectedDayRange)
      : Promise.resolve({
        dayWebSegments: [],
        webDomainFavicons: {},
        webDomainOverrides: {},
      }),
  ]);
  const icons = getCachedHistoryIconMap(daySessions, weeklySessions);

  return {
    fetchedAtMs: Date.now(),
    icons,
    daySessions,
    weeklySessions,
    dayWebSegments: webSnapshotPart.dayWebSegments,
    webDomainFavicons: webSnapshotPart.webDomainFavicons,
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
