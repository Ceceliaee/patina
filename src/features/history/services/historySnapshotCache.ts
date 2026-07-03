import {
  loadHistorySnapshot,
  type HistorySnapshot,
  type HistorySnapshotDeps,
} from "./historyReadModel.ts";

const HISTORY_SNAPSHOT_CACHE_LIMIT = 7;
const HISTORY_SNAPSHOT_CACHE = new Map<string, HistorySnapshot>();
const HISTORY_SNAPSHOT_PROMISES = new Map<string, Promise<HistorySnapshot>>();

function formatHistorySnapshotCacheKey(date: Date, rollingDayCount: number): string {
  const localDate = new Date(date);
  localDate.setHours(0, 0, 0, 0);
  return `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}:${rollingDayCount}`;
}

export function getHistorySnapshotCache(
  date: Date = new Date(),
  rollingDayCount: number = 7,
): HistorySnapshot | null {
  const cacheKey = formatHistorySnapshotCacheKey(date, rollingDayCount);
  const snapshot = HISTORY_SNAPSHOT_CACHE.get(cacheKey);
  if (!snapshot) return null;

  HISTORY_SNAPSHOT_CACHE.delete(cacheKey);
  HISTORY_SNAPSHOT_CACHE.set(cacheKey, snapshot);
  return snapshot;
}

export function setHistorySnapshotCache(
  snapshot: HistorySnapshot,
  date: Date = new Date(),
  rollingDayCount: number = 7,
): void {
  const cacheKey = formatHistorySnapshotCacheKey(date, rollingDayCount);
  HISTORY_SNAPSHOT_CACHE.delete(cacheKey);
  HISTORY_SNAPSHOT_CACHE.set(cacheKey, snapshot);

  while (HISTORY_SNAPSHOT_CACHE.size > HISTORY_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = HISTORY_SNAPSHOT_CACHE.keys().next().value;
    if (!oldestKey) break;
    HISTORY_SNAPSHOT_CACHE.delete(oldestKey);
  }
}

export function clearHistorySnapshotCache(): void {
  HISTORY_SNAPSHOT_CACHE.clear();
  HISTORY_SNAPSHOT_PROMISES.clear();
}

export function getHistorySnapshotCacheSizeForTests(): number {
  return HISTORY_SNAPSHOT_CACHE.size;
}

export function getHistorySnapshotCacheStats() {
  return {
    entries: HISTORY_SNAPSHOT_CACHE.size,
    limit: HISTORY_SNAPSHOT_CACHE_LIMIT,
    pendingEntries: HISTORY_SNAPSHOT_PROMISES.size,
  };
}

export async function loadHistorySnapshotWithCache(
  date: Date = new Date(),
  rollingDayCount: number = 7,
  deps?: HistorySnapshotDeps,
): Promise<HistorySnapshot> {
  const cacheKey = formatHistorySnapshotCacheKey(date, rollingDayCount);
  const pending = HISTORY_SNAPSHOT_PROMISES.get(cacheKey);
  if (pending) return pending;

  const snapshotPromise = loadHistorySnapshot(date, rollingDayCount, deps)
    .then((snapshot) => {
      setHistorySnapshotCache(snapshot, date, rollingDayCount);
      return snapshot;
    })
    .finally(() => {
      HISTORY_SNAPSHOT_PROMISES.delete(cacheKey);
    });

  HISTORY_SNAPSHOT_PROMISES.set(cacheKey, snapshotPromise);
  return snapshotPromise;
}

export async function prewarmHistorySnapshotCache(
  date: Date = new Date(),
  rollingDayCount: number = 7,
): Promise<HistorySnapshot> {
  return loadHistorySnapshotWithCache(date, rollingDayCount);
}
