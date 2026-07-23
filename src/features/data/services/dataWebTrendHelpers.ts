import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { WebActivitySegment } from "../../../shared/types/webActivity.ts";
import { formatLocalDateKey as toDateKey } from "../../../shared/lib/localDate.ts";

export function isBrowserApp(key: string): boolean {
  const EXE = /^(?:chrome|msedge|brave|opera|vivaldi|arc|chromium|360chromex|thorium|centbrowser|catsxp|firefox|zen|floorp|iceweasel)\.exe$/i;
  return EXE.test(key) || AppClassification.getUserOverride(key)?.category === "browser";
}

export function computeBrowserDurationByPeriodKey(
  buckets: Map<string, { dayDurations: Map<string, number>; monthDurations: Map<string, number> }>,
  monthly: boolean,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [key, b] of buckets) {
    if (!isBrowserApp(key)) continue;
    for (const [k, d] of monthly ? b.monthDurations : b.dayDurations) {
      result.set(k, (result.get(k) ?? 0) + d);
    }
  }
  return result;
}

export function computeWebDurationByPeriodKey(
  segments: WebActivitySegment[],
  startMs: number, endMs: number,
  nowMs: number, monthly: boolean,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const s of segments) {
    const d = Math.max(0, Math.min(endMs, s.endTime ?? nowMs) - Math.max(startMs, s.startTime));
    if (d <= 0) continue;
    const key = toDateKey(new Date(s.startTime));
    const pk = monthly ? key.slice(0, 7) : key;
    result.set(pk, (result.get(pk) ?? 0) + d);
  }
  return result;
}
