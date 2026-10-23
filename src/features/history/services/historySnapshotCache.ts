import {
  loadHistorySnapshot,
  getHistoryNativeReadStats,
  type HistorySnapshot,
  type HistorySnapshotDeps,
  type HistorySnapshotLoadOptions,
} from "./historyReadModel.ts";

const HISTORY_SNAPSHOT_CACHE_LIMIT = 7;
const HISTORY_CACHE_PAYLOAD_LIMIT = 16 * 1024 * 1024;
const HISTORY_SNAPSHOT_CACHE = new Map<string, { snapshot: HistorySnapshot; payloadBytes: number }>();
type PendingSnapshot = { promise: Promise<HistorySnapshot>; canPublish: boolean };
const HISTORY_SNAPSHOT_PROMISES = new Map<string, PendingSnapshot>();

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
  return snapshot.snapshot;
}

export function setHistorySnapshotCache(
  snapshot: HistorySnapshot,
  date: Date = new Date(),
  rollingDayCount: number = 7,
  includeWebActivity: boolean = true,
): void {
  const cacheKey = formatHistorySnapshotCacheKey(date, rollingDayCount, includeWebActivity);
  for (const detailMode of [0, 1]) {
    const pending = HISTORY_SNAPSHOT_PROMISES.get(`${cacheKey}:details-${detailMode}`);
    if (pending) pending.canPublish = false;
  }
  HISTORY_SNAPSHOT_CACHE.delete(cacheKey);
  const payloadBytes = estimateHistorySessionPayloadBytes(snapshot);
  if (payloadBytes > HISTORY_CACHE_PAYLOAD_LIMIT) return;
  HISTORY_SNAPSHOT_CACHE.set(cacheKey, { snapshot, payloadBytes });

  while (HISTORY_SNAPSHOT_CACHE.size > HISTORY_SNAPSHOT_CACHE_LIMIT
    || [...HISTORY_SNAPSHOT_CACHE.values()].reduce((bytes, entry) => bytes + entry.payloadBytes, 0) > HISTORY_CACHE_PAYLOAD_LIMIT) {
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

function estimateHistorySessionPayloadBytes(snapshot: HistorySnapshot) {
  // Logical UTF-16/numeric session payload; excludes object overhead and shared
  // icon/override caches. This is not a measurement of retained JavaScript heap.
  let estimatedSessionPayloadBytes = 0;
  for (const session of snapshot.daySessions) {
    estimatedSessionPayloadBytes += 40 + 2 * (session.appName.length + session.exeName.length + session.windowTitle.length);
    for (const detail of session.titleSampleDetails ?? []) {
      estimatedSessionPayloadBytes += 16 + 2 * detail.title.length;
    }
  }
  for (const sessions of [snapshot.dayAggregateSessions, snapshot.weeklyAggregateSessions]) {
    for (const session of sessions) {
      estimatedSessionPayloadBytes += 16 + 2 * (session.appName.length + session.exeName.length);
    }
  }
  for (const segment of snapshot.dayWebSegments) {
    estimatedSessionPayloadBytes += 32 + 2 * (segment.browserClientId.length + segment.browserKind.length
      + segment.browserExeName.length + segment.domain.length + segment.normalizedDomain.length
      + (segment.url?.length ?? 0) + (segment.title?.length ?? 0) + (segment.faviconUrl?.length ?? 0));
  }
  return estimatedSessionPayloadBytes;
}

export function getHistorySnapshotCacheStats() {
  return {
    entries: HISTORY_SNAPSHOT_CACHE.size,
    limit: HISTORY_SNAPSHOT_CACHE_LIMIT,
    pendingEntries: HISTORY_SNAPSHOT_PROMISES.size,
    estimatedSessionPayloadBytes: [...HISTORY_SNAPSHOT_CACHE.values()].reduce((bytes, entry) => bytes + entry.payloadBytes, 0),
    maxSessionPayloadBytes: HISTORY_CACHE_PAYLOAD_LIMIT,
    ...getHistoryNativeReadStats(),
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
  if (pending) return pending.promise;

  const request: PendingSnapshot = {
    canPublish: true,
    promise: loadHistorySnapshot(date, rollingDayCount, deps, options)
      .then((snapshot) => {
        if (request.canPublish && HISTORY_SNAPSHOT_PROMISES.get(promiseKey) === request) {
          setHistorySnapshotCache(snapshot, date, rollingDayCount, includeWebActivity);
        }
        return snapshot;
      })
      .finally(() => {
        if (HISTORY_SNAPSHOT_PROMISES.get(promiseKey) === request) {
          HISTORY_SNAPSHOT_PROMISES.delete(promiseKey);
        }
      }),
  };

  HISTORY_SNAPSHOT_PROMISES.set(promiseKey, request);
  return request.promise;
}
