import type {
  MiniStatusSnapshot,
  MiniToolProjection,
} from "../../platform/desktop/miniContentRuntimeGateway.ts";

interface MiniToolSlotViewModel {
  kind: MiniToolProjection["kind"];
  state: MiniToolProjection["state"];
  timeText: string;
  phase: MiniToolProjection["phase"];
  progress: number | null;
}

interface MiniStatusViewModel {
  tools: MiniToolSlotViewModel[];
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
  countsDown: boolean,
) {
  if (!running) return Math.max(0, valueMs);
  const delta = Math.max(0, elapsedSinceSnapshotMs);
  return countsDown
    ? Math.max(0, valueMs - delta)
    : Math.max(0, valueMs + delta);
}

export function buildMiniStatusViewModel(
  snapshot: MiniStatusSnapshot | null,
  elapsedSinceSnapshotMs: number,
): MiniStatusViewModel {
  if (!snapshot) {
    return { tools: [] };
  }

  return {
    tools: snapshot.tools
      .filter((tool) => (
        tool.visibleUntilMs === null
        || elapsedSinceSnapshotMs < tool.visibleUntilMs - snapshot.sampledAtMs
      ))
      .slice(0, 2)
      .map((tool) => ({
        kind: tool.kind,
        state: tool.state,
        phase: tool.phase,
        progress: tool.countsDown && tool.totalMs ? Math.min(1, Math.max(0, 1 - resolveLiveValue(
          tool.valueMs, elapsedSinceSnapshotMs, tool.state === "running", true,
        ) / tool.totalMs)) : null,
        timeText: formatMiniToolDuration(resolveLiveValue(
          tool.valueMs,
          elapsedSinceSnapshotMs,
          tool.state === "running",
          tool.countsDown,
        )),
      })),
  };
}
