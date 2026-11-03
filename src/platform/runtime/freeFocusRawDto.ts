import type { FreeFocusTask } from "../../shared/types/tools.ts";
import { isPlainRecord } from "../../shared/lib/runtimeTypeGuards.ts";

export interface RawFreeFocusTask {
  id: number; label: string; rest_mode: "fixed" | "ratio"; rest_minutes: number; rest_ratio: number;
  phase: "focus" | "break"; status: FreeFocusTask["status"]; elapsed_ms: number; rest_remaining_ms: number;
  started_at: number | null; created_at: number; updated_at: number;
}
export function isRawFreeFocusTask(value: unknown): value is RawFreeFocusTask {
  if (!isPlainRecord(value)) return false;
  const number = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  return number(value.id) && value.id > 0 && typeof value.label === "string"
    && (value.rest_mode === "fixed" || value.rest_mode === "ratio")
    && number(value.rest_minutes) && value.rest_minutes >= 1 && value.rest_minutes <= 120
    && number(value.rest_ratio) && value.rest_ratio >= 1 && value.rest_ratio <= 20
    && (value.phase === "focus" || value.phase === "break")
    && ["idle", "running", "paused", "completed"].includes(String(value.status))
    && number(value.elapsed_ms) && number(value.rest_remaining_ms)
    && (value.started_at === null || number(value.started_at)) && number(value.created_at) && number(value.updated_at);
}
export function mapFreeFocusTask(t: RawFreeFocusTask): FreeFocusTask {
  return { id: t.id, label: t.label, restMode: t.rest_mode, restMinutes: t.rest_minutes, restRatio: t.rest_ratio,
    phase: t.phase, status: t.status, elapsedMs: t.elapsed_ms, restRemainingMs: t.rest_remaining_ms,
    startedAt: t.started_at, createdAt: t.created_at, updatedAt: t.updated_at };
}
