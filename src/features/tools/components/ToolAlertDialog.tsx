import { AlarmClock, BellRing, TimerReset } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { ToolAlert } from "../../../shared/types/tools.ts";
import { useToolAlerts } from "../hooks/useToolAlerts.ts";
import { ToolsRuntimeService } from "../services/toolsRuntimeService.ts";

function formatAlertTime(timestampMs: number) {
  return new Date(timestampMs).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function alertIcon(alert: ToolAlert): ReactNode {
  if (alert.kind === "countdown") return <TimerReset size={17} />;
  if (alert.kind === "pomodoro") return <AlarmClock size={17} />;
  return <BellRing size={17} />;
}

export default function ToolAlertDialog() {
  const { activeAlert, dismissActiveAlert } = useToolAlerts();
  const [pausingPomodoro, setPausingPomodoro] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  const [snoozeMinutes, setSnoozeMinutes] = useState<number | null>(null);
  const title = activeAlert?.title.trim() || UI_TEXT.tools.notificationStatus;
  const message = activeAlert?.body.trim() || UI_TEXT.tools.defaultReminderLabel;
  const occurredAtLabel = activeAlert
    ? UI_TEXT.tools.alertOccurredAt(formatAlertTime(activeAlert.occurredAt))
    : "";
  const canPausePomodoro = activeAlert?.kind === "pomodoro";
  const canSnooze = activeAlert?.kind === "reminder" || activeAlert?.kind === "pomodoro" || activeAlert?.kind === "countdown";

  useEffect(() => {
    if (!activeAlert || !canSnooze) {
      setSnoozeMinutes(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const snapshot = await ToolsRuntimeService.getToolsSnapshot();
        if (cancelled) return;
        if (activeAlert.kind === "reminder") {
          setSnoozeMinutes(snapshot.settings.reminderSnoozeMinutes || 10);
        } else if (activeAlert.kind === "pomodoro") {
          setSnoozeMinutes(snapshot.settings.pomodoroSnoozeMinutes || 10);
        } else if (activeAlert.kind === "countdown") {
          setSnoozeMinutes(snapshot.settings.countdownSnoozeMinutes || 5);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeAlert, canSnooze]);

  const handleSnooze = useCallback(async () => {
    if (!activeAlert || snoozing) return;

    setSnoozing(true);
    try {
      if (activeAlert.kind === "reminder") {
        const snapshot = await ToolsRuntimeService.getToolsSnapshot();
        const snoozeMinutes = snapshot.settings.reminderSnoozeMinutes || 10;
        const now = Date.now();
        const snoozeUntil = now + snoozeMinutes * 60 * 1000;
        await ToolsRuntimeService.createReminder({
          label: activeAlert.body || activeAlert.title || "时间到了",
          scheduledAt: snoozeUntil,
        });
      } else if (activeAlert.kind === "pomodoro") {
        const snapshot = await ToolsRuntimeService.getToolsSnapshot();
        const snoozeMinutes = snapshot.settings.pomodoroSnoozeMinutes || 10;
        const now = Date.now();
        const snoozeUntil = now + snoozeMinutes * 60 * 1000;
        await ToolsRuntimeService.createReminder({
          label: activeAlert.title || "番茄钟",
          scheduledAt: snoozeUntil,
        });
      } else if (activeAlert.kind === "countdown") {
        const snapshot = await ToolsRuntimeService.getToolsSnapshot();
        const snoozeMinutes = snapshot.settings.countdownSnoozeMinutes || 5;
        await ToolsRuntimeService.startTimer({
          mode: "countdown",
          durationMs: Math.max(1, snoozeMinutes) * 60_000,
        });
      }
      dismissActiveAlert();
    } catch (error) {
      console.warn("snooze from alert failed", error);
    } finally {
      setSnoozing(false);
    }
  }, [activeAlert, dismissActiveAlert, snoozing]);

  const handlePausePomodoro = useCallback(async () => {
    if (activeAlert?.kind !== "pomodoro" || pausingPomodoro) return;

    setPausingPomodoro(true);
    try {
      await ToolsRuntimeService.pausePomodoro();
      dismissActiveAlert();
    } catch (error) {
      console.warn("pause pomodoro from alert failed", error);
    } finally {
      setPausingPomodoro(false);
    }
  }, [activeAlert?.kind, dismissActiveAlert, pausingPomodoro]);

  return (
    <QuietDialog
      open={Boolean(activeAlert)}
      title={title}
      closeOnBackdrop={false}
      onClose={dismissActiveAlert}
      surfaceClassName="tools-alert-dialog-surface"
      actions={(
        <>
          {canSnooze && (
            <button
              type="button"
              className="qp-button-secondary qp-dialog-action disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handleSnooze()}
              disabled={snoozing}
            >
              {snoozing
                ? UI_TEXT.tools.alertSnoozing
                : snoozeMinutes
                  ? UI_TEXT.tools.alertSnoozeMinutes(snoozeMinutes)
                  : UI_TEXT.tools.alertSnooze}
            </button>
          )}
          {canPausePomodoro && (
            <button
              type="button"
              className="qp-button-secondary qp-dialog-action disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void handlePausePomodoro()}
              disabled={pausingPomodoro}
            >
              {pausingPomodoro ? UI_TEXT.tools.alertPausingPomodoro : UI_TEXT.tools.alertPausePomodoro}
            </button>
          )}
          <button
            type="button"
            className="qp-button-primary qp-dialog-action"
            onClick={dismissActiveAlert}
          >
            {UI_TEXT.tools.alertDismiss}
          </button>
        </>
      )}
    >
      {activeAlert && (
        <div className="tools-alert-dialog-body">
          <div className="tools-alert-dialog-icon" aria-hidden="true">
            {alertIcon(activeAlert)}
          </div>
          <div className="tools-alert-dialog-copy">
            <p className="tools-alert-dialog-message">{message}</p>
            <p className="tools-alert-dialog-time">{occurredAtLabel}</p>
          </div>
        </div>
      )}
    </QuietDialog>
  );
}
