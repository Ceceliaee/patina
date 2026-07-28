import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { SessionRange } from "../../../shared/lib/sessionReadCompiler.ts";
import { getUiLocale, UI_TEXT } from "../../../shared/copy/index.ts";
import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";
import {
  buildDataDayRanges,
  buildDataMonthRanges,
  resolveDataTrendRange,
  type DataRollingTrendRange,
  type ResolvedDataTrendRange,
} from "./dataTrendRange.ts";
import {
  addLocalMonths,
  addLocalDays as addDays,
  formatLocalDateKey as toDateKey,
  startOfLocalDay,
  startOfLocalMonth,
} from "../../../shared/lib/localDate.ts";
import { pickPreferredAppName } from "../../../shared/lib/displayNameScoring.ts";
import {
  resolveStatisticalDataAppKey,
} from "./dataHeatmapReadModel.ts";
import type { DataDestinationTrendSummary } from "./dataDestinationState.ts";

export {
  buildActivityHeatmap,
  buildYearOptions,
  getHeatmapRange,
  getHeatmapSelectionKey,
  type HeatmapCell,
  type HeatmapRange,
  type HeatmapSelection,
  type HeatmapWeek,
} from "./dataHeatmapReadModel.ts";

export type { AggregateSessionRecord };
export {
  clearDataReadModelCache,
  getCachedDataHeatmapSessions,
  getCachedEarliestSessionStartTime,
  getDataHeatmapSessionCacheSizeForTests,
  getDataHeatmapSessionCacheStats,
  loadDataHeatmapSnapshot,
  prewarmRecentDataHeatmapCache,
  resetDataReadModelCacheForTests,
  type DataHeatmapDependencies,
  type DataHeatmapSnapshot,
} from "./dataHeatmapSnapshot.ts";

export type DataTrendRange = DataRollingTrendRange;

export interface DataTrendPoint {
  label: string;
  date: string | null;
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
  granularity: "day" | "month";
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

export interface DataDestinationChartSeries {
  key: string;
  dataKey: string;
  displayName: string;
}

export interface DataDestinationTrendChartRow {
  label: string;
  date: string;
  totalDuration: number;
  totalHours: number;
  [dataKey: string]: string | number;
}

export interface DataAppDayRow {
  date: string;
  label: string;
  duration: number;
  intensity: number;
}

export interface DataAppTrendViewModel {
  range: ResolvedDataTrendRange;
  rangeLabel: string;
  granularity: "day" | "month";
  appOptions: DataAppOption[];
  selectedApps: DataAppOption[];
  chartSeries: DataDestinationChartSeries[];
  chartRows: DataDestinationTrendChartRow[];
  summary: DataDestinationTrendSummary;
  chartAxis: DataTrendViewModel["chartAxis"];
  peakDay: DataAppDayRow | null;
}

interface CompiledDataSession extends AggregateSessionRecord {
  appKey: string;
  displayName: string; displayNameRank: number;
}

interface DataTrendAggregateContextOptions {
  includeAppBuckets?: boolean;
}

export interface DataAppDurationBucket {
  appKey: string;
  appName: string;
  exeName: string;
  totalDuration: number;
  dayDurations: Map<string, number>;
  monthDurations: Map<string, number>;
}

export interface DataDurationAggregate {
  totalDuration: number;
  dayDurations: Map<string, number>;
  monthDurations: Map<string, number>;
  appBuckets: Map<string, DataAppDurationBucket>;
}

export interface DataTrendAggregateContext {
  range: ResolvedDataTrendRange;
  dayRanges: SessionRange[];
  monthRanges: SessionRange[];
  aggregate: DataDurationAggregate;
}

interface MergedDataAppDurationBucket extends DataAppDurationBucket {
  sourceAppKeys: string[];
}

export function buildDataChartAxis(points: DataTrendPoint[]) {
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

const DATA_APP_DAY_LABEL_CACHE_LIMIT = 800;
const dataAppDayLabelCache = new Map<string, string>();

function formatAppDayLabel(dateKey: string) {
  const locale = getUiLocale();
  const cacheKey = `${locale}:${dateKey}`;
  const cached = dataAppDayLabelCache.get(cacheKey);
  if (cached) return cached;
  const date = new Date(`${dateKey}T00:00:00`);
  const label = date.toLocaleDateString(locale, { month: "2-digit", day: "2-digit", weekday: "short" });
  dataAppDayLabelCache.set(cacheKey, label);
  if (dataAppDayLabelCache.size > DATA_APP_DAY_LABEL_CACHE_LIMIT) {
    const oldestKey = dataAppDayLabelCache.keys().next().value;
    if (oldestKey) dataAppDayLabelCache.delete(oldestKey);
  }
  return label;
}

function resolveDataDisplayName(session: AggregateSessionRecord, appKey: string) {
  const overrideDisplayName = AppClassification.getUserOverride(appKey)?.displayName?.trim();
  if (overrideDisplayName) return overrideDisplayName;
  if (appKey !== AppClassification.normalizeExecutable(session.exeName)) {
    return AppClassification.mapApp(appKey).name;
  }
  return session.appName.trim() || AppClassification.mapApp(appKey).name;
}
function resolveDataDisplayNameRank(session: AggregateSessionRecord, appKey: string) {
  const isCanonicalExecutable = AppClassification.normalizeExecutable(session.exeName) === appKey;
  return AppClassification.getUserOverride(appKey)?.displayName?.trim()
    ? 3 : (isCanonicalExecutable ? (session.appName.trim() ? 2 : 1) : 0);
}

function compileDataSessions(
  sessions: AggregateSessionRecord[],
  range: SessionRange,
): CompiledDataSession[] {
  const compiledSessions: CompiledDataSession[] = [];

  for (const session of sessions) {
    const appKey = resolveStatisticalDataAppKey(session);
    if (!appKey) continue;

    const startTime = Math.max(session.startTime, range.startMs);
    const endTime = Math.min(session.endTime, range.endMs);
    if (endTime <= startTime) {
      continue;
    }

    compiledSessions.push({
      ...session,
      appKey,
      displayName: resolveDataDisplayName(session, appKey),
      displayNameRank: resolveDataDisplayNameRank(session, appKey),
      startTime,
      endTime,
    });
  }

  return compiledSessions;
}

function addDurationToBucket(buckets: Map<string, number>, key: string, duration: number) {
  if (duration <= 0) return;
  buckets.set(key, (buckets.get(key) ?? 0) + duration);
}

function getMonthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function createDurationBuckets(ranges: SessionRange[], getKey: (range: SessionRange) => string) {
  return new Map(ranges.map((range) => [getKey(range), 0]));
}

function createDayDurationBuckets(ranges: SessionRange[]) {
  return createDurationBuckets(ranges, (range) => toDateKey(new Date(range.startMs)));
}

function createMonthDurationBuckets(ranges: SessionRange[]) {
  return createDurationBuckets(ranges, (range) => getMonthKey(toDateKey(new Date(range.startMs))));
}

function resolveStatsExeName(session: CompiledDataSession) {
  return session.appKey === AppClassification.normalizeExecutable(session.exeName)
    ? session.exeName : session.appKey;
}
function getOrCreateAppDurationBucket(buckets: Map<string, DataAppDurationBucket>, displayNameRanks: Map<string, number>, session: CompiledDataSession) {
  const existing = buckets.get(session.appKey);
  if (existing) {
    const existingRank = displayNameRanks.get(session.appKey) ?? 0;
    if (session.displayNameRank > existingRank) {
      existing.appName = session.displayName;
    } else if (session.displayNameRank === existingRank) {
      existing.appName = pickPreferredAppName(existing.appName, session.displayName);
    }
    displayNameRanks.set(session.appKey, Math.max(existingRank, session.displayNameRank));
    return existing;
  }

  const bucket: DataAppDurationBucket = {
    appKey: session.appKey,
    appName: session.displayName,
    exeName: resolveStatsExeName(session),
    totalDuration: 0,
    dayDurations: new Map(),
    monthDurations: new Map(),
  };
  buckets.set(session.appKey, bucket);
  displayNameRanks.set(session.appKey, session.displayNameRank);
  return bucket;
}

function addSessionToDurationAggregate(
  aggregate: DataDurationAggregate, displayNameRanks: Map<string, number>,
  session: CompiledDataSession, range: SessionRange, includeAppBuckets: boolean,
) {
  const appBucket = includeAppBuckets
    ? getOrCreateAppDurationBucket(aggregate.appBuckets, displayNameRanks, session)
    : null;
  const sessionDuration = Math.max(0, session.endTime - session.startTime);

  aggregate.totalDuration += sessionDuration;
  if (appBucket) {
    appBucket.totalDuration += sessionDuration;
  }

  const shouldFillDayBuckets = aggregate.dayDurations.size > 0;
  const shouldFillMonthBuckets = aggregate.monthDurations.size > 0;

  if (shouldFillDayBuckets) {
    addSessionToDayDurationBuckets(aggregate, appBucket, session, range, shouldFillMonthBuckets);
  } else if (shouldFillMonthBuckets) {
    addSessionToMonthDurationBuckets(aggregate, appBucket, session, range);
  }
}

function addSessionToDayDurationBuckets(
  aggregate: DataDurationAggregate,
  appBucket: DataAppDurationBucket | null,
  session: CompiledDataSession,
  range: SessionRange,
  shouldFillMonthBuckets: boolean,
) {
  for (
    let cursor = startOfLocalDay(new Date(session.startTime));
    cursor.getTime() < session.endTime;
    cursor = addDays(cursor, 1)
  ) {
    const nextDay = addDays(cursor, 1);
    const clippedStart = Math.max(session.startTime, cursor.getTime(), range.startMs);
    const clippedEnd = Math.min(session.endTime, nextDay.getTime(), range.endMs);
    if (clippedEnd <= clippedStart) continue;

    const duration = clippedEnd - clippedStart;
    const dayKey = toDateKey(cursor);
    const monthKey = getMonthKey(dayKey);

    if (aggregate.dayDurations.has(dayKey)) {
      addDurationToBucket(aggregate.dayDurations, dayKey, duration);
      if (appBucket) {
        addDurationToBucket(appBucket.dayDurations, dayKey, duration);
      }
    }

    if (shouldFillMonthBuckets && aggregate.monthDurations.has(monthKey)) {
      addDurationToBucket(aggregate.monthDurations, monthKey, duration);
      if (appBucket) {
        addDurationToBucket(appBucket.monthDurations, monthKey, duration);
      }
    }
  }
}

function addSessionToMonthDurationBuckets(
  aggregate: DataDurationAggregate,
  appBucket: DataAppDurationBucket | null,
  session: CompiledDataSession,
  range: SessionRange,
) {
  for (
    let cursor = startOfLocalMonth(new Date(session.startTime));
    cursor.getTime() < session.endTime;
    cursor = addLocalMonths(cursor, 1)
  ) {
    const nextMonth = addLocalMonths(cursor, 1);
    const clippedStart = Math.max(session.startTime, cursor.getTime(), range.startMs);
    const clippedEnd = Math.min(session.endTime, nextMonth.getTime(), range.endMs);
    if (clippedEnd <= clippedStart) continue;

    const monthKey = getMonthKey(toDateKey(cursor));
    if (!aggregate.monthDurations.has(monthKey)) continue;

    const duration = clippedEnd - clippedStart;
    addDurationToBucket(aggregate.monthDurations, monthKey, duration);
    if (appBucket) {
      addDurationToBucket(appBucket.monthDurations, monthKey, duration);
    }
  }
}

function buildDataDurationAggregate(
  sessions: AggregateSessionRecord[],
  range: SessionRange,
  dayRanges: SessionRange[],
  monthRanges: SessionRange[],
  options: { includeAppBuckets?: boolean } = {},
): DataDurationAggregate {
  const aggregate: DataDurationAggregate = {
    totalDuration: 0,
    dayDurations: createDayDurationBuckets(dayRanges),
    monthDurations: createMonthDurationBuckets(monthRanges),
    appBuckets: new Map(),
  };
  const compiledSessions = compileDataSessions(sessions, range);
  const includeAppBuckets = options.includeAppBuckets ?? true;
  const displayNameRanks = new Map<string, number>();

  for (const session of compiledSessions) {
    addSessionToDurationAggregate(aggregate, displayNameRanks, session, range, includeAppBuckets);
  }

  return aggregate;
}

function buildAppDayRowsFromDurations(
  dayDurations: Map<string, number>,
  dayRanges: SessionRange[],
) {
  const rows = dayRanges.map((range) => {
    const date = toDateKey(new Date(range.startMs));
    return {
      date,
      label: formatAppDayLabel(date),
      duration: dayDurations.get(date) ?? 0,
      intensity: 0,
    };
  });
  const maxDuration = Math.max(1, ...rows.map((row) => row.duration));

  return rows.map((row) => ({
    ...row,
    intensity: row.duration > 0 ? Math.max(0.08, row.duration / maxDuration) : 0,
  }));
}

function getAppOptionIdentity(appName: string, exeName: string) {
  return `${appName.trim().toLowerCase()}|${exeName.trim().toLowerCase()}`;
}

function mergeDurationBuckets(target: Map<string, number>, source: Map<string, number>) {
  for (const [key, duration] of source.entries()) {
    addDurationToBucket(target, key, duration);
  }
}

function mergeDataAppDurationBuckets(appBuckets: Map<string, DataAppDurationBucket>) {
  const merged = new Map<string, MergedDataAppDurationBucket>();
  const sortedBuckets = Array.from(appBuckets.values()).sort((a, b) => b.totalDuration - a.totalDuration);

  for (const bucket of sortedBuckets) {
    const identity = getAppOptionIdentity(bucket.appName, bucket.exeName);
    const existing = merged.get(identity);

    if (existing) {
      existing.totalDuration += bucket.totalDuration;
      if (!existing.sourceAppKeys.includes(bucket.appKey)) {
        existing.sourceAppKeys.push(bucket.appKey);
      }
      mergeDurationBuckets(existing.dayDurations, bucket.dayDurations);
      mergeDurationBuckets(existing.monthDurations, bucket.monthDurations);
      continue;
    }

    merged.set(identity, {
      appKey: bucket.appKey,
      sourceAppKeys: [bucket.appKey],
      appName: bucket.appName,
      exeName: bucket.exeName,
      totalDuration: bucket.totalDuration,
      dayDurations: new Map(bucket.dayDurations),
      monthDurations: new Map(bucket.monthDurations),
    });
  }

  return Array.from(merged.values()).sort((a, b) => b.totalDuration - a.totalDuration);
}

function countActiveDurationDays(dayDurations: Map<string, number>) {
  let count = 0;
  for (const duration of dayDurations.values()) {
    if (duration > 0) count += 1;
  }
  return count;
}

export function getDataTrendRangeLabel(range: DataTrendRange) {
  if (range === 7) return UI_TEXT.data.pastSevenDays;
  if (range === 30) return UI_TEXT.data.pastThirtyDays;
  return UI_TEXT.data.recentYear;
}

function resolveDataTrendViewRange(
  selection: DataTrendRange | ResolvedDataTrendRange,
  nowMs: number,
) {
  return typeof selection === "number"
    ? resolveDataTrendRange({ kind: "rolling", days: selection }, nowMs)
    : selection;
}

export function buildDataTrendAggregateContext(
  sessions: AggregateSessionRecord[],
  selection: DataTrendRange | ResolvedDataTrendRange,
  nowMs: number,
  options: DataTrendAggregateContextOptions = {},
): DataTrendAggregateContext {
  const range = resolveDataTrendViewRange(selection, nowMs);
  const dayRanges = buildDataDayRanges(range);
  const shouldGroupByMonth = range.granularity === "month";
  const monthRanges = shouldGroupByMonth ? buildDataMonthRanges(range) : [];
  const includeAppBuckets = options.includeAppBuckets ?? true;
  const aggregate = buildDataDurationAggregate(
    sessions,
    range,
    shouldGroupByMonth && !includeAppBuckets ? [] : dayRanges,
    monthRanges,
    { includeAppBuckets },
  );

  return {
    range,
    dayRanges,
    monthRanges,
    aggregate,
  };
}

export function buildDataTrendViewModelFromAggregate(
  context: DataTrendAggregateContext,
): DataTrendViewModel {
  const { aggregate, dayRanges, monthRanges, range } = context;
  const shouldGroupByMonth = range.granularity === "month";
  const summaryRanges = shouldGroupByMonth ? monthRanges : dayRanges;
  const summaries = summaryRanges.map((summaryRange) => {
    const date = toDateKey(new Date(summaryRange.startMs));
    const totalDuration = shouldGroupByMonth
      ? aggregate.monthDurations.get(getMonthKey(date)) ?? 0
      : aggregate.dayDurations.get(date) ?? 0;
    return {
      date,
      totalDuration,
    };
  });
  const totalDuration = summaries.reduce((sum, item) => sum + item.totalDuration, 0);
  const averageDivisor = Math.max(1, shouldGroupByMonth ? summaries.length : dayRanges.length);
  const chartData = summaries.map((item) => ({
    label: shouldGroupByMonth ? formatMonthLabel(item.date.slice(0, 7)) : item.date.slice(5),
    date: shouldGroupByMonth ? null : item.date,
    hours: Math.max(0, item.totalDuration) / 3600000,
  }));
  const rangeLabel = range.label;

  return {
    title: rangeLabel,
    rangeLabel,
    rangeDays: range.dayCount,
    granularity: shouldGroupByMonth ? "month" : "day",
    totalDuration,
    averageDuration: Math.round(totalDuration / averageDivisor),
    averageDivisor,
    chartData,
    chartAxis: buildDataChartAxis(chartData),
    metricLabels: {
      total: UI_TEXT.data.rangeTotal(rangeLabel),
      average: shouldGroupByMonth ? UI_TEXT.data.yearlyAverage : UI_TEXT.data.dailyAverage,
      averageHint: shouldGroupByMonth ? UI_TEXT.data.yearlyAverageHint : UI_TEXT.data.rangeAverageHint(rangeLabel),
    },
  };
}

export function buildDataTrendViewModel(
  sessions: AggregateSessionRecord[],
  selection: DataTrendRange | ResolvedDataTrendRange,
  nowMs: number,
): DataTrendViewModel {
  return buildDataTrendViewModelFromAggregate(
    buildDataTrendAggregateContext(sessions, selection, nowMs, { includeAppBuckets: false }),
  );
}

export function buildDataAppTrendViewModelFromAggregate(
  context: DataTrendAggregateContext,
  selectedAppKeys: string | readonly string[] | null,
): DataAppTrendViewModel {
  const { aggregate, dayRanges, monthRanges, range } = context;
  const shouldGroupByMonth = range.granularity === "month";
  const chartRanges = shouldGroupByMonth ? monthRanges : dayRanges;
  const averageDivisor = Math.max(1, chartRanges.length);
  const totalAppDuration = aggregate.totalDuration;
  const mergedOptions = mergeDataAppDurationBuckets(aggregate.appBuckets).map((item) => ({
    appKey: item.appKey,
    sourceAppKeys: item.sourceAppKeys,
    appName: item.appName,
    exeName: item.exeName,
    totalDuration: item.totalDuration,
    percentage: totalAppDuration > 0 ? (item.totalDuration / totalAppDuration) * 100 : 0,
    averageDuration: Math.round(item.totalDuration / averageDivisor),
    activeDayCount: countActiveDurationDays(item.dayDurations),
    dayDurations: item.dayDurations,
    monthDurations: item.monthDurations,
  }));
  const requestedKeys = selectedAppKeys === null
    ? []
    : Array.isArray(selectedAppKeys) ? selectedAppKeys : [selectedAppKeys];
  const selectedMergedApps = Array.from(new Set(requestedKeys))
    .map((selectedKey) => mergedOptions.find((item) => (
      item.appKey === selectedKey || item.sourceAppKeys.includes(selectedKey)
    )) ?? {
      appKey: selectedKey,
      sourceAppKeys: [selectedKey],
      appName: selectedKey,
      exeName: selectedKey,
      totalDuration: 0,
      percentage: 0,
      averageDuration: 0,
      activeDayCount: 0,
      dayDurations: new Map<string, number>(),
      monthDurations: new Map<string, number>(),
    });
  if (selectedMergedApps.length === 0 && mergedOptions[0]) {
    selectedMergedApps.push(mergedOptions[0]);
  }
  const toAppOption = (item: typeof mergedOptions[number]): DataAppOption => ({
    appKey: item.appKey,
    appName: item.appName,
    exeName: item.exeName,
    totalDuration: item.totalDuration,
    percentage: item.percentage,
    averageDuration: item.averageDuration,
    activeDayCount: item.activeDayCount,
  });
  const selectedApps = selectedMergedApps.map(toAppOption);
  const appOptions = mergedOptions.map((item) => ({
    appKey: item.appKey,
    appName: item.appName,
    exeName: item.exeName,
    totalDuration: item.totalDuration,
    percentage: item.percentage,
    averageDuration: item.averageDuration,
    activeDayCount: item.activeDayCount,
  }));
  const selectedDayDurations = new Map<string, number>();
  for (const selected of selectedMergedApps) {
    for (const [dateKey, duration] of selected.dayDurations) {
      selectedDayDurations.set(dateKey, (selectedDayDurations.get(dateKey) ?? 0) + duration);
    }
  }
  const selectedDayRows = buildAppDayRowsFromDurations(selectedDayDurations, dayRanges);
  const chartSeries = selectedMergedApps.map((item, index) => ({
    key: item.appKey,
    dataKey: `series${index}`,
    displayName: item.appName,
  }));
  const chartRows = chartRanges.map((rangeItem) => {
    const date = toDateKey(new Date(rangeItem.startMs));
    const row: DataDestinationTrendChartRow = {
      label: shouldGroupByMonth ? formatMonthLabel(date.slice(0, 7)) : date.slice(5),
      date,
      totalDuration: 0,
      totalHours: 0,
    };
    for (const [index, selected] of selectedMergedApps.entries()) {
      const duration = shouldGroupByMonth
        ? selected.monthDurations.get(getMonthKey(date)) ?? 0
        : selected.dayDurations.get(date) ?? 0;
      row[`series${index}`] = duration / 3600000;
      row.totalDuration += duration;
    }
    row.totalHours = row.totalDuration / 3600000;
    return row;
  });
  const peakDay = selectedDayRows.reduce<DataAppDayRow | null>((peak, row) => {
    if (!peak || row.duration > peak.duration) {
      return row;
    }
    return peak;
  }, null);
  const selectedTotalDuration = selectedApps.reduce((total, app) => total + app.totalDuration, 0);
  const summary: DataDestinationTrendSummary = {
    totalDuration: selectedTotalDuration,
    averageDuration: Math.round(selectedTotalDuration / averageDivisor),
    activeDayCount: selectedDayRows.filter((row) => row.duration > 0).length,
  };
  const axisPoints = chartRows.flatMap((row) => chartSeries.map((series) => ({
    label: row.label,
    date: row.date,
    hours: Number(row[series.dataKey] ?? 0),
  })));

  return {
    range,
    rangeLabel: range.label,
    granularity: shouldGroupByMonth ? "month" : "day",
    appOptions,
    selectedApps,
    chartSeries,
    chartRows,
    summary,
    chartAxis: buildDataChartAxis(axisPoints),
    peakDay: peakDay && peakDay.duration > 0 ? peakDay : null,
  };
}

export function buildDataAppTrendViewModel(
  sessions: AggregateSessionRecord[],
  selection: DataTrendRange | ResolvedDataTrendRange,
  nowMs: number,
  selectedAppKeys: string | readonly string[] | null,
): DataAppTrendViewModel {
  return buildDataAppTrendViewModelFromAggregate(
    buildDataTrendAggregateContext(sessions, selection, nowMs),
    selectedAppKeys,
  );
}

export function buildDataTrendViewModelsFromAggregate(
  context: DataTrendAggregateContext,
  selectedAppKeys: string | readonly string[] | null,
) {
  return {
    overviewTrendViewModel: buildDataTrendViewModelFromAggregate(context),
    appTrendViewModel: buildDataAppTrendViewModelFromAggregate(context, selectedAppKeys),
  };
}
