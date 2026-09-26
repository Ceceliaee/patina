import type {
  QuietDateRangePickerSelection,
  QuietResolvedDateRange,
} from "../../../shared/components/QuietDateRangePicker.tsx";
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

export type ExportFormat = "csv" | "sqlite" | "parquet" | "markdown";
export type ExportRangeMode = "day" | "week" | "month" | "year";
export type ExportRangePickerMode = Exclude<ExportRangeMode, "day"> | "custom";
export type ExportRangeSelection = QuietDateRangePickerSelection;
type ExportTimeRangeError = "missingCustomRange" | "invalidCustomRange";

export interface ResolvedExportTimeRange extends QuietResolvedDateRange {
  startTime: number | null;
  endTime: number | null;
  error: ExportTimeRangeError | null;
}

export const EXPORT_RANGE_MODES: ExportRangeMode[] = ["day", "week", "month", "year"];
export const EXPORT_RANGE_PICKER_MODES: ExportRangePickerMode[] = ["custom", "week", "month", "year"];

function buildResolvedRange(
  selection: ExportRangeSelection,
  rawStart: Date,
  rawEnd: Date,
  nowMs: number,
  label: string,
): ResolvedExportTimeRange {
  const today = startOfLocalDay(new Date(nowMs));
  const start = minLocalDate(rawStart, today);
  const end = minLocalDate(maxLocalDate(rawStart, rawEnd), today);
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

    const start = minLocalDate(left, right);
    const end = minLocalDate(maxLocalDate(left, right), today);
    const dayCount = countInclusiveLocalDays(formatLocalDateKey(start), formatLocalDateKey(end));
    return buildResolvedRange(
      selection,
      start,
      end,
      nowMs,
      dayCount > 0 ? `${formatLocalDateKey(start)} - ${formatLocalDateKey(end)}` : "",
    );
  }

  const anchor = minLocalDate(parseLocalDateKey(selection.anchorDateKey) ?? today, today);
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

export function getAdjacentExportRangeSelection(
  selection: ExportRangeSelection,
  delta: -1 | 1,
  nowMs = Date.now(),
  calendarRange = false,
): ExportRangeSelection | null {
  if (selection.kind !== "custom") {
    if (calendarRange) {
      const range = resolveExportRangeSelection(selection, nowMs);
      const start = parseLocalDateKey(range.startDateKey)!;
      const next = selection.kind === "year"
        ? new Date(start.getFullYear() + delta, 0, 1)
        : selection.kind === "month"
          ? new Date(start.getFullYear(), start.getMonth() + delta, 1)
          : addLocalDays(start, delta * (selection.kind === "week" ? 7 : 1));
      if (next > startOfLocalDay(new Date(nowMs))) return null;
      return { kind: selection.kind, anchorDateKey: formatLocalDateKey(next) };
    }
    const mode = EXPORT_RANGE_MODES[EXPORT_RANGE_MODES.indexOf(selection.kind) + delta];
    return mode ? buildExportRangeSelection(mode, nowMs) : null;
  }
  const range = resolveExportRangeSelection(selection, nowMs);
  if (range.error || range.dayCount < 1) return null;
  const start = parseLocalDateKey(range.startDateKey)!;
  const end = parseLocalDateKey(range.endDateKey)!;
  const nextEnd = addLocalDays(end, delta * range.dayCount);
  if (nextEnd > startOfLocalDay(new Date(nowMs))) return null;
  return {
    kind: "custom",
    startDateKey: formatLocalDateKey(addLocalDays(start, delta * range.dayCount)),
    endDateKey: formatLocalDateKey(nextEnd),
  };
}
