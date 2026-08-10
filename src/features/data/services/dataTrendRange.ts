
import type { SessionRange } from "../../../shared/lib/sessionReadCompiler.ts";
import type { UiText } from "../../../shared/i18n/index.ts";
import {
  addLocalDays,
  countInclusiveLocalDays,
  formatLocalDateKey,
  getIsoWeek,
  maxLocalDate,
  minLocalDate,
  parseLocalDateKey,
  startOfLocalDay,
} from "../../../shared/lib/localDate.ts";

export type DataRollingTrendRange = 7 | 30 | 365;
export type DataTrendPickerMode = "custom" | "week" | "month" | "year";

export type DataTrendRangeSelection =
  | { kind: "all"; startDateKey: string; endDateKey: string }
  | { kind: "rolling"; days: DataRollingTrendRange }
  | { kind: "custom"; startDateKey: string; endDateKey: string }
  | { kind: "week"; anchorDateKey: string }
  | { kind: "month"; anchorDateKey: string }
  | { kind: "year"; anchorDateKey: string };

export interface ResolvedDataTrendRange {
  selection: DataTrendRangeSelection;
  startDateKey: string;
  endDateKey: string;
  startMs: number;
  endMs: number;
  dayCount: number;
  label: string;
  granularity: "day" | "month";
  cacheKey: string;
}

export interface DataTrendRangeDraft {
  mode: DataTrendPickerMode;
  firstDateKey: string | null;
  range: ResolvedDataTrendRange | null;
}

const DATA_ROLLING_TREND_RANGES: DataRollingTrendRange[] = [7, 30, 365];
export const DATA_TREND_PICKER_MODES: DataTrendPickerMode[] = ["custom", "week", "month", "year"];
export const DEFAULT_DATA_TREND_RANGE_SELECTION: DataTrendRangeSelection = {
  kind: "rolling",
  days: 7,
};

export {
  addLocalDays,
  countInclusiveLocalDays,
  parseLocalDateKey,
  startOfLocalDay,
};

const toLocalDateKey = formatLocalDateKey;

function getRollingLabel(days: DataRollingTrendRange, uiText: UiText): string {
  if (days === 7) return uiText.data.pastSevenDays;
  if (days === 30) return uiText.data.pastThirtyDays;
  return uiText.data.recentYear;
}

function getNormalizedCustomBounds(
  selection: Extract<DataTrendRangeSelection, { kind: "custom" }>,
): { start: Date; end: Date } | null {
  const left = parseLocalDateKey(selection.startDateKey);
  const right = parseLocalDateKey(selection.endDateKey);
  if (!left || !right) return null;
  return left <= right
    ? { start: left, end: right }
    : { start: right, end: left };
}

export function getAdjacentDataTrendRangeSelection(
  selection: DataTrendRangeSelection,
  delta: -1 | 1,
  nowMs: number,
  uiText: UiText,
  allTimeStartDateKey: string = toLocalDateKey(new Date(0)),
  allTimeEndDateKey: string = toLocalDateKey(new Date(nowMs)),
): DataTrendRangeSelection | null {
  if (selection.kind === "all") {
    return delta === 1 ? { kind: "rolling", days: 7 } : null;
  }

  if (selection.kind === "rolling") {
    const currentIndex = DATA_ROLLING_TREND_RANGES.indexOf(selection.days);
    if (currentIndex === 0 && delta === -1) {
      return {
        kind: "all",
        startDateKey: allTimeStartDateKey,
        endDateKey: allTimeEndDateKey,
      };
    }
    const days = DATA_ROLLING_TREND_RANGES[currentIndex + delta];
    return days ? { kind: "rolling", days } : null;
  }

  const today = startOfLocalDay(new Date(nowMs));
  if (selection.kind === "custom") {
    const bounds = getNormalizedCustomBounds(selection);
    if (!bounds) return null;
    const span = countInclusiveLocalDays(
      toLocalDateKey(bounds.start),
      toLocalDateKey(bounds.end),
    );
    const start = addLocalDays(bounds.start, delta * span);
    const end = addLocalDays(bounds.end, delta * span);
    if (end > today) return null;
    return {
      kind: "custom",
      startDateKey: toLocalDateKey(start),
      endDateKey: toLocalDateKey(end),
    };
  }

  const currentRange = resolveDataTrendRange(selection, nowMs, uiText);
  const currentStart = parseLocalDateKey(currentRange.startDateKey);
  if (!currentStart) return null;

  if (selection.kind === "week") {
    const nextStart = addLocalDays(currentStart, delta * 7);
    if (nextStart > today) return null;
    return { kind: "week", anchorDateKey: toLocalDateKey(nextStart) };
  }

  if (selection.kind === "month") {
    const nextStart = new Date(
      currentStart.getFullYear(),
      currentStart.getMonth() + delta,
      1,
    );
    if (nextStart > today) return null;
    return { kind: "month", anchorDateKey: toLocalDateKey(nextStart) };
  }

  const nextStart = new Date(currentStart.getFullYear() + delta, 0, 1);
  if (nextStart > today) return null;
  return { kind: "year", anchorDateKey: toLocalDateKey(nextStart) };
}

function resolveBounds(
  selection: DataTrendRangeSelection,
  start: Date,
  requestedEnd: Date,
  nowMs: number,
  label: string,
  granularity: "day" | "month",
): ResolvedDataTrendRange {
  const today = startOfLocalDay(new Date(nowMs));
  const end = minLocalDate(requestedEnd, today);
  const startDateKey = toLocalDateKey(start);
  const endDateKey = toLocalDateKey(end);
  const nextDay = addLocalDays(end, 1).getTime();
  return {
    selection,
    startDateKey,
    endDateKey,
    startMs: start.getTime(),
    endMs: Math.min(nextDay, nowMs),
    dayCount: countInclusiveLocalDays(startDateKey, endDateKey),
    label,
    granularity,
    cacheKey: `${startDateKey}:${endDateKey}`,
  };
}

export function resolveDataTrendRange(
  selection: DataTrendRangeSelection,
  nowMs: number,
  uiText: UiText,
): ResolvedDataTrendRange {
  const today = startOfLocalDay(new Date(nowMs));
  if (selection.kind === "all") {
    const left = minLocalDate(parseLocalDateKey(selection.startDateKey) ?? today, today);
    const right = minLocalDate(parseLocalDateKey(selection.endDateKey) ?? today, today);
    const earliest = minLocalDate(left, right);
    const latest = maxLocalDate(left, right);
    const start = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
    const end = new Date(latest.getFullYear(), latest.getMonth() + 1, 0);
    return resolveBounds(
      selection,
      start,
      end,
      nowMs,
      uiText.data.allTime,
      "month",
    );
  }

  if (selection.kind === "rolling") {
    if (selection.days === 365) {
      const start = new Date(today.getFullYear(), today.getMonth() - 11, 1);
      return resolveBounds(selection, start, today, nowMs, getRollingLabel(selection.days, uiText), "month");
    }
    return resolveBounds(
      selection,
      addLocalDays(today, -(selection.days - 1)),
      today,
      nowMs,
      getRollingLabel(selection.days, uiText),
      "day",
    );
  }

  if (selection.kind === "custom") {
    const left = parseLocalDateKey(selection.startDateKey) ?? today;
    const right = parseLocalDateKey(selection.endDateKey) ?? today;
    const start = left <= right ? left : right;
    const end = left <= right ? right : left;
    const dayCount = countInclusiveLocalDays(toLocalDateKey(start), toLocalDateKey(minLocalDate(end, today)));
    return resolveBounds(
      selection,
      start,
      end,
      nowMs,
      uiText.data.customDayCount(dayCount),
      dayCount > 62 ? "month" : "day",
    );
  }

  const anchor = minLocalDate(parseLocalDateKey(selection.anchorDateKey) ?? today, today);
  if (selection.kind === "week") {
    const mondayOffset = (anchor.getDay() + 6) % 7;
    const start = addLocalDays(anchor, -mondayOffset);
    const isoWeek = getIsoWeek(anchor);
    return resolveBounds(selection, start, addLocalDays(start, 6), nowMs, uiText.data.weekLabel(isoWeek.week), "day");
  }

  if (selection.kind === "month") {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return resolveBounds(selection, start, end, nowMs, uiText.date.monthLabel(anchor.getMonth() + 1), "day");
  }

  const start = new Date(anchor.getFullYear(), 0, 1);
  const end = new Date(anchor.getFullYear(), 11, 31);
  return resolveBounds(selection, start, end, nowMs, uiText.data.yearLabel(anchor.getFullYear()), "month");
}

export function resolveDataAllTimePresentationRange(
  range: ResolvedDataTrendRange,
  activeMonthKeys: Iterable<string>,
  uiText: UiText,
): ResolvedDataTrendRange {
  if (range.selection.kind !== "all") return range;

  let earliestMonthKey: string | null = null;
  let latestMonthKey: string | null = null;
  for (const monthKey of activeMonthKeys) {
    if (!/^\d{4}-\d{2}$/u.test(monthKey)) continue;
    if (earliestMonthKey === null || monthKey < earliestMonthKey) {
      earliestMonthKey = monthKey;
    }
    if (latestMonthKey === null || monthKey > latestMonthKey) {
      latestMonthKey = monthKey;
    }
  }
  if (earliestMonthKey === null || latestMonthKey === null) return range;

  return resolveDataTrendRange({
    kind: "all",
    startDateKey: `${earliestMonthKey}-01`,
    endDateKey: `${latestMonthKey}-01`,
  }, range.endMs, uiText);
}

export function selectDataTrendDraftDate(
  draft: DataTrendRangeDraft,
  dateKey: string,
  nowMs: number,
  uiText: UiText,
): DataTrendRangeDraft {
  const date = parseLocalDateKey(dateKey);
  if (!date || date > startOfLocalDay(new Date(nowMs))) return draft;
  if (draft.mode === "custom") {
    if (!draft.firstDateKey || draft.range) return { mode: "custom", firstDateKey: dateKey, range: null };
    return {
      mode: "custom",
      firstDateKey: null,
      range: resolveDataTrendRange({ kind: "custom", startDateKey: draft.firstDateKey, endDateKey: dateKey }, nowMs, uiText),
    };
  }
  return {
    mode: draft.mode,
    firstDateKey: null,
    range: resolveDataTrendRange({ kind: draft.mode, anchorDateKey: dateKey }, nowMs, uiText),
  };
}

export function buildDataDayRanges(range: ResolvedDataTrendRange): SessionRange[] {
  const start = parseLocalDateKey(range.startDateKey);
  const end = parseLocalDateKey(range.endDateKey);
  if (!start || !end) return [];
  const result: SessionRange[] = [];
  for (let cursor = start; cursor <= end; cursor = addLocalDays(cursor, 1)) {
    result.push({
      startMs: cursor.getTime(),
      endMs: Math.min(addLocalDays(cursor, 1).getTime(), range.endMs),
    });
  }
  return result;
}

export function buildDataMonthRanges(range: ResolvedDataTrendRange): SessionRange[] {
  const start = parseLocalDateKey(range.startDateKey);
  const end = parseLocalDateKey(range.endDateKey);
  if (!start || !end) return [];
  const result: SessionRange[] = [];
  for (
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    cursor <= end;
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
  ) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    result.push({
      startMs: Math.max(cursor.getTime(), range.startMs),
      endMs: Math.min(next.getTime(), range.endMs),
    });
  }
  return result;
}
