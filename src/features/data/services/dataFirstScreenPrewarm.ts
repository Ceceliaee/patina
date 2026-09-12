import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import type { UiText } from "../../../shared/i18n/generated/contract.ts";
import { loadLocaleText } from "../../../shared/i18n/runtime.ts";
import {
  buildDataAppTrendViewModelFromAggregate,
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
  getDataBootstrapSnapshotMutationVersion,
  type DataBootstrapSnapshot,
} from "./dataBootstrapSnapshot.ts";

interface DataFirstScreenPrewarmOptions {
  mappingVersion: number;
  uiLanguage: AppLanguage;
  reason: "foreground-opened" | "data-opened";
  nowMs?: number;
}

interface DataFirstScreenPrewarmDeps {
  loadLocaleText: typeof loadLocaleText;
  loadTrendSnapshot: typeof loadDataTrendSnapshot;
  prewarmRecentHeatmap: typeof prewarmRecentDataHeatmapCache;
  saveBootstrapSnapshot: typeof saveDataBootstrapSnapshot;
  nowMs: () => number;
  warn: (message: string, error: unknown) => void;
}

const DEFAULT_PREWARM_THROTTLE_MS = 5 * 60 * 1000;
const DEFAULT_TREND_SELECTION = { kind: "rolling", days: 7 } as const;

const defaultDeps: DataFirstScreenPrewarmDeps = {
  loadLocaleText,
  loadTrendSnapshot: loadDataTrendSnapshot,
  prewarmRecentHeatmap: prewarmRecentDataHeatmapCache,
  saveBootstrapSnapshot: saveDataBootstrapSnapshot,
  nowMs: Date.now,
  warn: console.warn,
};

type PrewarmRequest = { key: string; version: number; promise: Promise<DataBootstrapSnapshot | null> };
let pendingPrewarm: PrewarmRequest | null = null;
let lastPrewarm: { key: string; version: number; atMs: number } | null = null;

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
  uiText: UiText,
  nowMs: number,
): DataBootstrapSnapshot {
  const trendAggregateContext = buildDataTrendAggregateContext(
    trendSnapshot.sessions,
    trendSnapshot.range,
    trendSnapshot.fetchedAtMs,
    uiText,
    options.uiLanguage,
  );

  return {
    createdAtMs: nowMs,
    overviewRangeCacheKey: trendSnapshot.range.cacheKey,
    appRangeCacheKey: trendSnapshot.range.cacheKey,
    heatmapSelection: "recent",
    mappingVersion: options.mappingVersion,
    uiLanguage: options.uiLanguage,
    overviewTrendViewModel: buildDataTrendViewModelFromAggregate(trendAggregateContext),
    appTrendViewModel: buildDataAppTrendViewModelFromAggregate(trendAggregateContext, null),
    heatmapRows: buildActivityHeatmap(
      heatmapSnapshot.sessions,
      "recent",
      nowMs,
      uiText,
      options.uiLanguage,
    ),
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
  const version = getDataBootstrapSnapshotMutationVersion();

  if (
    pendingPrewarm
    && pendingPrewarm.key === prewarmKey
    && pendingPrewarm.version === version
  ) {
    return pendingPrewarm.promise;
  }

  if (
    lastPrewarm?.key === prewarmKey
    && lastPrewarm.version === version
    && nowMs - lastPrewarm.atMs >= 0
    && nowMs - lastPrewarm.atMs < DEFAULT_PREWARM_THROTTLE_MS
  ) {
    return null;
  }

  const request: PrewarmRequest = { key: prewarmKey, version, promise: Promise.resolve(null) };
  pendingPrewarm = request;
  const isCurrent = () => pendingPrewarm === request
    && getDataBootstrapSnapshotMutationVersion() === version;
  request.promise = (async () => {
    try {
      const uiText = await resolvedDeps.loadLocaleText(options.uiLanguage);
      if (!isCurrent()) return null;
      const [trendSnapshot, heatmapSnapshot] = await Promise.all([
        resolvedDeps.loadTrendSnapshot(
          DEFAULT_TREND_SELECTION,
          nowMs,
          uiText,
        ),
        resolvedDeps.prewarmRecentHeatmap(nowMs),
      ]);
      if (!isCurrent()) return null;
      const snapshot = buildBootstrapSnapshot(trendSnapshot, heatmapSnapshot, options, uiText, nowMs);
      const save = resolvedDeps.saveBootstrapSnapshot(snapshot);
      const saveVersion = getDataBootstrapSnapshotMutationVersion();
      request.version = saveVersion;
      if (!await save || pendingPrewarm !== request || getDataBootstrapSnapshotMutationVersion() !== saveVersion) {
        return null;
      }
      lastPrewarm = { key: prewarmKey, version: saveVersion, atMs: nowMs };
      return snapshot;
    } catch (error) {
      resolvedDeps.warn("Data first screen prewarm failed", error);
      return null;
    } finally {
      if (pendingPrewarm === request) pendingPrewarm = null;
    }
  })();

  return request.promise;
}

export function resetDataFirstScreenPrewarmForTests(): void {
  pendingPrewarm = null;
  lastPrewarm = null;
}
