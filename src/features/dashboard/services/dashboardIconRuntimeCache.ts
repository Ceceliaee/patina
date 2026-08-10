export {
  getAppIcon as getDashboardIcon,
  getAppIconRuntimeCacheSnapshot as getDashboardIconRuntimeCacheSnapshot,
  getRetryableMissingAppIconExecutables as getRetryableMissingDashboardIconExecutables,
  hasAppIconForExecutable as hasDashboardIconForExecutable,
  loadAppIconsForExecutables as loadDashboardIconsForExecutables,
  resetAppIconRuntimeCacheForTests as resetDashboardIconRuntimeCacheForTests,
} from "../../../platform/persistence/appIconRuntimeCache.ts";

export {
  resolveAppIconKeys as resolveDashboardIconKeys,
} from "../../../shared/classification/appIconIdentity.ts";

export type {
  AppIconRuntimeCacheDeps as DashboardIconRuntimeCacheDeps,
} from "../../../platform/persistence/appIconRuntimeCache.ts";
