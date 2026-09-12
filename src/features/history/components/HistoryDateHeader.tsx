import { useId, type RefObject } from "react";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import QuietPageHeader from "../../../shared/components/QuietPageHeader.tsx";
import { formatDateLabel } from "../services/historyFormatting.ts";
import HistoryCalendarPopover from "./HistoryCalendarPopover.tsx";
import { addLocalDays } from "../../../shared/lib/localDate.ts";

interface HistoryDateHeaderProps {
  datePickerRef: RefObject<HTMLDivElement | null>;
  calendarPopoverRef: RefObject<HTMLDivElement | null>;
  presentedDate: Date;
  readState: {
    failed: boolean;
    hasSnapshot: boolean;
    requestedDate: Date;
    retry: () => void;
  };
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

export default function HistoryDateHeader({
  datePickerRef,
  calendarPopoverRef,
  presentedDate,
  readState,
  today,
  isToday,
  calendarOpen,
  calendarPosition,
  calendarMonth,
  onCalendarMonthChange,
  onChangeDate,
  onOpenDatePicker,
  onSelectCalendarDate,
}: HistoryDateHeaderProps) {
  const UI_TEXT = useLocaleText();
  const locale = useLocale();
  const calendarId = useId();
  return (
    <>
      <QuietPageHeader
        icon={<Clock size={18} />}
        title={UI_TEXT.history.title}
        subtitle={UI_TEXT.history.subtitle}
        rightSlot={(
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onChangeDate(-1)}
              aria-label={UI_TEXT.accessibility.history.previousDay(formatDateLabel(addLocalDays(readState.requestedDate, -1), UI_TEXT, locale))}
              className="qp-control w-9 h-9 !min-h-0 flex items-center justify-center text-[var(--qp-text-secondary)] hover:text-[var(--qp-text-primary)]"
            >
              <ChevronLeft size={16} />
            </button>
            <div ref={datePickerRef} className="relative">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-expanded={calendarOpen}
                aria-controls={calendarOpen ? calendarId : undefined}
                onClick={onOpenDatePicker}
                className="qp-status history-date-label relative inline-flex min-w-[102px] cursor-pointer items-center justify-center px-3 py-1.5 text-center text-[var(--qp-text-secondary)]"
              >
                {formatDateLabel(presentedDate, UI_TEXT, locale)}
              </button>
              <HistoryCalendarPopover
                id={calendarId}
                open={calendarOpen}
                triggerRef={datePickerRef}
                popoverRef={calendarPopoverRef}
                position={calendarPosition}
                calendarMonth={calendarMonth}
                selectedDate={readState.requestedDate}
                today={today}
                onCalendarMonthChange={onCalendarMonthChange}
                onSelectDate={onSelectCalendarDate}
              />
            </div>
            <button
              type="button"
              onClick={() => onChangeDate(1)}
              aria-label={UI_TEXT.accessibility.history.nextDay(formatDateLabel(addLocalDays(readState.requestedDate, 1), UI_TEXT, locale))}
              disabled={isToday}
              className="qp-control w-9 h-9 !min-h-0 flex items-center justify-center text-[var(--qp-text-secondary)] hover:text-[var(--qp-text-primary)] disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
      />
      {readState.failed && (
        <div className="qp-panel flex items-center gap-3 p-4 text-sm text-[var(--qp-text-secondary)]" role="status" data-history-read-error>
          <span>{formatDateLabel(readState.requestedDate, UI_TEXT, locale)} · {readState.hasSnapshot ? UI_TEXT.common.refreshFailed : UI_TEXT.common.readFailed}</span>
          <button type="button" className="qp-control shrink-0" onClick={(event) => {
            if (document.activeElement === event.currentTarget) {
              datePickerRef.current?.querySelector<HTMLButtonElement>(".history-date-label")?.focus();
            }
            readState.retry();
          }}>{UI_TEXT.common.retry}</button>
        </div>
      )}
    </>
  );
}
