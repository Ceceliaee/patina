import { useId, useLayoutEffect, useRef, useState } from "react";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import QuietCalendar from "../../../shared/components/QuietCalendar.tsx";
import { QuietTimeColumns } from "../../../shared/components/QuietTimePicker.tsx";
import QuietSelect from "../../../shared/components/QuietSelect.tsx";
import { formatLocalDateKey, parseLocalDateKey, startOfLocalMonth } from "../../../shared/lib/localDate.ts";
import { useLocale, useLocaleText, type Locale, type UiText } from "../../../shared/i18n/index.ts";
import type { ReminderRecurrence } from "../../../shared/types/tools.ts";
import { formatUsageDuration } from "../services/toolsLabels.ts";

export function recurrenceLabel(rule: ReminderRecurrence | null, text: UiText, locale: Locale): string {
  if (!rule) return text.tools.reminderRepeatNone;
  if (rule.kind === "daily") return text.tools.reminderRepeatDaily;
  if (rule.kind === "monthly") return text.tools.reminderRepeatMonthly;
  if (rule.kind === "yearly") return text.tools.reminderRepeatYearly;
  if (rule.kind === "interval") return `${text.tools.reminderRepeatInterval} · ${formatUsageDuration(rule.minutes, locale)}`;
  const weekdays = rule.weekdays.map(day => new Intl.DateTimeFormat(locale, { weekday: "short" })
    .format(new Date(2026, 10, 1 + day)));
  return `${text.tools.reminderRepeatWeekly} · ${weekdays.join(" / ")}`;
}

export function validRecurrence(rule: ReminderRecurrence | null) {
  if (rule?.kind === "interval") return Number.isInteger(rule.minutes) && rule.minutes >= 1 && rule.minutes <= 86_400;
  return rule?.kind !== "weekly" || rule.weekdays.length > 0;
}

interface Props {
  date: string;
  time: string;
  recurrence: ReminderRecurrence | null;
  disabled?: boolean;
  onDateChange: (value: string) => void;
  onTimeChange: (value: string) => void;
  onRecurrenceChange: (value: ReminderRecurrence | null) => void;
}

export default function ReminderScheduleFields({ date, time, recurrence, disabled,
  onDateChange, onTimeChange, onRecurrenceChange }: Props) {
  const text = useLocaleText();
  const locale = useLocale();
  const id = useId();
  const [timeOpen, setTimeOpen] = useState(false);
  const timeRef = useRef<HTMLButtonElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const initialDateRef = useRef<HTMLElement>(null);
  const moveDateFocusRef = useRef(false);
  const selectedDate = parseLocalDateKey(date)!;
  const [calendarMonth, setCalendarMonth] = useState(() => startOfLocalMonth(selectedDate));
  const [focusedDate, setFocusedDate] = useState(selectedDate);
  useLayoutEffect(() => {
    if (!timeOpen || !moveDateFocusRef.current) return;
    moveDateFocusRef.current = false;
    calendarRef.current?.querySelector<HTMLElement>(`[data-calendar-date="${formatLocalDateKey(focusedDate)}"]`)
      ?.focus({ preventScroll: true });
  }, [timeOpen, focusedDate]);
  const options = [
    { value: "none", label: text.tools.reminderRepeatNone },
    { value: "daily", label: text.tools.reminderRepeatDaily },
    { value: "weekly", label: text.tools.reminderRepeatWeekly },
    { value: "monthly", label: text.tools.reminderRepeatMonthly },
    { value: "yearly", label: text.tools.reminderRepeatYearly },
  ] as const;
  const choose = (kind: "none" | ReminderRecurrence["kind"]) => {
    if (kind === "interval") return;
    onRecurrenceChange(kind === "none" ? null : kind === "weekly"
      ? { kind, weekdays: [parseLocalDateKey(date)!.getDay() || 7] }
      : { kind });
  };
  return <div className="tools-reminder-schedule-fields">
    <div className="tools-form-field">
      <span>{text.tools.reminderTimeLabel}</span>
      <button ref={timeRef} type="button" className="qp-input tools-reminder-time-trigger" disabled={disabled}
        aria-label={text.tools.reminderTimeLabel} aria-expanded={timeOpen} aria-controls={timeOpen ? `${id}-time` : undefined}
        onClick={() => {
          if (!timeOpen) { setCalendarMonth(startOfLocalMonth(selectedDate)); setFocusedDate(selectedDate); }
          setTimeOpen(!timeOpen);
        }}>
        {date.slice(5).replace("-", "/")} {time}
      </button>
    </div>
    <div className="tools-form-field">
      <span>{text.tools.reminderRepeatLabel}</span>
      <QuietSelect value={recurrence?.kind ?? "none"} options={[...options]} onChange={choose}
        disabled={disabled} ariaLabel={text.tools.reminderRepeatLabel} textStyle="input"
        displayLabel={recurrence?.kind === "interval" ? recurrenceLabel(recurrence, text, locale) : undefined} />
    </div>
    <QuietAnchoredPopover open={timeOpen} anchor={timeRef.current} id={`${id}-time`}
      ariaLabel={text.tools.reminderTimeLabel} containFocus initialFocusRef={initialDateRef}
      onClose={reason => { setTimeOpen(false); if (reason === "escape") timeRef.current?.focus(); }}
      className="tools-reminder-time-popover">
      <div className="tools-reminder-datetime">
        <div className="tools-reminder-calendar" ref={element => {
          calendarRef.current = element;
          initialDateRef.current = element?.querySelector<HTMLElement>('[data-selected="true"]') ?? null;
        }}>
          <QuietCalendar calendarMonth={calendarMonth} selectedDate={selectedDate} focusedDate={focusedDate}
            onCalendarMonthChange={setCalendarMonth} onFocusedDateChange={value => {
              moveDateFocusRef.current = !!calendarRef.current?.contains(document.activeElement)
                && !!document.activeElement?.matches(".qp-calendar-day");
              setFocusedDate(value);
            }}
            onSelectDate={value => {
              onDateChange(formatLocalDateKey(value));
              setCalendarMonth(startOfLocalMonth(value));
              setFocusedDate(value);
              if (recurrence?.kind === "weekly") onRecurrenceChange({ kind: "weekly", weekdays: [value.getDay() || 7] });
            }} />
        </div>
        <QuietTimeColumns value={time} onChange={onTimeChange} />
      </div>
    </QuietAnchoredPopover>
  </div>;
}
