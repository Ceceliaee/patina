import type {
  MiniStatusSnapshot,
  MiniToolProjection,
} from "../../platform/desktop/miniContentRuntimeGateway.ts";

interface MiniToolSlotViewModel {
  id: number;
  label: string;
  kind: MiniToolProjection["kind"];
  state: MiniToolProjection["state"];
  timeText: string;
  phase: MiniToolProjection["phase"];
  progress: number | null;
}

interface MiniStatusViewModel {
  tools: MiniToolSlotViewModel[];
  reminder: MiniStatusSnapshot["reminder"];
}

function safeWholeSeconds(valueMs: number) {
  return Math.max(0, Math.floor(valueMs / 1_000));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

export function formatMiniToolDuration(valueMs: number) {
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
  countingUp = false,
) {
  if (!running) return Math.max(0, valueMs);
  const delta = Math.max(0, elapsedSinceSnapshotMs);
  return Math.max(0, valueMs + (countingUp ? delta : -delta));
}

export function buildMiniStatusViewModel(
  snapshot: MiniStatusSnapshot | null,
  elapsedSinceSnapshotMs: number,
): MiniStatusViewModel {
  if (!snapshot) {
    return { tools: [], reminder: null };
  }

  return {
    reminder: snapshot.reminder,
    tools: snapshot.tools
      .filter((tool) => (
        tool.visibleUntilMs === null
        || elapsedSinceSnapshotMs < tool.visibleUntilMs - snapshot.sampledAtMs
      ))
      .map((tool) => ({
        id: tool.id,
        label: tool.label,
        kind: tool.kind,
        state: tool.state,
        phase: tool.phase,
        progress: tool.totalMs ? Math.min(1, Math.max(0, 1 - resolveLiveValue(
          tool.valueMs, elapsedSinceSnapshotMs, tool.state === "running",
        ) / tool.totalMs)) : null,
        timeText: formatMiniToolDuration(resolveLiveValue(
          tool.valueMs,
          elapsedSinceSnapshotMs,
          tool.state === "running",
          tool.countingUp,
        )),
      })),
  };
}
