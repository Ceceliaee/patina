import { useId, useRef, useState } from "react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import type { ReminderRecurrence } from "../../../shared/types/tools.ts";
import ReminderScheduleFields, { validRecurrence } from "./ReminderScheduleFields.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import { parseLocalDateTime, toDateInputValue, toTimeInputValue } from "../services/reminderTimeInput.ts";
import type { ReminderRowViewModel } from "../types.ts";

interface Props {
  row: ReminderRowViewModel;
  enabled: boolean;
  busy: boolean;
  onSave: (id: number, label: string, scheduledAt: number, enabled: boolean, recurrence: ReminderRecurrence | null) => Promise<boolean>;
  onClose: () => void;
}

export default function TimedReminderEditor({ row, enabled, busy, onSave, onClose }: Props) {
  const text = useLocaleText();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const originalDate = toDateInputValue(new Date(row.scheduledAt));
  const originalTime = toTimeInputValue(new Date(row.scheduledAt));
  const [recurrence, setRecurrence] = useState(row.recurrence);
  const [label, setLabel] = useState(row.label);
  const [date, setDate] = useState(originalDate);
  const [time, setTime] = useState(originalTime);
  const [invalid, setInvalid] = useState(!row.recurrence && row.scheduledAt <= Date.now());
  const save = async () => {
    if (savingRef.current) return;
    const scheduledAt = date === originalDate && time === originalTime
      ? row.scheduledAt : parseLocalDateTime(date, time);
    if (scheduledAt === null || (!recurrence && enabled && scheduledAt <= Date.now())) { setInvalid(true); return; }
    if (!validRecurrence(recurrence)) return;
    savingRef.current = true;
    try {
      if (await onSave(row.id, label.trim() || text.tools.defaultReminderLabel, scheduledAt, enabled, recurrence)) onClose();
    } finally {
      savingRef.current = false;
    }
  };

  return <QuietDialog open title={text.tools.reminderEditTitle} initialFocusRef={inputRef}
    onClose={() => { if (!savingRef.current) onClose(); }}
    actions={<>
      <QuietButton disabled={busy} onClick={onClose}>{text.common.cancel}</QuietButton>
      <QuietButton tone="primary" type="submit" form={formId} busy={busy} disabled={!validRecurrence(recurrence)}>{text.common.save}</QuietButton>
    </>}>
    <form id={formId} className="tools-reminder-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label className="tools-form-field">
        <span>{text.tools.reminderLabel}</span>
        <input ref={inputRef} className="qp-input" value={label} disabled={busy}
          onChange={(event) => setLabel(event.target.value)} />
      </label>
      <div className="tools-reminder-schedule-grid">
        <ReminderScheduleFields date={date} time={time} recurrence={recurrence} disabled={busy}
          onDateChange={value => { setDate(value); setInvalid(false); }}
          onTimeChange={value => { setTime(value); setInvalid(false); }} onRecurrenceChange={setRecurrence} />
      </div>
      {invalid ? <p className="tools-validation-message" role="alert">{text.tools.reminderTimeInvalid}</p> : null}
    </form>
  </QuietDialog>;
}
