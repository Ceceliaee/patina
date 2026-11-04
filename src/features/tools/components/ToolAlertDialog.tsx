import { lazy, Suspense, useEffect } from "react";
import { useToolPresentation } from "../hooks/useToolPresentation.ts";
import { toolPresentationStore } from "../services/toolPresentationStore.ts";
import FocusAlertDialog from "./FocusAlertDialog.tsx";

const ActivityReminderAlertDialog = lazy(() => import("./ActivityReminderAlertDialog.tsx"));
const TimedReminderAlertDialog = lazy(() => import("./TimedReminderAlertDialog.tsx"));

export default function ToolAlertDialog({ notification = false }: { notification?: boolean }) {
  const { snapshot } = useToolPresentation();
  const alert = snapshot?.alert;
  useEffect(() => {
    if (!alert) return;
    let frame = 0;
    let lastSize = "";
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const surface = document.querySelector<HTMLElement>(".tools-usage-alert-surface");
        if (!surface) return;
        const body = surface.querySelector<HTMLElement>(".qp-dialog-body");
        const height = Math.min(4096, Math.ceil(Math.max(surface.scrollHeight, surface.getBoundingClientRect().height) + (body ? body.scrollHeight - body.clientHeight : 0)));
        const width = Number.parseFloat(getComputedStyle(surface).getPropertyValue("--tools-alert-width")) || Math.ceil(surface.getBoundingClientRect().width);
        const size = `${width}:${height}`;
        if (size === lastSize) return;
        lastSize = size;
        void toolPresentationStore.ready(alert.id, width, height).catch(() => { lastSize = ""; });
      });
    };
    const observer = new MutationObserver(measure);
    const resize = new ResizeObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    resize.observe(document.body);
    const focus = () => { lastSize = ""; measure(); };
    window.addEventListener("focus", focus);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); window.removeEventListener("focus", focus); };
  }, [alert, notification]);
  if (!alert) return null;
  const onAction = (action: Parameters<typeof toolPresentationStore.act>[1]) => toolPresentationStore.act(alert.id, action);
  if (alert.kind === "activity_reminder" && alert.activityReminder) {
    return <Suspense fallback={null}><ActivityReminderAlertDialog key={alert.id} alert={alert} details={alert.activityReminder} onAction={onAction} notification={notification} targetIcon={snapshot?.targetIcon} /></Suspense>;
  }
  if (alert.kind === "reminder") {
    return <Suspense fallback={null}><TimedReminderAlertDialog key={alert.id} alert={alert} onAction={onAction} notification={notification} /></Suspense>;
  }
  return <FocusAlertDialog key={alert.id} alert={alert} onAction={onAction} notification={notification} />;
}
