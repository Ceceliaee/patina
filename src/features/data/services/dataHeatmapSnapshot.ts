import {
  getEarliestSessionStartTime,
  getSessionSummariesInRangeByLocalDay,
  type AggregateSessionRecord,
} from "../../../platform/persistence/sessionReadRepository.ts";
import {
  getHeatmapRange,
  getHeatmapSelectionKey,
  type HeatmapRange,
  type HeatmapSelection,
} from "./dataHeatmapReadModel.ts";
import { registerDataHeavyCacheClearer } from "./dataCacheLifecycle.ts";
import { estimateDataSessionPayloadBytes } from "./dataLruCache.ts";

export interface DataHeatmapSnapshot {
  earliestStartTime: number | null;
  sessions: AggregateSessionRecord[];
  range: HeatmapRange;
  cacheKey: string;
}

export interface DataHeatmapDependencies {
  getEarliestSessionStartTime: () => Promise<number | null>;
  getSessionsInRange: (startMs: number, endMs: number) => Promise<AggregateSessionRecord[]>;
}

const HEATMAP_SESSION_CACHE_LIMIT = 2;
const HEATMAP_PENDING_LIMIT = 4;
const HEATMAP_CACHE_PAYLOAD_LIMIT = 16 * 1024 * 1024;
const heatmapSessionCache = new Map<string, { sessions: AggregateSessionRecord[]; payloadBytes: number }>();
const heatmapSnapshotPromises = new Map<string, Promise<DataHeatmapSnapshot>>();
let earliestSessionStartTimeCache: number | null | undefined;
let dataReadModelCacheEpoch = 0;

const defaultDataHeatmapDependencies: DataHeatmapDependencies = {
  getEarliestSessionStartTime,
  getSessionsInRange: getSessionSummariesInRangeByLocalDay,
};

export function resetDataReadModelCacheForTests() {
  clearDataReadModelCache();
}

export function clearDataReadModelCache() {
  dataReadModelCacheEpoch += 1;
  heatmapSessionCache.clear();
  // The old epoch still owns its native reads until both queries finish.
  earliestSessionStartTimeCache = undefined;
}

registerDataHeavyCacheClearer("heatmap-read-model", clearDataReadModelCache);

export function getCachedEarliestSessionStartTime() {
  return earliestSessionStartTimeCache;
}

function setHeatmapSessionCache(cacheKey: string, sessions: AggregateSessionRecord[]) {
  const payloadBytes = estimateDataSessionPayloadBytes(sessions);
  heatmapSessionCache.delete(cacheKey);
  if (payloadBytes > HEATMAP_CACHE_PAYLOAD_LIMIT) return;
  heatmapSessionCache.set(cacheKey, { sessions, payloadBytes });

  while (heatmapSessionCache.size > HEATMAP_SESSION_CACHE_LIMIT
    || [...heatmapSessionCache.values()].reduce((bytes, entry) => bytes + entry.payloadBytes, 0) > HEATMAP_CACHE_PAYLOAD_LIMIT) {
    const oldestKey = heatmapSessionCache.keys().next().value;
    if (!oldestKey) break;
    heatmapSessionCache.delete(oldestKey);
  }
}

export function getCachedDataHeatmapSessions(selection: HeatmapSelection, nowMs: number) {
  const cacheKey = getHeatmapSelectionKey(selection, nowMs);
  const entry = heatmapSessionCache.get(cacheKey);
  if (!entry) return undefined;

  heatmapSessionCache.delete(cacheKey);
  heatmapSessionCache.set(cacheKey, entry);
  return entry.sessions;
}

export async function loadDataHeatmapSnapshot(
  selection: HeatmapSelection,
  nowMs: number = Date.now(),
  deps: DataHeatmapDependencies = defaultDataHeatmapDependencies,
): Promise<DataHeatmapSnapshot> {
  const range = getHeatmapRange(selection, nowMs);
  const cacheKey = getHeatmapSelectionKey(selection, nowMs);
  const loadStartedAtEpoch = dataReadModelCacheEpoch;
  const pendingKey = `${loadStartedAtEpoch}:${cacheKey}`;
  const pending = heatmapSnapshotPromises.get(pendingKey);
  if (pending) return pending;
  if (heatmapSnapshotPromises.size >= HEATMAP_PENDING_LIMIT) {
    throw new Error("Data heatmap reads are still in progress");
  }
  const earliestStartTimePromise = (async () => earliestSessionStartTimeCache === undefined
    ? deps.getEarliestSessionStartTime()
    : earliestSessionStartTimeCache)();
  const sessionsPromise = (async () => deps.getSessionsInRange(range.start.getTime(), range.end.getTime()))();

  const snapshotPromise = (async () => {
    const [earliestStartTime, sessions] = await Promise.all([
      earliestStartTimePromise,
      sessionsPromise,
    ]);

    if (dataReadModelCacheEpoch === loadStartedAtEpoch) {
      earliestSessionStartTimeCache = earliestStartTime;
      setHeatmapSessionCache(cacheKey, sessions);
    }

    return {
      earliestStartTime,
      sessions,
      range,
      cacheKey,
    };
  })();
  // A failed earliest-date read must not release capacity while the sessions
  // query is still running (and vice versa). Callers can see the error promptly.
  void Promise.allSettled([earliestStartTimePromise, sessionsPromise]).then(() => {
    if (heatmapSnapshotPromises.get(pendingKey) === snapshotPromise) {
      heatmapSnapshotPromises.delete(pendingKey);
    }
  });

  heatmapSnapshotPromises.set(pendingKey, snapshotPromise);
  return snapshotPromise;
}

export function getDataHeatmapSessionCacheSizeForTests(): number {
  return heatmapSessionCache.size;
}

export function getDataHeatmapSessionCacheStats() {
  return {
    entries: heatmapSessionCache.size,
    limit: HEATMAP_SESSION_CACHE_LIMIT,
    pendingEntries: heatmapSnapshotPromises.size,
    pendingLimit: HEATMAP_PENDING_LIMIT,
    estimatedSessionPayloadBytes: [...heatmapSessionCache.values()].reduce((bytes, entry) => bytes + entry.payloadBytes, 0),
    maxSessionPayloadBytes: HEATMAP_CACHE_PAYLOAD_LIMIT,
    earliestSessionStartTimeCached: earliestSessionStartTimeCache !== undefined,
  };
}

export async function prewarmRecentDataHeatmapCache(
  nowMs: number = Date.now(),
  deps?: DataHeatmapDependencies,
): Promise<DataHeatmapSnapshot> {
  const cachedSessions = getCachedDataHeatmapSessions("recent", nowMs);
  if (cachedSessions && earliestSessionStartTimeCache !== undefined) {
    const range = getHeatmapRange("recent", nowMs);
    return {
      earliestStartTime: earliestSessionStartTimeCache,
      sessions: cachedSessions,
      range,
      cacheKey: getHeatmapSelectionKey("recent", nowMs),
    };
  }

  return loadDataHeatmapSnapshot("recent", nowMs, deps);
}
