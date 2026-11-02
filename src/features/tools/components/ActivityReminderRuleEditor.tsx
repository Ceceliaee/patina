import { useId, useRef, useState, type ReactNode } from "react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import ActivityReminderDurationPicker from "./ActivityReminderDurationPicker.tsx";
import type { ActivityReminderRuleRowViewModel } from "../types.ts";

interface Props {
  rule: ActivityReminderRuleRowViewModel;
  targetIcon: ReactNode;
  busy: boolean;
  onSave: (id: number, limitMinutes: number) => Promise<boolean>;
  onClose: () => void;
}

export default function ActivityReminderRuleEditor({ rule, targetIcon, busy, onSave, onClose }: Props) {
  const text = useLocaleText();
  const formId = useId();
  const inputRef = useRef<HTMLButtonElement>(null);
  const savingRef = useRef(false);
  const [minutes, setMinutes] = useState(rule.limitMinutes);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      if (await onSave(rule.id, minutes)) onClose();
    } finally {
      savingRef.current = false;
    }
  };

  return <QuietDialog
    open
    title={text.tools.activityReminderEditTitle}
    initialFocusRef={inputRef}
    onClose={() => { if (!savingRef.current) onClose(); }}
    actions={<>
      <QuietButton disabled={busy} onClick={onClose}>{text.common.cancel}</QuietButton>
      <QuietButton tone="primary" type="submit" form={formId} busy={busy}>{text.common.save}</QuietButton>
    </>}
  >
    <form id={formId} className="tools-reminder-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="tools-reminder-editor-target tools-reminder-row-main tools-software-rule-main">
        {targetIcon}<strong>{rule.targetLabel}</strong>
      </div>
      <div className="tools-form-field">
        <span>{text.tools.activityReminderDurationLabel}</span>
        <ActivityReminderDurationPicker minutes={minutes} onChange={setMinutes} disabled={busy} triggerRef={inputRef} />
      </div>
    </form>
  </QuietDialog>;
}
