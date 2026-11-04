import { useRef, useState } from "react";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { useLocale, useLocaleText } from "../../../shared/i18n/index.ts";
import type { ToolAlert } from "../../../shared/types/tools.ts";
import { formatUsageDuration } from "../services/toolsLabels.ts";
import { formatCompactDuration } from "../services/toolsViewModel.ts";
import { ToolsRuntimeService } from "../services/toolsRuntimeService.ts";
import type { ToolAlertActions } from "../../../shared/types/toolNotifications.ts";

export default function FocusAlertDialog({ alert, onAction, notification = false }: { alert: ToolAlert } & ToolAlertActions) {
  const text = useLocaleText();
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const startRef = useRef<HTMLButtonElement>(null);
  const dismissRef = useRef<HTMLButtonElement>(null);
  const task = alert.pomodoro;
  const free = alert.kind === "free_focus" ? alert.freeFocus : null;
  const run = task?.run;
  const completed = run?.status === "completed";
  const canStart = free || (run && (completed || run.status === "paused"));
  const startLabel = free ? (free.phase === "break" ? text.tools.pomodoroStartBreak : text.tools.pomodoroStartFocus)
    : completed ? text.tools.pomodoroStartNextGroup
    : run?.phase === "focus" ? text.tools.pomodoroStartFocus : text.tools.pomodoroStartBreak;
  const phase = run?.phase === "focus" ? text.tools.pomodoroPhase.focus
    : run?.phase === "long_break" ? text.tools.pomodoroPhase.longBreak : text.tools.pomodoroPhase.shortBreak;
  const duration = run?.phase === "focus" ? run.focusMs : run?.phase === "long_break" ? run.longBreakMs : run?.shortBreakMs;
  const summary = free ? (free.phase === "break"
    ? text.tools.pomodoroNextPhase(text.tools.freeFocusRest, formatCompactDuration(free.restRemainingMs))
    : text.tools.freeFocusRestart)
    : task && run ? completed
    ? text.tools.pomodoroGroupSummary(run.longBreakEvery, task.completedGroups)
    : text.tools.pomodoroNextPhase(phase, formatUsageDuration((duration ?? 0) / 60_000, locale))
    : alert.body;
  const dismiss = () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    void onAction({ kind: "dismiss" }).catch(() => setError(text.tools.actionFailed))
      .finally(() => { pending.current = false; setBusy(false); });
  };
  const start = async () => {
    if (!canStart || pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    try {
      await onAction({ kind: "start_next" });
    } catch (cause) {
      setError(ToolsRuntimeService.isStateRefreshPendingError(cause) ? text.tools.stateRefreshPending : text.tools.actionFailed);
    } finally { pending.current = false; setBusy(false); }
  };

  return <QuietDialog open autoFocus={!notification} title={free ? free.label || text.tools.focusModeFree : task?.label.trim() || text.tools.pomodoroTaskDefault}
    surfaceClassName={`tools-usage-alert-surface tools-timed-alert-surface tools-usage-alert-limit ${free ? "tools-free-focus-alert" : "tools-pomodoro-alert-surface"}`}
    closeOnBackdrop={false} initialFocusRef={canStart ? startRef : dismissRef} onClose={dismiss}
    actions={<>
      <QuietButton ref={dismissRef} size="large" disabled={busy} onClick={dismiss}>
        {completed ? text.tools.reminderConfirmComplete : !canStart ? text.tools.alertDismiss : text.tools.pomodoroStartLater}
      </QuietButton>
      {canStart ? <QuietButton ref={startRef} size="large" tone="primary" busy={busy} onClick={() => void start()}>{startLabel}</QuietButton> : null}
    </>}
  >
    <p className="tools-usage-alert-summary">{summary}</p>
    {error ? <p className="tools-usage-alert-error" role="alert">{error}</p> : null}
  </QuietDialog>;
}
