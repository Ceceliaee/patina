import { lazy, Suspense, useEffect } from "react";
import { useToolPresentation } from "../hooks/useToolPresentation.ts";
import { toolPresentationStore } from "../services/toolPresentationStore.ts";
import FocusAlertDialog from "./FocusAlertDialog.tsx";

const ActivityReminderAlertDialog = lazy(() => import("./ActivityReminderAlertDialog.tsx"));
const TimedReminderAlertDialog = lazy(() => import("./TimedReminderAlertDialog.tsx"));

export default function ToolAlertDialog({ notification = false }: { notification?: boolean }) {
  const { snapshot } = useToolPresentation();
  const alert = snapshot?.alert;
  const alertId = alert?.id;
  useEffect(() => {
    if (!alertId) return;
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
        let canvasHeight: number | undefined;
        if (notification && surface.matches(".tools-usage-steps-dialog")) {
          const panels = surface.querySelector(".tools-usage-steps");
          const active = panels?.querySelector(":scope > :not([inert])");
          const inactive = panels?.querySelector(":scope > [inert]");
          if (active && inactive) {
            const extra = Math.max(0, inactive.getBoundingClientRect().height - active.getBoundingClientRect().height);
            canvasHeight = Math.min(4096, Math.ceil(surface.getBoundingClientRect().height + extra));
          }
        }
        const size = `${width}:${height}:${canvasHeight ?? height}`;
        if (size === lastSize) return;
        lastSize = size;
        void toolPresentationStore.ready(alertId, width, height, canvasHeight).catch(() => { lastSize = ""; });
      });
    };
    const observer = new MutationObserver(measure);
    const resize = new ResizeObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    resize.observe(document.body);
    const focus = () => {
      if (!notification) lastSize = "";
      measure();
    };
    window.addEventListener("focus", focus);
    measure();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); window.removeEventListener("focus", focus); };
  }, [alertId, notification]);
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
