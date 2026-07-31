import {
  addLocalDays,
  parseLocalDateKey,
  toLocalDateKey,
  type ResolvedDataTrendRange,
} from "./dataTrendRange.ts";
import type {
  DataDestinationMode,
  DataDestinationTrendOption,
} from "./dataDestinationState.ts";

export interface DataDestinationDetailTarget {
  mode: DataDestinationMode;
  key: string;
  identityKeys: string[];
  displayName: string;
  secondaryText: string;
  iconUrl: string | null;
  color: string;
}

export interface DataDestinationDetailSelectionSnapshot {
  appKeys: string[];
  webKeys: string[];
  mode: DataDestinationMode;
  listScrollTop: number;
}

function normalizeIdentityKey(value: string) {
  return value.trim().toLowerCase();
}

function uniqueIdentityKeys(keys: readonly string[]) {
  return Array.from(new Set(keys.map(normalizeIdentityKey).filter(Boolean)));
}

export function buildDataDestinationDetailTarget(
  mode: DataDestinationMode,
  option: DataDestinationTrendOption,
  color: string,
): DataDestinationDetailTarget {
  const normalizedKey = normalizeIdentityKey(option.key);
  const identityKeys = uniqueIdentityKeys(
    option.identityKeys.length > 0 ? option.identityKeys : [option.key],
  );

  return {
    mode,
    key: normalizedKey,
    identityKeys: identityKeys.length > 0 ? identityKeys : [normalizedKey],
    displayName: option.displayName.trim() || option.key,
    secondaryText: option.secondaryText.trim() || option.key,
    iconUrl: option.iconUrl,
    color,
  };
}

export function createDataDestinationDetailSelectionSnapshot({
  appKeys,
  webKeys,
  mode,
  listScrollTop,
}: {
  appKeys: readonly string[];
  webKeys: readonly string[];
  mode: DataDestinationMode;
  listScrollTop: number;
}): DataDestinationDetailSelectionSnapshot {
  return {
    appKeys: [...appKeys],
    webKeys: [...webKeys],
    mode,
    listScrollTop: Math.max(0, listScrollTop),
  };
}

export function selectDataDestinationDetailSnapshotTarget(
  snapshot: DataDestinationDetailSelectionSnapshot,
  mode: DataDestinationMode,
  targetKey: string,
): DataDestinationDetailSelectionSnapshot {
  return {
    appKeys: mode === "app" ? [targetKey] : [...snapshot.appKeys],
    webKeys: mode === "web" ? [targetKey] : [...snapshot.webKeys],
    mode: snapshot.mode,
    listScrollTop: snapshot.listScrollTop,
  };
}

export function isDateKeyInResolvedRange(
  dateKey: string | null,
  range: ResolvedDataTrendRange,
): dateKey is string {
  return Boolean(
    dateKey
    && parseLocalDateKey(dateKey)
    && dateKey >= range.startDateKey
    && dateKey <= range.endDateKey,
  );
}

export function isDataDestinationDetailDateKeyAvailable(
  dateKey: string | null,
  nowMs: number = Date.now(),
): dateKey is string {
  return Boolean(
    dateKey
    && parseLocalDateKey(dateKey)
    && dateKey <= toLocalDateKey(new Date(nowMs)),
  );
}

export function resolveDataDestinationFocusedDateKey({
  activeDateKeys,
  previousDateKey,
  range,
  nowMs = Date.now(),
}: {
  activeDateKeys: readonly string[];
  previousDateKey: string | null;
  range: ResolvedDataTrendRange;
  nowMs?: number;
}): string {
  if (isDataDestinationDetailDateKeyAvailable(previousDateKey, nowMs)) {
    return previousDateKey;
  }

  const todayKey = toLocalDateKey(new Date(nowMs));
  const orderedActiveDates = activeDateKeys
    .filter((dateKey) => (
      isDateKeyInResolvedRange(dateKey, range)
      && dateKey <= todayKey
    ))
    .sort();
  const latestActiveDate = orderedActiveDates[orderedActiveDates.length - 1];

  return latestActiveDate ?? (
    range.endDateKey <= todayKey ? range.endDateKey : todayKey
  );
}

export function getAdjacentDataDestinationFocusedDateKey(
  focusedDateKey: string,
  delta: -1 | 1,
  nowMs: number = Date.now(),
): string | null {
  const focusedDate = parseLocalDateKey(focusedDateKey);
  if (!focusedDate) return null;
  const nextDateKey = toLocalDateKey(addLocalDays(focusedDate, delta));
  return isDataDestinationDetailDateKeyAvailable(nextDateKey, nowMs)
    ? nextDateKey
    : null;
}

export function encodeDataDestinationDetailDayRequestKey(
  target: DataDestinationDetailTarget,
  focusedDateKey: string,
  cacheVersion: string,
) {
  return [
    target.mode,
    target.key,
    focusedDateKey,
    cacheVersion,
  ].join(":");
}
