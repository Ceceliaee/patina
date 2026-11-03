import { lazy, Suspense } from "react";
import { useToolAlerts } from "../hooks/useToolAlerts.ts";
import FocusAlertDialog from "./FocusAlertDialog.tsx";

const ActivityReminderAlertDialog = lazy(() => import("./ActivityReminderAlertDialog.tsx"));
const TimedReminderAlertDialog = lazy(() => import("./TimedReminderAlertDialog.tsx"));

export default function ToolAlertDialog() {
  const { activeAlert, dismissActiveAlert } = useToolAlerts();
  if (!activeAlert) return null;
  if (activeAlert.kind === "activity_reminder" && activeAlert.activityReminder) {
    return <Suspense fallback={null}><ActivityReminderAlertDialog key={activeAlert.id} alert={activeAlert} details={activeAlert.activityReminder} onDismiss={dismissActiveAlert} /></Suspense>;
  }
  if (activeAlert.kind === "reminder") {
    return <Suspense fallback={null}><TimedReminderAlertDialog key={activeAlert.id} alert={activeAlert} onDismiss={dismissActiveAlert} /></Suspense>;
  }
  return <FocusAlertDialog key={activeAlert.id} alert={activeAlert} onDismiss={dismissActiveAlert} />;
}
