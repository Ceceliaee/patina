import { invoke } from "@tauri-apps/api/core";
import { isPlainRecord } from "../../shared/lib/runtimeTypeGuards.ts";
import { ANONYMOUS_ACTIVITY_KEY } from "../../shared/classification/anonymousActivity.ts";
import { parseActivityAggregateRange } from "../persistence/activityReadModelGateway.ts";
import { parseHistoryRangeRows } from "../persistence/sessionReadRepository.ts";
import { parseWebGroupedRange } from "../persistence/webLinksGateway.ts";
import { parseMiniBootstrapSnapshot } from "./miniContentRuntimeGateway.ts";

export type MiniActivityPage = "today" | "activity";

export interface MiniActivitySnapshot {
  kind: MiniActivityPage;
  sampledAtMs: number;
  startMs: number;
  endMs: number;
  bootstrap: NonNullable<ReturnType<typeof parseMiniBootstrapSnapshot>>;
  sessions: ReturnType<typeof parseHistoryRangeRows>;
  web: ReturnType<typeof parseWebGroupedRange> | null;
  records: ReturnType<typeof parseActivityAggregateRange>["records"];
  icons: Record<string, string>;
}

export function parseMiniActivitySnapshot(raw: unknown) {
  if (!isPlainRecord(raw) || ![raw.sampled_at_ms, raw.day_start_ms, raw.day_end_ms, raw.recent_start_ms].every(Number.isSafeInteger)
    || !isPlainRecord(raw.icons) || !Object.values(raw.icons).every(icon => typeof icon === "string")) {
    throw new Error("Invalid Mini activity snapshot");
  }
  const sampledAtMs = raw.sampled_at_ms as number;
  const dayStart = raw.day_start_ms as number;
  const dayEnd = raw.day_end_ms as number;
  const recentStart = raw.recent_start_ms as number;
  const bootstrap = parseMiniBootstrapSnapshot(raw.bootstrap);
  if (!bootstrap || sampledAtMs < 0 || dayStart > sampledAtMs || dayEnd <= sampledAtMs
    || recentStart !== Math.max(0, sampledAtMs - 3_600_000) || recentStart >= sampledAtMs) {
    throw new Error("Invalid Mini activity range");
  }
  const aggregate = parseActivityAggregateRange(raw.aggregate);
  const sessions = parseHistoryRangeRows(raw.sessions, sampledAtMs);
  const web = bootstrap.timelineMode === "web" ? parseWebGroupedRange(raw.web, sampledAtMs) : null;
  if ((web && sessions.length) || (!web && raw.web !== null)) throw new Error("Mixed Mini activity sources");
  const records = aggregate.records.map(row => row.anonymous ? { ...row, exeName: ANONYMOUS_ACTIVITY_KEY } : row);
  const common = { sampledAtMs, bootstrap };
  const today: MiniActivitySnapshot = { ...common, kind: "today", startMs: dayStart, endMs: dayEnd, sessions: [], web: null,
    records, icons: {} };
  const activity: MiniActivitySnapshot = { ...common, kind: "activity", startMs: recentStart, endMs: sampledAtMs,
    sessions, web, records: [], icons: raw.icons as Record<string, string> };
  return { activity, today };
}

export async function getMiniActivitySnapshot() {
  return parseMiniActivitySnapshot(await invoke<unknown>("cmd_get_mini_activity_snapshot"));
}
