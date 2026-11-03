import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import { parseBoundedMinuteInput } from "../services/toolsNumberInput.ts";
import ToolDurationInput from "./ToolDurationInput.tsx";

export const POMODORO_DURATION_BOUNDS = [[1, 180], [1, 60], [1, 120], [2, 12]] as const;

interface Props {
  values: string[];
  disabled: boolean;
  onChange: (values: string[]) => void;
}

export default function PomodoroSettingsPicker({ values, disabled, onChange }: Props) {
  const text = useLocaleText();
  const id = useId();
  const anchorRef = useRef<HTMLButtonElement>(null);
  const initialFocusRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(values);
  const parse = (next: string[]) => next.map((value, index) =>
    parseBoundedMinuteInput(value, POMODORO_DURATION_BOUNDS[index][0], POMODORO_DURATION_BOUNDS[index][1]));
  const invalid = parse(draft).some(value => value === null);
  const close = () => { setOpen(false); anchorRef.current?.focus(); };
  const change = (next: string[]) => {
    setDraft(next);
    const parsed = parse(next);
    if (parsed.every(value => value !== null)) onChange(parsed.map(String));
  };
  const fields = [
    ["focus", text.tools.focusDuration], ["short-break", text.tools.shortBreakDuration],
    ["long-break", text.tools.longBreakDuration], ["long-break-every", text.tools.longBreakEvery],
  ];

  return <div className="tools-form-field tools-pomodoro-settings-field">
    <span id={`${id}-label`}>{text.tools.pomodoroTimingSettings}</span>
    <button ref={anchorRef} type="button" disabled={disabled}
      className="qp-input qp-time-picker-trigger tools-pomodoro-settings-trigger"
      aria-labelledby={`${id}-label ${id}-summary`} aria-expanded={open && !disabled}
      aria-controls={open && !disabled ? id : undefined}
      onClick={() => { if (!open) setDraft(values); setOpen(!open); }}>
      <span id={`${id}-summary`}>{text.tools.pomodoroTimingSummary(Number(values[0]), Number(values[3]))}</span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    <QuietAnchoredPopover open={open && !disabled} anchor={anchorRef.current} id={id}
      ariaLabel={text.tools.pomodoroTimingSettings} containFocus initialFocusRef={initialFocusRef}
      className="tools-pomodoro-settings-popover"
      onClose={reason => { setOpen(false); if (reason === "escape") anchorRef.current?.focus(); }}>
      <div onKeyDown={event => {
        if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
          event.preventDefault();
          if (!invalid) close();
        }
      }} ref={element => { initialFocusRef.current = element?.querySelector('input') ?? null; }}>
        <div className="tools-pomodoro-settings-grid">
          {fields.map(([field, label], index) => <ToolDurationInput key={field} id={`tools-pomodoro-${field}`}
            label={label} minutes={draft[index]} minMinutes={POMODORO_DURATION_BOUNDS[index][0]}
            maxMinutes={POMODORO_DURATION_BOUNDS[index][1]}
            unit={index === 3 ? text.tools.pomodoroRoundUnit : text.tools.reminderMinutesUnit}
            onMinutesChange={value => change(draft.map((old, at) => at === index ? value : old))} />)}
        </div>
      </div>
    </QuietAnchoredPopover>
  </div>;
}
