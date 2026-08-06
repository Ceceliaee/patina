import { useLocaleText } from "../../../shared/i18n/index.ts";
import { useEffect, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import QuietCalendar from "../../../shared/components/QuietCalendar.tsx";
import {
  addLocalMonths, formatLocalDateKey, startOfLocalMonth, } from "../../../shared/lib/localDate.ts";


interface HistoryCalendarPopoverProps {
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
    if (!open) return undefined;
    setFocusedDate(selectedDate);
    const selectedDateKey = formatLocalDateKey(selectedDate);
    const frame = window.requestAnimationFrame(() => {
      popoverRef.current
        ?.querySelector<HTMLElement>(`[data-calendar-date="${selectedDateKey}"]`)
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, popoverRef, selectedDate]);

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
