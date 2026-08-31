import type {
  WidgetStatusSnapshot,
  WidgetToolProjection,
} from "../../platform/desktop/widgetRuntimeGateway.ts";

interface WidgetToolSlotViewModel {
  kind: WidgetToolProjection["kind"];
  state: WidgetToolProjection["state"];
  timeText: string;
}

interface WidgetStatusViewModel {
  trackingTimeText: string;
  tools: WidgetToolSlotViewModel[];
}

function safeWholeSeconds(valueMs: number) {
  return Math.max(0, Math.floor(valueMs / 1_000));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function formatWidgetTrackingDuration(valueMs: number) {
  const totalMinutes = Math.min(99 * 60 + 59, Math.floor(safeWholeSeconds(valueMs) / 60));
  return `${pad2(Math.floor(totalMinutes / 60))}:${pad2(totalMinutes % 60)}`;
}

export function formatWidgetToolDuration(valueMs: number) {
  const totalSeconds = safeWholeSeconds(valueMs);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`
    : `${pad2(minutes)}:${pad2(seconds)}`;
}

function resolveLiveValue(
  valueMs: number,
  elapsedSinceSnapshotMs: number,
  running: boolean,
  countsDown: boolean,
) {
  if (!running) return Math.max(0, valueMs);
  const delta = Math.max(0, elapsedSinceSnapshotMs);
  return countsDown
    ? Math.max(0, valueMs - delta)
    : Math.max(0, valueMs + delta);
}

export function buildWidgetStatusViewModel(
  snapshot: WidgetStatusSnapshot | null,
  elapsedSinceSnapshotMs: number,
): WidgetStatusViewModel {
  if (!snapshot) {
    return { trackingTimeText: "—", tools: [] };
  }

  const trackingValue = snapshot.tracking
    ? resolveLiveValue(
        snapshot.tracking.elapsedMs,
        elapsedSinceSnapshotMs,
        snapshot.tracking.running,
        false,
      )
    : null;

  return {
    trackingTimeText: trackingValue === null ? "—" : formatWidgetTrackingDuration(trackingValue),
    tools: snapshot.tools
      .filter((tool) => (
        tool.visibleUntilMs === null
        || elapsedSinceSnapshotMs < tool.visibleUntilMs - snapshot.sampledAtMs
      ))
      .slice(0, 2)
      .map((tool) => ({
        kind: tool.kind,
        state: tool.state,
        timeText: formatWidgetToolDuration(resolveLiveValue(
          tool.valueMs,
          elapsedSinceSnapshotMs,
          tool.state === "running",
          tool.countsDown,
        )),
      })),
  };
}
