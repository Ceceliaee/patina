import {
  installDevelopmentResourceDiagnostics as installPlatformDevelopmentResourceDiagnostics,
  loadResourceDiagnostics,
  type ResourceDiagnosticsSnapshot,
} from "../../platform/desktop/resourceDiagnosticsRuntimeGateway.ts";
import { getDashboardSnapshotCacheStats } from "../../features/dashboard/services/dashboardSnapshotCache.ts";
import { getDataHeatmapSessionCacheStats } from "../../features/data/services/dataReadModel.ts";
import { getDataTrendSnapshotCacheStats } from "../../features/data/services/dataTrendSnapshot.ts";
import { getHistorySnapshotCacheStats } from "../../features/history/services/historySnapshotCache.ts";
import { getAppIconRuntimeCacheStats } from "../../platform/persistence/appIconRuntimeCache.ts";

interface FrontendCacheDiagnostics {
  appIconRuntime: ReturnType<typeof getAppIconRuntimeCacheStats>;
  dashboardSnapshot: ReturnType<typeof getDashboardSnapshotCacheStats>;
  dataHeatmapSessions: ReturnType<typeof getDataHeatmapSessionCacheStats>;
  dataTrendSnapshot: ReturnType<typeof getDataTrendSnapshotCacheStats>;
  historySnapshot: ReturnType<typeof getHistorySnapshotCacheStats>;
}

export interface AppResourceDiagnosticsSnapshot extends ResourceDiagnosticsSnapshot {
  frontendCaches: FrontendCacheDiagnostics;
}

async function loadAppResourceDiagnostics(): Promise<AppResourceDiagnosticsSnapshot> {
  const snapshot = await loadResourceDiagnostics();
  return {
    ...snapshot,
    frontendCaches: {
      appIconRuntime: getAppIconRuntimeCacheStats(),
      dashboardSnapshot: getDashboardSnapshotCacheStats(),
      dataHeatmapSessions: getDataHeatmapSessionCacheStats(),
      dataTrendSnapshot: getDataTrendSnapshotCacheStats(),
      historySnapshot: getHistorySnapshotCacheStats(),
    },
  };
}

export function installAppDevelopmentResourceDiagnostics(): void {
  installPlatformDevelopmentResourceDiagnostics(loadAppResourceDiagnostics);
}
