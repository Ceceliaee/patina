import { AlarmClock, BellRing, TimerReset } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
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
  const title = activeAlert?.title.trim() || UI_TEXT.tools.notificationStatus;
  const message = activeAlert?.body.trim() || UI_TEXT.tools.defaultReminderLabel;
  const occurredAtLabel = activeAlert
    ? UI_TEXT.tools.alertOccurredAt(formatAlertTime(activeAlert.occurredAt))
    : "";
  const canPausePomodoro = activeAlert?.kind === "pomodoro";
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
          {canPausePomodoro && (
            <QuietButton
              className="qp-dialog-action"
              onClick={() => void handlePausePomodoro()}
              busy={pausingPomodoro}
            >
              {pausingPomodoro ? UI_TEXT.tools.alertPausingPomodoro : UI_TEXT.tools.alertPausePomodoro}
            </QuietButton>
          )}
          <QuietButton
            tone="primary"
            className="qp-dialog-action"
            onClick={dismissActiveAlert}
          >
            {UI_TEXT.tools.alertDismiss}
          </QuietButton>
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
