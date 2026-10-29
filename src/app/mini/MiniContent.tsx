import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import type { useMiniTracking } from "./useMiniTracking.ts";
import { buildMiniStatusViewModel } from "./miniStatusViewModel.ts";
import { useLocaleText } from "../../shared/i18n/index.ts";
import type { MiniPage } from "../../platform/desktop/miniWindowRuntimeGateway.ts";
import MiniActivityContent from "./MiniActivityContent.tsx";

export default function MiniContent({ tracking, page }: {
  tracking: ReturnType<typeof useMiniTracking>;
  page: MiniPage;
}) {
  const text = useLocaleText();
  if (!tracking.presentationReady) return <div className="mini-content mini-empty" role={tracking.presentationFailed ? "alert" : "status"}>
    {tracking.presentationFailed ? <><span>{text.miniWindow.failed}</span><button className="qp-button qp-button-secondary" onClick={tracking.retry}>{text.common.retry}</button></> : text.common.loading}
  </div>;
  return page === "tools" ? <MiniTools tracking={tracking} />
    : <MiniActivityContent page={page} health={tracking.trackerHealth} />;
}

function MiniTools({ tracking }: {
  tracking: ReturnType<typeof useMiniTracking>;
}) {
  const text = useLocaleText();
  const [elapsed, setElapsed] = useState(0);
  const clock = useRef({ snapshot: tracking.miniStatus, start: performance.now() });
  useEffect(() => {
    if (clock.current.snapshot !== tracking.miniStatus) {
      clock.current = { snapshot: tracking.miniStatus, start: performance.now() };
      setElapsed(0);
    }
    if (tracking.presentationFailed || !tracking.miniStatus?.tools.some(tool => tool.state === "running" || tool.visibleUntilMs !== null)) return;
    const timer = window.setInterval(() => setElapsed(Math.max(0, performance.now() - clock.current.start)), 1_000);
    return () => window.clearInterval(timer);
  }, [tracking.miniStatus, tracking.presentationFailed]);
  const status = buildMiniStatusViewModel(tracking.miniStatus, elapsed);
  return <div className="mini-content">
    {tracking.presentationFailed && <p role="alert">{text.miniWindow.failed}</p>}
    <div className="mini-tools">
      {status.tools.length === 0 && <p className="mini-empty">{text.miniWindow.emptyTools}</p>}
      {status.tools.map((tool) => <div className="mini-tool" key={tool.kind}>
        <div className="mini-tool-heading">
        <Timer size={14} aria-hidden="true" />
        <span>{tool.kind === "pomodoro" && tool.phase ? text.tools.pomodoroPhase[tool.phase === "short_break" ? "shortBreak" : tool.phase === "long_break" ? "longBreak" : "focus"] : tool.kind === "countdown" ? text.tools.timerModeCountdown : text.tools.timerModeStopwatch}</span>
        {tool.state !== "running" && <span className="mini-tool-state">{text.tools.pomodoroStatus[tool.state]}</span>}
        </div>
        <span className="mini-tool-time">{tool.timeText}</span>
        {tool.progress !== null && <progress value={tool.progress} max={1} aria-label={tool.timeText} />}
      </div>)}
    </div>
  </div>;
}
