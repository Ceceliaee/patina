import { useLocaleText } from "../i18n/index.ts";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Clock3 } from "lucide-react";

interface QuietTimePickerProps {
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

interface TimeParts {
  hour: number;
  minute: number;
}

interface TimePickerPosition {
  left: number;
  top: number;
  placement: "top" | "bottom";
}

const TIME_PICKER_WIDTH = 176;
const TIME_PICKER_HEIGHT = 212;
const TIME_PICKER_GAP = 6;
const VIEWPORT_PADDING = 8;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute);

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function parseTimeValue(value: string): TimeParts | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || hour > 23 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

function formatTimeValue(hour: number, minute: number) {
  return `${pad2(hour)}:${pad2(minute)}`;
}

export default function QuietTimePicker({
  value,
  onChange,
  ariaLabel,
  className,
  disabled = false,
}: QuietTimePickerProps) {
  const UI_TEXT = useLocaleText();
  const resolvedAriaLabel = ariaLabel ?? UI_TEXT.time.pickTime;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const dialogId = useId();
  const selectedTime = useMemo<TimeParts>(() => parseTimeValue(value) ?? { hour: 0, minute: 0 }, [value]);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<TimePickerPosition | null>(null);

  const resolvePosition = useCallback((): TimePickerPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;

    const rect = trigger.getBoundingClientRect();
    const minLeft = VIEWPORT_PADDING + TIME_PICKER_WIDTH / 2;
    const maxLeft = Math.max(minLeft, window.innerWidth - VIEWPORT_PADDING - TIME_PICKER_WIDTH / 2);
    const belowTop = rect.bottom + TIME_PICKER_GAP;
    const aboveTop = rect.top - TIME_PICKER_HEIGHT - TIME_PICKER_GAP;
    const spaceBelow = window.innerHeight - belowTop - VIEWPORT_PADDING;
    const spaceAbove = rect.top - TIME_PICKER_GAP - VIEWPORT_PADDING;
    const placement = spaceBelow < TIME_PICKER_HEIGHT && spaceAbove > spaceBelow ? "top" : "bottom";
    const maxTop = Math.max(VIEWPORT_PADDING, window.innerHeight - TIME_PICKER_HEIGHT - VIEWPORT_PADDING);

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

  const closeTimePicker = (restoreFocus = false) => {
    setOpen(false);
    setPosition(null);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const toggleTimePicker = () => {
    if (disabled) return;
    if (open) {
      closeTimePicker();
      return;
    }
    updatePosition();
    setOpen(true);
  };

  const selectHour = (hour: number) => {
    onChange(formatTimeValue(hour, selectedTime.minute));
  };

  const selectMinute = (minute: number) => {
    onChange(formatTimeValue(selectedTime.hour, minute));
    closeTimePicker(true);
  };

  const focusTimeOption = (part: "hour" | "minute", value: number) => {
    requestAnimationFrame(() => {
      popoverRef.current
        ?.querySelector<HTMLElement>(`[data-time-picker-part="${part}"][data-time-picker-value="${value}"]`)
        ?.focus();
    });
  };

  const handleOptionKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    part: "hour" | "minute",
    value: number,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeTimePicker(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;

    event.preventDefault();
    const values = part === "hour" ? HOURS : MINUTES;
    const currentIndex = values.indexOf(value);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? values.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1) % values.length
          : (currentIndex - 1 + values.length) % values.length;
    const nextValue = values[nextIndex];
    if (part === "hour") {
      onChange(formatTimeValue(nextValue, selectedTime.minute));
    } else {
      onChange(formatTimeValue(selectedTime.hour, nextValue));
    }
    focusTimeOption(part, nextValue);
  };

  useEffect(() => {
    if (!open) return undefined;

    const handleOutside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (rootRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      closeTimePicker();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeTimePicker(true);
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

  useLayoutEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => {
      const hourOption = popoverRef.current?.querySelector<HTMLElement>("[data-selected-time-part=\"hour\"]");
      const minuteOption = popoverRef.current?.querySelector<HTMLElement>("[data-selected-time-part=\"minute\"]");
      const hourList = hourOption?.closest<HTMLElement>(".qp-time-picker-list");
      const minuteList = minuteOption?.closest<HTMLElement>(".qp-time-picker-list");
      if (hourOption && hourList) {
        hourList.scrollTop = hourOption.offsetTop - (hourList.clientHeight - hourOption.offsetHeight) / 2;
      }
      if (minuteOption && minuteList) {
        minuteList.scrollTop = minuteOption.offsetTop - (minuteList.clientHeight - minuteOption.offsetHeight) / 2;
      }
      if (!popoverRef.current?.contains(document.activeElement)) {
        hourOption?.focus();
      }
    });
  }, [open, selectedTime.hour, selectedTime.minute]);

  const popoverStyle: CSSProperties | undefined = position
    ? {
      left: `${position.left}px`,
      top: `${position.top}px`,
    }
    : undefined;

  const popover = open && position ? (
    <div
      ref={popoverRef}
      id={dialogId}
      role="dialog"
      aria-label={resolvedAriaLabel}
      className={`qp-time-picker-popover qp-time-picker-popover-${position.placement}`}
      style={popoverStyle}
    >
      <div className="qp-time-picker-column-headings" aria-hidden="true">
        <div className="qp-time-picker-column-title">{UI_TEXT.time.hours}</div>
        <div className="qp-time-picker-column-title">{UI_TEXT.time.minutes}</div>
      </div>
      <div className="qp-time-picker-columns">
        <div className="qp-time-picker-column">
          <div className="qp-time-picker-list qp-scroll-region" role="listbox" aria-label={UI_TEXT.time.hours}>
            {HOURS.map((hour) => {
              const selected = hour === selectedTime.hour;
              return (
                <button
                  key={hour}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-selected-time-part={selected ? "hour" : undefined}
                  data-time-picker-part="hour"
                  data-time-picker-value={hour}
                  onKeyDown={(event) => handleOptionKeyDown(event, "hour", hour)}
                  onClick={() => selectHour(hour)}
                  className={`qp-time-picker-option ${selected ? "qp-time-picker-option-selected" : ""}`.trim()}
                >
                  {pad2(hour)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="qp-time-picker-column">
          <div className="qp-time-picker-list qp-scroll-region" role="listbox" aria-label={UI_TEXT.time.minutes}>
            {MINUTES.map((minute) => {
              const selected = minute === selectedTime.minute;
              return (
                <button
                  key={minute}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  data-selected-time-part={selected ? "minute" : undefined}
                  data-time-picker-part="minute"
                  data-time-picker-value={minute}
                  onKeyDown={(event) => handleOptionKeyDown(event, "minute", minute)}
                  onClick={() => selectMinute(minute)}
                  className={`qp-time-picker-option ${selected ? "qp-time-picker-option-selected" : ""}`.trim()}
                >
                  {pad2(minute)}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="qp-time-picker">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={resolvedAriaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        onClick={toggleTimePicker}
        className={`qp-input qp-time-picker-trigger ${open ? "qp-time-picker-trigger-open" : ""} ${
          className ?? ""
        }`.trim()}
      >
        <span>{formatTimeValue(selectedTime.hour, selectedTime.minute)}</span>
        <Clock3 size={14} aria-hidden="true" />
      </button>
      {popover ? createPortal(popover, document.body) : null}
    </div>
  );
}
