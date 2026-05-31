import { AppClassification } from "../classification/appClassification.ts";
import type { AppCategory } from "../classification/categoryTokens.ts";
import { UI_TEXT } from "../copy/uiText.ts";
import type { HistorySession } from "../types/sessions.ts";

export interface HourlyActivityPoint {
  hour: string;
  minutes: number;
}

export interface HourlyCategorySeries {
  dataKey: string;
  category: AppCategory | null;
  name: string;
  color: string;
  totalMinutes: number;
  isRemainder: boolean;
}

export interface HourlyCategoryActivityPoint {
  hour: string;
  minutes: number;
  segmentDetails: Record<string, HourlyCategoryActivitySegment>;
  [dataKey: string]: string | number | null | Record<string, HourlyCategoryActivitySegment>;
}

export interface HourlyCategoryActivitySegment {
  category: AppCategory | null;
  name: string;
  color: string;
  minutes: number;
  isRemainder: boolean;
}

export interface HourlyCategoryActivity {
  points: HourlyCategoryActivityPoint[];
  series: HourlyCategorySeries[];
}

interface CategoryDescriptor {
  category: AppCategory;
  name: string;
  color: string;
}

const HOURLY_CATEGORY_SLOT_PREFIX = "slot";

export function getHourlyCategorySlotDataKey(index: number) {
  return `${HOURLY_CATEGORY_SLOT_PREFIX}${index}`;
}

function forEachHourlySessionSegment(
  session: HistorySession,
  visit: (hourIndex: number, durationMs: number) => void,
) {
  const start = new Date(session.startTime);
  const end = session.endTime ? new Date(session.endTime) : new Date();
  let currentPtr = start.getTime();

  while (currentPtr < end.getTime()) {
    const currentDate = new Date(currentPtr);
    const hourIndex = currentDate.getHours();
    const nextHour = new Date(currentPtr);
    nextHour.setHours(hourIndex + 1, 0, 0, 0);

    const segmentEnd = Math.min(end.getTime(), nextHour.getTime());
    visit(hourIndex, segmentEnd - currentPtr);
    currentPtr = segmentEnd;
  }
}

export function buildHourlyActivity(sessions: HistorySession[]): HourlyActivityPoint[] {
  const hoursCount = new Array<number>(24).fill(0);

  for (const session of sessions) {
    forEachHourlySessionSegment(session, (hourIndex, durationMs) => {
      hoursCount[hourIndex] += durationMs / 60000;
    });
  }

  return hoursCount.map((minutes, hourIndex) => ({
    hour: `${hourIndex.toString().padStart(2, "0")}:00`,
    minutes: Math.round(minutes),
  }));
}

function incrementCategoryMinutes(
  bucket: Map<AppCategory, number>,
  category: AppCategory,
  minutes: number,
) {
  bucket.set(category, (bucket.get(category) ?? 0) + minutes);
}

function buildVisibleSeries(
  categoryTotals: Map<AppCategory, number>,
  categoryDescriptors: Map<AppCategory, CategoryDescriptor>,
): HourlyCategorySeries[] {
  const sortedCategories = Array.from(categoryTotals.entries())
    .filter(([, totalMinutes]) => totalMinutes > 0)
    .sort((left, right) => right[1] - left[1]);
  return sortedCategories.map(([category, totalMinutes], index) => {
    const descriptor = categoryDescriptors.get(category);
    return {
      dataKey: `category${index}`,
      category,
      name: descriptor?.name ?? AppClassification.getCategoryLabel(category),
      color: descriptor?.color ?? AppClassification.getCategoryColor(category),
      totalMinutes,
      isRemainder: false,
    };
  });
}

export function buildHourlyCategoryActivity(
  sessions: HistorySession[],
): HourlyCategoryActivity {
  const hourlyCategoryMinutes = Array.from({ length: 24 }, () => new Map<AppCategory, number>());
  const categoryTotals = new Map<AppCategory, number>();
  const categoryDescriptors = new Map<AppCategory, CategoryDescriptor>();
  const appCategoryCache = new Map<string, CategoryDescriptor>();

  for (const session of sessions) {
    const cacheKey = `${session.exeName}\0${session.appName}`;
    let descriptor = appCategoryCache.get(cacheKey);
    if (!descriptor) {
      const mapped = AppClassification.mapApp(session.exeName, { appName: session.appName });
      descriptor = {
        category: mapped.category,
        name: AppClassification.getCategoryLabel(mapped.category),
        color: AppClassification.getCategoryColor(mapped.category),
      };
      appCategoryCache.set(cacheKey, descriptor);
      categoryDescriptors.set(mapped.category, descriptor);
    }

    forEachHourlySessionSegment(session, (hourIndex, durationMs) => {
      const minutes = durationMs / 60000;
      incrementCategoryMinutes(hourlyCategoryMinutes[hourIndex], descriptor.category, minutes);
      incrementCategoryMinutes(categoryTotals, descriptor.category, minutes);
    });
  }

  const series = buildVisibleSeries(
    categoryTotals,
    categoryDescriptors,
  );
  const points = hourlyCategoryMinutes.map((categoryMinutes, hourIndex) => {
    const point: HourlyCategoryActivityPoint = {
      hour: `${hourIndex.toString().padStart(2, "0")}:00`,
      minutes: Array.from(categoryMinutes.values()).reduce((total, minutes) => total + minutes, 0),
      segmentDetails: {},
    };
    const activeSegments = series
      .map((item) => ({
        item,
        minutes: categoryMinutes.get(item.category as AppCategory) ?? 0,
      }))
      .filter(({ minutes }) => minutes > 0)
      .sort((left, right) => left.minutes - right.minutes);
    point.minutes = Math.round(point.minutes);
    let remainingMinutes = point.minutes;

    for (const [index, { item, minutes }] of activeSegments.entries()) {
      const roundedValue = index === activeSegments.length - 1
        ? remainingMinutes
        : Math.min(remainingMinutes, Math.round(minutes));
      const slotDataKey = getHourlyCategorySlotDataKey(index);
      point[slotDataKey] = roundedValue > 0 ? roundedValue : null;
      point.segmentDetails[slotDataKey] = {
        category: item.category,
        name: item.name,
        color: item.color,
        minutes: roundedValue,
        isRemainder: item.isRemainder,
      };
      remainingMinutes -= roundedValue;
    }

    return point;
  });

  return { points, series };
}

export function limitHourlyCategoryActivity(
  activity: HourlyCategoryActivity,
  visibleCategoryLimit: number,
): HourlyCategoryActivity {
  const limit = Math.max(0, visibleCategoryLimit);
  const points = activity.points.map((sourcePoint) => {
    const activeSegments = Object.values(sourcePoint.segmentDetails)
      .filter((segment) => segment.minutes > 0)
      .sort((left, right) => right.minutes - left.minutes);
    const visibleSegments = activeSegments.slice(0, limit);
    const foldedSegments = activeSegments.slice(limit);
    const remainderMinutes = foldedSegments.reduce((total, segment) => total + segment.minutes, 0);
    const displaySegments = [
      ...(remainderMinutes > 0 ? [{
        category: null,
        name: UI_TEXT.dashboard.remainingCategories,
        color: "var(--qp-text-tertiary)",
        minutes: remainderMinutes,
        isRemainder: true,
      } satisfies HourlyCategoryActivitySegment] : []),
      ...visibleSegments.sort((left, right) => left.minutes - right.minutes),
    ];
    const point: HourlyCategoryActivityPoint = {
      hour: sourcePoint.hour,
      minutes: sourcePoint.minutes,
      segmentDetails: {},
    };

    for (const [index, segment] of displaySegments.entries()) {
      const slotDataKey = getHourlyCategorySlotDataKey(index);
      point[slotDataKey] = segment.minutes;
      point.segmentDetails[slotDataKey] = segment;
    }

    return point;
  });

  return { points, series: activity.series };
}
