import {
  installDevelopmentResourceDiagnostics as installPlatformDevelopmentResourceDiagnostics,
  loadResourceDiagnostics,
  type ResourceDiagnosticsSnapshot,
} from "../../platform/desktop/resourceDiagnosticsRuntimeGateway.ts";
import { getDashboardSnapshotCacheStats } from "../../features/dashboard/services/dashboardSnapshotCache.ts";
import { getAppIconRuntimeCacheStats } from "../../platform/persistence/appIconRuntimeCache.ts";

interface FrontendCacheDiagnostics {
  appIconRuntime: ReturnType<typeof getAppIconRuntimeCacheStats>;
  dashboardSnapshot: ReturnType<typeof getDashboardSnapshotCacheStats>;
}

interface AppResourceDiagnosticsSnapshot extends ResourceDiagnosticsSnapshot {
  frontendCaches: FrontendCacheDiagnostics;
}

async function loadAppResourceDiagnostics(): Promise<AppResourceDiagnosticsSnapshot> {
  const snapshot = await loadResourceDiagnostics();
  return {
    ...snapshot,
    frontendCaches: {
      appIconRuntime: getAppIconRuntimeCacheStats(),
      dashboardSnapshot: getDashboardSnapshotCacheStats(),
    },
  };
}

export function installAppDevelopmentResourceDiagnostics(): void {
  installPlatformDevelopmentResourceDiagnostics(loadAppResourceDiagnostics);
}
