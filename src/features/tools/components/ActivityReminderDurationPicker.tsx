import { useId, useRef, useState, type RefObject } from "react";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import { QuietTimeColumns } from "../../../shared/components/QuietTimePicker.tsx";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import { formatUsageDuration } from "../services/toolsLabels.ts";

interface Props {
  minutes: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export default function ActivityReminderDurationPicker({ minutes, onChange, disabled, triggerRef }: Props) {
  const text = useLocaleText();
  const locale = useLocale();
  const id = useId();
  const localRef = useRef<HTMLButtonElement>(null);
  const initialOptionRef = useRef<HTMLElement>(null);
  const anchorRef = triggerRef ?? localRef;
  const [open, setOpen] = useState(false);
  const hours = Math.floor(minutes / 60);
  const value = `${String(hours).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  const close = () => { setOpen(false); anchorRef.current?.focus(); };

  return <>
    <button ref={anchorRef} type="button" disabled={disabled}
      className="qp-input qp-time-picker-trigger tools-usage-duration-trigger"
      aria-label={text.tools.activityReminderDurationLabel} aria-expanded={open && !disabled}
      aria-controls={open && !disabled ? id : undefined} onClick={() => setOpen(!open)}>
      {formatUsageDuration(minutes, locale)}
    </button>
    <QuietAnchoredPopover open={open && !disabled} anchor={anchorRef.current} id={id}
      ariaLabel={text.tools.activityReminderDurationLabel} containFocus initialFocusRef={initialOptionRef}
      onClose={reason => { setOpen(false); if (reason === "escape") anchorRef.current?.focus(); }}
      className="tools-usage-duration-popover">
      <div ref={element => {
        initialOptionRef.current = element?.querySelector<HTMLElement>('[data-selected-time-part="hour"]') ?? null;
      }}>
        <QuietTimeColumns value={value} maxHour={24} minMinute={hours === 0 ? 1 : 0}
          maxMinute={hours === 24 ? 0 : 59} onCommit={close}
          onChange={next => {
            const [hour, minute] = next.split(":").map(Number);
            onChange(Math.max(1, Math.min(1440, hour * 60 + minute)));
          }} />
      </div>
    </QuietAnchoredPopover>
  </>;
}
