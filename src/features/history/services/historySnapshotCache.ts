import {
  loadHistorySnapshot,
  type HistorySnapshot,
  type HistorySnapshotDeps,
  type HistorySnapshotLoadOptions,
} from "./historyReadModel.ts";

const HISTORY_SNAPSHOT_CACHE_LIMIT = 7;
const HISTORY_SNAPSHOT_CACHE = new Map<string, HistorySnapshot>();
const HISTORY_SNAPSHOT_PROMISES = new Map<string, Promise<HistorySnapshot>>();
const HISTORY_SNAPSHOT_CACHE_VERSIONS = new Map<string, number>();
let historySnapshotCacheEpoch = 0;

function formatHistorySnapshotCacheKey(
  date: Date,
  rollingDayCount: number,
  includeWebActivity: boolean,
): string {
  const localDate = new Date(date);
  localDate.setHours(0, 0, 0, 0);
  return `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}:${rollingDayCount}:web-${includeWebActivity ? 1 : 0}`;
}

export function getHistorySnapshotCache(
  date: Date = new Date(),
  rollingDayCount: number = 7,
  includeWebActivity: boolean = true,
): HistorySnapshot | null {
  const cacheKey = formatHistorySnapshotCacheKey(date, rollingDayCount, includeWebActivity);
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
  includeWebActivity: boolean = true,
): void {
  const cacheKey = formatHistorySnapshotCacheKey(date, rollingDayCount, includeWebActivity);
  HISTORY_SNAPSHOT_CACHE_VERSIONS.set(
    cacheKey,
    (HISTORY_SNAPSHOT_CACHE_VERSIONS.get(cacheKey) ?? 0) + 1,
  );
  HISTORY_SNAPSHOT_CACHE.delete(cacheKey);
  HISTORY_SNAPSHOT_CACHE.set(cacheKey, snapshot);

  while (HISTORY_SNAPSHOT_CACHE.size > HISTORY_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = HISTORY_SNAPSHOT_CACHE.keys().next().value;
    if (!oldestKey) break;
    HISTORY_SNAPSHOT_CACHE.delete(oldestKey);
  }
}

export function clearHistorySnapshotCache(): void {
  historySnapshotCacheEpoch += 1;
  HISTORY_SNAPSHOT_CACHE.clear();
  HISTORY_SNAPSHOT_PROMISES.clear();
  HISTORY_SNAPSHOT_CACHE_VERSIONS.clear();
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
  options: HistorySnapshotLoadOptions = {},
): Promise<HistorySnapshot> {
  const includeWebActivity = options.includeWebActivity ?? true;
  const cacheKey = formatHistorySnapshotCacheKey(date, rollingDayCount, includeWebActivity);
  const promiseKey = `${cacheKey}:details-${(options.includeTitleDetails ?? true) ? 1 : 0}`;
  const pending = HISTORY_SNAPSHOT_PROMISES.get(promiseKey);
  if (pending) return pending;

  const loadStartedAtEpoch = historySnapshotCacheEpoch;
  const loadStartedAtCacheVersion = HISTORY_SNAPSHOT_CACHE_VERSIONS.get(cacheKey) ?? 0;
  const snapshotPromise = loadHistorySnapshot(date, rollingDayCount, deps, options)
    .then((snapshot) => {
      if (
        historySnapshotCacheEpoch === loadStartedAtEpoch
        && (HISTORY_SNAPSHOT_CACHE_VERSIONS.get(cacheKey) ?? 0) === loadStartedAtCacheVersion
      ) {
        setHistorySnapshotCache(snapshot, date, rollingDayCount, includeWebActivity);
      }
      return snapshot;
    })
    .finally(() => {
      if (HISTORY_SNAPSHOT_PROMISES.get(promiseKey) === snapshotPromise) {
        HISTORY_SNAPSHOT_PROMISES.delete(promiseKey);
      }
    });

  HISTORY_SNAPSHOT_PROMISES.set(promiseKey, snapshotPromise);
  return snapshotPromise;
}

export async function prewarmHistorySnapshotCache(
  date: Date = new Date(),
  rollingDayCount: number = 7,
  options: HistorySnapshotLoadOptions = {},
): Promise<HistorySnapshot> {
  return loadHistorySnapshotWithCache(date, rollingDayCount, undefined, options);
}
