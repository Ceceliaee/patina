import { useLocaleText } from "../i18n/index.ts";
import {
  type ButtonHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useMemo,
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  addLocalMonths,
  buildMondayFirstCalendarGrid,
  formatLocalDateKey,
  isSameLocalDay,
  moveLocalDateByCalendarKey,
  startOfLocalDay,
  startOfLocalMonth,
} from "../lib/localDate.ts";

type QuietCalendarDayButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "className" | "type"
>;

interface QuietCalendarDay {
  dateKey: string;
  muted?: boolean;
  selected?: boolean;
  today?: boolean;
  inRange?: boolean;
  buttonProps?: QuietCalendarDayButtonProps;
  dataAttributes?: Record<`data-${string}`, string>;
}

interface QuietCalendarMonthFrameProps {
  monthLabel: ReactNode;
  previousMonthIcon: ReactNode;
  nextMonthIcon: ReactNode;
  previousMonthLabel: string;
  nextMonthLabel: string;
  previousMonthDisabled?: boolean;
  nextMonthDisabled?: boolean;
  weekdays: readonly string[];
  days: readonly Date[];
  variant?: "single" | "range";
  getDay: (date: Date) => QuietCalendarDay;
  onPreviousMonth: () => void;
  onNextMonth: () => void;
}

interface QuietCalendarProps {
  calendarMonth: Date;
  selectedDate: Date;
  minDate?: Date | null;
  maxDate?: Date | null;
  today?: Date | null;
  focusedDate?: Date;
  previousMonthDisabled?: boolean;
  nextMonthDisabled?: boolean;
  onCalendarMonthChange: (month: Date) => void;
  onFocusedDateChange?: (date: Date) => void;
  onSelectDate: (date: Date) => void;
}

function clampDateToBounds(date: Date, minDate?: Date | null, maxDate?: Date | null) {
  const normalizedDate = startOfLocalDay(date);
  if (minDate && normalizedDate < minDate) return minDate;
  if (maxDate && normalizedDate > maxDate) return maxDate;
  return normalizedDate;
}

/** Internal month frame shared by the single-date and range controllers. */
export function QuietCalendarMonthFrame({
  monthLabel,
  previousMonthIcon,
  nextMonthIcon,
  previousMonthLabel,
  nextMonthLabel,
  previousMonthDisabled = false,
  nextMonthDisabled = false,
  weekdays,
  days,
  variant = "single",
  getDay,
  onPreviousMonth,
  onNextMonth,
}: QuietCalendarMonthFrameProps) {
  const range = variant === "range";

  return (
    <div className="qp-calendar-month" data-range={range || undefined}>
      <header className="qp-calendar-header">
        <button
          type="button"
          onClick={onPreviousMonth}
          disabled={previousMonthDisabled}
          className="qp-calendar-nav"
          aria-label={previousMonthLabel}
        >
          {previousMonthIcon}
        </button>
        <div className="qp-calendar-title">
          {monthLabel}
        </div>
        <button
          type="button"
          onClick={onNextMonth}
          disabled={nextMonthDisabled}
          className="qp-calendar-nav"
          aria-label={nextMonthLabel}
        >
          {nextMonthIcon}
        </button>
      </header>

      <div className="qp-calendar-grid qp-calendar-weekdays">
        {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>

      <div className="qp-calendar-grid qp-calendar-days">
        {days.map((date) => {
          const day = getDay(date);
          return (
            <button
              key={day.dateKey}
              {...day.buttonProps}
              {...day.dataAttributes}
              type="button"
              className="qp-calendar-day"
              data-muted={day.muted || undefined}
              data-in-range={day.inRange || undefined}
              data-selected={day.selected || undefined}
              data-today={day.today || undefined}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function QuietCalendar({
  calendarMonth,
  selectedDate,
  minDate,
  maxDate,
  today,
  focusedDate,
  previousMonthDisabled = false,
  nextMonthDisabled = false,
  onCalendarMonthChange,
  onFocusedDateChange,
  onSelectDate,
}: QuietCalendarProps) {
  const UI_TEXT = useLocaleText();
  const normalizedMinDate = minDate ? startOfLocalDay(minDate) : null;
  const normalizedMaxDate = maxDate ? startOfLocalDay(maxDate) : null;
  const calendarDays = useMemo(
    () => buildMondayFirstCalendarGrid(calendarMonth),
    [calendarMonth],
  );

  const handleDayKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, date: Date) => {
    if (!onFocusedDateChange) return;
    const requestedDate = moveLocalDateByCalendarKey(date, event.key);
    if (!requestedDate) return;

    event.preventDefault();
    const nextDate = clampDateToBounds(requestedDate, normalizedMinDate, normalizedMaxDate);
    onFocusedDateChange(nextDate);
    if (startOfLocalMonth(nextDate).getTime() !== startOfLocalMonth(calendarMonth).getTime()) {
      onCalendarMonthChange(startOfLocalMonth(nextDate));
    }
  };

  const changeMonth = (delta: number) => {
    const nextMonth = addLocalMonths(calendarMonth, delta);
    onCalendarMonthChange(nextMonth);
    onFocusedDateChange?.(clampDateToBounds(nextMonth, normalizedMinDate, normalizedMaxDate));
  };

  return (
    <QuietCalendarMonthFrame
      monthLabel={UI_TEXT.date.yearMonthLabel(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1)}
      previousMonthIcon={<ChevronLeft size={14} />}
      nextMonthIcon={<ChevronRight size={14} />}
      previousMonthLabel={UI_TEXT.accessibility.date.previousMonth}
      nextMonthLabel={UI_TEXT.accessibility.date.nextMonth}
      previousMonthDisabled={previousMonthDisabled}
      nextMonthDisabled={nextMonthDisabled}
      weekdays={UI_TEXT.date.weekdaysShort}
      days={calendarDays}
      getDay={(date) => {
        const dateKey = formatLocalDateKey(date);
        const selected = isSameLocalDay(date, selectedDate);
        const isToday = today ? isSameLocalDay(date, today) : false;
        const focused = focusedDate ? isSameLocalDay(date, focusedDate) : false;
        return {
          dateKey,
          muted: date.getMonth() !== calendarMonth.getMonth(),
          selected,
          today: isToday,
          dataAttributes: { "data-calendar-date": dateKey },
          buttonProps: {
            disabled: Boolean(
              (normalizedMinDate && date < normalizedMinDate)
              || (normalizedMaxDate && date > normalizedMaxDate),
            ),
            "aria-pressed": selected,
            "aria-current": isToday ? "date" : undefined,
            "aria-label": dateKey.replace(/-/g, "/"),
            tabIndex: focusedDate ? (focused ? 0 : -1) : undefined,
            onFocus: onFocusedDateChange ? () => onFocusedDateChange(date) : undefined,
            onKeyDown: onFocusedDateChange
              ? (event) => handleDayKeyDown(event, date)
              : undefined,
            onClick: () => onSelectDate(date),
          },
        };
      }}
      onPreviousMonth={() => changeMonth(-1)}
      onNextMonth={() => changeMonth(1)}
    />
  );
}
