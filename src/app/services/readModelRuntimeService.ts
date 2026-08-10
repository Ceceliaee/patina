import { loadDashboardSnapshot, type DashboardSnapshot } from "../../features/dashboard/services/dashboardReadModel.ts";
import {
  type HistorySnapshot,
  type HistorySnapshotLoadOptions,
} from "../../features/history/services/historyReadModel.ts";
import { ensureProcessMapperRuntimeReady } from "./processMapperRuntimeGate.ts";
import {
  getDashboardSnapshotCache,
  setDashboardSnapshotCache,
} from "../../features/dashboard/services/dashboardSnapshotCache.ts";
import {
  loadHistorySnapshotWithCache,
} from "../../features/history/services/historySnapshotCache.ts";
import type { DataTrendSnapshot } from "../../features/data/services/dataTrendSnapshot.ts";
import type { DataTrendRangeSelection } from "../../features/data/services/dataTrendRange.ts";
import type { UiText } from "../../shared/i18n/index.ts";

type DashboardRuntimeSnapshotDeps = {
  ensureProcessMapperRuntimeReady: () => Promise<void>;
  loadDashboardSnapshot: (date?: Date) => Promise<DashboardSnapshot>;
  setDashboardSnapshotCache: (snapshot: DashboardSnapshot, date?: Date) => void;
};

type HistoryRuntimeSnapshotDeps = {
  ensureProcessMapperRuntimeReady: () => Promise<void>;
  loadHistorySnapshot: (
    date: Date,
    rollingDayCount?: number,
    deps?: undefined,
    options?: HistorySnapshotLoadOptions,
  ) => Promise<HistorySnapshot>;
  setHistorySnapshotCache: (
    snapshot: HistorySnapshot,
    date?: Date,
    rollingDayCount?: number,
    includeWebActivity?: boolean,
  ) => void;
};

const dashboardRuntimeSnapshotDeps: DashboardRuntimeSnapshotDeps = {
  ensureProcessMapperRuntimeReady,
  loadDashboardSnapshot,
  setDashboardSnapshotCache,
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
  return loadDashboardRuntimeSnapshotWithDeps(date, dashboardRuntimeSnapshotDeps);
}

export async function loadHistoryRuntimeSnapshotWithDeps(
  date: Date,
  rollingDayCount: number = 7,
  deps: HistoryRuntimeSnapshotDeps,
  options: HistorySnapshotLoadOptions = {},
): Promise<HistorySnapshot> {
  await deps.ensureProcessMapperRuntimeReady();
  const snapshot = await deps.loadHistorySnapshot(date, rollingDayCount, undefined, options);
  deps.setHistorySnapshotCache(
    snapshot,
    date,
    rollingDayCount,
    options.includeWebActivity ?? true,
  );
  return snapshot;
}

export async function loadHistoryRuntimeSnapshot(
  date: Date,
  rollingDayCount: number = 7,
  options: HistorySnapshotLoadOptions = {},
): Promise<HistorySnapshot> {
  await ensureProcessMapperRuntimeReady();
  return loadHistorySnapshotWithCache(date, rollingDayCount, undefined, options);
}

export function getHistoryRuntimeSeedSnapshot(date: Date): HistorySnapshot | null {
  const dashboardSnapshot = getDashboardSnapshotCache(date);
  if (!dashboardSnapshot) return null;

  return {
    fetchedAtMs: dashboardSnapshot.fetchedAtMs,
    icons: dashboardSnapshot.icons,
    daySessions: dashboardSnapshot.sessions,
    weeklySessions: [],
    dayAggregateSessions: dashboardSnapshot.importedBuckets ?? [],
    weeklyAggregateSessions: [],
    aggregateIncludesExactFacts: dashboardSnapshot.aggregateIncludesExactFacts ?? false,
    dayWebSegments: [],
    webDomainFavicons: {},
    webDomainOverrides: {},
  };
}

export async function loadDataTrendRuntimeSnapshot(
  selection: DataTrendRangeSelection,
  nowMs: number,
  uiText: UiText,
): Promise<DataTrendSnapshot> {
  await ensureProcessMapperRuntimeReady();
  const { loadDataTrendSnapshot } = await import(
    "../../features/data/services/dataTrendSnapshot.ts"
  );
  return loadDataTrendSnapshot(selection, nowMs, uiText);
}
