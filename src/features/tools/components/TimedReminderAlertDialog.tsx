import { useEffect, useRef, useState } from "react";
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
  useEffect(() => { if (snoozing) selectedRef.current?.focus(); }, [snoozing]);
  const cancel = () => {
    if (pending.current) return;
    setSnoozing(false); setError(null);
    requestAnimationFrame(() => snoozeRef.current?.focus());
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

  return <QuietDialog open autoFocus={!notification}
    title={snoozing ? text.tools.reminderSnooze : alert.body.trim() || text.tools.defaultReminderLabel}
    surfaceClassName={`tools-usage-alert-surface tools-timed-alert-surface${snoozing ? "" : " tools-usage-alert-limit"}`}
    closeOnBackdrop={false} initialFocusRef={completeRef}
    onClose={() => { if (!pending.current) { if (snoozing) cancel(); else void resolve(null); } }}
    actions={snoozing ? <>
      <QuietButton size="large" disabled={busy} onClick={cancel}>{text.common.cancel}</QuietButton>
      <QuietButton size="large" tone="primary" busy={busy} onClick={() => void resolve(minutes)}>{text.common.confirm}</QuietButton>
    </> : <>
      <QuietButton ref={snoozeRef} size="large" disabled={busy} onClick={() => { setMinutes(5); setError(null); setSnoozing(true); }}>{text.tools.reminderSnooze}</QuietButton>
      <QuietButton ref={completeRef} size="large" tone="primary" busy={busy} onClick={() => void resolve(null)}>{text.tools.reminderConfirmComplete}</QuietButton>
    </>}
  >
    {snoozing ? <fieldset className="tools-usage-alert-options" aria-label={text.tools.reminderSnooze} disabled={busy}>
      {([5, 15, 30] as const).map(value => <label key={value} className="tools-usage-alert-option">
        <span>{text.tools.reminderSnoozeDelay(formatUsageDuration(value, locale))}</span>
        <input ref={value === minutes ? selectedRef : undefined} type="radio" name="reminder-delay" value={value} checked={value === minutes} onChange={() => setMinutes(value)} />
        <Check className="tools-usage-alert-option-check" size={18} aria-hidden />
      </label>)}
    </fieldset> : <p className="tools-usage-alert-summary">{text.tools.reminderOccurredAt(occurredAt)}</p>}
    {error ? <p className="tools-usage-alert-error" role="alert">{error}</p> : null}
  </QuietDialog>;
}
