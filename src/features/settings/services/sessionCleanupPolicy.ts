import type { CleanupRange } from "../types";

type SessionCleanupDeps = {
  clearSessionsBefore: (cutoffTime: number) => Promise<void>;
};

export function resolveSessionStartCleanupCutoffTime(range: CleanupRange, nowMs: number): number {
  const date = new Date(nowMs);
  date.setDate(date.getDate() - range);
  return date.getTime();
}

export async function clearSessionsByRangeWithDeps(
  range: CleanupRange,
  nowMs: number,
  deps: SessionCleanupDeps,
): Promise<void> {
  await deps.clearSessionsBefore(resolveSessionStartCleanupCutoffTime(range, nowMs));
}

export function shouldDeleteSessionByStartTime(sessionStartTime: number, cutoffTime: number): boolean {
  return sessionStartTime < cutoffTime;
}
