import {
  getSessionSummariesInRangeByLocalDay,
  getSessionSummariesInRangeByLocalMonth,
} from "../../../platform/persistence/sessionReadRepository.ts";
import { getLocaleText } from "../../../shared/i18n/runtime.ts";
import type { UiText } from "../../../shared/i18n/index.ts";
import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";
import {
  resolveDataTrendRange,
  type DataTrendRangeSelection,
  type ResolvedDataTrendRange,
} from "./dataTrendRange.ts";
import { getCachedDataIconsForExecutables } from "./dataIconService.ts";
import { registerDataHeavyCacheClearer } from "./dataCacheLifecycle.ts";

export interface DataTrendSnapshot {
  fetchedAtMs: number;
  icons: Record<string, string>;
  range: ResolvedDataTrendRange;
  sessions: AggregateSessionRecord[];
}

export interface DataTrendSnapshotDependencies {
  getSessionSummariesInRange: (startMs: number, endMs: number) => Promise<AggregateSessionRecord[]>;
  getSessionSummariesInRangeByLocalMonth?: (startMs: number, endMs: number) => Promise<AggregateSessionRecord[]>;
}

const snapshotCache = new Map<string, DataTrendSnapshot>();
const sessionPromises = new Map<string, Promise<AggregateSessionRecord[]>>();
const DATA_TREND_SNAPSHOT_CACHE_LIMIT = 2;
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

function touchSnapshotCacheEntry(key: string, snapshot: DataTrendSnapshot): void {
  snapshotCache.delete(key);
  snapshotCache.set(key, snapshot);

  while (snapshotCache.size > DATA_TREND_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = snapshotCache.keys().next().value;
    if (!oldestKey) break;
    snapshotCache.delete(oldestKey);
  }
}

export function getCachedDataTrendSnapshot(range: ResolvedDataTrendRange): DataTrendSnapshot | null {
  const snapshot = snapshotCache.get(range.cacheKey);
  if (!snapshot) return null;

  touchSnapshotCacheEntry(range.cacheKey, snapshot);
  return { ...snapshot, range };
}

export function setDataTrendSnapshotCache(snapshot: DataTrendSnapshot): void {
  touchSnapshotCacheEntry(snapshot.range.cacheKey, snapshot);
}

export function clearDataTrendSnapshotCache(): void {
  dataTrendSnapshotCacheEpoch += 1;
  snapshotCache.clear();
  sessionPromises.clear();
}

registerDataHeavyCacheClearer("trend-snapshot", clearDataTrendSnapshotCache);

export async function loadDataTrendSnapshot(
  selection: DataTrendRangeSelection,
  nowMs: number,
  uiText: UiText,
  deps: DataTrendSnapshotDependencies = {
    getSessionSummariesInRange: getSessionSummariesInRangeByLocalDay,
    getSessionSummariesInRangeByLocalMonth,
  },
): Promise<DataTrendSnapshot> {
  const range = resolveDataTrendRange(selection, nowMs, uiText);
  const pending = sessionPromises.get(range.cacheKey);
  const loadStartedAtEpoch = dataTrendSnapshotCacheEpoch;
  const sessionPromise = pending ?? (() => {
    const loadSessions = selection.kind === "all"
      ? deps.getSessionSummariesInRangeByLocalMonth ?? deps.getSessionSummariesInRange
      : deps.getSessionSummariesInRange;
    const nextPromise = loadSessions(range.startMs, range.endMs).finally(() => {
      if (sessionPromises.get(range.cacheKey) === nextPromise) {
        sessionPromises.delete(range.cacheKey);
      }
    });
    sessionPromises.set(range.cacheKey, nextPromise);
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

export function prewarmDefaultDataTrendSnapshot(nowMs: number = Date.now()) {
  return loadDataTrendSnapshot({ kind: "rolling", days: 7 }, nowMs, getLocaleText("zh-CN"));
}

export function getDataTrendSnapshotCacheSizeForTests(): number {
  return snapshotCache.size;
}

export function getDataTrendSnapshotCacheStats() {
  return {
    entries: snapshotCache.size,
    limit: DATA_TREND_SNAPSHOT_CACHE_LIMIT,
    pendingEntries: sessionPromises.size,
  };
}
