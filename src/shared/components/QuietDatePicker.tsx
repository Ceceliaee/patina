import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { CalendarDays } from "lucide-react";
import { UI_TEXT } from "../copy/index.ts";
import {
  addLocalMonths,
  formatLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
  startOfLocalMonth,
} from "../lib/localDate.ts";
import QuietCalendar from "./QuietCalendar.tsx";
import QuietRangeControl from "./QuietRangeControl.tsx";

interface QuietDatePickerDayNavigation {
  ariaLabel: string;
  previousAriaLabel: string;
  nextAriaLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  className?: string;
}

interface QuietDatePickerProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  displayLabel?: string;
  showCalendarIcon?: boolean;
  disabled?: boolean;
  minDate?: string;
  maxDate?: string;
  dayNavigation?: QuietDatePickerDayNavigation;
}

interface CalendarPosition {
  left: number;
  top: number;
  placement: "top" | "bottom";
}

const CALENDAR_WIDTH = 236;
const CALENDAR_HEIGHT = 262;
const CALENDAR_GAP = 6;
const VIEWPORT_PADDING = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatDateDisplay(dateKey: string) {
  const date = parseLocalDateKey(dateKey);
  if (!date) return dateKey.replace(/-/g, "/");
  return formatLocalDateKey(date).replace(/-/g, "/");
}

export default function QuietDatePicker({
  value,
  onChange,
  ariaLabel = UI_TEXT.date.pickDate,
  className,
  displayLabel,
  showCalendarIcon = true,
  disabled = false,
  minDate,
  maxDate,
  dayNavigation,
}: QuietDatePickerProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const dialogId = useId();
  const selectedDate = useMemo(() => parseLocalDateKey(value) ?? startOfLocalDay(new Date()), [value]);
  const minDateValue = useMemo(() => minDate ? parseLocalDateKey(minDate) : null, [minDate]);
  const maxDateValue = useMemo(() => maxDate ? parseLocalDateKey(maxDate) : null, [maxDate]);
  const [open, setOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfLocalMonth(selectedDate));
  const [focusedDate, setFocusedDate] = useState(selectedDate);
  const [position, setPosition] = useState<CalendarPosition | null>(null);
  const today = startOfLocalDay(new Date());

  const resolvePosition = useCallback((): CalendarPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const rect = trigger.getBoundingClientRect();
    const minLeft = VIEWPORT_PADDING + CALENDAR_WIDTH / 2;
    const maxLeft = Math.max(minLeft, window.innerWidth - VIEWPORT_PADDING - CALENDAR_WIDTH / 2);
    const belowTop = rect.bottom + CALENDAR_GAP;
    const aboveTop = rect.top - CALENDAR_HEIGHT - CALENDAR_GAP;
    const spaceBelow = window.innerHeight - belowTop - VIEWPORT_PADDING;
    const spaceAbove = rect.top - CALENDAR_GAP - VIEWPORT_PADDING;
    const placement = spaceBelow < CALENDAR_HEIGHT && spaceAbove > spaceBelow ? "top" : "bottom";
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - CALENDAR_HEIGHT - VIEWPORT_PADDING);

    return {
      left: clamp(rect.left + rect.width / 2, minLeft, maxLeft),
      top: placement === "top" ? clamp(aboveTop, VIEWPORT_PADDING, maxTop) : clamp(belowTop, VIEWPORT_PADDING, maxTop),
      placement,
    };
  }, []);

  const updatePosition = useCallback(() => {
    const nextPosition = resolvePosition();
    if (nextPosition) {
      setPosition(nextPosition);
    }
  }, [resolvePosition]);

  const closeCalendar = () => {
    setOpen(false);
    setPosition(null);
  };

  const focusCalendarDate = (date: Date) => {
    const dateKey = formatLocalDateKey(date);
    requestAnimationFrame(() => {
      popoverRef.current
        ?.querySelector<HTMLElement>(`[data-calendar-date="${dateKey}"]`)
        ?.focus();
    });
  };

  const toggleCalendar = () => {
    if (disabled) return;
    if (open) {
      closeCalendar();
      return;
    }
    setCalendarMonth(startOfLocalMonth(selectedDate));
    setFocusedDate(selectedDate);
    updatePosition();
    setOpen(true);
  };

  const selectDate = (date: Date) => {
    onChange(formatLocalDateKey(date));
    closeCalendar();
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return undefined;

    const handleOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      closeCalendar();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeCalendar();
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    const handleViewportChange = () => updatePosition();

    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    setCalendarMonth(startOfLocalMonth(selectedDate));
  }, [selectedDate, open]);

  useLayoutEffect(() => {
    if (!open || !position) return;
    const activeElement = document.activeElement;
    if (
      activeElement instanceof HTMLElement
      && popoverRef.current?.contains(activeElement)
      && !activeElement.classList.contains("qp-calendar-day")
    ) {
      return;
    }
    focusCalendarDate(focusedDate);
  }, [focusedDate, open, position]);

  const popoverStyle: CSSProperties | undefined = position
    ? {
      left: `${position.left}px`,
      top: `${position.top}px`,
    }
    : undefined;
  const previousMonthDisabled = Boolean(
    minDateValue
    && startOfLocalMonth(addLocalMonths(calendarMonth, -1))
      < startOfLocalMonth(minDateValue),
  );
  const nextMonthDisabled = Boolean(
    maxDateValue
    && startOfLocalMonth(addLocalMonths(calendarMonth, 1))
      > startOfLocalMonth(maxDateValue),
  );

  const popover = open && position ? (
    <div
      ref={popoverRef}
      id={dialogId}
      role="dialog"
      aria-label={ariaLabel}
      className={`qp-calendar-popover qp-calendar-popover-${position.placement} qp-motion-popover-enter`}
      style={popoverStyle}
    >
      <QuietCalendar
        calendarMonth={calendarMonth}
        selectedDate={selectedDate}
        minDate={minDateValue}
        maxDate={maxDateValue}
        today={today}
        focusedDate={focusedDate}
        previousMonthDisabled={previousMonthDisabled}
        nextMonthDisabled={nextMonthDisabled}
        onCalendarMonthChange={setCalendarMonth}
        onFocusedDateChange={setFocusedDate}
        onSelectDate={selectDate}
      />
    </div>
  ) : null;

  return (
    <div
      ref={rootRef}
      className={`qp-date-picker ${dayNavigation ? "qp-date-picker-day-navigation" : ""}`.trim()}
    >
      {dayNavigation ? (
        <QuietRangeControl
          ref={triggerRef}
          className={dayNavigation.className}
          ariaLabel={dayNavigation.ariaLabel}
          label={displayLabel ?? formatDateDisplay(value)}
          labelAriaLabel={ariaLabel}
          previousAriaLabel={dayNavigation.previousAriaLabel}
          nextAriaLabel={dayNavigation.nextAriaLabel}
          previousDisabled={dayNavigation.previousDisabled}
          nextDisabled={dayNavigation.nextDisabled}
          onPrevious={dayNavigation.onPrevious}
          onNext={dayNavigation.onNext}
          onLabelClick={toggleCalendar}
          expanded={open}
          labelControls={open ? dialogId : undefined}
          labelClassName={`qp-date-picker-range-trigger ${
            open ? "qp-date-picker-range-trigger-open" : ""
          } ${className ?? ""}`.trim()}
        />
      ) : (
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          onClick={toggleCalendar}
          className={`qp-input qp-date-picker-trigger ${open ? "qp-date-picker-trigger-open" : ""} ${
            className ?? ""
          }`.trim()}
        >
          <span>{displayLabel ?? formatDateDisplay(value)}</span>
          {showCalendarIcon ? <CalendarDays size={14} aria-hidden="true" /> : null}
        </button>
      )}
      {popover ? createPortal(popover, document.body) : null}
    </div>
  );
}
