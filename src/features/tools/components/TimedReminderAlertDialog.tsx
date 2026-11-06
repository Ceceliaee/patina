import { useLayoutEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { ReminderDelayMinutes, ToolAlert } from "../../../shared/types/tools.ts";
import { ToolsRuntimeService } from "../services/toolsRuntimeService.ts";
import type { ToolAlertActions } from "../../../shared/types/toolNotifications.ts";
import { formatUsageDuration } from "../services/toolsLabels.ts";

export default function TimedReminderAlertDialog({ alert, onAction, notification = false }: { alert: ToolAlert } & ToolAlertActions) {
  const text = useLocaleText();
  const locale = useLocale();
  const [snoozing, setSnoozing] = useState(false);
  const [minutes, setMinutes] = useState<ReminderDelayMinutes>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const completeRef = useRef<HTMLButtonElement>(null);
  const snoozeRef = useRef<HTMLButtonElement>(null);
  const selectedRef = useRef<HTMLInputElement>(null);
  const previousSnoozing = useRef(snoozing);
  useLayoutEffect(() => {
    if (previousSnoozing.current === snoozing) return;
    previousSnoozing.current = snoozing;
    const target = snoozing ? selectedRef.current : snoozeRef.current;
    target?.focus({ preventScroll: true });
  }, [snoozing]);
  const toggleSnooze = () => {
    if (pending.current) return;
    if (!snoozing) setMinutes(5);
    setSnoozing(!snoozing);
    setError(null);
  };
  const resolve = async (delay: ReminderDelayMinutes | null) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      await onAction({ kind: "resolve", delay });
    } catch (cause) {
      setError(ToolsRuntimeService.isStateRefreshPendingError(cause) ? text.tools.stateRefreshPending : text.tools.actionFailed);
    } finally { pending.current = false; setBusy(false); }
  };
  const occurredAt = new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(alert.occurredAt);
  const reminderTitle = alert.body.trim() || text.tools.defaultReminderLabel;

  return <QuietDialog open autoFocus={!notification}
    title={<span className="sr-only">{snoozing ? text.tools.reminderSnooze : reminderTitle}</span>}
    surfaceClassName="tools-usage-alert-surface tools-timed-alert-surface tools-usage-steps-dialog"
    closeOnBackdrop={false} initialFocusRef={completeRef}
    onClose={() => { if (snoozing) toggleSnooze(); else void resolve(null); }}
    actions={<>
      <QuietButton ref={snoozeRef} size="large" disabled={busy} onClick={toggleSnooze}>
        {snoozing ? text.common.cancel : text.tools.reminderSnooze}
      </QuietButton>
      <QuietButton ref={completeRef} size="large" tone="primary" busy={busy} onClick={() => void resolve(snoozing ? minutes : null)}>
        {snoozing ? text.common.confirm : text.tools.reminderConfirmComplete}
      </QuietButton>
    </>}
  >
    <div className="tools-usage-steps">
      <div className="tools-usage-step-limit" inert={snoozing}>
        <div className="qp-dialog-title">{reminderTitle}</div>
        <p className="tools-usage-alert-summary">{text.tools.reminderOccurredAt(occurredAt)}</p>
      </div>
      <div inert={!snoozing}>
        <div className="qp-dialog-title">{text.tools.reminderSnooze}</div>
        <fieldset className="tools-usage-alert-options" aria-label={text.tools.reminderSnooze} disabled={busy}>
          {([5, 15, 30] as const).map(value => <label key={value} className="tools-usage-alert-option">
            <span>{text.tools.reminderSnoozeDelay(formatUsageDuration(value, locale))}</span>
            <input ref={value === minutes ? selectedRef : undefined} type="radio" name="reminder-delay" value={value} checked={value === minutes} onChange={() => setMinutes(value)} />
            <Check className="tools-usage-alert-option-check" size={18} aria-hidden />
          </label>)}
        </fieldset>
      </div>
    </div>
    {error ? <p className="tools-usage-alert-error" role="alert">{error}</p> : null}
  </QuietDialog>;
}
