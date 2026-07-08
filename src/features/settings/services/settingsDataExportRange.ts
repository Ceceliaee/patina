import type {
  QuietDateRangePickerSelection,
  QuietResolvedDateRange,
} from "../../../shared/components/QuietDateRangePicker.tsx";
import {
  addLocalDays,
  addLocalMonths,
  formatLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
} from "../../../shared/lib/localDate.ts";

export type ExportFormat = "csv" | "sqlite" | "parquet";
export type ExportRangeMode = "day" | "week" | "month" | "year";
export type ExportRangePickerMode = Exclude<ExportRangeMode, "day"> | "custom";
export type ExportRangeSelection = QuietDateRangePickerSelection;
export type ExportTimeRangeError = "missingCustomRange" | "invalidCustomRange";

export interface ResolvedExportTimeRange extends QuietResolvedDateRange {
  startTime: number | null;
  endTime: number | null;
  error: ExportTimeRangeError | null;
}

export interface DateInputRange {
  startDateKey: string;
  endDateKey: string;
}

interface ResolveExportTimeRangeInput {
  preset: TimeRangePreset;
  customStart: string;
  customEnd: string;
  nowMs?: number;
}

export type TimeRangePreset = "today" | "thisWeek" | "thisMonth" | "thisYear" | "custom";

export const EXPORT_RANGE_MODES: ExportRangeMode[] = ["day", "week", "month", "year"];
export const EXPORT_RANGE_PICKER_MODES: ExportRangePickerMode[] = ["custom", "week", "month", "year"];

function minDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function maxDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}

function countInclusiveLocalDays(startDateKey: string, endDateKey: string): number {
  const start = parseLocalDateKey(startDateKey);
  const end = parseLocalDateKey(endDateKey);
  if (!start || !end || start > end) return 0;
  let count = 0;
  for (let cursor = start; cursor <= end; cursor = addLocalDays(cursor, 1)) count += 1;
  return count;
}

function getIsoWeek(date: Date): { week: number; year: number } {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const weekday = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return {
    week: Math.ceil((((utc.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7),
    year: utc.getUTCFullYear(),
  };
}

function buildResolvedRange(
  selection: ExportRangeSelection,
  rawStart: Date,
  rawEnd: Date,
  nowMs: number,
  label: string,
): ResolvedExportTimeRange {
  const today = startOfLocalDay(new Date(nowMs));
  const start = minDate(rawStart, today);
  const end = minDate(maxDate(rawStart, rawEnd), today);
  const startDateKey = formatLocalDateKey(start);
  const endDateKey = formatLocalDateKey(end);
  const startTime = startOfLocalDay(start).getTime();
  const endTime = addLocalDays(startOfLocalDay(end), 1).getTime();
  return {
    selection,
    startDateKey,
    endDateKey,
    startTime,
    endTime,
    error: null,
    label,
    dayCount: countInclusiveLocalDays(startDateKey, endDateKey),
  };
}

export function buildExportRangeSelection(mode: ExportRangeMode, nowMs = Date.now()): ExportRangeSelection {
  return {
    kind: mode,
    anchorDateKey: formatLocalDateKey(startOfLocalDay(new Date(nowMs))),
  };
}

export function resolveExportRangeSelection(
  selection: ExportRangeSelection,
  nowMs = Date.now(),
): ResolvedExportTimeRange {
  const today = startOfLocalDay(new Date(nowMs));

  if (selection.kind === "custom") {
    if (!selection.startDateKey || !selection.endDateKey) {
      return {
        selection,
        startDateKey: "",
        endDateKey: "",
        startTime: null,
        endTime: null,
        error: "missingCustomRange",
        label: "",
        dayCount: 0,
      };
    }

    const left = parseLocalDateKey(selection.startDateKey);
    const right = parseLocalDateKey(selection.endDateKey);
    if (!left || !right) {
      return {
        selection,
        startDateKey: selection.startDateKey,
        endDateKey: selection.endDateKey,
        startTime: null,
        endTime: null,
        error: "invalidCustomRange",
        label: "",
        dayCount: 0,
      };
    }

    const start = minDate(left, right);
    const end = minDate(maxDate(left, right), today);
    const dayCount = countInclusiveLocalDays(formatLocalDateKey(start), formatLocalDateKey(end));
    return buildResolvedRange(
      selection,
      start,
      end,
      nowMs,
      dayCount > 0 ? `${formatLocalDateKey(start)} - ${formatLocalDateKey(end)}` : "",
    );
  }

  const anchor = minDate(parseLocalDateKey(selection.anchorDateKey) ?? today, today);
  if (selection.kind === "day") {
    return buildResolvedRange(selection, anchor, anchor, nowMs, formatLocalDateKey(anchor));
  }

  if (selection.kind === "week") {
    const mondayOffset = (anchor.getDay() + 6) % 7;
    const start = addLocalDays(anchor, -mondayOffset);
    const isoWeek = getIsoWeek(anchor);
    return buildResolvedRange(selection, start, addLocalDays(start, 6), nowMs, `${isoWeek.year}-W${String(isoWeek.week).padStart(2, "0")}`);
  }

  if (selection.kind === "month") {
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return buildResolvedRange(selection, start, end, nowMs, `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`);
  }

  const start = new Date(anchor.getFullYear(), 0, 1);
  const end = new Date(anchor.getFullYear(), 11, 31);
  return buildResolvedRange(selection, start, end, nowMs, String(anchor.getFullYear()));
}

export function shiftExportRangeSelection(
  selection: ExportRangeSelection,
  delta: -1 | 1,
  nowMs = Date.now(),
): ExportRangeSelection {
  const resolved = resolveExportRangeSelection(selection, nowMs);
  const start = parseLocalDateKey(resolved.startDateKey) ?? startOfLocalDay(new Date(nowMs));
  if (selection.kind === "custom") {
    const days = Math.max(1, resolved.dayCount);
    return {
      kind: "custom",
      startDateKey: formatLocalDateKey(addLocalDays(start, delta * days)),
      endDateKey: formatLocalDateKey(addLocalDays(parseLocalDateKey(resolved.endDateKey) ?? start, delta * days)),
    };
  }

  if (selection.kind === "day") {
    return { kind: "day", anchorDateKey: formatLocalDateKey(addLocalDays(start, delta)) };
  }
  if (selection.kind === "week") {
    return { kind: "week", anchorDateKey: formatLocalDateKey(addLocalDays(start, delta * 7)) };
  }
  if (selection.kind === "month") {
    return { kind: "month", anchorDateKey: formatLocalDateKey(addLocalMonths(start, delta)) };
  }
  return { kind: "year", anchorDateKey: formatLocalDateKey(new Date(start.getFullYear() + delta, 0, 1)) };
}

export function canShiftExportRangeSelection(
  selection: ExportRangeSelection,
  delta: -1 | 1,
  nowMs = Date.now(),
): boolean {
  if (delta < 0) return true;
  const shifted = resolveExportRangeSelection(shiftExportRangeSelection(selection, delta, nowMs), nowMs);
  const todayKey = formatLocalDateKey(startOfLocalDay(new Date(nowMs)));
  return Boolean(shifted.startDateKey && shifted.endDateKey && shifted.endDateKey <= todayKey);
}

export function resolveExportRangeLabel(
  resolved: ResolvedExportTimeRange,
  labels: Record<ExportRangeMode, string>,
): string {
  const todayKey = formatLocalDateKey(startOfLocalDay(new Date()));
  if (resolved.selection.kind !== "custom" && resolved.endDateKey === todayKey) {
    return labels[resolved.selection.kind];
  }
  return resolved.label || `${resolved.startDateKey} - ${resolved.endDateKey}`;
}

export function getPresetDateInputs(preset: Exclude<TimeRangePreset, "custom">, nowMs = Date.now()): DateInputRange {
  const mode = preset === "today"
    ? "day"
    : preset === "thisWeek"
      ? "week"
      : preset === "thisMonth"
        ? "month"
        : "year";
  const resolved = resolveExportRangeSelection(buildExportRangeSelection(mode, nowMs), nowMs);
  return {
    startDateKey: resolved.startDateKey,
    endDateKey: resolved.endDateKey,
  };
}

export function resolveExportTimeRange({
  preset,
  customStart,
  customEnd,
  nowMs = Date.now(),
}: ResolveExportTimeRangeInput): ResolvedExportTimeRange {
  const selection: ExportRangeSelection = preset === "custom"
    ? { kind: "custom", startDateKey: customStart, endDateKey: customEnd }
    : buildExportRangeSelection(
      preset === "today" ? "day" : preset === "thisWeek" ? "week" : preset === "thisMonth" ? "month" : "year",
      nowMs,
    );
  const resolved = resolveExportRangeSelection(selection, nowMs);
  if (selection.kind === "custom" && customStart && customEnd && customStart > customEnd) {
    return {
      ...resolved,
      startTime: null,
      endTime: null,
      error: "invalidCustomRange",
    };
  }
  return resolved;
}

export function countInclusiveDays(startDateKey: string, endDateKey: string): number | null {
  const start = parseLocalDateKey(startDateKey);
  const end = parseLocalDateKey(endDateKey);
  if (!start || !end || start.getTime() > end.getTime()) return null;
  return countInclusiveLocalDays(startDateKey, endDateKey);
}
