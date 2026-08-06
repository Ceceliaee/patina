import type { RefObject } from "react";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatDateLabel } from "../services/historyFormatting.ts";
import HistoryCalendarPopover from "./HistoryCalendarPopover.tsx";

interface HistoryDateNavigatorProps {
  datePickerRef: RefObject<HTMLDivElement | null>;
  calendarPopoverRef: RefObject<HTMLDivElement | null>;
  selectedDate: Date;
  today: Date;
  isToday: boolean;
  calendarOpen: boolean;
  calendarPosition: {
    left: number;
    top: number;
  };
  calendarMonth: Date;
  onCalendarMonthChange: (month: Date) => void;
  onChangeDate: (delta: number) => void;
  onOpenDatePicker: () => void;
  onSelectCalendarDate: (date: Date) => void;
}

export default function HistoryDateNavigator({
  datePickerRef,
  calendarPopoverRef,
  selectedDate,
  today,
  isToday,
  calendarOpen,
  calendarPosition,
  calendarMonth,
  onCalendarMonthChange,
  onChangeDate,
  onOpenDatePicker,
  onSelectCalendarDate,
}: HistoryDateNavigatorProps) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  return (
    <div className="flex items-center gap-2 shrink-0">
      <button
        type="button"
        onClick={() => onChangeDate(-1)}
        className="qp-control w-9 h-9 !min-h-0 flex items-center justify-center text-[var(--qp-text-secondary)] hover:text-[var(--qp-text-primary)]"
      >
        <ChevronLeft size={16} />
      </button>
      <div ref={datePickerRef} className="relative">
        <span
          role="button"
          tabIndex={0}
          onClick={onOpenDatePicker}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpenDatePicker();
            }
          }}
          className="qp-status history-date-label relative inline-flex min-w-[102px] cursor-pointer items-center justify-center px-3 py-1.5 text-center text-xs font-semibold text-[var(--qp-text-secondary)]"
        >
          {formatDateLabel(selectedDate, UI_TEXT, locale)}
        </span>
        <HistoryCalendarPopover
          open={calendarOpen}
          triggerRef={datePickerRef}
          popoverRef={calendarPopoverRef}
          position={calendarPosition}
          calendarMonth={calendarMonth}
          selectedDate={selectedDate}
          today={today}
          onCalendarMonthChange={onCalendarMonthChange}
          onSelectDate={onSelectCalendarDate}
        />
      </div>
      <button
        type="button"
        onClick={() => onChangeDate(1)}
        disabled={isToday}
        className="qp-control w-9 h-9 !min-h-0 flex items-center justify-center text-[var(--qp-text-secondary)] hover:text-[var(--qp-text-primary)] disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
