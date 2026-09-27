import type { DashboardSnapshot } from "./dashboardReadModel.ts";

const DASHBOARD_SNAPSHOT_CACHE_LIMIT = 1;
let cachedSnapshot: { key: string; snapshot: DashboardSnapshot } | null = null;
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
  return cachedSnapshot?.key === cacheKey ? cachedSnapshot.snapshot : null;
}

export function setDashboardSnapshotCache(snapshot: DashboardSnapshot, date: Date = new Date()): void {
  const cacheKey = formatDashboardSnapshotCacheKey(date);
  cachedSnapshot = { key: cacheKey, snapshot };
}

export function clearDashboardSnapshotCache(): void {
  dashboardCacheLoadGeneration += 1;
  cachedSnapshot = null;
}

export function getDashboardSnapshotCacheSizeForTests(): number {
  return (cachedSnapshot ? 1 : 0);
}

export function getDashboardSnapshotCacheStats() {
  return {
    entries: (cachedSnapshot ? 1 : 0),
    limit: DASHBOARD_SNAPSHOT_CACHE_LIMIT,
  };
}
