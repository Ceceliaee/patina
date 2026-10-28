import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import type { useMiniTracking } from "./useMiniTracking.ts";
import { buildMiniStatusViewModel } from "./miniStatusViewModel.ts";
import { useLocaleText } from "../../shared/i18n/index.ts";

export default function MiniContent({ tracking }: {
  tracking: ReturnType<typeof useMiniTracking>;
}) {
  const text = useLocaleText();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = performance.now();
    setElapsed(0);
    if (tracking.presentationFailed || !tracking.miniStatus?.tools.some(tool => tool.state === "running")) return;
    const timer = window.setInterval(() => setElapsed(Math.max(0, performance.now() - start)), 1_000);
    return () => window.clearInterval(timer);
  }, [tracking.miniStatus, tracking.presentationFailed]);
  const status = buildMiniStatusViewModel(tracking.miniStatus, tracking.presentationFailed ? 0 : elapsed);
  return <div className="mini-content">
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
