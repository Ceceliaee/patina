import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import {
  isFiniteNumber,
  isPlainRecord as isRecord,
  isStringArray,
} from "../../../shared/lib/runtimeTypeGuards.ts";
import { parseLocalDateKey } from "../../../shared/lib/localDate.ts";
import { SUPPORTED_LOCALES } from "../../../shared/i18n/generated/contract.ts";
import {
  clearDataBootstrapSnapshotPayload,
  loadDataBootstrapSnapshotPayload,
  saveDataBootstrapSnapshotPayload,
} from "../../../platform/persistence/dataBootstrapSnapshotStore.ts";
import type {
  DataAppTrendViewModel,
  DataTrendViewModel,
} from "./dataReadModel.ts";
import type { HeatmapSelection, HeatmapWeek } from "./dataHeatmapReadModel.ts";
import { createSerializedJobRunner } from "../../../platform/persistence/sqliteTransactions.ts";

const DATA_BOOTSTRAP_SNAPSHOT_MAX_BYTES = 256 * 1024;

export interface DataBootstrapSnapshot {
  createdAtMs: number;
  overviewRangeCacheKey: string;
  appRangeCacheKey: string;
  heatmapSelection: HeatmapSelection;
  mappingVersion: number;
  uiLanguage: AppLanguage;
  overviewTrendViewModel: DataTrendViewModel;
  appTrendViewModel: DataAppTrendViewModel;
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
let lastSavedIdentity: string | null = null;
let cacheMutationVersion = 0;
const runSerializedStorage = createSerializedJobRunner();

function snapshotIdentity(snapshot: DataBootstrapSnapshot): string {
  return JSON.stringify([
    snapshot.overviewRangeCacheKey, snapshot.appRangeCacheKey, snapshot.heatmapSelection,
    snapshot.mappingVersion, snapshot.uiLanguage,
  ]);
}

export function getDataBootstrapSnapshotMutationVersion(): number {
  return cacheMutationVersion;
}

function isValidAppOption(value: unknown) {
  return isRecord(value)
    && typeof value.appKey === "string"
    && typeof value.appName === "string"
    && typeof value.exeName === "string"
    && isStringArray(value.sourceAppKeys)
    && [value.totalDuration, value.percentage, value.averageDuration, value.activeDayCount].every(isNonnegativeNumber);
}

function isNonnegativeNumber(value: unknown) {
  return isFiniteNumber(value) && value >= 0;
}

function isDateKey(value: unknown) {
  return typeof value === "string" && parseLocalDateKey(value) !== null;
}

function isGranularity(value: unknown) {
  return value === "day" || value === "month";
}

function isValidChartAxis(value: unknown) {
  return isRecord(value)
    && isNonnegativeNumber(value.domainMax)
    && Array.isArray(value.ticks)
    && value.ticks.every(isNonnegativeNumber);
}

function isValidTrendSelection(value: unknown) {
  if (!isRecord(value)) return false;
  if (value.kind === "rolling") return [7, 30, 365].includes(value.days as number);
  if (value.kind === "custom" || value.kind === "all") {
    return isDateKey(value.startDateKey) && isDateKey(value.endDateKey);
  }
  return ["week", "month", "year"].includes(value.kind as string) && isDateKey(value.anchorDateKey);
}

function isValidOverviewTrend(value: unknown) {
  return isRecord(value)
    && isGranularity(value.granularity)
    && isNonnegativeNumber(value.totalDuration)
    && isNonnegativeNumber(value.averageDuration)
    && isRecord(value.metricLabels)
    && typeof value.metricLabels.total === "string"
    && typeof value.metricLabels.average === "string"
    && isValidChartAxis(value.chartAxis)
    && Array.isArray(value.chartData)
    && value.chartData.every((point: unknown) => isRecord(point)
      && typeof point.label === "string"
      && (point.date === null || isDateKey(point.date))
      && isNonnegativeNumber(point.hours));
}

function isValidAppTrendViewModel(value: unknown) {
  if (!isRecord(value) || !Array.isArray(value.selectedApps)) return false;
  const selectedApps = value.selectedApps;
  return isGranularity(value.granularity)
    && isRecord(value.range)
    && isValidTrendSelection(value.range.selection)
    && isRecord(value.summary)
    && [value.summary.totalDuration, value.summary.averageDuration, value.summary.activeDayCount].every(isNonnegativeNumber)
    && isValidChartAxis(value.chartAxis)
    && selectedApps.every(isValidAppOption)
    && Array.isArray(value.appOptions)
    && value.appOptions.every(isValidAppOption)
    && Array.isArray(value.chartRows)
    && value.chartRows.every((row: unknown) => isRecord(row)
      && typeof row.label === "string"
      && isDateKey(row.date)
      && isNonnegativeNumber(row.totalDuration)
      && isNonnegativeNumber(row.totalHours)
      && selectedApps.every((_app, index) => isNonnegativeNumber(row[`series${index}`]))
      && Object.entries(row).every(([key, item]) => key === "label" || key === "date" || isNonnegativeNumber(item)))
    && (value.peakDay === null || (isRecord(value.peakDay) && isNonnegativeNumber(value.peakDay.duration)));
}

function isValidHeatmapRows(value: unknown) {
  return Array.isArray(value) && value.every((week: unknown) => isRecord(week)
    && typeof week.key === "string"
    && typeof week.monthLabel === "string"
    && Array.isArray(week.cells)
    && week.cells.every((cell: unknown) => isRecord(cell)
      && typeof cell.key === "string"
      && isDateKey(cell.date)
      && typeof cell.label === "string"
      && isNonnegativeNumber(cell.duration)
      && isNonnegativeNumber(cell.intensity)
      && typeof cell.isFuture === "boolean"
      && typeof cell.isOutsideYear === "boolean"
      && (cell.availability === undefined || ["recorded", "no-activity", "unavailable", "future"].includes(cell.availability as string))));
}

function isValidBootstrapSnapshot(value: unknown): value is DataBootstrapSnapshot {
  if (!isRecord(value)) return false;
  return (
    isFiniteNumber(value.createdAtMs)
    && typeof value.overviewRangeCacheKey === "string"
    && typeof value.appRangeCacheKey === "string"
    && (isFiniteNumber(value.heatmapSelection) || value.heatmapSelection === "recent")
    && isFiniteNumber(value.mappingVersion)
    && SUPPORTED_LOCALES.includes(value.uiLanguage as AppLanguage)
    && isValidOverviewTrend(value.overviewTrendViewModel)
    && isValidAppTrendViewModel(value.appTrendViewModel)
    && isValidHeatmapRows(value.heatmapRows)
    && (isFiniteNumber(value.earliestStartTime) || value.earliestStartTime === null)
  );
}

export function getCachedDataBootstrapSnapshot(): DataBootstrapSnapshot | null {
  return cachedSnapshot;
}

export async function loadPersistedDataBootstrapSnapshot(
  deps: Partial<DataBootstrapSnapshotDeps> = {},
): Promise<DataBootstrapSnapshot | null> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  const loadStartedAtVersion = cacheMutationVersion;

  try {
    const payload = await runSerializedStorage(resolvedDeps.loadPayload);
    if (cacheMutationVersion !== loadStartedAtVersion) return cachedSnapshot;
    let snapshot: DataBootstrapSnapshot | null = null;
    if (payload) {
      const parsed: unknown = new TextEncoder().encode(payload).byteLength <= DATA_BOOTSTRAP_SNAPSHOT_MAX_BYTES
        ? JSON.parse(payload)
        : null;
      if (!isValidBootstrapSnapshot(parsed)) {
        await clearDataBootstrapSnapshot(resolvedDeps);
        return cachedSnapshot;
      }
      snapshot = parsed;
    }

    cacheMutationVersion += 1;
    cachedSnapshot = snapshot;
    return snapshot;
  } catch (error) {
    if (cacheMutationVersion !== loadStartedAtVersion) return cachedSnapshot;
    cacheMutationVersion += 1;
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

  const payload = JSON.stringify(snapshot);
  const payloadBytes = new TextEncoder().encode(payload).byteLength;
  if (payloadBytes > DATA_BOOTSTRAP_SNAPSHOT_MAX_BYTES) {
    resolvedDeps.warn(
      "Skipped Data bootstrap snapshot because it exceeded the size budget",
      new Error(`${payloadBytes} bytes`),
    );
    return false;
  }

  cacheMutationVersion += 1;
  const saveVersion = cacheMutationVersion;
  cachedSnapshot = snapshot;
  const identity = snapshotIdentity(snapshot);
  const elapsedMs = nowMs - lastSaveAtMs;
  if (identity === lastSavedIdentity && lastSaveAtMs > 0 && elapsedMs >= 0 && elapsedMs < minSaveIntervalMs) {
    return false;
  }

  try {
    await runSerializedStorage(() => resolvedDeps.savePayload(payload));
    if (cacheMutationVersion === saveVersion) {
      lastSaveAtMs = nowMs;
      lastSavedIdentity = identity;
    }
    return true;
  } catch (error) {
    resolvedDeps.warn("Failed to save Data bootstrap snapshot", error);
    return false;
  }
}

export function clearDataBootstrapSnapshot(
  deps: Partial<DataBootstrapSnapshotDeps> = {},
): Promise<void> {
  const resolvedDeps = { ...defaultDeps, ...deps };
  cacheMutationVersion += 1;
  cachedSnapshot = null;
  lastSaveAtMs = 0;
  lastSavedIdentity = null;

  return runSerializedStorage(resolvedDeps.clearPayload).catch((error: unknown) => {
    resolvedDeps.warn("Failed to clear Data bootstrap snapshot", error);
  });
}

export function resetDataBootstrapSnapshotForTests(): void {
  cacheMutationVersion += 1;
  cachedSnapshot = null;
  lastSaveAtMs = 0;
  lastSavedIdentity = null;
}
