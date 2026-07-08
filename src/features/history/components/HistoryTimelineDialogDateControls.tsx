import { ChevronLeft, ChevronRight } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import { addLocalDays } from "../../../shared/lib/localDate.ts";
import { formatDateLabel } from "../services/historyFormatting.ts";

interface HistoryTimelineDialogDateControlsProps {
  selectedDate: Date;
  isToday: boolean;
  className?: string;
  onChangeDate: (delta: number) => void;
}

export default function HistoryTimelineDialogDateControls({
  selectedDate,
  isToday,
  className = "",
  onChangeDate,
}: HistoryTimelineDialogDateControlsProps) {
  const previousDateLabel = formatDateLabel(addLocalDays(selectedDate, -1));
  const currentDateLabel = formatDateLabel(selectedDate);
  const nextDateLabel = formatDateLabel(addLocalDays(selectedDate, 1));

  return (
    <div className={`history-timeline-dialog-date-switch ${className}`.trim()} role="group" aria-label={UI_TEXT.date.pickDate}>
      <button
        type="button"
        onClick={() => onChangeDate(-1)}
        aria-label={UI_TEXT.accessibility.history.previousDay(previousDateLabel)}
        className="qp-button-secondary inline-flex h-6 w-6 items-center justify-center rounded-[6px] p-0 history-timeline-dialog-date-button history-timeline-dialog-date-previous disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronLeft size={11} aria-hidden />
      </button>
      <span className="history-timeline-dialog-date-label">
        {currentDateLabel}
      </span>
      <button
        type="button"
        onClick={() => onChangeDate(1)}
        disabled={isToday}
        aria-label={UI_TEXT.accessibility.history.nextDay(nextDateLabel)}
        className="qp-button-secondary inline-flex h-6 w-6 items-center justify-center rounded-[6px] p-0 history-timeline-dialog-date-button history-timeline-dialog-date-next disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronRight size={11} aria-hidden />
      </button>
    </div>
  );
}
