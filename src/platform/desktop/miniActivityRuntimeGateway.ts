import { invoke } from "@tauri-apps/api/core";
import { isPlainRecord } from "../../shared/lib/runtimeTypeGuards.ts";
import { ANONYMOUS_ACTIVITY_KEY } from "../../shared/classification/anonymousActivity.ts";
import { parseActivityAggregateRange } from "../persistence/activityReadModelGateway.ts";
import { parseHistoryRangeRows } from "../persistence/sessionReadRepository.ts";
import { parseWebGroupedRange } from "../persistence/webLinksGateway.ts";
import { parseMiniBootstrapSnapshot } from "./miniContentRuntimeGateway.ts";

export type MiniActivityPage = "today" | "activity";

export function parseMiniActivitySnapshot(value: unknown, kind: MiniActivityPage) {
  if (!isPlainRecord(value) || value.kind !== kind || !Number.isSafeInteger(value.sampled_at_ms)
    || !Number.isSafeInteger(value.start_ms) || !Number.isSafeInteger(value.end_ms)
    || !isPlainRecord(value.icons) || !Object.values(value.icons).every(icon => typeof icon === "string")) {
    throw new Error("Invalid Mini activity snapshot");
  }
  const sampledAtMs = value.sampled_at_ms as number;
  const startMs = value.start_ms as number;
  const endMs = value.end_ms as number;
  const bootstrap = parseMiniBootstrapSnapshot(value.bootstrap);
  if (!bootstrap || sampledAtMs < 0 || startMs > sampledAtMs || endMs < sampledAtMs || startMs >= endMs
    || (kind === "today" && endMs === sampledAtMs)
    || (kind === "activity" && (endMs !== sampledAtMs || startMs !== Math.max(0, sampledAtMs - 3_600_000)))) {
    throw new Error("Invalid Mini activity range");
  }
  const aggregate = kind === "today" ? parseActivityAggregateRange(value.aggregate) : null;
  const web = kind === "activity" && bootstrap.timelineMode === "web" ? parseWebGroupedRange(value.web, sampledAtMs) : null;
  const sessions = parseHistoryRangeRows(value.sessions, sampledAtMs);
  if ((kind === "today" && (sessions.length || value.web !== null))
    || (kind === "activity" && value.aggregate !== null)
    || (kind === "activity" && bootstrap.timelineMode !== "web" && value.web !== null)
    || (web && sessions.length)) throw new Error("Mixed Mini activity sources");
  return { kind, sampledAtMs, startMs, endMs, bootstrap, sessions, web,
    records: aggregate?.records.map(row => row.anonymous ? { ...row, exeName: ANONYMOUS_ACTIVITY_KEY } : row) ?? [],
    sourceRevision: aggregate?.sourceRevision ?? null,
    icons: value.icons as Record<string, string>,
  };
}

export type MiniActivitySnapshot = ReturnType<typeof parseMiniActivitySnapshot>;

export async function getMiniActivitySnapshot(kind: MiniActivityPage): Promise<MiniActivitySnapshot> {
  return parseMiniActivitySnapshot(await invoke<unknown>("cmd_get_mini_activity_snapshot", { kind }), kind);
}
