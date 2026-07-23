import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import {
  buildDataTrendAggregateContext,
  buildDataTrendViewModelFromAggregate,
  prewarmRecentDataHeatmapCache,
} from "./dataReadModel.ts";
import { buildActivityHeatmap } from "./dataHeatmapReadModel.ts";
import {
  loadDataTrendSnapshot,
  type DataTrendSnapshot,
} from "./dataTrendSnapshot.ts";
import {
  saveDataBootstrapSnapshot,
  type DataBootstrapSnapshot,
} from "./dataBootstrapSnapshot.ts";

export interface DataFirstScreenPrewarmOptions {
  mappingVersion: number;
  uiLanguage: AppLanguage;
  reason: "foreground-opened" | "data-opened";
  nowMs?: number;
}

interface DataFirstScreenPrewarmDeps {
  loadTrendSnapshot: typeof loadDataTrendSnapshot;
  prewarmRecentHeatmap: typeof prewarmRecentDataHeatmapCache;
  saveBootstrapSnapshot: typeof saveDataBootstrapSnapshot;
  nowMs: () => number;
  warn: (message: string, error: unknown) => void;
}

const DEFAULT_PREWARM_THROTTLE_MS = 5 * 60 * 1000;
const DEFAULT_TREND_SELECTION = { kind: "rolling", days: 7 } as const;

const defaultDeps: DataFirstScreenPrewarmDeps = {
  loadTrendSnapshot: loadDataTrendSnapshot,
  prewarmRecentHeatmap: prewarmRecentDataHeatmapCache,
  saveBootstrapSnapshot: saveDataBootstrapSnapshot,
  nowMs: Date.now,
  warn: console.warn,
};

let pendingPrewarm: Promise<DataBootstrapSnapshot | null> | null = null;
let lastPrewarmKey: string | null = null;
let lastPrewarmAtMs = 0;

function buildPrewarmKey(options: DataFirstScreenPrewarmOptions, nowMs: number): string {
  const date = new Date(nowMs);
  const localDateKey = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

  return `${options.mappingVersion}:${options.uiLanguage}:${localDateKey}`;
}

function buildBootstrapSnapshot(
  trendSnapshot: DataTrendSnapshot,
  heatmapSnapshot: Awaited<ReturnType<typeof prewarmRecentDataHeatmapCache>>,
  options: DataFirstScreenPrewarmOptions,
  nowMs: number,
): DataBootstrapSnapshot {
  const trendAggregateContext = buildDataTrendAggregateContext(
    trendSnapshot.sessions,
    trendSnapshot.range,
    trendSnapshot.fetchedAtMs,
  );

  return {
    createdAtMs: nowMs,
    overviewRangeCacheKey: trendSnapshot.range.cacheKey,
    heatmapSelection: "recent",
    mappingVersion: options.mappingVersion,
    uiLanguage: options.uiLanguage,
    overviewTrendViewModel: buildDataTrendViewModelFromAggregate(trendAggregateContext),
    heatmapRows: buildActivityHeatmap(heatmapSnapshot.sessions, "recent", nowMs),
    earliestStartTime: heatmapSnapshot.earliestStartTime,
  };
}

export async function prewarmDataFirstScreen(
  options: DataFirstScreenPrewarmOptions,
  deps: Partial<DataFirstScreenPrewarmDeps> = {},
): Promise<DataBootstrapSnapshot | null> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const nowMs = options.nowMs ?? resolvedDeps.nowMs();
  const prewarmKey = buildPrewarmKey(options, nowMs);

  if (
    pendingPrewarm
    && lastPrewarmKey === prewarmKey
  ) {
    return pendingPrewarm;
  }

  if (
    lastPrewarmKey === prewarmKey
    && lastPrewarmAtMs > 0
    && nowMs - lastPrewarmAtMs < DEFAULT_PREWARM_THROTTLE_MS
  ) {
    return null;
  }

  lastPrewarmKey = prewarmKey;
  lastPrewarmAtMs = nowMs;
  pendingPrewarm = (async () => {
    try {
      const [trendSnapshot, heatmapSnapshot] = await Promise.all([
        resolvedDeps.loadTrendSnapshot(DEFAULT_TREND_SELECTION, nowMs),
        resolvedDeps.prewarmRecentHeatmap(nowMs),
      ]);
      const snapshot = buildBootstrapSnapshot(trendSnapshot, heatmapSnapshot, options, nowMs);
      await resolvedDeps.saveBootstrapSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      resolvedDeps.warn("Data first screen prewarm failed", error);
      return null;
    } finally {
      pendingPrewarm = null;
    }
  })();

  return pendingPrewarm;
}

export function resetDataFirstScreenPrewarmForTests(): void {
  pendingPrewarm = null;
  lastPrewarmKey = null;
  lastPrewarmAtMs = 0;
}
