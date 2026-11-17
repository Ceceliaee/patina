import { loadDashboardSnapshot, type DashboardSnapshot } from "../../features/dashboard/services/dashboardReadModel.ts";
import { ensureProcessMapperRuntimeReady } from "./processMapperRuntimeGate.ts";
import {
  beginDashboardSnapshotCacheLoad,
} from "../../features/dashboard/services/dashboardSnapshotCache.ts";

type DashboardRuntimeSnapshotDeps = {
  ensureProcessMapperRuntimeReady: () => Promise<void>;
  loadDashboardSnapshot: (date?: Date) => Promise<DashboardSnapshot>;
  setDashboardSnapshotCache: (snapshot: DashboardSnapshot, date?: Date) => void;
};

export async function loadDashboardRuntimeSnapshotWithDeps(
  date: Date = new Date(),
  deps: DashboardRuntimeSnapshotDeps,
): Promise<DashboardSnapshot> {
  await deps.ensureProcessMapperRuntimeReady();
  const snapshot = await deps.loadDashboardSnapshot(date);
  deps.setDashboardSnapshotCache(snapshot, date);
  return snapshot;
}

export async function loadDashboardRuntimeSnapshot(date: Date = new Date()): Promise<DashboardSnapshot> {
  return loadDashboardRuntimeSnapshotWithDeps(date, {
    ensureProcessMapperRuntimeReady,
    loadDashboardSnapshot,
    setDashboardSnapshotCache: beginDashboardSnapshotCacheLoad(),
  });
}
