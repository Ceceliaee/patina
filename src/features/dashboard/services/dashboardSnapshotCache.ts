import type { DashboardSnapshot } from "./dashboardReadModel.ts";

const DASHBOARD_SNAPSHOT_CACHE_LIMIT = 1;
const DASHBOARD_SNAPSHOT_CACHE = new Map<string, DashboardSnapshot>();
let dashboardCacheLoadGeneration = 0;

export function beginDashboardSnapshotCacheLoad(): (snapshot: DashboardSnapshot, date?: Date) => void {
  const generation = ++dashboardCacheLoadGeneration;
  return (snapshot, date) => {
    if (generation === dashboardCacheLoadGeneration) setDashboardSnapshotCache(snapshot, date);
  };
}

function formatDashboardSnapshotCacheKey(date: Date): string {
  const localDate = new Date(date);
  localDate.setHours(0, 0, 0, 0);
  return `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
}

export function getDashboardSnapshotCache(date: Date = new Date()): DashboardSnapshot | null {
  const cacheKey = formatDashboardSnapshotCacheKey(date);
  const snapshot = DASHBOARD_SNAPSHOT_CACHE.get(cacheKey);
  if (!snapshot) return null;

  DASHBOARD_SNAPSHOT_CACHE.delete(cacheKey);
  DASHBOARD_SNAPSHOT_CACHE.set(cacheKey, snapshot);
  return snapshot;
}

export function setDashboardSnapshotCache(snapshot: DashboardSnapshot, date: Date = new Date()): void {
  const cacheKey = formatDashboardSnapshotCacheKey(date);
  DASHBOARD_SNAPSHOT_CACHE.delete(cacheKey);
  DASHBOARD_SNAPSHOT_CACHE.set(cacheKey, snapshot);

  while (DASHBOARD_SNAPSHOT_CACHE.size > DASHBOARD_SNAPSHOT_CACHE_LIMIT) {
    const oldestKey = DASHBOARD_SNAPSHOT_CACHE.keys().next().value;
    if (!oldestKey) break;
    DASHBOARD_SNAPSHOT_CACHE.delete(oldestKey);
  }
}

export function clearDashboardSnapshotCache(): void {
  dashboardCacheLoadGeneration += 1;
  DASHBOARD_SNAPSHOT_CACHE.clear();
}

export function getDashboardSnapshotCacheSizeForTests(): number {
  return DASHBOARD_SNAPSHOT_CACHE.size;
}

export function getDashboardSnapshotCacheStats() {
  return {
    entries: DASHBOARD_SNAPSHOT_CACHE.size,
    limit: DASHBOARD_SNAPSHOT_CACHE_LIMIT,
  };
}
