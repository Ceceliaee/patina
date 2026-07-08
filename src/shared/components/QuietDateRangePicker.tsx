import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  buildMondayFirstCalendarGrid,
  formatLocalDateKey,
  startOfLocalDay,
} from "../lib/localDate.ts";

export type QuietDateRangePickerMode = "custom" | "day" | "week" | "month" | "year";

export type QuietDateRangePickerSelection =
  | { kind: "custom"; startDateKey: string; endDateKey: string }
  | { kind: Exclude<QuietDateRangePickerMode, "custom">; anchorDateKey: string };

export interface QuietResolvedDateRange {
  selection: QuietDateRangePickerSelection;
  startDateKey: string;
  endDateKey: string;
  label: string;
  dayCount: number;
}

interface QuietDateRangeDraft {
  mode: QuietDateRangePickerMode;
  firstDateKey: string | null;
  range: QuietResolvedDateRange | null;
}

interface QuietDateRangePickerLabels {
  title: string;
  modeLabels: Record<QuietDateRangePickerMode, string>;
  pickStartDate: string;
  pickEndDate: string;
  pickDate: string;
  shortRangeHint?: string;
  cancel: string;
  apply: string;
  previousMonth: string;
  nextMonth: string;
  yearMonthLabel: (year: number, month: number) => string;
  weekdaysShort: readonly string[];
}

interface Props {
  anchor: HTMLElement;
  mode: QuietDateRangePickerMode;
  labels: QuietDateRangePickerLabels;
  className?: string;
  footerClassName?: string;
  nowMs?: number;
  onApply: (selection: QuietDateRangePickerSelection) => void;
  onClose: () => void;
  onDraftLabelChange?: (label: string) => void;
  resolveSelection: (
    selection: QuietDateRangePickerSelection,
    nowMs?: number,
  ) => QuietResolvedDateRange;
}

function getPopoverPosition(anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(236, window.innerWidth - 24);
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 12);
  const estimatedHeight = 344;
  const top = rect.bottom + 8 + estimatedHeight <= window.innerHeight
    ? rect.bottom + 8
    : Math.max(12, rect.top - estimatedHeight - 8);
  return { left, top, width };
}

function getDraftLabel(draft: QuietDateRangeDraft, labels: QuietDateRangePickerLabels) {
  return draft.range?.label ?? labels.modeLabels[draft.mode];
}

function getDraftSummary(draft: QuietDateRangeDraft, labels: QuietDateRangePickerLabels) {
  if (draft.range) return `${draft.range.startDateKey} - ${draft.range.endDateKey}`;
  if (draft.mode === "custom" && draft.firstDateKey) return labels.pickEndDate;
  return draft.mode === "custom" ? labels.pickStartDate : labels.pickDate;
}

function selectDraftDate(
  draft: QuietDateRangeDraft,
  dateKey: string,
  resolveSelection: Props["resolveSelection"],
  nowMs?: number,
): QuietDateRangeDraft {
  const todayKey = formatLocalDateKey(startOfLocalDay(new Date(nowMs ?? Date.now())));
  if (dateKey > todayKey) return draft;

  if (draft.mode === "custom") {
    if (!draft.firstDateKey || draft.range) {
      return { mode: "custom", firstDateKey: dateKey, range: null };
    }
    return {
      mode: "custom",
      firstDateKey: null,
      range: resolveSelection({
        kind: "custom",
        startDateKey: draft.firstDateKey,
        endDateKey: dateKey,
      }, nowMs),
    };
  }

  return {
    mode: draft.mode,
    firstDateKey: null,
    range: resolveSelection({ kind: draft.mode, anchorDateKey: dateKey }, nowMs),
  };
}

export default function QuietDateRangePicker({
  anchor,
  mode,
  labels,
  className,
  footerClassName,
  nowMs,
  onApply,
  onClose,
  onDraftLabelChange,
  resolveSelection,
}: Props) {
  const [draft, setDraft] = useState<QuietDateRangeDraft>({
    mode,
    firstDateKey: null,
    range: null,
  });
  const [calendarMonth, setCalendarMonth] = useState(() => startOfLocalDay(new Date(nowMs ?? Date.now())));
  const [position, setPosition] = useState(() => getPopoverPosition(anchor));
  const today = startOfLocalDay(new Date(nowMs ?? Date.now()));
  const todayKey = formatLocalDateKey(today);
  const calendarDays = useMemo(() => buildMondayFirstCalendarGrid(calendarMonth), [calendarMonth]);
  const canGoNextMonth = calendarMonth.getFullYear() < today.getFullYear()
    || calendarMonth.getMonth() < today.getMonth();

  useEffect(() => {
    const updatePosition = () => setPosition(getPopoverPosition(anchor));
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Node
        && !anchor.parentElement?.contains(target)
        && !document.querySelector(".qp-range-picker")?.contains(target)
      ) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [anchor, onClose]);

  useEffect(() => {
    setDraft({ mode, firstDateKey: null, range: null });
  }, [mode]);

  useEffect(() => {
    onDraftLabelChange?.(getDraftLabel(draft, labels));
  }, [draft, labels, onDraftLabelChange]);

  if (typeof document === "undefined") return null;

  return createPortal((
    <section
      className={`qp-range-picker ${className ?? ""}`.trim()}
      style={{ left: position.left, top: position.top, width: position.width }}
      role="dialog"
      aria-label={labels.title}
    >
      <header className="qp-range-picker-header">
        <strong>{getDraftSummary(draft, labels)}</strong>
      </header>

      <div className="qp-range-picker-month">
        <button
          type="button"
          className="qp-control qp-range-picker-arrow"
          onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
          aria-label={labels.previousMonth}
        >
          <ChevronLeft size={14} />
        </button>
        <strong>{labels.yearMonthLabel(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1)}</strong>
        <button
          type="button"
          className="qp-control qp-range-picker-arrow"
          disabled={!canGoNextMonth}
          onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
          aria-label={labels.nextMonth}
        >
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="qp-range-picker-grid qp-range-picker-weekdays">
        {labels.weekdaysShort.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="qp-range-picker-grid">
        {calendarDays.map((date) => {
          const dateKey = formatLocalDateKey(date);
          const isFuture = dateKey > todayKey;
          const isOutsideMonth = date.getMonth() !== calendarMonth.getMonth();
          const isInRange = Boolean(
            draft.range
            && dateKey >= draft.range.startDateKey
            && dateKey <= draft.range.endDateKey,
          );
          const isBoundary = dateKey === draft.range?.startDateKey
            || dateKey === draft.range?.endDateKey
            || dateKey === draft.firstDateKey;
          return (
            <button
              key={dateKey}
              type="button"
              className={[
                "qp-range-picker-day",
                isOutsideMonth ? "qp-range-picker-day-muted" : "",
                isInRange ? "qp-range-picker-day-in-range" : "",
                isBoundary ? "qp-range-picker-day-selected" : "",
              ].filter(Boolean).join(" ")}
              disabled={isFuture}
              data-range-picker-date={dateKey}
              onClick={() => setDraft((current) => selectDraftDate(current, dateKey, resolveSelection, nowMs))}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>

      {draft.mode === "custom" && draft.range && draft.range.dayCount < 7 && labels.shortRangeHint ? (
        <p className="qp-range-picker-hint">{labels.shortRangeHint}</p>
      ) : null}

      <footer className={`qp-range-picker-footer ${footerClassName ?? ""}`.trim()}>
        <button type="button" className="qp-button-secondary qp-range-picker-action" onClick={onClose}>{labels.cancel}</button>
        <button
          type="button"
          className="qp-button-primary qp-range-picker-action"
          disabled={!draft.range}
          onClick={() => {
            if (draft.range) onApply(draft.range.selection);
          }}
        >
          {labels.apply}
        </button>
      </footer>
    </section>
  ), document.body);
}
