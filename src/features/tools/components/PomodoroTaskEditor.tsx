import { useId, useRef, useState } from "react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { PomodoroTaskAction, ToolPomodoroTask } from "../../../shared/types/tools.ts";
import { formatMinuteInput } from "../services/toolsNumberInput.ts";
import PomodoroSettingsPicker from "./PomodoroSettingsPicker.tsx";

interface Props {
  task: ToolPomodoroTask;
  busy: boolean;
  onSave: (action: PomodoroTaskAction) => Promise<boolean>;
  onClose: () => void;
}

export default function PomodoroTaskEditor({ task, busy, onSave, onClose }: Props) {
  const text = useLocaleText();
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);
  const [label, setLabel] = useState(task.label);
  const [values, setValues] = useState(() => [task.run.focusMs / 60_000, task.run.shortBreakMs / 60_000,
    task.run.longBreakMs / 60_000, task.run.longBreakEvery].map(formatMinuteInput));
  const save = async () => {
    if (busy || savingRef.current) return;
    savingRef.current = true;
    try {
      const [focus, shortBreak, longBreak, every] = values.map(Number);
      if (await onSave({ kind: "save", id: task.run.id, label: label.trim(), focusMs: focus * 60_000,
        shortBreakMs: shortBreak * 60_000, longBreakMs: longBreak * 60_000, longBreakEvery: every })) onClose();
    } finally {
      savingRef.current = false;
    }
  };

  return <QuietDialog open title={text.tools.pomodoroTaskEdit} initialFocusRef={inputRef}
    onClose={() => { if (!savingRef.current && !busy) onClose(); }}
    actions={<>
      <QuietButton disabled={busy} onClick={onClose}>{text.common.cancel}</QuietButton>
      <QuietButton tone="primary" type="submit" form={formId} busy={busy}>{text.common.save}</QuietButton>
    </>}>
    <form id={formId} className="tools-pomodoro-editor" onSubmit={event => { event.preventDefault(); void save(); }}>
      <label className="tools-form-field">
        <span>{text.tools.pomodoroTaskName}</span>
        <input ref={inputRef} className="qp-input" value={label} maxLength={160} disabled={busy}
          placeholder={text.tools.pomodoroTaskPlaceholder} onChange={event => setLabel(event.target.value)} />
      </label>
      <PomodoroSettingsPicker values={values} disabled={busy} onChange={setValues} />
    </form>
  </QuietDialog>;
}
