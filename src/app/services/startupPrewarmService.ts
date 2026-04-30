import {
  prewarmSettingsBootstrapCache,
} from "../../features/settings/services/settingsBootstrapService.ts";
import {
  prewarmClassificationBootstrapCache,
} from "../../features/classification/services/classificationService.ts";
import {
  prewarmDashboardSnapshotCache,
} from "../../features/dashboard/services/dashboardSnapshotCache.ts";
import {
  prewarmHistorySnapshotCache,
} from "../../features/history/services/historySnapshotCache.ts";

interface StartupPrewarmDeps {
  prewarmSettingsBootstrapCache: () => Promise<unknown>;
  prewarmClassificationBootstrapCache: () => Promise<unknown>;
  prewarmDashboardSnapshotCache: (date: Date) => Promise<unknown>;
  prewarmHistorySnapshotCache: (date: Date) => Promise<unknown>;
  warn: (message: string, error: unknown) => void;
}

const startupPrewarmDeps: StartupPrewarmDeps = {
  prewarmSettingsBootstrapCache,
  prewarmClassificationBootstrapCache,
  prewarmDashboardSnapshotCache,
  prewarmHistorySnapshotCache,
  warn: console.warn,
};

function warnRejectedPrewarm(
  message: string,
  results: PromiseSettledResult<unknown>[],
  warn: StartupPrewarmDeps["warn"],
) {
  for (const result of results) {
    if (result.status === "rejected") {
      warn(message, result.reason);
    }
  }
}

export async function prewarmStartupBootstrapCachesWithDeps(
  deps: Pick<
    StartupPrewarmDeps,
    "prewarmSettingsBootstrapCache" | "prewarmClassificationBootstrapCache" | "warn"
  >,
): Promise<void> {
  const results = await Promise.allSettled([
    deps.prewarmSettingsBootstrapCache(),
    deps.prewarmClassificationBootstrapCache(),
  ]);

  warnRejectedPrewarm("Failed to prewarm startup bootstrap cache:", results, deps.warn);
}

export async function prewarmStartupBootstrapCaches(): Promise<void> {
  return prewarmStartupBootstrapCachesWithDeps(startupPrewarmDeps);
}

export async function prewarmStartupSnapshotCachesWithDeps(
  date: Date,
  deps: Pick<
    StartupPrewarmDeps,
    "prewarmDashboardSnapshotCache" | "prewarmHistorySnapshotCache" | "warn"
  >,
): Promise<void> {
  const results = await Promise.allSettled([
    deps.prewarmDashboardSnapshotCache(date),
    deps.prewarmHistorySnapshotCache(date),
  ]);

  warnRejectedPrewarm("Failed to prewarm startup snapshot cache:", results, deps.warn);
}

export async function prewarmStartupSnapshotCaches(date: Date = new Date()): Promise<void> {
  return prewarmStartupSnapshotCachesWithDeps(date, startupPrewarmDeps);
}
