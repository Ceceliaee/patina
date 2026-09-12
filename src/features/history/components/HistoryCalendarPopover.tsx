import { useLocaleText } from "../../../shared/i18n/index.ts";
import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import QuietCalendar from "../../../shared/components/QuietCalendar.tsx";
import {
  addLocalMonths, formatLocalDateKey, startOfLocalMonth, } from "../../../shared/lib/localDate.ts";


interface HistoryCalendarPopoverProps {
  id: string;
  open: boolean;
  triggerRef: RefObject<HTMLDivElement | null>;
  popoverRef: RefObject<HTMLDivElement | null>;
  position: {
    left: number;
    top: number;
  };
  calendarMonth: Date;
  selectedDate: Date;
  today: Date;
  onCalendarMonthChange: (month: Date) => void;
  onSelectDate: (date: Date) => void;
}

export default function HistoryCalendarPopover({
  id,
  open,
  triggerRef,
  popoverRef,
  position,
  calendarMonth,
  selectedDate,
  today,
  onCalendarMonthChange,
  onSelectDate,
}: HistoryCalendarPopoverProps) {
  const UI_TEXT = useLocaleText();
  const [focusedDate, setFocusedDate] = useState(selectedDate);

  useEffect(() => {
    if (open) setFocusedDate(selectedDate);
  }, [open, selectedDate]);

  useEffect(() => {
    if (!open) return undefined;
    const focusedDateKey = formatLocalDateKey(focusedDate);
    const frame = window.requestAnimationFrame(() => {
      popoverRef.current
        ?.querySelector<HTMLElement>(`[data-calendar-date="${focusedDateKey}"]`)
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedDate, open, popoverRef]);

  useEffect(() => {
    if (!open) return undefined;
    const opener = triggerRef.current?.querySelector<HTMLElement>(".history-date-label");
    return () => {
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
  }, [open, triggerRef]);

  return createPortal(
    open ? (
        <div
          id={id}
          ref={popoverRef}
          className="qp-calendar-popover history-calendar-popover qp-motion-popover-enter"
          role="dialog"
          aria-label={UI_TEXT.date.pickDate}
          style={{
            left: position.left,
            top: position.top,
          }}
        >
          <QuietCalendar
            calendarMonth={calendarMonth}
            selectedDate={selectedDate}
            focusedDate={focusedDate}
            maxDate={today}
            nextMonthDisabled={(
              startOfLocalMonth(addLocalMonths(calendarMonth, 1))
              > startOfLocalMonth(today)
            )}
            onCalendarMonthChange={onCalendarMonthChange}
            onFocusedDateChange={setFocusedDate}
            onSelectDate={onSelectDate}
          />
        </div>
      ) : null,
    document.body,
  );
}
