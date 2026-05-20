import type { HistorySession } from "../../../shared/types/sessions.ts";
import {
  compileSessions,
  buildDailySummaries,
  buildNormalizedAppStats,
  getRollingDayRanges,
  type SessionRange,
} from "../../../shared/lib/sessionReadCompiler.ts";
import { getUiLocale, UI_TEXT } from "../../../shared/copy/uiText.ts";

export type { HistorySession };

export type DataTrendRange = 7 | 30 | 365;

export interface DataTrendPoint {
  label: string;
  hours: number;
}

export interface DataTrendMetricLabels {
  total: string;
  average: string;
  averageHint: string;
}

export interface DataTrendViewModel {
  title: string;
  rangeLabel: string;
  rangeDays: number;
  totalDuration: number;
  averageDuration: number;
  averageDivisor: number;
  chartData: DataTrendPoint[];
  chartAxis: {
    domainMax: number;
    ticks: number[];
  };
  metricLabels: DataTrendMetricLabels;
}

export interface DataAppOption {
  appKey: string;
  appName: string;
  exeName: string;
  totalDuration: number;
  percentage: number;
  averageDuration: number;
  activeDayCount: number;
}

export interface DataAppTrendPoint {
  label: string;
  date: string;
  hours: number;
  duration: number;
}

export interface DataAppDayRow {
  date: string;
  label: string;
  duration: number;
  intensity: number;
}

export interface DataAppTrendViewModel {
  range: DataTrendRange;
  rangeLabel: string;
  appOptions: DataAppOption[];
  selectedApp: DataAppOption | null;
  chartData: DataAppTrendPoint[];
  chartAxis: DataTrendViewModel["chartAxis"];
  dayRows: DataAppDayRow[];
  peakDay: DataAppDayRow | null;
}

export interface HeatmapCell {
  key: string;
  date: string;
  duration: number;
  intensity: number;
  isFuture: boolean;
  isOutsideYear: boolean;
  label: string;
}

export interface HeatmapWeek {
  key: string;
  monthLabel: string;
  cells: HeatmapCell[];
}

export type HeatmapSelection = "recent" | number;

export interface HeatmapRange {
  start: Date;
  end: Date;
  weekCount: number;
}

export interface DataHeatmapSnapshot {
  earliestStartTime: number | null;
  sessions: HistorySession[];
  range: HeatmapRange;
  cacheKey: string;
}

export interface DataHeatmapDependencies {
  getEarliestSessionStartTime: () => Promise<number | null>;
  getSessionsInRange: (startMs: number, endMs: number) => Promise<HistorySession[]>;
}

const RECENT_HEATMAP_WEEK_COUNT = 53;
const heatmapSessionCache = new Map<string, HistorySession[]>();
let earliestSessionStartTimeCache: number | null | undefined;
function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, delta: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + delta);
  return next;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatHeatmapDateLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(getUiLocale(), { month: "2-digit", day: "2-digit" });
}

function formatDuration(durationMs: number) {
  const safeMs = Math.max(0, durationMs);
  const totalSeconds = Math.floor(safeMs / 1000);
  const totalMinutes = Math.floor(safeMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (totalMinutes > 0) return `${minutes}m`;
  if (totalSeconds > 0) return `${totalSeconds}s`;
  return "<1s";
}

function formatHeatmapMonthLabel(date: Date) {
  return UI_TEXT.date.monthLabel(date.getMonth() + 1);
}

function buildChartAxis(points: DataTrendPoint[]) {
  const maxHours = Math.max(0, ...points.map((point) => point.hours));
  const intervalCount = 3;
  const rawStep = Math.max(1, maxHours / intervalCount);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalizedStep = rawStep / magnitude;
  const niceMultiplier = [1, 2, 3, 4, 6, 8, 10].find((multiplier) => normalizedStep <= multiplier) ?? 10;
  const axisStep = Math.max(1, niceMultiplier * magnitude);
  const domainMax = Math.max(axisStep * intervalCount, Math.ceil(maxHours / axisStep) * axisStep);

  return {
    domainMax,
    ticks: Array.from({ length: 4 }, (_, index) => (domainMax / intervalCount) * index),
  };
}

function formatMonthLabel(monthKey: string) {
  const month = Number(monthKey.slice(5, 7));
  return UI_TEXT.date.monthLabel(month);
}

function formatAppDayLabel(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00`);
  return date.toLocaleDateString(getUiLocale(), { month: "2-digit", day: "2-digit", weekday: "short" });
}

function getRecentMonthRanges(nowMs: number, monthCount: number): SessionRange[] {
  const now = new Date(nowMs);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  return Array.from({ length: monthCount }, (_, index) => {
    const monthStart = new Date(currentMonthStart);
    monthStart.setMonth(currentMonthStart.getMonth() - (monthCount - 1 - index));
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthStart.getMonth() + 1);

    return {
      startMs: monthStart.getTime(),
      endMs: Math.min(monthEnd.getTime(), nowMs),
    };
  });
}

function getRangeBounds(ranges: SessionRange[]) {
  const firstRange = ranges[0];
  const lastRange = ranges[ranges.length - 1];
  return {
    startMs: firstRange?.startMs ?? 0,
    endMs: lastRange?.endMs ?? 0,
  };
}

function getClippedSessionDuration(
  session: { startTime: number; endTime: number | null },
  rangeStartMs: number,
  rangeEndMs: number,
) {
  const clippedStart = Math.max(session.startTime, rangeStartMs);
  const clippedEnd = Math.min(session.endTime ?? session.startTime, rangeEndMs);
  return Math.max(0, clippedEnd - clippedStart);
}

function buildAppDayRows(
  sessions: ReturnType<typeof compileSessions>,
  dayRanges: SessionRange[],
) {
  const rows = dayRanges.map((range) => {
    const date = toDateKey(new Date(range.startMs));
    return {
      date,
      label: formatAppDayLabel(date),
      duration: sessions.reduce(
        (sum, session) => sum + getClippedSessionDuration(session, range.startMs, range.endMs),
        0,
      ),
      intensity: 0,
    };
  });
  const maxDuration = Math.max(1, ...rows.map((row) => row.duration));

  return rows.map((row) => ({
    ...row,
    intensity: row.duration > 0 ? Math.max(0.08, row.duration / maxDuration) : 0,
  }));
}

function countActiveRanges(
  sessions: ReturnType<typeof compileSessions>,
  ranges: SessionRange[],
) {
  return ranges.reduce((count, range) => (
    sessions.some((session) => getClippedSessionDuration(session, range.startMs, range.endMs) > 0)
      ? count + 1
      : count
  ), 0);
}

function resolveAppKeyByStats(
  appName: string,
  exeName: string,
  sessions: ReturnType<typeof compileSessions>,
) {
  return sessions.find((session) => (
    session.appKey === exeName
    || (session.displayName === appName && session.exeName === exeName)
    || session.displayName === appName
  ))?.appKey ?? exeName;
}

function groupSessionsByAppKey(sessions: ReturnType<typeof compileSessions>) {
  const sessionsByAppKey = new Map<string, ReturnType<typeof compileSessions>>();

  for (const session of sessions) {
    const appSessions = sessionsByAppKey.get(session.appKey);
    if (appSessions) {
      appSessions.push(session);
    } else {
      sessionsByAppKey.set(session.appKey, [session]);
    }
  }

  return sessionsByAppKey;
}

function getAppOptionIdentity(appName: string, exeName: string) {
  return `${appName.trim().toLowerCase()}|${exeName.trim().toLowerCase()}`;
}

export function getDataTrendRangeLabel(range: DataTrendRange) {
  if (range === 7) return UI_TEXT.data.pastSevenDays;
  if (range === 30) return UI_TEXT.data.pastThirtyDays;
  return UI_TEXT.data.recentYear;
}

export function buildDataTrendViewModel(
  sessions: HistorySession[],
  range: DataTrendRange,
  nowMs: number,
): DataTrendViewModel {
  const dayRanges = getRollingDayRanges(range, nowMs);
  const shouldGroupByMonth = range === 365;
  const summaryRanges = shouldGroupByMonth ? getRecentMonthRanges(nowMs, 12) : dayRanges;
  const summaries = buildDailySummaries(sessions, summaryRanges, 0);
  const totalDuration = summaries.reduce((sum, item) => sum + item.totalDuration, 0);
  const averageDivisor = Math.max(1, shouldGroupByMonth ? summaries.length : dayRanges.length);
  const chartData = summaries.map((item) => ({
    label: shouldGroupByMonth ? formatMonthLabel(item.date.slice(0, 7)) : item.date.slice(5),
    hours: Math.max(0, item.totalDuration) / 3600000,
  }));
  const rangeLabel = getDataTrendRangeLabel(range);

  return {
    title: rangeLabel,
    rangeLabel,
    rangeDays: range,
    totalDuration,
    averageDuration: Math.round(totalDuration / averageDivisor),
    averageDivisor,
    chartData,
    chartAxis: buildChartAxis(chartData),
    metricLabels: {
      total: UI_TEXT.data.trendTotal(range),
      average: shouldGroupByMonth ? UI_TEXT.data.yearlyAverage : UI_TEXT.data.dailyAverage,
      averageHint: shouldGroupByMonth ? UI_TEXT.data.yearlyAverageHint : UI_TEXT.data.rangeAverageHint(rangeLabel),
    },
  };
}

export function buildDataAppTrendViewModel(
  sessions: HistorySession[],
  range: DataTrendRange,
  nowMs: number,
  selectedAppKey: string | null,
): DataAppTrendViewModel {
  const dayRanges = getRollingDayRanges(range, nowMs);
  const shouldGroupByMonth = range === 365;
  const averageDivisor = Math.max(1, shouldGroupByMonth ? getRecentMonthRanges(nowMs, 12).length : dayRanges.length);
  const { startMs, endMs } = getRangeBounds(dayRanges);
  const compiledSessions = compileSessions(sessions, {
    startMs,
    endMs,
    minSessionSecs: 0,
  });
  const sessionsByAppKey = groupSessionsByAppKey(compiledSessions);
  const activeDayCountsByAppKey = new Map<string, number>();
  const appStats = buildNormalizedAppStats(compiledSessions);
  const totalAppDuration = appStats.reduce((sum, item) => sum + item.totalDuration, 0);
  const mergedAppStats = new Map<string, {
    appKey: string;
    sourceAppKeys: string[];
    appName: string;
    exeName: string;
    totalDuration: number;
  }>();

  for (const item of appStats) {
    const appKey = resolveAppKeyByStats(item.appName, item.exeName, compiledSessions);
    const identity = getAppOptionIdentity(item.appName, item.exeName);
    const existing = mergedAppStats.get(identity);

    if (existing) {
      existing.totalDuration += item.totalDuration;
      if (!existing.sourceAppKeys.includes(appKey)) {
        existing.sourceAppKeys.push(appKey);
      }
      continue;
    }

    mergedAppStats.set(identity, {
      appKey,
      sourceAppKeys: [appKey],
      appName: item.appName,
      exeName: item.exeName,
      totalDuration: item.totalDuration,
    });
  }

  const mergedOptions = Array.from(mergedAppStats.values()).map((item) => {
    const appSessions = item.sourceAppKeys.flatMap((appKey) => sessionsByAppKey.get(appKey) ?? []);
    const activeDayCount = activeDayCountsByAppKey.get(item.appKey)
      ?? countActiveRanges(appSessions, dayRanges);
    activeDayCountsByAppKey.set(item.appKey, activeDayCount);
    return {
      appKey: item.appKey,
      sourceAppKeys: item.sourceAppKeys,
      appName: item.appName,
      exeName: item.exeName,
      totalDuration: item.totalDuration,
      percentage: totalAppDuration > 0 ? (item.totalDuration / totalAppDuration) * 100 : 0,
      averageDuration: Math.round(item.totalDuration / averageDivisor),
      activeDayCount,
    };
  }).sort((a, b) => b.totalDuration - a.totalDuration);
  const selectedMergedApp = mergedOptions.find((item) => (
    item.appKey === selectedAppKey || item.sourceAppKeys.includes(selectedAppKey ?? "")
  )) ?? mergedOptions[0] ?? null;
  const selectedApp = selectedMergedApp
    ? {
      appKey: selectedMergedApp.appKey,
      appName: selectedMergedApp.appName,
      exeName: selectedMergedApp.exeName,
      totalDuration: selectedMergedApp.totalDuration,
      percentage: selectedMergedApp.percentage,
      averageDuration: selectedMergedApp.averageDuration,
      activeDayCount: selectedMergedApp.activeDayCount,
    }
    : null;
  const appOptions = mergedOptions.map((item) => ({
    appKey: item.appKey,
    appName: item.appName,
    exeName: item.exeName,
    totalDuration: item.totalDuration,
    percentage: item.percentage,
    averageDuration: item.averageDuration,
    activeDayCount: item.activeDayCount,
  }));
  const selectedSessions = selectedMergedApp
    ? selectedMergedApp.sourceAppKeys.flatMap((appKey) => sessionsByAppKey.get(appKey) ?? [])
    : [];
  const selectedDayRows = selectedApp ? buildAppDayRows(selectedSessions, dayRanges) : [];
  const chartRanges = shouldGroupByMonth ? getRecentMonthRanges(nowMs, 12) : dayRanges;
  const chartData = chartRanges.map((rangeItem) => {
    const date = toDateKey(new Date(rangeItem.startMs));
    const duration = selectedSessions.reduce(
      (sum, session) => sum + getClippedSessionDuration(session, rangeItem.startMs, rangeItem.endMs),
      0,
    );
    return {
      label: shouldGroupByMonth ? formatMonthLabel(date.slice(0, 7)) : date.slice(5),
      date,
      duration,
      hours: duration / 3600000,
    };
  });
  const peakDay = selectedDayRows.reduce<DataAppDayRow | null>((peak, row) => {
    if (!peak || row.duration > peak.duration) {
      return row;
    }
    return peak;
  }, null);

  return {
    range,
    rangeLabel: getDataTrendRangeLabel(range),
    appOptions,
    selectedApp,
    chartData,
    chartAxis: buildChartAxis(chartData),
    dayRows: selectedDayRows.slice().reverse(),
    peakDay: peakDay && peakDay.duration > 0 ? peakDay : null,
  };
}

async function resolveDefaultDataHeatmapDependencies(): Promise<DataHeatmapDependencies> {
  const repository = await import("../../../platform/persistence/sessionReadRepository.ts");
  return {
    getEarliestSessionStartTime: repository.getEarliestSessionStartTime,
    getSessionsInRange: repository.getSessionsInRange,
  };
}

export function resetDataReadModelCacheForTests() {
  heatmapSessionCache.clear();
  earliestSessionStartTimeCache = undefined;
}

export function clearDataReadModelCache() {
  heatmapSessionCache.clear();
  earliestSessionStartTimeCache = undefined;
}

export function getCachedEarliestSessionStartTime() {
  return earliestSessionStartTimeCache;
}

export function getHeatmapRange(selection: HeatmapSelection, nowMs: number): HeatmapRange {
  if (selection === "recent") {
    const todayStart = startOfLocalDay(new Date(nowMs));
    const mondayOffset = (todayStart.getDay() + 6) % 7;
    const currentWeekStart = addDays(todayStart, -mondayOffset);
    return {
      start: addDays(currentWeekStart, -(RECENT_HEATMAP_WEEK_COUNT - 1) * 7),
      end: addDays(currentWeekStart, 7),
      weekCount: RECENT_HEATMAP_WEEK_COUNT,
    };
  }

  const yearStart = new Date(selection, 0, 1);
  const nextYearStart = new Date(selection + 1, 0, 1);
  const mondayOffset = (yearStart.getDay() + 6) % 7;
  const heatmapStart = addDays(yearStart, -mondayOffset);
  const lastYearDay = addDays(nextYearStart, -1);
  const lastWeekEndOffset = 6 - ((lastYearDay.getDay() + 6) % 7);
  const heatmapEnd = addDays(lastYearDay, lastWeekEndOffset + 1);

  return {
    start: heatmapStart,
    end: heatmapEnd,
    weekCount: Math.ceil((heatmapEnd.getTime() - heatmapStart.getTime()) / (7 * 24 * 60 * 60 * 1000)),
  };
}

export function getHeatmapSelectionKey(selection: HeatmapSelection, nowMs: number) {
  const range = getHeatmapRange(selection, nowMs);
  return `${selection}:${toDateKey(range.start)}:${toDateKey(range.end)}`;
}

export function getCachedDataHeatmapSessions(selection: HeatmapSelection, nowMs: number) {
  return heatmapSessionCache.get(getHeatmapSelectionKey(selection, nowMs));
}

export function buildYearOptions(earliestStartTime: number | null, currentYear: number) {
  const earliestYear = earliestStartTime ? new Date(earliestStartTime).getFullYear() : currentYear;
  const firstYear = Math.min(earliestYear, currentYear);
  return Array.from(
    { length: currentYear - firstYear + 1 },
    (_, index) => currentYear - index,
  );
}

export function buildActivityHeatmap(
  sessions: HistorySession[],
  selection: HeatmapSelection,
  nowMs: number,
): HeatmapWeek[] {
  const { start: heatmapStart, weekCount } = getHeatmapRange(selection, nowMs);
  const todayStart = startOfLocalDay(new Date(nowMs));
  const dayBuckets = new Map<string, number>();

  for (let dayIndex = 0; dayIndex < weekCount * 7; dayIndex += 1) {
    dayBuckets.set(toDateKey(addDays(heatmapStart, dayIndex)), 0);
  }

  for (const session of sessions) {
    const sessionStart = session.startTime;
    const sessionEnd = session.endTime ?? nowMs;
    if (sessionEnd <= sessionStart) continue;

    let cursor = startOfLocalDay(new Date(sessionStart));
    while (cursor.getTime() < sessionEnd) {
      const dayStart = cursor.getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;
      const clippedStart = Math.max(sessionStart, dayStart);
      const clippedEnd = Math.min(sessionEnd, dayEnd);
      const key = toDateKey(cursor);
      const previous = dayBuckets.get(key);

      if (previous !== undefined && clippedEnd > clippedStart) {
        dayBuckets.set(key, previous + clippedEnd - clippedStart);
      }

      cursor = addDays(cursor, 1);
    }
  }

  const maxDuration = Math.max(1, ...Array.from(dayBuckets.values()));

  return Array.from({ length: weekCount }, (_, weekIndex) => {
    const weekStart = addDays(heatmapStart, weekIndex * 7);
    const monthStartInWeek = Array.from({ length: 7 }, (_, weekdayIndex) => addDays(weekStart, weekdayIndex))
      .find((date) => (selection === "recent" || date.getFullYear() === selection) && date.getDate() === 1);
    return {
      key: toDateKey(weekStart),
      monthLabel: monthStartInWeek ? formatHeatmapMonthLabel(monthStartInWeek) : "",
      cells: Array.from({ length: 7 }, (_, weekdayIndex) => {
        const date = addDays(weekStart, weekdayIndex);
        const dateKey = toDateKey(date);
        const duration = dayBuckets.get(dateKey) ?? 0;
        const isFuture = date.getTime() > todayStart.getTime();
        const isOutsideYear = selection !== "recent" && date.getFullYear() !== selection;
        return {
          key: dateKey,
          date: dateKey,
          duration,
          isFuture,
          isOutsideYear,
          intensity: duration <= 0 || isFuture || isOutsideYear ? 0 : Math.max(0.16, duration / maxDuration),
          label: `${formatHeatmapDateLabel(dateKey)} · ${isFuture ? UI_TEXT.data.notStarted : formatDuration(duration)}`,
        };
      }),
    };
  });
}

export async function loadDataHeatmapSnapshot(
  selection: HeatmapSelection,
  nowMs: number = Date.now(),
  deps?: DataHeatmapDependencies,
): Promise<DataHeatmapSnapshot> {
  const resolvedDeps = deps ?? await resolveDefaultDataHeatmapDependencies();
  const range = getHeatmapRange(selection, nowMs);
  const cacheKey = getHeatmapSelectionKey(selection, nowMs);
  const earliestStartTimePromise = earliestSessionStartTimeCache === undefined
    ? resolvedDeps.getEarliestSessionStartTime()
    : Promise.resolve(earliestSessionStartTimeCache);

  const [earliestStartTime, sessions] = await Promise.all([
    earliestStartTimePromise,
    resolvedDeps.getSessionsInRange(range.start.getTime(), range.end.getTime()),
  ]);

  earliestSessionStartTimeCache = earliestStartTime;
  heatmapSessionCache.set(cacheKey, sessions);

  return {
    earliestStartTime,
    sessions,
    range,
    cacheKey,
  };
}
