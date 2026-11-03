import { ChevronDown } from "lucide-react";
import { useId, useRef, useState } from "react";
import QuietAnchoredPopover from "../../../shared/components/QuietAnchoredPopover.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { FreeFocusSettings } from "../../../shared/types/tools.ts";

interface Props { value: FreeFocusSettings; disabled: boolean; onChange: (value: FreeFocusSettings) => void }
export default function FreeFocusRestPicker({ value, disabled, onChange }: Props) {
  const text = useLocaleText();
  const id = useId();
  const anchor = useRef<HTMLButtonElement>(null);
  const initialFocus = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ fixed: String(value.restMinutes), ratio: String(value.restRatio) });
  const fixed = value.restMode === "fixed";
  const summary = fixed ? `${text.tools.freeRestFixed} ${value.restMinutes} ${text.tools.reminderMinutesUnit}`
    : `${text.tools.freeRestRatio} ${value.restRatio}:1`;
  return <div className="tools-form-field tools-pomodoro-settings-field">
    <span id={`${id}-label`}>{text.tools.freeRestMode}</span>
    <button ref={anchor} type="button" className="qp-input qp-time-picker-trigger tools-pomodoro-settings-trigger tools-free-rest-trigger"
      disabled={disabled} aria-labelledby={`${id}-label ${id}-summary`} aria-expanded={open && !disabled} aria-controls={open && !disabled ? id : undefined}
      onClick={() => { if (!open) setDraft({ fixed: String(value.restMinutes), ratio: String(value.restRatio) }); setOpen(!open); }}>
      <span id={`${id}-summary`}>{summary}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    <QuietAnchoredPopover open={open && !disabled} anchor={anchor.current} id={id} ariaLabel={text.tools.freeRestMode}
      containFocus initialFocusRef={initialFocus} className="tools-pomodoro-settings-popover tools-free-rest-popover"
      onClose={reason => { setOpen(false); if (reason === "escape") anchor.current?.focus(); }}>
      <fieldset className="tools-free-rest-options" aria-label={text.tools.freeRestMode} disabled={disabled}>
        {(["fixed", "ratio"] as const).map(mode => {
          const isFixed = mode === "fixed";
          const max = isFixed ? 120 : 20;
          const select = () => onChange({ ...value, restMode: mode });
          return <div key={mode} className={`qp-select-option tools-free-rest-option ${mode === value.restMode ? "qp-select-option-selected" : ""}`}>
            <label className="tools-free-rest-choice">
              <input ref={mode === value.restMode ? initialFocus : undefined} type="radio" name={`${id}-mode`}
                value={mode} checked={mode === value.restMode} onChange={select} />
              <span>{isFixed ? text.tools.freeRestFixed : text.tools.freeRestRatio}</span>
            </label>
            <div className="tools-duration-control">
            <input type="number" className="qp-input tools-duration-input tools-free-rest-value" min={1} max={max} step={1}
              aria-label={isFixed ? text.tools.freeRestDuration : text.tools.freeRestProportion}
              value={draft[mode]} onFocus={select} onChange={event => {
                const raw = event.target.value;
                setDraft(current => ({ ...current, [mode]: raw }));
                const n = Number(raw);
                if (Number.isInteger(n) && n >= 1 && n <= max) onChange({ ...value, restMode: mode, [isFixed ? "restMinutes" : "restRatio"]: n });
              }} />
            <span className="tools-duration-unit">{isFixed ? text.tools.reminderMinutesUnit : ":1"}</span>
            </div>
          </div>;
        })}
      </fieldset>
    </QuietAnchoredPopover>
  </div>;
}
