import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import {
  clearDataBootstrapSnapshotPayload,
  loadDataBootstrapSnapshotPayload,
  saveDataBootstrapSnapshotPayload,
} from "../../../platform/persistence/dataBootstrapSnapshotStore.ts";
import type {
  DataTrendViewModel,
} from "./dataReadModel.ts";
import type { HeatmapSelection, HeatmapWeek } from "./dataHeatmapReadModel.ts";

const DATA_BOOTSTRAP_SNAPSHOT_MAX_BYTES = 256 * 1024;

export interface DataBootstrapSnapshot {
  createdAtMs: number;
  overviewRangeCacheKey: string;
  appRangeCacheKey?: string;
  heatmapSelection: HeatmapSelection;
  mappingVersion: number;
  uiLanguage: AppLanguage;
  overviewTrendViewModel: DataTrendViewModel;
  appTrendViewModel?: DataTrendViewModel;
  heatmapRows: HeatmapWeek[];
  earliestStartTime: number | null;
}

interface DataBootstrapSnapshotDeps {
  clearPayload: () => Promise<void>;
  loadPayload: () => Promise<string | null>;
  savePayload: (payload: string) => Promise<void>;
  warn: (message: string, error: unknown) => void;
}

const defaultDeps: DataBootstrapSnapshotDeps = {
  clearPayload: clearDataBootstrapSnapshotPayload,
  loadPayload: loadDataBootstrapSnapshotPayload,
  savePayload: saveDataBootstrapSnapshotPayload,
  warn: console.warn,
};

let cachedSnapshot: DataBootstrapSnapshot | null = null;
let lastSaveAtMs = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidBootstrapSnapshot(value: unknown): value is DataBootstrapSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.createdAtMs === "number"
    && typeof value.overviewRangeCacheKey === "string"
    && (value.appRangeCacheKey === undefined || typeof value.appRangeCacheKey === "string")
    && (typeof value.heatmapSelection === "number" || value.heatmapSelection === "recent")
    && typeof value.mappingVersion === "number"
    && (value.uiLanguage === "zh-CN" || value.uiLanguage === "en-US")
    && isRecord(value.overviewTrendViewModel)
    && (value.appTrendViewModel === undefined || isRecord(value.appTrendViewModel))
    && Array.isArray(value.heatmapRows)
    && (typeof value.earliestStartTime === "number" || value.earliestStartTime === null)
  );
}

export function getCachedDataBootstrapSnapshot(): DataBootstrapSnapshot | null {
  return cachedSnapshot;
}

export async function loadPersistedDataBootstrapSnapshot(
  deps: Partial<DataBootstrapSnapshotDeps> = {},
): Promise<DataBootstrapSnapshot | null> {
  const resolvedDeps = { ...defaultDeps, ...deps };

  try {
    const payload = await resolvedDeps.loadPayload();
    if (!payload) {
      cachedSnapshot = null;
      return null;
    }

    const parsed: unknown = JSON.parse(payload);
    if (!isValidBootstrapSnapshot(parsed)) {
      cachedSnapshot = null;
      return null;
    }

    cachedSnapshot = parsed;
    return parsed;
  } catch (error) {
    cachedSnapshot = null;
    resolvedDeps.warn("Failed to load Data bootstrap snapshot", error);
    return null;
  }
}

export async function saveDataBootstrapSnapshot(
  snapshot: DataBootstrapSnapshot,
  options: {
    minSaveIntervalMs?: number;
    nowMs?: number;
  } = {},
  deps: Partial<DataBootstrapSnapshotDeps> = {},
): Promise<boolean> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const nowMs = options.nowMs ?? Date.now();
  const minSaveIntervalMs = options.minSaveIntervalMs ?? 5 * 60 * 1000;

  if (lastSaveAtMs > 0 && nowMs - lastSaveAtMs < minSaveIntervalMs) {
    cachedSnapshot = snapshot;
    return false;
  }

  const payload = JSON.stringify(snapshot);
  if (payload.length > DATA_BOOTSTRAP_SNAPSHOT_MAX_BYTES) {
    resolvedDeps.warn(
      "Skipped Data bootstrap snapshot because it exceeded the size budget",
      new Error(`${payload.length} bytes`),
    );
    return false;
  }

  try {
    await resolvedDeps.savePayload(payload);
    cachedSnapshot = snapshot;
    lastSaveAtMs = nowMs;
    return true;
  } catch (error) {
    resolvedDeps.warn("Failed to save Data bootstrap snapshot", error);
    return false;
  }
}

export async function clearDataBootstrapSnapshot(
  deps: Partial<DataBootstrapSnapshotDeps> = {},
): Promise<void> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  cachedSnapshot = null;
  lastSaveAtMs = 0;

  try {
    await resolvedDeps.clearPayload();
  } catch (error) {
    resolvedDeps.warn("Failed to clear Data bootstrap snapshot", error);
  }
}

export function resetDataBootstrapSnapshotForTests(): void {
  cachedSnapshot = null;
  lastSaveAtMs = 0;
}
