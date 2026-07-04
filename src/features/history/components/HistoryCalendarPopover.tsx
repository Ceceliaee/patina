import type { RefObject } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import {
  formatLocalDateKey,
  isSameLocalDay,
  startOfLocalDay,
} from "../../../shared/lib/localDate.ts";

interface HistoryCalendarPopoverProps {
  open: boolean;
  popoverRef: RefObject<HTMLDivElement | null>;
  position: {
    left: number;
    top: number;
  };
  calendarMonth: Date;
  calendarDays: Date[];
  selectedDate: Date;
  today: Date;
  canGoNextMonth: boolean;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
  onSelectDate: (date: Date) => void;
}

const formatCalendarMonth = (date: Date) => UI_TEXT.date.yearMonthLabel(date.getFullYear(), date.getMonth() + 1);

export default function HistoryCalendarPopover({
  open,
  popoverRef,
  position,
  calendarMonth,
  calendarDays,
  selectedDate,
  today,
  canGoNextMonth,
  onPreviousMonth,
  onNextMonth,
  onSelectDate,
}: HistoryCalendarPopoverProps) {
  return createPortal(
    open ? (
        <div
          ref={popoverRef}
          className="history-calendar-popover qp-motion-popover-enter"
          style={{
            left: position.left,
            top: position.top,
          }}
        >
          <header className="history-calendar-header">
            <button
              type="button"
              onClick={onPreviousMonth}
              className="history-calendar-nav"
              aria-label={UI_TEXT.accessibility.history.previousMonth}
            >
              <ChevronLeft size={14} />
            </button>
            <div className="history-calendar-title">{formatCalendarMonth(calendarMonth)}</div>
            <button
              type="button"
              onClick={onNextMonth}
              disabled={!canGoNextMonth}
              className="history-calendar-nav"
              aria-label={UI_TEXT.accessibility.history.nextMonth}
            >
              <ChevronRight size={14} />
            </button>
          </header>
          <div className="history-calendar-grid history-calendar-weekdays">
            {UI_TEXT.date.weekdaysShort.map((weekday) => (
              <span key={weekday}>{weekday}</span>
            ))}
          </div>
          <div className="history-calendar-grid">
            {calendarDays.map((date) => {
              const disabled = startOfLocalDay(date) > startOfLocalDay(today);
              const muted = date.getMonth() !== calendarMonth.getMonth();
              const selected = isSameLocalDay(date, selectedDate);
              return (
                <button
                  key={formatLocalDateKey(date)}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelectDate(date)}
                  className={`history-calendar-day ${muted ? "history-calendar-day-muted" : ""} ${
                    selected ? "history-calendar-day-selected" : ""
                  }`}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null,
    document.body,
  );
}
