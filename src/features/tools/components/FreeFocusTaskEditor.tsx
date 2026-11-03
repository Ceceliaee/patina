import { useId, useRef, useState } from "react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { FreeFocusAction, FreeFocusSettings, FreeFocusTask } from "../../../shared/types/tools.ts";
import FreeFocusRestPicker from "./FreeFocusRestPicker.tsx";

export default function FreeFocusTaskEditor({ task, busy, onSave, onClose }: {
  task: FreeFocusTask; busy: boolean; onSave: (action: FreeFocusAction) => Promise<boolean>; onClose: () => void;
}) {
  const text = useLocaleText(), id = useId();
  const ref = useRef<HTMLInputElement>(null), pending = useRef(false);
  const [label, setLabel] = useState(task.label);
  const [settings, setSettings] = useState<FreeFocusSettings>(task);
  const close = () => { if (!busy && !pending.current) onClose(); };
  return <QuietDialog open title={text.tools.freeFocusEdit} initialFocusRef={ref} onClose={close}
    actions={<><QuietButton disabled={busy} onClick={close}>{text.common.cancel}</QuietButton>
      <QuietButton type="submit" form={id} tone="primary" busy={busy}>{text.common.save}</QuietButton></>}>
    <form id={id} className="tools-pomodoro-editor" onSubmit={event => {
      event.preventDefault(); if (busy || pending.current) return; pending.current = true;
      void onSave({ kind: "save", id: task.id, label: label.trim(), restMode: settings.restMode,
        restMinutes: settings.restMinutes, restRatio: settings.restRatio }).then(ok => { if (ok) onClose(); }).finally(() => { pending.current = false; });
    }}>
      <label className="tools-form-field"><span>{text.tools.pomodoroTaskName}</span><input ref={ref} className="qp-input" value={label}
        disabled={busy} maxLength={160} placeholder={text.tools.pomodoroTaskPlaceholder} onChange={event => setLabel(event.target.value)} /></label>
      <FreeFocusRestPicker value={settings} disabled={busy} onChange={setSettings} />
    </form>
  </QuietDialog>;
}
