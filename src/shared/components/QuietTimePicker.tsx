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
  showClockIcon?: boolean;
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

export function QuietTimeColumns({ value, onChange, onCommit, autoFocus = false }: {
  value: string;
  onChange: (value: string) => void;
  onCommit?: () => void;
  autoFocus?: boolean;
}) {
  const text = useLocaleText();
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = parseTimeValue(value) ?? { hour: 0, minute: 0 };
  const select = (part: "hour" | "minute", next: number) => {
    onChange(formatTimeValue(part === "hour" ? next : selected.hour, part === "minute" ? next : selected.minute));
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, part: "hour" | "minute", current: number) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const count = part === "hour" ? HOURS.length : MINUTES.length;
    const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1
      : (current + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
    select(part, next);
    rootRef.current?.querySelector<HTMLElement>(`[data-time-picker-part="${part}"][data-time-picker-value="${next}"]`)
      ?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      for (const part of ["hour", "minute"]) {
        const option = rootRef.current?.querySelector<HTMLElement>(`[data-selected-time-part="${part}"]`);
        const list = option?.closest<HTMLElement>(".qp-time-picker-list");
        if (option && list) {
          list.scrollTop += option.getBoundingClientRect().top - list.getBoundingClientRect().top
            - (list.clientHeight - option.offsetHeight) / 2;
        }
      }
      if (autoFocus && !rootRef.current?.contains(document.activeElement)) {
        rootRef.current?.querySelector<HTMLElement>('[data-selected-time-part="hour"]')?.focus();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [autoFocus, selected.hour, selected.minute]);
  return <div ref={rootRef} className="qp-time-picker-content">
    <div className="qp-time-picker-column-headings" aria-hidden="true">
      <div className="qp-time-picker-column-title">{text.time.hours}</div>
      <div className="qp-time-picker-column-title">{text.time.minutes}</div>
    </div>
    <div className="qp-time-picker-columns">
      {(["hour", "minute"] as const).map(part => <div key={part} className="qp-time-picker-column">
        <div className="qp-time-picker-list qp-scroll-region" role="listbox" aria-label={part === "hour" ? text.time.hours : text.time.minutes}>
          {(part === "hour" ? HOURS : MINUTES).map(option => <button key={option} type="button" role="option"
            aria-selected={option === selected[part]} tabIndex={option === selected[part] ? 0 : -1}
            data-selected-time-part={option === selected[part] ? part : undefined}
            data-time-picker-part={part} data-time-picker-value={option}
            onKeyDown={event => handleKeyDown(event, part, option)}
            onClick={() => { select(part, option); if (part === "minute") onCommit?.(); }}
            className={`qp-time-picker-option ${option === selected[part] ? "qp-time-picker-option-selected" : ""}`.trim()}>
            {pad2(option)}
          </button>)}
        </div>
      </div>)}
    </div>
  </div>;
}

export default function QuietTimePicker({
  value,
  onChange,
  ariaLabel,
  className,
  disabled = false,
  showClockIcon = true,
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
      onKeyDown={event => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        closeTimePicker(true);
      }}
    >
      <QuietTimeColumns value={value} onChange={onChange} onCommit={() => closeTimePicker(true)} autoFocus />
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
        {showClockIcon ? <Clock3 size={14} aria-hidden="true" /> : null}
      </button>
      {popover ? createPortal(popover, document.body) : null}
    </div>
  );
}
