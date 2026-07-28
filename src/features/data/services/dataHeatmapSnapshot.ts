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
const heatmapSessionCache = new Map<string, AggregateSessionRecord[]>();
const heatmapSnapshotPromises = new Map<string, Promise<DataHeatmapSnapshot>>();
let earliestSessionStartTimeCache: number | null | undefined;
let dataReadModelCacheEpoch = 0;

function resolveDefaultDataHeatmapDependencies(): DataHeatmapDependencies {
  return {
    getEarliestSessionStartTime,
    getSessionsInRange: getSessionSummariesInRangeByLocalDay,
  };
}

export function resetDataReadModelCacheForTests() {
  clearDataReadModelCache();
}

export function clearDataReadModelCache() {
  dataReadModelCacheEpoch += 1;
  heatmapSessionCache.clear();
  heatmapSnapshotPromises.clear();
  earliestSessionStartTimeCache = undefined;
}

registerDataHeavyCacheClearer("heatmap-read-model", clearDataReadModelCache);

export function getCachedEarliestSessionStartTime() {
  return earliestSessionStartTimeCache;
}

function setHeatmapSessionCache(cacheKey: string, sessions: AggregateSessionRecord[]) {
  heatmapSessionCache.delete(cacheKey);
  heatmapSessionCache.set(cacheKey, sessions);

  while (heatmapSessionCache.size > HEATMAP_SESSION_CACHE_LIMIT) {
    const oldestKey = heatmapSessionCache.keys().next().value;
    if (!oldestKey) break;
    heatmapSessionCache.delete(oldestKey);
  }
}

export function getCachedDataHeatmapSessions(selection: HeatmapSelection, nowMs: number) {
  const cacheKey = getHeatmapSelectionKey(selection, nowMs);
  const sessions = heatmapSessionCache.get(cacheKey);
  if (!sessions) return undefined;

  setHeatmapSessionCache(cacheKey, sessions);
  return sessions;
}

export async function loadDataHeatmapSnapshot(
  selection: HeatmapSelection,
  nowMs: number = Date.now(),
  deps: DataHeatmapDependencies = resolveDefaultDataHeatmapDependencies(),
): Promise<DataHeatmapSnapshot> {
  const range = getHeatmapRange(selection, nowMs);
  const cacheKey = getHeatmapSelectionKey(selection, nowMs);
  const pending = heatmapSnapshotPromises.get(cacheKey);
  if (pending) return pending;
  const loadStartedAtEpoch = dataReadModelCacheEpoch;

  const snapshotPromise = (async () => {
    const earliestStartTimePromise = earliestSessionStartTimeCache === undefined
      ? deps.getEarliestSessionStartTime()
      : Promise.resolve(earliestSessionStartTimeCache);

    const [earliestStartTime, sessions] = await Promise.all([
      earliestStartTimePromise,
      deps.getSessionsInRange(range.start.getTime(), range.end.getTime()),
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
  })().finally(() => {
    if (heatmapSnapshotPromises.get(cacheKey) === snapshotPromise) {
      heatmapSnapshotPromises.delete(cacheKey);
    }
  });

  heatmapSnapshotPromises.set(cacheKey, snapshotPromise);
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
