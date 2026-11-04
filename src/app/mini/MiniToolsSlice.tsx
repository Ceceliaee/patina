import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useLocaleText } from "../../shared/i18n/index.ts";
import type { MiniAction } from "../../platform/desktop/miniWindowRuntimeGateway.ts";
import type { useMiniTracking } from "./useMiniTracking.ts";
import { buildMiniStatusViewModel } from "./miniStatusViewModel.ts";

export default function MiniToolsSlice({ tracking, act }: {
  tracking: ReturnType<typeof useMiniTracking>;
  act: (action: MiniAction) => Promise<void>;
}) {
  const text = useLocaleText();
  const [elapsed, setElapsed] = useState(0);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
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
  const status = buildMiniStatusViewModel(tracking.miniStatus, clock.current.snapshot === tracking.miniStatus ? elapsed : 0);
  if (!tracking.presentationReady || (!status.tools.length && !status.reminder)) return null;
  const control = async (tool: typeof status.tools[number]) => {
    if (busy.current) return;
    busy.current = true; setPending(true);
    try { await act({ kind: "tool_control", tool: tool.kind, id: tool.id, resume: tool.state === "paused" }); }
    finally { busy.current = false; setPending(false); }
  };
  const reminder = status.reminder;
  const due = reminder ? new Date(reminder.scheduledAt) : null;
  const time = due ? `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}` : "";
  return <section className="mini-tools" aria-label={text.miniWindow.tools}>
    {status.tools.map(tool => <div className="mini-tool" key={`${tool.kind}:${tool.id}`}>
      <span className="mini-tool-name">{tool.phase === "focus" && tool.label ? tool.label
        : tool.phase ? text.tools.pomodoroPhase[tool.phase === "short_break" ? "shortBreak" : tool.phase === "long_break" ? "longBreak" : "focus"] : text.tools.pomodoroTitle}</span>
      <span className="mini-tool-time">{tool.timeText}</span>
      {tool.state === "completed" ? <span className="mini-tool-action-space" /> : <button type="button"
        className="qp-icon-action qp-icon-action-neutral" disabled={pending || tracking.presentationFailed}
        aria-label={tool.state === "running" ? text.tools.pause : text.tools.resume}
        aria-busy={pending} onClick={() => { void control(tool); }}>
        {tool.state === "running" ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
      </button>}
    </div>)}
    {reminder && <div className="mini-tool mini-reminder">
      <span className="mini-tool-name">{reminder.label}</span>
      <time className="mini-tool-time" dateTime={due!.toISOString()} aria-label={due!.toLocaleString()}>{time}</time>
      <span className="mini-tool-action-space" />
    </div>}
  </section>;
}
