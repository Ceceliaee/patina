import type { AppStat } from "../../../shared/types/app.ts";
import type { HistorySession } from "../../../shared/types/sessions.ts";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking.ts";
import {
  getHistoryByDate,
  getImportedTimeBucketsByDate,
  type AggregateSessionRecord,
} from "../../../platform/persistence/sessionReadRepository.ts";
import {
  getDashboardIconRuntimeCacheSnapshot,
  loadDashboardIconsForExecutables,
} from "./dashboardIconRuntimeCache.ts";
import {
  buildCategoryDistribution,
  buildTopApplications,
  getTotalTrackedTime,
  type CategoryDistItem,
  type TopApplicationItem,
} from "./dashboardFormatting.ts";
import {
  buildHourlyActivity,
  buildHourlyCategoryActivity,
  type HourlyActivityPoint,
  type HourlyCategoryActivity,
} from "../../../shared/lib/hourlyActivityCompiler.ts";
import {
  buildNormalizedAppStats,
  getDayRange,
  type CompiledSession,
} from "../../../shared/lib/sessionReadCompiler.ts";
import {
  buildReadModelDiagnostics,
  compileForRange,
  materializeLiveSessions,
  resolveLiveCutoffMs,
  type ReadModelDiagnostics,
} from "../../../shared/lib/readModelCore.ts";

export interface DashboardSnapshot {
  fetchedAtMs: number;
  icons: Record<string, string>;
  sessions: HistorySession[];
  yesterdaySessions?: HistorySession[];
  importedBuckets?: AggregateSessionRecord[];
  yesterdayImportedBuckets?: AggregateSessionRecord[];
}

export type ImportedDashboardBucket = AggregateSessionRecord;

export interface IconSnapshot {
  fetchedAtMs: number;
  icons: Record<string, string>;
}

export interface DashboardReadModel {
  compiledSessions: CompiledSession[];
  stats: AppStat[];
  totalTrackedTime: number;
  yesterdayTrackedTime: number;
  dayDeltaTrackedTime: number;
  topApplications: TopApplicationItem[];
  hourlyActivity: HourlyActivityPoint[];
  hourlyCategoryActivity: HourlyCategoryActivity;
  categoryDist: CategoryDistItem[];
  diagnostics: ReadModelDiagnostics;
}

interface DashboardSnapshotDependencies {
  now: () => number;
  getHistoryByDate: typeof getHistoryByDate;
  getImportedTimeBucketsByDate: typeof getImportedTimeBucketsByDate;
  loadIcons: typeof loadDashboardIconsForExecutables;
  getCachedIcons: typeof getDashboardIconRuntimeCacheSnapshot;
}

const DASHBOARD_SNAPSHOT_DEPENDENCIES: DashboardSnapshotDependencies = {
  now: Date.now,
  getHistoryByDate,
  getImportedTimeBucketsByDate,
  loadIcons: loadDashboardIconsForExecutables,
  getCachedIcons: getDashboardIconRuntimeCacheSnapshot,
};

function collectDashboardIconExecutables(
  ...sessionGroups: Array<Array<Pick<HistorySession, "exeName">>>
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const sessions of sessionGroups) {
    for (const session of sessions) {
      const exeName = session.exeName.trim();
      if (!exeName || seen.has(exeName)) continue;

      seen.add(exeName);
      result.push(exeName);
    }
  }

  return result;
}

export async function loadDashboardSnapshotWithDeps(
  date: Date,
  deps: DashboardSnapshotDependencies,
): Promise<DashboardSnapshot> {
  const yesterday = new Date(date);
  yesterday.setDate(yesterday.getDate() - 1);
  const [sessions, yesterdaySessions, importedBuckets, yesterdayImportedBuckets] = await Promise.all([
    deps.getHistoryByDate(date),
    deps.getHistoryByDate(yesterday),
    deps.getImportedTimeBucketsByDate(date),
    deps.getImportedTimeBucketsByDate(yesterday),
  ]);
  const icons = await deps.loadIcons(
    collectDashboardIconExecutables(sessions, importedBuckets),
  );

  return {
    fetchedAtMs: deps.now(),
    icons,
    sessions,
    yesterdaySessions,
    importedBuckets,
    yesterdayImportedBuckets,
  };
}

export async function loadDashboardSnapshot(date: Date = new Date()): Promise<DashboardSnapshot> {
  return loadDashboardSnapshotWithDeps(date, DASHBOARD_SNAPSHOT_DEPENDENCIES);
}

export async function loadIconSnapshotWithDeps(
  exeNames: string[],
  deps: Pick<DashboardSnapshotDependencies, "now" | "loadIcons" | "getCachedIcons">,
): Promise<IconSnapshot> {
  const icons = exeNames.length > 0
    ? await deps.loadIcons(exeNames)
    : deps.getCachedIcons();

  return {
    fetchedAtMs: deps.now(),
    icons,
  };
}

export async function loadIconSnapshot(exeNames: string[] = []): Promise<IconSnapshot> {
  return loadIconSnapshotWithDeps(exeNames, DASHBOARD_SNAPSHOT_DEPENDENCIES);
}

export function buildDashboardReadModel(
  sessions: HistorySession[],
  trackerHealth: TrackerHealthSnapshot,
  nowMs: number,
  yesterdaySessions: HistorySession[] = [],
  importedBuckets: AggregateSessionRecord[] = [],
  yesterdayImportedBuckets: AggregateSessionRecord[] = [],
): DashboardReadModel {
  const dayRange = getDayRange(new Date(nowMs), nowMs);
  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayRange = getDayRange(yesterday);
  const liveSessions = materializeLiveSessions(sessions, trackerHealth, nowMs);
  const compiledSessions = compileForRange(
    [...liveSessions, ...materializeImportedBuckets(importedBuckets)],
    dayRange,
    0,
  );
  const compiledYesterdaySessions = compileForRange(
    [...yesterdaySessions, ...materializeImportedBuckets(yesterdayImportedBuckets)],
    yesterdayRange,
    0,
  );
  const stats = buildNormalizedAppStats(compiledSessions);
  const yesterdayStats = buildNormalizedAppStats(compiledYesterdaySessions);
  const totalTrackedTime = getTotalTrackedTime(stats);
  const yesterdayTrackedTime = getTotalTrackedTime(yesterdayStats);
  const diagnostics = buildReadModelDiagnostics(
    compiledSessions,
    trackerHealth,
    resolveLiveCutoffMs(trackerHealth, nowMs),
  );

  return {
    compiledSessions,
    stats,
    totalTrackedTime,
    yesterdayTrackedTime,
    dayDeltaTrackedTime: totalTrackedTime - yesterdayTrackedTime,
    topApplications: buildTopApplications(stats),
    hourlyActivity: buildHourlyActivity(compiledSessions),
    hourlyCategoryActivity: buildHourlyCategoryActivity(compiledSessions),
    categoryDist: buildCategoryDistribution(stats),
    diagnostics,
  };
}

function materializeImportedBuckets(buckets: AggregateSessionRecord[]): HistorySession[] {
  return buckets.map((bucket, index) => ({
    id: -(index + 1),
    appName: bucket.appName,
    exeName: bucket.exeName,
    windowTitle: "",
    startTime: bucket.startTime,
    endTime: bucket.endTime,
    duration: Math.max(0, bucket.endTime - bucket.startTime),
    continuityGroupStartTime: bucket.startTime,
  }));
}
