import { loadHistorySnapshot, type HistorySnapshot } from "./historyReadModel.ts";

const HISTORY_SNAPSHOT_CACHE = new Map<string, HistorySnapshot>();

function formatHistorySnapshotCacheKey(date: Date, rollingDayCount: number): string {
  const localDate = new Date(date);
  localDate.setHours(0, 0, 0, 0);
  return `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}:${rollingDayCount}`;
}

export function getHistorySnapshotCache(
  date: Date = new Date(),
  rollingDayCount: number = 7,
): HistorySnapshot | null {
  return HISTORY_SNAPSHOT_CACHE.get(formatHistorySnapshotCacheKey(date, rollingDayCount)) ?? null;
}

export function setHistorySnapshotCache(
  snapshot: HistorySnapshot,
  date: Date = new Date(),
  rollingDayCount: number = 7,
): void {
  HISTORY_SNAPSHOT_CACHE.set(formatHistorySnapshotCacheKey(date, rollingDayCount), snapshot);
}

export function clearHistorySnapshotCache(): void {
  HISTORY_SNAPSHOT_CACHE.clear();
}

export async function prewarmHistorySnapshotCache(
  date: Date = new Date(),
  rollingDayCount: number = 7,
): Promise<HistorySnapshot> {
  const snapshot = await loadHistorySnapshot(date, rollingDayCount);
  setHistorySnapshotCache(snapshot, date, rollingDayCount);
  return snapshot;
}
