import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { Locale, UiText } from "../../../shared/i18n/index.ts";
import { formatDuration } from "../../../shared/lib/durationFormatting.ts";
import {
  addLocalDays as addDays,
  formatLocalDateKey as toDateKey,
  startOfLocalDay,
} from "../../../shared/lib/localDate.ts";
import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";

export interface HeatmapCell {
  key: string;
  date: string;
  duration: number;
  intensity: number;
  isFuture: boolean;
  isOutsideYear: boolean;
  label: string;
  availability?: HeatmapAvailability;
}

export interface HeatmapWeek {
  key: string;
  monthLabel: string;
  cells: HeatmapCell[];
}

export type HeatmapSelection = "recent" | number;

export function isDataHeatmapSelectionSettled(
  loadedSelection: HeatmapSelection | null,
  requestedSelection: HeatmapSelection,
  coldError: boolean,
): boolean {
  return coldError || loadedSelection === requestedSelection;
}
type HeatmapAvailability = "recorded" | "no-activity" | "unavailable" | "future";

export interface HeatmapRange {
  start: Date;
  end: Date;
  weekCount: number;
}

const RECENT_HEATMAP_WEEK_COUNT = 53;

function formatHeatmapDateLabel(dateKey: string, locale: Locale) {
  const [year, month, day] = dateKey.split("-");
  return locale.startsWith("zh")
    ? `${year}/${month}/${day}`
    : `${month}/${day}/${year}`;
}

function formatHeatmapMonthLabel(date: Date, uiText: UiText) {
  return uiText.date.monthLabel(date.getMonth() + 1);
}

export function resolveStatisticalDataAppKey(session: AggregateSessionRecord): string | null {
  if (!AppClassification.shouldTrackProcess(session.exeName, { appName: session.appName })) {
    return null;
  }

  const appKey = AppClassification.resolveCanonicalExecutable(session.exeName);
  return appKey && AppClassification.isAppTrackingEnabledByUser(appKey) ? appKey : null;
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

export function buildYearOptions(earliestStartTime: number | null, currentYear: number) {
  const earliestYear = earliestStartTime ? new Date(earliestStartTime).getFullYear() : currentYear;
  const firstYear = Math.min(earliestYear, currentYear);
  return Array.from(
    { length: currentYear - firstYear + 1 },
    (_, index) => currentYear - index,
  );
}

export function buildActivityHeatmap(
  sessions: AggregateSessionRecord[],
  selection: HeatmapSelection,
  nowMs: number,
  uiText: UiText,
  locale: Locale,
  selectedAppKeys: string | readonly string[] | null = null,
): HeatmapWeek[] {
  const { start: heatmapStart, end: heatmapEnd, weekCount } = getHeatmapRange(selection, nowMs);
  const dayBuckets = new Map<string, number>();
  const selectedAppKeySet = selectedAppKeys === null
    ? null
    : new Set(Array.isArray(selectedAppKeys) ? selectedAppKeys : [selectedAppKeys]);

  for (let dayIndex = 0; dayIndex < weekCount * 7; dayIndex += 1) {
    dayBuckets.set(toDateKey(addDays(heatmapStart, dayIndex)), 0);
  }

  const heatmapStartMs = heatmapStart.getTime();
  const heatmapEndMs = heatmapEnd.getTime();
  const statisticalAppKeyByApp = new Map<string, string | null>();
  let cachedDayStartMs = Number.NaN;
  let cachedDayEndMs = Number.NaN;
  let cachedDayKey = "";

  for (const session of sessions) {
    const eligibilityKey = `${session.exeName}\u0000${session.appName}`;
    if (!statisticalAppKeyByApp.has(eligibilityKey)) {
      statisticalAppKeyByApp.set(eligibilityKey, resolveStatisticalDataAppKey(session));
    }
    const sessionAppKey = statisticalAppKeyByApp.get(eligibilityKey) ?? null;
    if (!sessionAppKey) continue;
    if (selectedAppKeySet && !selectedAppKeySet.has(sessionAppKey)) continue;

    const sessionStart = Math.max(session.startTime, heatmapStartMs);
    const sessionEnd = Math.min(session.endTime ?? nowMs, heatmapEndMs);
    if (sessionEnd <= sessionStart) continue;

    if (sessionStart >= cachedDayStartMs && sessionEnd <= cachedDayEndMs) {
      const previous = dayBuckets.get(cachedDayKey);
      if (previous !== undefined) {
        dayBuckets.set(cachedDayKey, previous + sessionEnd - sessionStart);
      }
      continue;
    }

    let cursor = startOfLocalDay(new Date(sessionStart));
    const firstDayEnd = addDays(cursor, 1).getTime();
    if (sessionEnd <= firstDayEnd) {
      cachedDayStartMs = cursor.getTime();
      cachedDayEndMs = firstDayEnd;
      cachedDayKey = toDateKey(cursor);
      const previous = dayBuckets.get(cachedDayKey);
      if (previous !== undefined) {
        dayBuckets.set(cachedDayKey, previous + sessionEnd - sessionStart);
      }
      continue;
    }

    while (cursor.getTime() < sessionEnd) {
      const dayStart = cursor.getTime();
      const dayEnd = addDays(cursor, 1).getTime();
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

  return buildHeatmapFromDailyDurations({
    dayDurations: dayBuckets,
    selection,
    nowMs,
    uiText,
    locale,
  });
}

export function buildHeatmapFromDailyDurations({
  dayDurations,
  selection,
  nowMs,
  resolveAvailability,
  resolveSummary,
  uiText,
  locale,
}: {
  dayDurations: Map<string, number>;
  selection: HeatmapSelection;
  nowMs: number;
  resolveAvailability?: (input: {
    dateKey: string;
    dateMs: number;
    duration: number;
    isFuture: boolean;
    isOutsideYear: boolean;
  }) => HeatmapAvailability;
  resolveSummary?: (input: {
    availability: HeatmapAvailability;
    duration: number;
  }) => string;
  uiText: UiText;
  locale: Locale;
}): HeatmapWeek[] {
  const { start: heatmapStart, weekCount } = getHeatmapRange(selection, nowMs);
  const todayStart = startOfLocalDay(new Date(nowMs));
  const maxDuration = Math.max(1, ...Array.from(dayDurations.values()));
  return Array.from({ length: weekCount }, (_, weekIndex) => {
    const weekStart = addDays(heatmapStart, weekIndex * 7);
    const monthStartInWeek = Array.from({ length: 7 }, (_, weekdayIndex) => addDays(weekStart, weekdayIndex))
      .find((date) => (selection === "recent" || date.getFullYear() === selection) && date.getDate() === 1);
    return {
      key: toDateKey(weekStart),
      monthLabel: monthStartInWeek ? formatHeatmapMonthLabel(monthStartInWeek, uiText) : "",
      cells: Array.from({ length: 7 }, (_, weekdayIndex) => {
        const date = addDays(weekStart, weekdayIndex);
        const dateKey = toDateKey(date);
        const duration = dayDurations.get(dateKey) ?? 0;
        const isFuture = date.getTime() > todayStart.getTime();
        const isOutsideYear = selection !== "recent" && date.getFullYear() !== selection;
        const availability = resolveAvailability?.({
          dateKey,
          dateMs: date.getTime(),
          duration,
          isFuture,
          isOutsideYear,
        }) ?? (isFuture ? "future" : "recorded");
        const summary = resolveSummary?.({ availability, duration })
          ?? (isFuture ? uiText.data.notStarted : formatDuration(duration));
        return {
          key: dateKey,
          date: dateKey,
          duration,
          isFuture,
          isOutsideYear,
          availability,
          intensity: duration <= 0 || isFuture || isOutsideYear ? 0 : Math.max(0.16, duration / maxDuration),
          label: `${formatHeatmapDateLabel(dateKey, locale)} · ${summary}`,
        };
      }),
    };
  });
}
