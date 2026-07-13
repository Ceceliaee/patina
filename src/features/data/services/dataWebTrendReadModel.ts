import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { WebActivitySegment, WebDomainOverride } from "../../../shared/types/webActivity.ts";
import type { SessionRange } from "../../../shared/lib/sessionReadCompiler.ts";
import { formatLocalDateKey as toDateKey } from "../../../shared/lib/localDate.ts";
import {
  buildDataDayRanges,
  buildDataMonthRanges,
  type ResolvedDataTrendRange,
} from "./dataTrendRange.ts";
import {
  formatHeatmapDateLabel,
  buildChartAxis,
  type DataTrendViewModel,
} from "./dataReadModel.ts";

export interface DataWebDomainOption {
  domainKey: string;
  domain: string;
  label: string;
  faviconUrl: string | null;
  totalDuration: number;
  percentage: number;
  averageDuration: number;
  activeDayCount: number;
  color: string;
}

export interface DataWebTrendPoint {
  label: string;
  date: string;
  hours: number;
  duration: number;
}

export interface DataWebTrendDayRow {
  date: string;
  label: string;
  duration: number;
  intensity: number;
}

export interface DataWebTrendViewModel {
  range: ResolvedDataTrendRange;
  rangeLabel: string;
  granularity: "day" | "month";
  domainOptions: DataWebDomainOption[];
  selectedDomain: DataWebDomainOption | null;
  chartData: DataWebTrendPoint[];
  chartAxis: DataTrendViewModel["chartAxis"];
  dayRows: DataWebTrendDayRow[];
  peakDay: DataWebTrendDayRow | null;
}

const WEB_TREND_VIEWMODEL_CACHE_LIMIT = 4;
const webTrendViewModelCache = new Map<string, DataWebTrendViewModel>();

export function clearWebTrendViewModelCache(): void {
  webTrendViewModelCache.clear();
}

function resolveWebDomainLabel(segment: WebActivitySegment, overrides: Record<string, WebDomainOverride>): string {
  return overrides[segment.normalizedDomain]?.displayName?.trim()
    || segment.domain
    || segment.normalizedDomain;
}

function stableDomainColor(normalizedDomain: string) {
  const palette = [
    "#36AC7E",
    "#4790CF",
    "#6F7AE6",
    "#B07E55",
    "#35A69E",
    "#C56A73",
    "#8C6FA1",
  ];
  let hash = 0;
  for (const char of normalizedDomain) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

function resolveWebDomainColor(
  normalizedDomain: string,
  overrides: Record<string, WebDomainOverride>,
  iconThemeColors: Record<string, string>,
): string {
  const overrideColor = overrides[normalizedDomain]?.color;
  if (overrideColor) return overrideColor;
  const iconColor = iconThemeColors[normalizedDomain];
  if (iconColor) return iconColor;
  return stableDomainColor(normalizedDomain);
}

function preferFaviconUrl(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  if (!current.startsWith("data:") && candidate.startsWith("data:")) return candidate;
  return current;
}

function buildWebDayRowsFromDurations(
  dayDurations: Map<string, number>,
  dayRanges: SessionRange[],
): DataWebTrendDayRow[] {
  let maxDuration = 0;
  for (const duration of dayDurations.values()) {
    if (duration > maxDuration) maxDuration = duration;
  }
  return dayRanges.map((rangeItem) => {
    const date = toDateKey(new Date(rangeItem.startMs));
    const duration = dayDurations.get(date) ?? 0;
    return {
      date,
      label: formatHeatmapDateLabel(date),
      duration,
      intensity: maxDuration > 0 ? duration / maxDuration : 0,
    };
  });
}

function getWebMonthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function formatWebMonthLabel(monthKey: string) {
  const month = Number(monthKey.slice(5, 7));
  return UI_TEXT.date.monthLabel(month);
}

function getWebTrendViewModelCacheKey(
  webSegments: WebActivitySegment[],
  selection: ResolvedDataTrendRange,
  selectedDomainKey: string | null,
  overrides: Record<string, WebDomainOverride>,
  iconThemeColors: Record<string, string>,
  webDomainFavicons: Record<string, string>,
): string {
  const overrideKeys = Object.keys(overrides).sort().join(",");
  const iconColorKeys = Object.keys(iconThemeColors).sort().join(",");
  const faviconKeys = Object.keys(webDomainFavicons).sort().join(",");
  return `${selection.cacheKey}:${webSegments.length}:${selectedDomainKey ?? "null"}:${overrideKeys}:${iconColorKeys}:${faviconKeys}`;
}

function buildWebTrendViewModelUncached(
  webSegments: WebActivitySegment[],
  selection: ResolvedDataTrendRange,
  nowMs: number,
  selectedDomainKey: string | null,
  overrides: Record<string, WebDomainOverride>,
  iconThemeColors: Record<string, string>,
  webDomainFavicons: Record<string, string>,
): DataWebTrendViewModel {
  const { dayRanges, monthRanges, range } = { dayRanges: buildDataDayRanges(selection), monthRanges: buildDataMonthRanges(selection), range: selection };
  const shouldGroupByMonth = range.granularity === "month";
  const chartRanges = shouldGroupByMonth ? monthRanges : dayRanges;
  const averageDivisor = Math.max(1, chartRanges.length);

  const domainDayDurations = new Map<string, Map<string, number>>();
  const domainMonthDurations = new Map<string, Map<string, number>>();
  const domainTotals = new Map<string, number>();
  const domainLabels = new Map<string, string>();
  const domainDomains = new Map<string, string>();
  const domainFavicons = new Map<string, string | null>();
  let totalDuration = 0;

  for (const segment of webSegments) {
    const startTime = Math.max(range.startMs, segment.startTime);
    const rawEndTime = segment.endTime ?? nowMs;
    const endTime = Math.min(range.endMs, Math.max(segment.startTime, rawEndTime));
    const duration = Math.max(0, endTime - startTime);
    if (duration <= 0) continue;

    const key = segment.normalizedDomain;
    totalDuration += duration;

    if (!domainTotals.has(key)) {
      domainTotals.set(key, 0);
      domainDayDurations.set(key, new Map());
      domainMonthDurations.set(key, new Map());
      domainLabels.set(key, resolveWebDomainLabel(segment, overrides));
      domainDomains.set(key, segment.domain || key);
      domainFavicons.set(key, null);
    }

    domainTotals.set(key, (domainTotals.get(key) ?? 0) + duration);

    const dayKey = toDateKey(new Date(startTime));
    const dayMap = domainDayDurations.get(key);
    if (dayMap) {
      dayMap.set(dayKey, (dayMap.get(dayKey) ?? 0) + duration);
    }

    const monthKey = getWebMonthKey(dayKey);
    const monthMap = domainMonthDurations.get(key);
    if (monthMap) {
      monthMap.set(monthKey, (monthMap.get(monthKey) ?? 0) + duration);
    }

    const segmentFavicon = webDomainFavicons[segment.normalizedDomain] ?? segment.faviconUrl;
    const currentFavicon = domainFavicons.get(key) ?? null;
    domainFavicons.set(key, preferFaviconUrl(currentFavicon, segmentFavicon));
  }

  const domainOptions: DataWebDomainOption[] = Array.from(domainTotals.entries())
    .map(([key, total]) => {
      const dayDurations = domainDayDurations.get(key) ?? new Map();
      let activeDayCount = 0;
      for (const dur of dayDurations.values()) {
        if (dur > 0) activeDayCount++;
      }
      return {
        domainKey: key,
        domain: domainDomains.get(key) ?? key,
        label: domainLabels.get(key) ?? key,
        faviconUrl: domainFavicons.get(key) ?? null,
        totalDuration: total,
        percentage: totalDuration > 0 ? (total / totalDuration) * 100 : 0,
        averageDuration: Math.round(total / averageDivisor),
        activeDayCount,
        color: resolveWebDomainColor(key, overrides, iconThemeColors),
      };
    })
    .sort((left, right) => right.totalDuration - left.totalDuration || left.label.localeCompare(right.label));

  const selectedDomain = domainOptions.find((d) => d.domainKey === selectedDomainKey) ?? domainOptions[0] ?? null;

  const selectedDayDurations = selectedDomain
    ? (domainDayDurations.get(selectedDomain.domainKey) ?? new Map())
    : new Map<string, number>();
  const selectedMonthDurations = selectedDomain
    ? (domainMonthDurations.get(selectedDomain.domainKey) ?? new Map())
    : new Map<string, number>();

  const chartData = chartRanges.map((rangeItem) => {
    const date = toDateKey(new Date(rangeItem.startMs));
    const duration = selectedDomain
      ? shouldGroupByMonth
        ? selectedMonthDurations.get(getWebMonthKey(date)) ?? 0
        : selectedDayDurations.get(date) ?? 0
      : 0;
    return {
      label: shouldGroupByMonth ? formatWebMonthLabel(date.slice(0, 7)) : date.slice(5),
      date,
      duration,
      hours: duration / 3600000,
    };
  });

  const dayRows = buildWebDayRowsFromDurations(selectedDayDurations, dayRanges);
  const peakDay = dayRows.reduce<DataWebTrendDayRow | null>((peak, row) => {
    if (!peak || row.duration > peak.duration) {
      return row;
    }
    return peak;
  }, null);

  return {
    range,
    rangeLabel: range.label,
    granularity: shouldGroupByMonth ? "month" : "day",
    domainOptions,
    selectedDomain,
    chartData,
    chartAxis: buildChartAxis(chartData),
    dayRows: dayRows.slice().reverse(),
    peakDay: peakDay && peakDay.duration > 0 ? peakDay : null,
  };
}

export function buildDataWebTrendViewModel(
  webSegments: WebActivitySegment[],
  selection: ResolvedDataTrendRange,
  nowMs: number,
  selectedDomainKey: string | null,
  overrides: Record<string, WebDomainOverride> = {},
  iconThemeColors: Record<string, string> = {},
  webDomainFavicons: Record<string, string> = {},
): DataWebTrendViewModel {
  const cacheKey = getWebTrendViewModelCacheKey(
    webSegments,
    selection,
    selectedDomainKey,
    overrides,
    iconThemeColors,
    webDomainFavicons,
  );
  const cached = webTrendViewModelCache.get(cacheKey);
  if (cached) {
    webTrendViewModelCache.delete(cacheKey);
    webTrendViewModelCache.set(cacheKey, cached);
    return cached;
  }

  const result = buildWebTrendViewModelUncached(
    webSegments,
    selection,
    nowMs,
    selectedDomainKey,
    overrides,
    iconThemeColors,
    webDomainFavicons,
  );

  webTrendViewModelCache.delete(cacheKey);
  webTrendViewModelCache.set(cacheKey, result);
  while (webTrendViewModelCache.size > WEB_TREND_VIEWMODEL_CACHE_LIMIT) {
    const oldestKey = webTrendViewModelCache.keys().next().value;
    if (oldestKey !== undefined) webTrendViewModelCache.delete(oldestKey);
  }

  return result;
}
