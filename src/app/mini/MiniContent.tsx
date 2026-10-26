import { useEffect, useState } from "react";
import { Clock3, Timer } from "lucide-react";
import type { useMiniTracking } from "./useMiniTracking.ts";
import { useMiniObjectIcon } from "./useMiniObjectIcon.ts";
import { buildMiniViewModel, isMiniSelfWindow } from "./miniViewModel.ts";
import { buildMiniStatusViewModel } from "./miniStatusViewModel.ts";
import { useLocaleText } from "../../shared/i18n/index.ts";
import { TRACKER_HEARTBEAT_STALE_AFTER_MS } from "../../shared/types/tracking.ts";

export default function MiniContent({ tracking }: { tracking: ReturnType<typeof useMiniTracking> }) {
  const text = useLocaleText();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    setElapsed(0);
    if (tracking.presentationFailed) return;
    const timer = window.setInterval(() => setElapsed(Math.max(0, performance.now() - start)), 1_000);
    return () => window.clearInterval(timer);
  }, [tracking.miniStatus, tracking.presentationFailed]);
  const view = buildMiniViewModel(tracking.activeWindow, tracking.trackingStatus, tracking.appSettings,
    tracking.trackerHealth, tracking.trackingRuntimeProbeStatus, text);
  // Never continue the previous application's clock while Patina is foreground.
  const projection = tracking.miniStatus && isMiniSelfWindow(tracking.activeWindow)
    ? { ...tracking.miniStatus, tracking: null } : tracking.miniStatus;
  const stale = Boolean(projection?.tracking?.running && tracking.trackingSampleAgeMs + elapsed > TRACKER_HEARTBEAT_STALE_AFTER_MS);
  const unavailable = stale || tracking.presentationFailed;
  const safeProjection = projection?.tracking && (unavailable || !["tracking", "tracking-sustained"].includes(view.statusTone))
    ? { ...projection, tracking: { ...projection.tracking, running: false } } : projection;
  const status = buildMiniStatusViewModel(safeProjection, tracking.presentationFailed ? 0 : elapsed);
  const icon = useMiniObjectIcon(view.objectIconKey);
  return <div className="mini-content">
    <div className="mini-status" data-tone={unavailable ? "unavailable" : view.statusTone}><span aria-hidden="true" />{unavailable ? text.miniWindow.trackingNotSynced : view.statusLabel}</div>
    <div className="mini-activity">
      {icon ? <img src={icon} alt="" /> : <Clock3 size={24} aria-hidden="true" />}
      <span>{view.appName}</span>
    </div>
    <div className="mini-time" aria-label={text.miniWindow.currentApp}>{status.trackingTimeText}</div>
    <div className="mini-tools">
      {status.tools.map((tool) => <div className="mini-tool" key={tool.kind}>
        <Timer size={14} aria-hidden="true" />
        <span>{tool.kind === "pomodoro" ? text.tools.pomodoroTitle : tool.kind === "countdown" ? text.tools.timerModeCountdown : text.tools.timerModeStopwatch}</span>
        <span className="mini-tool-time">{tool.timeText}</span>
        <span className="mini-tool-state">{text.tools.pomodoroStatus[tool.state]}</span>
      </div>)}
    </div>
  </div>;
}
