import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { isAppCategory, type AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import {
  buildDataChartAxis,
  mergeDataAppDurationBuckets,
  type DataAppDayRow,
  type DataAppTrendViewModel,
  type DataDestinationTrendChartRow,
  type DataTrendAggregateContext,
  type MergedDataAppDurationBucket,
} from "./dataReadModel.ts";
import {
  buildDataDayRanges,
  buildDataMonthRanges,
  resolveDataAllTimePresentationRange,
} from "./dataTrendRange.ts";
import { resolveStatisticalDataAppKey } from "./dataHeatmapReadModel.ts";

interface DataCategoryOption {
  category: AppCategory;
  sourceAppKeys: string[];
  displayName: string;
  color: string;
  appCount: number;
  totalDuration: number;
  percentage: number;
  averageDuration: number;
  activeDayCount: number;
}

export interface DataCategoryTrendViewModel {
  range: DataAppTrendViewModel["range"];
  rangeLabel: string;
  granularity: "day" | "month";
  categoryOptions: DataCategoryOption[];
  selectedCategories: DataCategoryOption[];
  selectedSourceAppKeys: string[];
  chartSeries: DataAppTrendViewModel["chartSeries"];
  chartRows: DataDestinationTrendChartRow[];
  summary: DataAppTrendViewModel["summary"];
  chartAxis: DataAppTrendViewModel["chartAxis"];
  peakDay: DataAppDayRow | null;
  activeDateKeys: string[];
}

interface DataCategoryTrendBucket extends DataCategoryOption {
  dayDurations: Map<string, number>;
  monthDurations: Map<string, number>;
}

function addDuration(target: Map<string, number>, key: string, duration: number) {
  target.set(key, (target.get(key) ?? 0) + duration);
}

function mergeDurations(target: Map<string, number>, source: Map<string, number>) {
  for (const [key, duration] of source) {
    addDuration(target, key, duration);
  }
}

function countActiveDays(dayDurations: Map<string, number>) {
  let count = 0;
  for (const duration of dayDurations.values()) {
    if (duration > 0) count += 1;
  }
  return count;
}

function resolveCategoryForApp(bucket: MergedDataAppDurationBucket) {
  return AppClassification.mapApp(bucket.exeName, { appName: bucket.appName }).category;
}

function buildCategoryBuckets(context: DataTrendAggregateContext): DataCategoryTrendBucket[] {
  const { aggregate, range, dayRanges, monthRanges, uiText } = context;
  const optionRanges = range.granularity === "month" ? monthRanges : dayRanges;
  const averageDivisor = Math.max(1, optionRanges.length);
  const buckets = new Map<AppCategory, DataCategoryTrendBucket>();

  for (const app of mergeDataAppDurationBuckets(aggregate.appBuckets)) {
    const category = resolveCategoryForApp(app);
    let bucket = buckets.get(category);
    if (!bucket) {
      bucket = {
        category,
        sourceAppKeys: [],
        displayName: AppClassification.getCategoryLabel(category, uiText),
        color: AppClassification.getCategoryColor(category),
        appCount: 0,
        totalDuration: 0,
        percentage: 0,
        averageDuration: 0,
        activeDayCount: 0,
        dayDurations: new Map(),
        monthDurations: new Map(),
      };
      buckets.set(category, bucket);
    }

    bucket.appCount += 1;
    bucket.totalDuration += app.totalDuration;
    for (const sourceAppKey of app.sourceAppKeys) {
      if (!bucket.sourceAppKeys.includes(sourceAppKey)) {
        bucket.sourceAppKeys.push(sourceAppKey);
      }
    }
    mergeDurations(bucket.dayDurations, app.dayDurations);
    mergeDurations(bucket.monthDurations, app.monthDurations);
  }

  for (const bucket of buckets.values()) {
    bucket.percentage = aggregate.totalDuration > 0
      ? (bucket.totalDuration / aggregate.totalDuration) * 100
      : 0;
    bucket.averageDuration = Math.round(bucket.totalDuration / averageDivisor);
    bucket.activeDayCount = countActiveDays(bucket.dayDurations);
  }

  return Array.from(buckets.values()).sort((left, right) => (
    right.totalDuration - left.totalDuration
    || left.category.localeCompare(right.category)
  ));
}

function createEmptyCategoryBucket(
  category: AppCategory,
  context: DataTrendAggregateContext,
): DataCategoryTrendBucket {
  return {
    category,
    sourceAppKeys: [],
    displayName: AppClassification.getCategoryLabel(category, context.uiText),
    color: AppClassification.getCategoryColor(category),
    appCount: 0,
    totalDuration: 0,
    percentage: 0,
    averageDuration: 0,
    activeDayCount: 0,
    dayDurations: new Map(),
    monthDurations: new Map(),
  };
}

function resolveSelectedCategoryBuckets(
  buckets: readonly DataCategoryTrendBucket[],
  selectedCategoryKeys: readonly string[],
  context: DataTrendAggregateContext,
) {
  const selected = Array.from(new Set(selectedCategoryKeys)).flatMap((key) => {
    const existing = buckets.find((bucket) => bucket.category === key);
    if (existing) return [existing];
    return isAppCategory(key) ? [createEmptyCategoryBucket(key, context)] : [];
  });
  if (selected.length === 0 && buckets[0]) {
    selected.push(buckets[0]);
  }
  return selected;
}

function toCategoryOption(bucket: DataCategoryTrendBucket): DataCategoryOption {
  return {
    category: bucket.category,
    sourceAppKeys: [...bucket.sourceAppKeys],
    displayName: bucket.displayName,
    color: bucket.color,
    appCount: bucket.appCount,
    totalDuration: bucket.totalDuration,
    percentage: bucket.percentage,
    averageDuration: bucket.averageDuration,
    activeDayCount: bucket.activeDayCount,
  };
}

function formatDayLabel(dateKey: string, locale: DataTrendAggregateContext["locale"]) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString(locale, {
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });
}

function buildSelectedDayRows(
  selectedBuckets: readonly DataCategoryTrendBucket[],
  dayRanges: DataTrendAggregateContext["dayRanges"],
  locale: DataTrendAggregateContext["locale"],
): DataAppDayRow[] {
  const durations = new Map<string, number>();
  for (const bucket of selectedBuckets) {
    mergeDurations(durations, bucket.dayDurations);
  }
  const rows = dayRanges.map((range) => {
    const date = formatLocalDateKey(new Date(range.startMs));
    return {
      date,
      label: formatDayLabel(date, locale),
      duration: durations.get(date) ?? 0,
      intensity: 0,
    };
  });
  const maxDuration = Math.max(1, ...rows.map((row) => row.duration));
  return rows.map((row) => ({
    ...row,
    intensity: row.duration > 0 ? Math.max(0.08, row.duration / maxDuration) : 0,
  }));
}

export function buildDataCategoryTrendViewModelFromAggregate(
  context: DataTrendAggregateContext,
  selectedCategoryKeys: readonly string[],
): DataCategoryTrendViewModel {
  const categoryBuckets = buildCategoryBuckets(context);
  const selectedBuckets = resolveSelectedCategoryBuckets(
    categoryBuckets,
    selectedCategoryKeys,
    context,
  );
  const activeMonthKeys: string[] = [];
  for (const bucket of selectedBuckets) {
    for (const [monthKey, duration] of bucket.monthDurations) {
      if (duration > 0) activeMonthKeys.push(monthKey);
    }
  }
  const range = resolveDataAllTimePresentationRange(
    context.range,
    activeMonthKeys,
    context.uiText,
  );
  const dayRanges = range === context.range ? context.dayRanges : buildDataDayRanges(range);
  const monthRanges = range === context.range ? context.monthRanges : buildDataMonthRanges(range);
  const shouldGroupByMonth = range.granularity === "month";
  const chartRanges = shouldGroupByMonth ? monthRanges : dayRanges;
  const averageDivisor = Math.max(1, chartRanges.length);
  const chartSeries = selectedBuckets.map((bucket, index) => ({
    key: bucket.category,
    dataKey: `series${index}`,
    displayName: bucket.displayName,
  }));
  const chartRows = chartRanges.map((rangeItem) => {
    const date = formatLocalDateKey(new Date(rangeItem.startMs));
    const row: DataDestinationTrendChartRow = {
      label: shouldGroupByMonth
        ? context.uiText.date.monthLabel(Number(date.slice(5, 7)))
        : date.slice(5),
      date,
      totalDuration: 0,
      totalHours: 0,
    };
    for (const [index, bucket] of selectedBuckets.entries()) {
      const duration = shouldGroupByMonth
        ? bucket.monthDurations.get(date.slice(0, 7)) ?? 0
        : bucket.dayDurations.get(date) ?? 0;
      row[`series${index}`] = duration / 3_600_000;
      row.totalDuration += duration;
    }
    row.totalHours = row.totalDuration / 3_600_000;
    return row;
  });
  const selectedDayRows = buildSelectedDayRows(selectedBuckets, dayRanges, context.locale);
  const peakDay = selectedDayRows.reduce<DataAppDayRow | null>((peak, row) => (
    !peak || row.duration > peak.duration ? row : peak
  ), null);
  const totalDuration = selectedBuckets.reduce((sum, bucket) => sum + bucket.totalDuration, 0);
  const selectedSourceAppKeys = Array.from(new Set(
    selectedBuckets.flatMap((bucket) => bucket.sourceAppKeys),
  ));
  const axisPoints = chartRows.flatMap((row) => chartSeries.map((series) => ({
    label: row.label,
    date: row.date,
    hours: Number(row[series.dataKey] ?? 0),
  })));

  return {
    range,
    rangeLabel: range.label,
    granularity: shouldGroupByMonth ? "month" : "day",
    categoryOptions: categoryBuckets.map(toCategoryOption),
    selectedCategories: selectedBuckets.map(toCategoryOption),
    selectedSourceAppKeys,
    chartSeries,
    chartRows,
    summary: {
      totalDuration,
      averageDuration: Math.round(totalDuration / averageDivisor),
      activeDayCount: selectedDayRows.filter((row) => row.duration > 0).length,
    },
    chartAxis: buildDataChartAxis(axisPoints),
    peakDay: peakDay && peakDay.duration > 0 ? peakDay : null,
    activeDateKeys: selectedDayRows.filter((row) => row.duration > 0).map((row) => row.date),
  };
}

export function filterDataCategoryOptionsForQuery(
  options: readonly DataCategoryOption[],
  query: string,
): DataCategoryOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return [...options];
  return options.filter((option) => (
    option.displayName.toLocaleLowerCase().includes(normalizedQuery)
  ));
}

export function resolveDataCategorySourceAppKeys(
  sessions: readonly AggregateSessionRecord[],
  selectedCategoryKeys: readonly string[],
): string[] {
  const selected = new Set(selectedCategoryKeys.filter(isAppCategory));
  if (selected.size === 0) return [];
  const appKeys = new Set<string>();
  for (const session of sessions) {
    const appKey = resolveStatisticalDataAppKey(session);
    if (!appKey) continue;
    const category = AppClassification.mapApp(session.exeName, { appName: session.appName }).category;
    if (selected.has(category)) {
      appKeys.add(appKey);
    }
  }
  return Array.from(appKeys);
}
