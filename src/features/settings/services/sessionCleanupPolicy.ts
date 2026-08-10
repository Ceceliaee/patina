import type { CleanupRange } from "../types";

type SessionCleanupMode = "session-start-before-cutoff";
type SessionCleanupDeps = {
  clearSessionsBefore: (cutoffTime: number) => Promise<void>;
};

interface SessionCleanupPlan {
  range: CleanupRange;
  nowMs: number;
  cutoffTime: number;
  mode: SessionCleanupMode;
  deletesSessionsStartingBeforeCutoff: true;
  keepsSessionsStartingAtOrAfterCutoff: true;
  deletesCrossCutoffActiveSessionsByStartTime: true;
}

export function resolveSessionStartCleanupCutoffTime(range: CleanupRange, nowMs: number): number {
  const date = new Date(nowMs);
  date.setDate(date.getDate() - range);
  return date.getTime();
}

export function buildSessionCleanupPlan(range: CleanupRange, nowMs: number): SessionCleanupPlan {
  return {
    range,
    nowMs,
    cutoffTime: resolveSessionStartCleanupCutoffTime(range, nowMs),
    mode: "session-start-before-cutoff",
    deletesSessionsStartingBeforeCutoff: true,
    keepsSessionsStartingAtOrAfterCutoff: true,
    deletesCrossCutoffActiveSessionsByStartTime: true,
  };
}

async function executeSessionCleanupPlan(
  cleanupPlan: SessionCleanupPlan,
  deps: SessionCleanupDeps,
): Promise<void> {
  await deps.clearSessionsBefore(cleanupPlan.cutoffTime);
}

export async function clearSessionsByRangeWithDeps(
  range: CleanupRange,
  nowMs: number,
  deps: SessionCleanupDeps,
): Promise<void> {
  await executeSessionCleanupPlan(buildSessionCleanupPlan(range, nowMs), deps);
}

export function shouldDeleteSessionByStartTime(sessionStartTime: number, cutoffTime: number): boolean {
  return sessionStartTime < cutoffTime;
}
