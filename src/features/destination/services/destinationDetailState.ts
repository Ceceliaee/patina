import {
  addLocalDays,
  formatLocalDateKey,
  parseLocalDateKey,
} from "../../../shared/lib/localDate.ts";
import type { DestinationDetailTarget } from "../types.ts";

export function isDestinationDetailDateKeyAvailable(
  dateKey: string | null,
  nowMs: number = Date.now(),
): dateKey is string {
  return Boolean(
    dateKey
    && parseLocalDateKey(dateKey)
    && dateKey <= formatLocalDateKey(new Date(nowMs)),
  );
}

export function resolveDestinationDetailInitialDateKey(
  dateKey: string,
  nowMs: number = Date.now(),
) {
  return isDestinationDetailDateKeyAvailable(dateKey, nowMs)
    ? dateKey
    : formatLocalDateKey(new Date(nowMs));
}

export function getAdjacentDestinationDetailDateKey(
  focusedDateKey: string,
  delta: -1 | 1,
  nowMs: number = Date.now(),
): string | null {
  const focusedDate = parseLocalDateKey(focusedDateKey);
  if (!focusedDate) return null;
  const nextDateKey = formatLocalDateKey(addLocalDays(focusedDate, delta));
  return isDestinationDetailDateKeyAvailable(nextDateKey, nowMs)
    ? nextDateKey
    : null;
}

export function encodeDestinationDetailDayRequestKey(
  target: DestinationDetailTarget,
  focusedDateKey: string,
  cacheVersion: string,
) {
  return [target.mode, target.key, focusedDateKey, cacheVersion].join(":");
}
