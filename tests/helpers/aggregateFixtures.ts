import type { AggregateSessionRecord } from "../../src/platform/persistence/sessionReadRepository.ts";
import type { TrackerHealthSnapshot } from "../../src/shared/types/tracking.ts";

/** Small, non-overlapping facts used to supply the backend aggregate DTO in view tests.
 * SQL priority, overlap, bucket boundaries and live cutoffs have separate repository
 * and real IPC tests; this fixture builder is not an implementation of that query.
 */
export function aggregateFixtureRecords(
  rows: Array<Omit<AggregateSessionRecord, "endTime"> & { endTime: number | null }>,
  health: TrackerHealthSnapshot | undefined,
  nowMs: number,
): AggregateSessionRecord[] {
  const cutoff = health?.status === "stale" ? Math.min(nowMs, health.lastHeartbeatMs ?? nowMs) : nowMs;
  return rows.map(row => ({ appName: row.appName, exeName: row.exeName, startTime: row.startTime,
    endTime: row.endTime ?? Math.max(row.startTime, cutoff) })).filter(row => row.endTime > row.startTime);
}
