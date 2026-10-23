import {
  getSessionSummariesInRangeByLocalDay,
} from "../../../platform/persistence/sessionReadRepository.ts";
import type { UiText } from "../../../shared/i18n/index.ts";
import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";
import {
  resolveDataTrendRange,
  type DataTrendRangeSelection,
  type ResolvedDataTrendRange,
} from "./dataTrendRange.ts";
import { getCachedDataIconsForExecutables } from "./dataIconService.ts";
import { registerDataHeavyCacheClearer } from "./dataCacheLifecycle.ts";
import { estimateDataSessionPayloadBytes, touchBoundedDataCacheEntry } from "./dataLruCache.ts";

export interface DataTrendSnapshot {
  fetchedAtMs: number;
  icons: Record<string, string>;
  range: ResolvedDataTrendRange;
  sessions: AggregateSessionRecord[];
}

export interface DataTrendSnapshotDependencies {
  getSessionSummariesInRange: (startMs: number, endMs: number) => Promise<AggregateSessionRecord[]>;
}

const snapshotCache = new Map<string, { snapshot: DataTrendSnapshot; payloadBytes: number }>();
const sessionPromises = new Map<string, Promise<AggregateSessionRecord[]>>();
const DATA_TREND_SNAPSHOT_CACHE_LIMIT = 2;
const DATA_TREND_PENDING_LIMIT = 4;
const DATA_TREND_CACHE_PAYLOAD_LIMIT = 16 * 1024 * 1024;
let dataTrendSnapshotCacheEpoch = 0;

function collectDataIconExecutables(sessions: AggregateSessionRecord[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const session of sessions) {
    const exeName = session.exeName.trim();
    if (!exeName || seen.has(exeName)) continue;

    seen.add(exeName);
    result.push(exeName);
  }

  return result;
}

function getCachedDataIconMap(
  sessions: AggregateSessionRecord[],
): Record<string, string> {
  return getCachedDataIconsForExecutables(
    collectDataIconExecutables(sessions),
  );
}

export function getCachedDataTrendSnapshot(range: ResolvedDataTrendRange): DataTrendSnapshot | null {
  const entry = snapshotCache.get(range.cacheKey);
  if (!entry) return null;

  touchBoundedDataCacheEntry(snapshotCache, range.cacheKey, entry, DATA_TREND_SNAPSHOT_CACHE_LIMIT);
  return { ...entry.snapshot, range };
}

function setDataTrendSnapshotCache(snapshot: DataTrendSnapshot): void {
  const payloadBytes = estimateDataSessionPayloadBytes(snapshot.sessions);
  snapshotCache.delete(snapshot.range.cacheKey);
  // Return complete query results to the page even when they are too large to retain.
  if (payloadBytes > DATA_TREND_CACHE_PAYLOAD_LIMIT) return;
  touchBoundedDataCacheEntry(snapshotCache, snapshot.range.cacheKey, { snapshot, payloadBytes }, DATA_TREND_SNAPSHOT_CACHE_LIMIT);
  while ([...snapshotCache.values()].reduce((bytes, entry) => bytes + entry.payloadBytes, 0) > DATA_TREND_CACHE_PAYLOAD_LIMIT) {
    snapshotCache.delete(snapshotCache.keys().next().value!);
  }
}

export function clearDataTrendSnapshotCache(): void {
  dataTrendSnapshotCacheEpoch += 1;
  snapshotCache.clear();
  // Invalidating cached results does not cancel native reads already in flight.
}

registerDataHeavyCacheClearer("trend-snapshot", clearDataTrendSnapshotCache);

export async function loadDataTrendSnapshot(
  selection: DataTrendRangeSelection,
  nowMs: number,
  uiText: UiText,
  deps: DataTrendSnapshotDependencies = {
    getSessionSummariesInRange: getSessionSummariesInRangeByLocalDay,
  },
): Promise<DataTrendSnapshot> {
  const range = resolveDataTrendRange(selection, nowMs, uiText);
  const loadStartedAtEpoch = dataTrendSnapshotCacheEpoch;
  const pendingKey = `${loadStartedAtEpoch}:${range.cacheKey}`;
  const pending = sessionPromises.get(pendingKey);
  if (!pending && sessionPromises.size >= DATA_TREND_PENDING_LIMIT) {
    throw new Error("Data trend reads are still in progress");
  }
  const sessionPromise = pending ?? (() => {
    const nextPromise = deps.getSessionSummariesInRange(range.startMs, range.endMs).finally(() => {
      if (sessionPromises.get(pendingKey) === nextPromise) {
        sessionPromises.delete(pendingKey);
      }
    });
    sessionPromises.set(pendingKey, nextPromise);
    return nextPromise;
  })();
  return sessionPromise.then((sessions) => {
    const icons = getCachedDataIconMap(sessions);
    const snapshot = { fetchedAtMs: nowMs, icons, range, sessions };
    if (dataTrendSnapshotCacheEpoch === loadStartedAtEpoch) {
      setDataTrendSnapshotCache(snapshot);
    }
    return snapshot;
  });
}

export function getDataTrendSnapshotCacheSizeForTests(): number {
  return snapshotCache.size;
}

export function getDataTrendSnapshotCacheStats() {
  return {
    entries: snapshotCache.size,
    limit: DATA_TREND_SNAPSHOT_CACHE_LIMIT,
    pendingEntries: sessionPromises.size,
    pendingLimit: DATA_TREND_PENDING_LIMIT,
    estimatedSessionPayloadBytes: [...snapshotCache.values()].reduce((bytes, entry) => bytes + entry.payloadBytes, 0),
    maxSessionPayloadBytes: DATA_TREND_CACHE_PAYLOAD_LIMIT,
  };
}
