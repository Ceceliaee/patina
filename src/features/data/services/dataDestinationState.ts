import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";

export type DataDestinationMode = "app" | "web";

export const DATA_DESTINATION_SELECTION_LIMIT = 7;

export interface DataDestinationTrendOption {
  key: string;
  identityKeys: string[];
  exeName?: string;
  classificationCategory?: AppCategory;
  unclassified?: boolean;
  displayName: string;
  secondaryText: string;
  iconUrl: string | null;
  totalDuration: number;
  percentage: number;
  averageDuration: number;
  activeDayCount: number;
}

export interface DataDestinationTrendSeries {
  key: string;
  dataKey: string;
  displayName: string;
  color: string;
}

export interface DataDestinationTrendSummary {
  totalDuration: number;
  averageDuration: number;
  activeDayCount: number;
}

export type DataDestinationSelectionOutcome =
  | "replaced"
  | "added"
  | "removed"
  | "limit-reached"
  | "last-item";

export interface DataDestinationSelectionResult {
  keys: string[];
  outcome: DataDestinationSelectionOutcome;
}

export interface DataDestinationSelectionSnapshot {
  appKeys: string[];
  webKeys: string[];
  mode: DataDestinationMode;
}

function uniqueKeys(keys: readonly string[]) {
  return Array.from(new Set(keys.filter(Boolean)));
}

export function replaceDataDestinationSelection(key: string): DataDestinationSelectionResult {
  return {
    keys: key ? [key] : [],
    outcome: "replaced",
  };
}

export function commitDataDestinationDetailSelection<
  Snapshot extends DataDestinationSelectionSnapshot,
>(
  snapshot: Snapshot,
  mode: DataDestinationMode,
  key: string,
): Snapshot {
  const selectedKeys = replaceDataDestinationSelection(key).keys;
  return {
    ...snapshot,
    mode,
    appKeys: mode === "app" ? selectedKeys : snapshot.appKeys,
    webKeys: mode === "web" ? selectedKeys : snapshot.webKeys,
  };
}

export function buildDataDestinationIconSources(
  appOptions: readonly DataDestinationTrendOption[],
  webOptions: readonly DataDestinationTrendOption[],
): Record<string, string> {
  const entries = [
    ...appOptions.map((option) => ["app", option] as const),
    ...webOptions.map((option) => ["web", option] as const),
  ].flatMap(([mode, option]) => (
    option.iconUrl ? [[`${mode}:${option.key}`, option.iconUrl] as const] : []
  ));
  return Object.fromEntries(entries);
}

export function toggleDataDestinationSelection(
  currentKeys: readonly string[],
  key: string,
  limit = DATA_DESTINATION_SELECTION_LIMIT,
): DataDestinationSelectionResult {
  const keys = uniqueKeys(currentKeys);
  const selectedIndex = keys.indexOf(key);
  if (selectedIndex >= 0) {
    if (keys.length === 1) {
      return { keys, outcome: "last-item" };
    }
    return {
      keys: keys.filter((selectedKey) => selectedKey !== key),
      outcome: "removed",
    };
  }
  if (keys.length >= limit) {
    return { keys, outcome: "limit-reached" };
  }
  return {
    keys: [...keys, key],
    outcome: "added",
  };
}

export function reconcileDataDestinationSelection(
  selectedKeys: readonly string[],
  availableKeys: readonly string[],
): string[] {
  const available = new Set(availableKeys);
  const reconciled = uniqueKeys(selectedKeys).filter((key) => available.has(key))
    .slice(0, DATA_DESTINATION_SELECTION_LIMIT);
  if (reconciled.length > 0 || availableKeys.length === 0) {
    return reconciled;
  }
  return [availableKeys[0]];
}

export function encodeDataDestinationSelectionKey(keys: readonly string[]): string {
  return JSON.stringify(uniqueKeys(keys));
}

export function buildDataDestinationTrendSeries(
  options: readonly DataDestinationTrendOption[],
  resolveColor: (option: DataDestinationTrendOption) => string,
): DataDestinationTrendSeries[] {
  return options.map((option, index) => ({
    key: option.key,
    dataKey: `series${index}`,
    displayName: option.displayName,
    color: resolveColor(option),
  }));
}

export type DataWebTrendPresentation =
  | "hidden"
  | "initial-loading"
  | "ready"
  | "refreshing"
  | "refreshing-stale"
  | "blocking-error"
  | "refresh-error";

interface DataWebTrendPresentationInput {
  webActivityEnabled: boolean;
  mode: DataDestinationMode;
  requestedCacheKey: string | null;
  loadingCacheKey: string | null;
  errorCacheKey: string | null;
  snapshotCacheKey: string | null;
  snapshotCacheVersion: string | null;
  cacheVersion: string;
}

export function resolveDataDestinationMode(
  webActivityEnabled: boolean,
  mode: DataDestinationMode,
): DataDestinationMode {
  return webActivityEnabled ? mode : "app";
}

export function resolveDataWebTrendPresentation({
  webActivityEnabled,
  mode,
  requestedCacheKey,
  loadingCacheKey,
  errorCacheKey,
  snapshotCacheKey,
  snapshotCacheVersion,
  cacheVersion,
}: DataWebTrendPresentationInput): DataWebTrendPresentation {
  if (!webActivityEnabled || mode !== "web" || !requestedCacheKey) {
    return "hidden";
  }

  const hasSnapshot = snapshotCacheKey !== null;
  const hasCurrentSnapshot = hasSnapshot
    && snapshotCacheVersion === cacheVersion
    && snapshotCacheKey === requestedCacheKey;
  const isCurrentRequestLoading = loadingCacheKey === requestedCacheKey;
  const hasCurrentRequestError = errorCacheKey === requestedCacheKey;

  if (hasCurrentRequestError) {
    return hasSnapshot ? "refresh-error" : "blocking-error";
  }
  if (isCurrentRequestLoading) {
    if (!hasSnapshot) return "initial-loading";
    return hasCurrentSnapshot ? "refreshing" : "refreshing-stale";
  }
  if (hasCurrentSnapshot) {
    return "ready";
  }
  if (hasSnapshot) {
    return "refreshing-stale";
  }
  return "initial-loading";
}
