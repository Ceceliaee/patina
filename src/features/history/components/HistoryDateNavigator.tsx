import type { Dispatch, RefObject, SetStateAction } from "react";
import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addLocalMonths } from "../../../shared/lib/localDate.ts";
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
  calendarDays: Date[];
  canGoNextCalendarMonth: boolean;
  setCalendarMonth: Dispatch<SetStateAction<Date>>;
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
  calendarDays,
  canGoNextCalendarMonth,
  setCalendarMonth,
  onChangeDate,
  onOpenDatePicker,
  onSelectCalendarDate,
}: HistoryDateNavigatorProps) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <motion.button
        whileTap={{ scale: 0.995 }}
        transition={{ duration: 0.1, ease: "easeOut" }}
        onClick={() => onChangeDate(-1)}
        className="qp-control w-9 h-9 !min-h-0 flex items-center justify-center text-[var(--qp-text-secondary)] hover:text-[var(--qp-text-primary)]"
      >
        <ChevronLeft size={16} />
      </motion.button>
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
          className="qp-status relative inline-flex min-w-[102px] cursor-pointer items-center justify-center px-3 py-1.5 text-center text-xs font-semibold text-[var(--qp-text-secondary)]"
        >
          {formatDateLabel(selectedDate)}
        </span>
        <HistoryCalendarPopover
          open={calendarOpen}
          popoverRef={calendarPopoverRef}
          position={calendarPosition}
          calendarMonth={calendarMonth}
          calendarDays={calendarDays}
          selectedDate={selectedDate}
          today={today}
          canGoNextMonth={canGoNextCalendarMonth}
          onPreviousMonth={() => setCalendarMonth((month) => addLocalMonths(month, -1))}
          onNextMonth={() => setCalendarMonth((month) => addLocalMonths(month, 1))}
          onSelectDate={onSelectCalendarDate}
        />
      </div>
      <motion.button
        whileTap={{ scale: 0.995 }}
        transition={{ duration: 0.1, ease: "easeOut" }}
        onClick={() => onChangeDate(1)}
        disabled={isToday}
        className="qp-control w-9 h-9 !min-h-0 flex items-center justify-center text-[var(--qp-text-secondary)] hover:text-[var(--qp-text-primary)] disabled:opacity-35 disabled:cursor-not-allowed"
      >
        <ChevronRight size={16} />
      </motion.button>
    </div>
  );
}
