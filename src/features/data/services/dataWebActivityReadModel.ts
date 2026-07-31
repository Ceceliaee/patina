import { getUiLocale, UI_TEXT } from "../../../shared/copy/index.ts";
import { formatDuration } from "../../../shared/lib/durationFormatting.ts";
import {
  addLocalDays,
  formatLocalDateKey,
} from "../../../shared/lib/localDate.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import {
  getWebFaviconsForDomains,
  loadWebDomainOverrides,
} from "../../../platform/persistence/webActivityRepository.ts";
import {
  loadWebActivityAggregateRange,
  type WebActivityAggregateRecord,
  type WebActivityDomainCoverage,
} from "../../../platform/persistence/webActivityAnalysisGateway.ts";
import {
  buildDataChartAxis,
  type DataAppDayRow,
  type DataDestinationChartSeries,
  type DataDestinationTrendChartRow,
  type DataTrendViewModel,
} from "./dataReadModel.ts";
import type { DataDestinationTrendSummary } from "./dataDestinationState.ts";
import {
  buildHeatmapFromDailyDurations,
  getHeatmapRange,
  getHeatmapSelectionKey,
  type HeatmapSelection,
  type HeatmapWeek,
} from "./dataHeatmapReadModel.ts";
import {
  buildDataDayRanges,
  buildDataMonthRanges,
  resolveDataTrendRange,
  type DataTrendRangeSelection,
  type ResolvedDataTrendRange,
} from "./dataTrendRange.ts";
import type { DataWebActivitySnapshotDependencies } from "./dataWebActivitySnapshotDependencies.ts";
import { registerDataHeavyCacheClearer } from "./dataCacheLifecycle.ts";

export interface DataWebDomainOption {
  normalizedDomain: string;
  displayName: string;
  faviconUrl: string | null;
  totalDuration: number;
  percentage: number;
  averageDuration: number;
  activeDayCount: number;
  earliestRecordedStartMs: number | null;
}

interface DataWebDomainAggregate extends DataWebDomainOption {
  dayDurations: Map<string, number>;
  monthDurations: Map<string, number>;
}

export interface DataWebTrendViewModel {
  range: ResolvedDataTrendRange;
  rangeLabel: string;
  granularity: "day" | "month";
  domainOptions: DataWebDomainOption[];
  selectedDomains: DataWebDomainOption[];
  chartSeries: DataDestinationChartSeries[];
  chartRows: DataDestinationTrendChartRow[];
  summary: DataDestinationTrendSummary;
  chartAxis: DataTrendViewModel["chartAxis"];
  peakDay: DataAppDayRow | null;
  activeDateKeys: string[];
}

export interface DataWebActivitySnapshot {
  records: WebActivityAggregateRecord[];
  domainCoverage: WebActivityDomainCoverage[];
  overrides: Record<string, WebDomainOverride>;
  favicons: Record<string, string>;
}

export interface DataWebTrendSnapshot extends DataWebActivitySnapshot {
  range: ResolvedDataTrendRange;
  cacheKey: string;
}

export interface DataWebHeatmapSnapshot extends DataWebActivitySnapshot {
  selection: HeatmapSelection;
  normalizedDomains: string[];
  cacheVersion: string;
  cacheKey: string;
}

interface LoadRangeSnapshotInput {
  startMs: number;
  endMs: number;
  bucketBoundariesMs: number[];
  cacheKey: string;
  normalizedDomains: readonly string[] | null;
  deps: DataWebActivitySnapshotDependencies;
}

interface BuildDataWebTrendViewModelInput extends DataWebActivitySnapshot {
  range: ResolvedDataTrendRange;
  selectedDomains: readonly string[];
}

interface BuildDataWebActivityHeatmapInput {
  selection: HeatmapSelection;
  nowMs: number;
  normalizedDomains: readonly string[];
  records: WebActivityAggregateRecord[];
  earliestRecordedStartMs: number | null;
  loadErrorMessage?: string | null;
}

// Keep the active heatmap plus the three preset trend ranges warm so switching
// between app and web destinations never evicts the heatmap and flashes a reload.
const DATA_WEB_ACTIVITY_SNAPSHOT_CACHE_LIMIT = 4;
const snapshotCache = new Map<string, DataWebActivitySnapshot>();
const snapshotPromises = new Map<string, Promise<DataWebActivitySnapshot>>();
let snapshotCacheEpoch = 0;

const defaultDependencies: DataWebActivitySnapshotDependencies = {
  loadAggregateRange: loadWebActivityAggregateRange,
  loadOverrides: loadWebDomainOverrides,
  loadFavicons: getWebFaviconsForDomains,
};

function touchSnapshotCacheEntry(cacheKey: string, snapshot: DataWebActivitySnapshot) {
  snapshotCache.delete(cacheKey);
  snapshotCache.set(cacheKey, snapshot);

  while (snapshotCache.size > DATA_WEB_ACTIVITY_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = snapshotCache.keys().next().value;
    if (!oldestKey) break;
    snapshotCache.delete(oldestKey);
  }
}

function buildDailyBucketBoundaries(startMs: number, endMs: number): number[] {
  const boundaries = [startMs];
  let cursor = new Date(startMs);
  while (cursor.getTime() < endMs) {
    cursor = addLocalDays(cursor, 1);
    boundaries.push(Math.min(cursor.getTime(), endMs));
  }
  if (boundaries[boundaries.length - 1] !== endMs) boundaries.push(endMs);
  return Array.from(new Set(boundaries));
}

function getTrendSnapshotCacheKey(
  range: ResolvedDataTrendRange,
  normalizedDomains: readonly string[] | null,
  cacheVersion: string,
) {
  return `trend:${cacheVersion}:${range.cacheKey}:${JSON.stringify(normalizedDomains ?? ["*"])}`;
}

async function loadRangeSnapshot({
  startMs,
  endMs,
  bucketBoundariesMs,
  cacheKey,
  normalizedDomains,
  deps,
}: LoadRangeSnapshotInput): Promise<DataWebActivitySnapshot> {
  const cached = snapshotCache.get(cacheKey);
  if (cached) {
    touchSnapshotCacheEntry(cacheKey, cached);
    return cached;
  }
  const pending = snapshotPromises.get(cacheKey);
  if (pending) return pending;
  const loadStartedAtEpoch = snapshotCacheEpoch;

  const snapshotPromise = (async () => {
    const [aggregate, overrides] = await Promise.all([
      deps.loadAggregateRange(startMs, endMs, bucketBoundariesMs, normalizedDomains),
      deps.loadOverrides().catch((): Record<string, WebDomainOverride> => ({})),
    ]);
    const domains = Array.from(new Set(
      aggregate.records
        .filter((record) => overrides[record.normalizedDomain]?.enabled !== false)
        .map((record) => record.normalizedDomain),
    ));
    const favicons = await deps.loadFavicons(domains).catch(() => ({}));
    const snapshot: DataWebActivitySnapshot = {
      ...aggregate,
      overrides,
      favicons,
    };
    if (snapshotCacheEpoch === loadStartedAtEpoch) {
      touchSnapshotCacheEntry(cacheKey, snapshot);
    }
    return snapshot;
  })().finally(() => {
    if (snapshotPromises.get(cacheKey) === snapshotPromise) {
      snapshotPromises.delete(cacheKey);
    }
  });

  snapshotPromises.set(cacheKey, snapshotPromise);
  return snapshotPromise;
}

function getMonthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function formatMonthLabel(monthKey: string) {
  return UI_TEXT.date.monthLabel(Number(monthKey.slice(5, 7)));
}

function buildDomainAggregates({
  range,
  records,
  domainCoverage,
  overrides,
  favicons,
}: Omit<BuildDataWebTrendViewModelInput, "selectedDomains">): DataWebDomainAggregate[] {
  const domainBuckets = new Map<string, {
    dayDurations: Map<string, number>;
    monthDurations: Map<string, number>;
    totalDuration: number;
  }>();

  for (const record of records) {
    const override = overrides[record.normalizedDomain];
    if (override?.enabled === false || record.durationMs <= 0) continue;
    const dateKey = formatLocalDateKey(new Date(record.bucketStartMs));
    const bucket = domainBuckets.get(record.normalizedDomain) ?? {
      dayDurations: new Map<string, number>(),
      monthDurations: new Map<string, number>(),
      totalDuration: 0,
    };
    bucket.dayDurations.set(dateKey, (bucket.dayDurations.get(dateKey) ?? 0) + record.durationMs);
    const monthKey = getMonthKey(dateKey);
    bucket.monthDurations.set(monthKey, (bucket.monthDurations.get(monthKey) ?? 0) + record.durationMs);
    bucket.totalDuration += record.durationMs;
    domainBuckets.set(record.normalizedDomain, bucket);
  }

  const totalWebDuration = Array.from(domainBuckets.values())
    .reduce((total, bucket) => total + bucket.totalDuration, 0);
  const averageDivisor = Math.max(
    1,
    range.granularity === "month"
      ? buildDataMonthRanges(range).length
      : buildDataDayRanges(range).length,
  );
  const coverageByDomain = new Map(
    domainCoverage.map((coverage) => [coverage.normalizedDomain, coverage.earliestRecordedStartMs]),
  );

  return Array.from(domainBuckets, ([normalizedDomain, bucket]) => ({
    normalizedDomain,
    displayName: overrides[normalizedDomain]?.displayName?.trim() || normalizedDomain,
    faviconUrl: favicons[normalizedDomain] ?? null,
    totalDuration: bucket.totalDuration,
    percentage: totalWebDuration > 0 ? (bucket.totalDuration / totalWebDuration) * 100 : 0,
    averageDuration: Math.round(bucket.totalDuration / averageDivisor),
    activeDayCount: Array.from(bucket.dayDurations.values()).filter((duration) => duration > 0).length,
    earliestRecordedStartMs: coverageByDomain.get(normalizedDomain) ?? null,
    dayDurations: bucket.dayDurations,
    monthDurations: bucket.monthDurations,
  })).sort((left, right) => (
    right.totalDuration - left.totalDuration
    || left.displayName.localeCompare(right.displayName, getUiLocale())
    || left.normalizedDomain.localeCompare(right.normalizedDomain)
  ));
}

export function buildDataWebTrendViewModel(
  input: BuildDataWebTrendViewModelInput,
): DataWebTrendViewModel {
  const aggregates = buildDomainAggregates(input);
  const aggregateByDomain = new Map(
    aggregates.map((aggregate) => [aggregate.normalizedDomain, aggregate]),
  );
  const selectedAggregates = Array.from(new Set(input.selectedDomains))
    .map((domain): DataWebDomainAggregate => aggregateByDomain.get(domain) ?? ({
      normalizedDomain: domain,
      displayName: input.overrides[domain]?.displayName?.trim() || domain,
      faviconUrl: input.favicons[domain] ?? null,
      totalDuration: 0,
      percentage: 0,
      averageDuration: 0,
      activeDayCount: 0,
      earliestRecordedStartMs: input.domainCoverage.find(
        (coverage) => coverage.normalizedDomain === domain,
      )?.earliestRecordedStartMs ?? null,
      dayDurations: new Map<string, number>(),
      monthDurations: new Map<string, number>(),
    }));
  if (selectedAggregates.length === 0 && aggregates[0]) {
    selectedAggregates.push(aggregates[0]);
  }
  const dayRanges = buildDataDayRanges(input.range);
  const chartRanges = input.range.granularity === "month"
    ? buildDataMonthRanges(input.range)
    : dayRanges;
  const chartSeries = selectedAggregates.map<DataDestinationChartSeries>((aggregate, index) => ({
    key: aggregate.normalizedDomain,
    dataKey: `series${index}`,
    displayName: aggregate.displayName,
  }));
  const chartRows = chartRanges.map<DataDestinationTrendChartRow>((rangeItem) => {
    const date = formatLocalDateKey(new Date(rangeItem.startMs));
    const row: DataDestinationTrendChartRow = {
      label: input.range.granularity === "month" ? formatMonthLabel(getMonthKey(date)) : date.slice(5),
      date,
      totalDuration: 0,
      totalHours: 0,
    };
    for (const [index, aggregate] of selectedAggregates.entries()) {
      const duration = input.range.granularity === "month"
        ? aggregate.monthDurations.get(getMonthKey(date)) ?? 0
        : aggregate.dayDurations.get(date) ?? 0;
      row[`series${index}`] = duration / 3_600_000;
      row.totalDuration += duration;
    }
    row.totalHours = row.totalDuration / 3_600_000;
    return row;
  });
  const dayRows = dayRanges.map((rangeItem) => {
    const date = formatLocalDateKey(new Date(rangeItem.startMs));
    const duration = selectedAggregates.reduce(
      (total, aggregate) => total + (aggregate.dayDurations.get(date) ?? 0),
      0,
    );
    return {
      date,
      label: date,
      duration,
      intensity: 0,
    };
  });
  const maxDayDuration = Math.max(1, ...dayRows.map((row) => row.duration));
  const normalizedDayRows = dayRows.map((row) => ({
    ...row,
    intensity: row.duration <= 0 ? 0 : Math.max(0.16, row.duration / maxDayDuration),
  }));
  const peakDay = normalizedDayRows.reduce<DataAppDayRow | null>((peak, row) => (
    !peak || row.duration > peak.duration ? row : peak
  ), null);
  const summary: DataDestinationTrendSummary = {
    totalDuration: selectedAggregates.reduce(
      (total, aggregate) => total + aggregate.totalDuration,
      0,
    ),
    averageDuration: chartRanges.length > 0
      ? Math.round(
        selectedAggregates.reduce(
          (total, aggregate) => total + aggregate.totalDuration,
          0,
        ) / chartRanges.length,
      )
      : 0,
    activeDayCount: normalizedDayRows.filter((row) => row.duration > 0).length,
  };
  const selectedDomains = selectedAggregates.map(({
    dayDurations: _dayDurations,
    monthDurations: _monthDurations,
    ...domain
  }) => domain);

  return {
    range: input.range,
    rangeLabel: input.range.label,
    granularity: input.range.granularity,
    domainOptions: aggregates.map(({
      dayDurations: _dayDurations,
      monthDurations: _monthDurations,
      ...domain
    }) => domain),
    selectedDomains,
    chartSeries,
    chartRows,
    summary,
    chartAxis: buildDataChartAxis(chartSeries.flatMap((series) => (
      chartRows.map((row) => ({
        label: row.label,
        date: row.date,
        hours: Number(row[series.dataKey]),
      }))
    ))),
    peakDay: peakDay && peakDay.duration > 0 ? peakDay : null,
    activeDateKeys: normalizedDayRows
      .filter((row) => row.duration > 0)
      .map((row) => row.date),
  };
}

export function buildDataWebActivityHeatmap({
  selection,
  nowMs,
  normalizedDomains,
  records,
  loadErrorMessage = null,
}: BuildDataWebActivityHeatmapInput): HeatmapWeek[] {
  const selectedDomains = new Set(normalizedDomains);
  const dayDurations = new Map<string, number>();
  for (const record of records) {
    if (!selectedDomains.has(record.normalizedDomain) || record.durationMs <= 0) continue;
    const dateKey = formatLocalDateKey(new Date(record.bucketStartMs));
    dayDurations.set(dateKey, (dayDurations.get(dateKey) ?? 0) + record.durationMs);
  }
  return buildHeatmapFromDailyDurations({
    dayDurations,
    selection,
    nowMs,
    resolveAvailability: ({ isFuture }) => {
      if (isFuture) return "future";
      if (loadErrorMessage) return "unavailable";
      return "recorded";
    },
    resolveSummary: ({ availability, duration }) => {
      if (availability === "future") return UI_TEXT.data.notStarted;
      if (loadErrorMessage) return loadErrorMessage;
      return formatDuration(duration);
    },
  });
}

export async function loadDataWebActivitySnapshot({
  selection,
  nowMs = Date.now(),
  normalizedDomains = null,
  cacheVersion = "default",
  deps = defaultDependencies,
}: {
  selection: DataTrendRangeSelection;
  nowMs?: number;
  normalizedDomains?: readonly string[] | null;
  cacheVersion?: string;
  deps?: DataWebActivitySnapshotDependencies;
}): Promise<DataWebTrendSnapshot> {
  const range = resolveDataTrendRange(selection, nowMs);
  const bucketBoundariesMs = buildDailyBucketBoundaries(range.startMs, range.endMs);
  const cacheKey = getTrendSnapshotCacheKey(range, normalizedDomains, cacheVersion);
  const snapshot = await loadRangeSnapshot({
    startMs: range.startMs,
    endMs: range.endMs,
    bucketBoundariesMs,
    cacheKey,
    normalizedDomains,
    deps,
  });
  return { ...snapshot, range, cacheKey };
}

export function getCachedDataWebTrendSnapshot({
  selection,
  nowMs = Date.now(),
  normalizedDomains = null,
  cacheVersion = "default",
}: {
  selection: DataTrendRangeSelection;
  nowMs?: number;
  normalizedDomains?: readonly string[] | null;
  cacheVersion?: string;
}): DataWebTrendSnapshot | null {
  const range = resolveDataTrendRange(selection, nowMs);
  const cacheKey = getTrendSnapshotCacheKey(range, normalizedDomains, cacheVersion);
  const snapshot = snapshotCache.get(cacheKey);
  if (!snapshot) return null;
  touchSnapshotCacheEntry(cacheKey, snapshot);
  return { ...snapshot, range, cacheKey };
}

export async function loadDataWebHeatmapSnapshot({
  selection,
  normalizedDomains,
  nowMs = Date.now(),
  cacheVersion = "default",
  deps = defaultDependencies,
}: {
  selection: HeatmapSelection;
  normalizedDomains: readonly string[];
  nowMs?: number;
  cacheVersion?: string;
  deps?: DataWebActivitySnapshotDependencies;
}): Promise<DataWebHeatmapSnapshot> {
  const range = getHeatmapRange(selection, nowMs);
  const startMs = range.start.getTime();
  const endMs = Math.min(range.end.getTime(), nowMs);
  const normalizedDomainKeys = Array.from(new Set(normalizedDomains));
  const cacheKey = `heatmap:${cacheVersion}:${getHeatmapSelectionKey(selection, nowMs)}:${JSON.stringify(normalizedDomainKeys)}`;
  const snapshot = await loadRangeSnapshot({
    startMs,
    endMs,
    bucketBoundariesMs: buildDailyBucketBoundaries(startMs, endMs),
    cacheKey,
    normalizedDomains: normalizedDomainKeys,
    deps,
  });
  return {
    ...snapshot,
    selection,
    normalizedDomains: normalizedDomainKeys,
    cacheVersion,
    cacheKey,
  };
}

export function clearDataWebActivitySnapshotCache() {
  snapshotCacheEpoch += 1;
  snapshotCache.clear();
  snapshotPromises.clear();
}

registerDataHeavyCacheClearer("web-activity-snapshot", clearDataWebActivitySnapshotCache);

export function getDataWebActivitySnapshotCacheStats() {
  return {
    entries: snapshotCache.size,
    pendingEntries: snapshotPromises.size,
    limit: DATA_WEB_ACTIVITY_SNAPSHOT_CACHE_LIMIT,
  };
}
