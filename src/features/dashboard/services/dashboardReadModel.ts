import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { AppStat } from "../../../shared/types/app.ts";
import type { HistorySession } from "../../../shared/types/sessions.ts";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking.ts";
import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";
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
  resolveLiveCutoffMs,
  type ReadModelDiagnostics,
} from "../../../shared/lib/readModelCore.ts";
import { loadActivityAggregateRange } from "../../../platform/persistence/activityReadModelGateway.ts";

export interface DashboardSnapshot {
  fetchedAtMs: number;
  icons: Record<string, string>;
  activityRecords: AggregateSessionRecord[];
  hasActiveSession: boolean;
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
  getActivityAggregateRange: typeof loadActivityAggregateRange;
  loadIcons: typeof loadDashboardIconsForExecutables;
  getCachedIcons: typeof getDashboardIconRuntimeCacheSnapshot;
}

const DASHBOARD_SNAPSHOT_DEPENDENCIES: DashboardSnapshotDependencies = {
  now: Date.now,
  getActivityAggregateRange: loadActivityAggregateRange,
  loadIcons: loadDashboardIconsForExecutables,
  getCachedIcons: getDashboardIconRuntimeCacheSnapshot,
};

function collectDashboardIconExecutables(
  sessions: Array<Pick<HistorySession, "exeName">>,
): string[] {
  const names = new Set(sessions.map(session => session.exeName.trim()).filter(Boolean));
  return [...new Set([...names].flatMap((key) => [key, AppClassification.resolveStatisticalApp(key)]))];
}

export async function loadDashboardSnapshotWithDeps(
  date: Date,
  deps: DashboardSnapshotDependencies,
): Promise<DashboardSnapshot> {
  const dayRange = getDayRange(date);
  const dayResponse = await deps.getActivityAggregateRange(dayRange.startMs, dayRange.endMs);
  const icons = await deps.loadIcons(
    collectDashboardIconExecutables(dayResponse.records),
  ).catch((error: unknown) => {
    console.warn("Failed to refresh dashboard icons:", error);
    return deps.getCachedIcons();
  });

  return {
    fetchedAtMs: deps.now(),
    icons,
    activityRecords: dayResponse.records,
    hasActiveSession: dayResponse.hasActiveSession,
  };
}

export async function loadDashboardSnapshot(date: Date = new Date()): Promise<DashboardSnapshot> {
  return loadDashboardSnapshotWithDeps(date, DASHBOARD_SNAPSHOT_DEPENDENCIES);
}

export function buildDashboardReadModel(
  activityRecords: AggregateSessionRecord[],
  trackerHealth: TrackerHealthSnapshot,
  nowMs: number,
  yesterdayActivityRecords: AggregateSessionRecord[] = [],
): DashboardReadModel {
  const dayRange = getDayRange(new Date(nowMs), nowMs);
  const yesterday = new Date(nowMs);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayRange = getDayRange(yesterday);
  const compiledSessions = compileForRange(materializeActivityRecords(activityRecords), dayRange, 0);
  const compiledYesterdaySessions = compileForRange(materializeActivityRecords(yesterdayActivityRecords), yesterdayRange, 0);
  const stats = buildNormalizedAppStats(compiledSessions);
  const yesterdayStats = buildNormalizedAppStats(compiledYesterdaySessions);
  const totalTrackedTime = getTotalTrackedTime(stats);
  const yesterdayTrackedTime = getTotalTrackedTime(yesterdayStats);
  const diagnostics = buildReadModelDiagnostics(
    compiledSessions,
    trackerHealth,
    resolveLiveCutoffMs(trackerHealth, nowMs),
  );
  const hourlyCategoryActivity = buildHourlyCategoryActivity(compiledSessions);
  const hourlyActivity = hourlyCategoryActivity.points.map(({ hour, minutes }) => ({
    hour,
    minutes,
  }));

  return {
    compiledSessions,
    stats,
    totalTrackedTime,
    yesterdayTrackedTime,
    dayDeltaTrackedTime: totalTrackedTime - yesterdayTrackedTime,
    topApplications: buildTopApplications(stats),
    hourlyActivity,
    hourlyCategoryActivity,
    categoryDist: buildCategoryDistribution(stats),
    diagnostics,
  };
}

function materializeActivityRecords(buckets: AggregateSessionRecord[]): HistorySession[] {
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
