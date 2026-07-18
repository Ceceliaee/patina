import type { DailySummary, HistorySession } from "../../../shared/types/sessions.ts";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking.ts";
import type {
  WebActivitySegment,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
import {
  getHistoryByDate,
  getImportedTimeBucketsInRange,
  getSessionsInRange,
  getSessionsInRangeWithoutTitleSamples,
  type AggregateSessionRecord,
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

export type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";

export interface HistorySnapshot {
  fetchedAtMs: number;
  icons: Record<string, string>;
  daySessions: HistorySession[];
  weeklySessions: HistorySession[];
  dayAggregateSessions?: AggregateSessionRecord[];
  weeklyAggregateSessions?: AggregateSessionRecord[];
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
  getImportedTimeBucketsInRange?: typeof getImportedTimeBucketsInRange;
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
  getImportedTimeBucketsInRange,
  getWebActivitySegmentsInRange,
  getWebFaviconsForDomains,
  loadWebDomainOverrides,
};

let warnedWebHistoryFallback = false;
let warnedWebFaviconFallback = false;

const HISTORY_WEB_FAVICON_RUNTIME_CACHE_LIMIT = 64;
const HISTORY_WEB_FAVICON_REFRESH_INTERVAL_MS = 30_000;
const HISTORY_WEB_FAVICON_SOURCE_MAX_CHARS = 8_192;
const historyWebFaviconRuntimeCache = new Map<string, string>();
const historyWebFaviconResolvedAt = new Map<string, number>();
let pendingHistoryWebFaviconRefresh: Promise<void> | null = null;

function normalizeHistoryWebDomain(domain: string): string {
  return domain.trim().toLowerCase();
}

function collectHistoryWebDomains(dayWebSegments: WebActivitySegment[]): string[] {
  return Array.from(new Set(
    dayWebSegments
      .map((segment) => normalizeHistoryWebDomain(segment.normalizedDomain))
      .filter(Boolean),
  ));
}

function touchHistoryWebFaviconDomain(domain: string, resolvedAtMs: number): void {
  historyWebFaviconResolvedAt.delete(domain);
  historyWebFaviconResolvedAt.set(domain, resolvedAtMs);

  const favicon = historyWebFaviconRuntimeCache.get(domain);
  if (favicon) {
    historyWebFaviconRuntimeCache.delete(domain);
    historyWebFaviconRuntimeCache.set(domain, favicon);
  }

  while (historyWebFaviconResolvedAt.size > HISTORY_WEB_FAVICON_RUNTIME_CACHE_LIMIT) {
    const oldestDomain = historyWebFaviconResolvedAt.keys().next().value;
    if (!oldestDomain) break;
    historyWebFaviconResolvedAt.delete(oldestDomain);
    historyWebFaviconRuntimeCache.delete(oldestDomain);
  }
}

function rememberHistoryWebFaviconRefresh(
  domains: string[],
  favicons: Record<string, string>,
  resolvedAtMs: number,
): void {
  const normalizedFavicons = new Map(
    Object.entries(favicons).map(([domain, favicon]) => [
      normalizeHistoryWebDomain(domain),
      favicon.trim(),
    ]),
  );

  for (const domain of domains) {
    const favicon = normalizedFavicons.get(domain) ?? "";
    if (favicon && favicon.length <= HISTORY_WEB_FAVICON_SOURCE_MAX_CHARS) {
      historyWebFaviconRuntimeCache.set(domain, favicon);
    } else {
      historyWebFaviconRuntimeCache.delete(domain);
    }
    touchHistoryWebFaviconDomain(domain, resolvedAtMs);
  }
}

export function getCachedHistoryWebFaviconsForSegments(
  dayWebSegments: WebActivitySegment[],
): Record<string, string> {
  const favicons: Record<string, string> = {};
  for (const domain of collectHistoryWebDomains(dayWebSegments)) {
    const favicon = historyWebFaviconRuntimeCache.get(domain);
    if (favicon) favicons[domain] = favicon;
  }
  return favicons;
}

export function areHistoryWebFaviconsResolvedForSegments(
  dayWebSegments: WebActivitySegment[],
): boolean {
  return collectHistoryWebDomains(dayWebSegments).every((domain) => (
    historyWebFaviconResolvedAt.has(domain)
  ));
}

export function resetHistoryWebFaviconRuntimeCacheForTests(): void {
  historyWebFaviconRuntimeCache.clear();
  historyWebFaviconResolvedAt.clear();
  pendingHistoryWebFaviconRefresh = null;
}

export function getHistoryWebFaviconRuntimeCacheStats() {
  return {
    entries: historyWebFaviconRuntimeCache.size,
    limit: HISTORY_WEB_FAVICON_RUNTIME_CACHE_LIMIT,
    resolvedDomains: historyWebFaviconResolvedAt.size,
    pendingRefresh: pendingHistoryWebFaviconRefresh !== null,
  };
}

type HistoryIconRecord = Pick<HistorySession, "exeName"> | Pick<AggregateSessionRecord, "exeName">;

function collectHistoryIconExecutables(...sessionGroups: HistoryIconRecord[][]): string[] {
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
  dayAggregateSessions: AggregateSessionRecord[],
  weeklyAggregateSessions: AggregateSessionRecord[],
): Record<string, string> {
  return getCachedHistoryIconsForExecutables(
    collectHistoryIconExecutables(
      daySessions,
      weeklySessions,
      dayAggregateSessions,
      weeklyAggregateSessions,
    ),
  );
}

function mapAggregateSessionsForSummary(
  records: AggregateSessionRecord[],
): HistorySession[] {
  return records.map((record, index) => ({
    id: -(index + 1),
    appName: record.appName,
    exeName: record.exeName,
    windowTitle: "",
    startTime: record.startTime,
    endTime: record.endTime,
    duration: Math.max(0, record.endTime - record.startTime),
    continuityGroupStartTime: record.startTime,
    titleSampleDetails: [],
  }));
}

async function loadOptionalWebFaviconMap(
  deps: HistorySnapshotDeps,
  dayWebSegments: WebActivitySegment[],
): Promise<Record<string, string>> {
  const domains = collectHistoryWebDomains(dayWebSegments);
  if (domains.length === 0) return {};

  const requestedAtMs = Date.now();
  if (pendingHistoryWebFaviconRefresh) {
    await pendingHistoryWebFaviconRefresh.catch(() => undefined);
  }

  const domainsToRefresh = domains.filter((domain) => (
    requestedAtMs - (historyWebFaviconResolvedAt.get(domain) ?? 0)
      >= HISTORY_WEB_FAVICON_REFRESH_INTERVAL_MS
  ));
  if (domainsToRefresh.length === 0) {
    return getCachedHistoryWebFaviconsForSegments(dayWebSegments);
  }

  const refresh = deps.getWebFaviconsForDomains(domainsToRefresh)
    .then((favicons) => {
      rememberHistoryWebFaviconRefresh(domainsToRefresh, favicons, Date.now());
    });
  pendingHistoryWebFaviconRefresh = refresh;

  try {
    await refresh;
  } catch (error) {
    if (!warnedWebFaviconFallback) {
      warnedWebFaviconFallback = true;
      console.warn("History web favicon cache is unavailable; continuing without domain favicons.", error);
    }
  } finally {
    if (pendingHistoryWebFaviconRefresh === refresh) {
      pendingHistoryWebFaviconRefresh = null;
    }
  }

  return getCachedHistoryWebFaviconsForSegments(dayWebSegments);
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
  const loadAggregateSessions = deps.getImportedTimeBucketsInRange
    ?? (async () => [] as AggregateSessionRecord[]);
  const [
    daySessions,
    weeklySessions,
    dayAggregateSessions,
    weeklyAggregateSessions,
    webSnapshotPart,
  ] = await Promise.all([
    loadDaySessions(),
    (deps.getWeeklySessionsInRange ?? deps.getSessionsInRange)(weeklyRangeStart, weeklyRangeEnd),
    loadAggregateSessions(selectedDayRange.startMs, selectedDayRange.endMs),
    loadAggregateSessions(weeklyRangeStart, weeklyRangeEnd),
    includeWebActivity
      ? loadOptionalWebSnapshotPart(deps, selectedDayRange)
      : Promise.resolve({
        dayWebSegments: [],
        webDomainFavicons: {},
        webDomainOverrides: {},
      }),
  ]);
  const icons = getCachedHistoryIconMap(
    daySessions,
    weeklySessions,
    dayAggregateSessions,
    weeklyAggregateSessions,
  );

  return {
    fetchedAtMs: Date.now(),
    icons,
    daySessions,
    weeklySessions,
    dayAggregateSessions,
    weeklyAggregateSessions,
    dayWebSegments: webSnapshotPart.dayWebSegments,
    webDomainFavicons: webSnapshotPart.webDomainFavicons,
    webDomainOverrides: webSnapshotPart.webDomainOverrides,
  };
}

export function buildHistoryReadModel(params: {
  daySessions: HistorySession[];
  weeklySessions: HistorySession[];
  dayAggregateSessions?: AggregateSessionRecord[];
  weeklyAggregateSessions?: AggregateSessionRecord[];
  trackerHealth: TrackerHealthSnapshot;
  selectedDate: Date;
  nowMs: number;
  minSessionSecs: number;
  mergeThresholdSecs: number;
}): HistoryReadModel {
  const {
    daySessions,
    weeklySessions,
    dayAggregateSessions = [],
    weeklyAggregateSessions = [],
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
  const summaryCompiledSessions = compileForRange(
    [...liveDaySessions, ...mapAggregateSessionsForSummary(dayAggregateSessions)],
    selectedDayRange,
    0,
  );
  const mergedTimelineSessions = buildTimelineSessions(compiledSessions, mergeThresholdSecs);
  const timelineSessions = filterTimelineSessionsForDisplay(
    mergedTimelineSessions,
    minSessionSecs,
  ).slice().reverse();
  const appSummary = buildAppSummary(buildNormalizedAppStats(summaryCompiledSessions));
  const hourlyActivity = buildHourlyActivity(summaryCompiledSessions);
  const hourlyCategoryActivity = buildHourlyCategoryActivity(summaryCompiledSessions);
  const weekly = buildDailySummaries(
    [...liveWeeklySessions, ...mapAggregateSessionsForSummary(weeklyAggregateSessions)],
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
