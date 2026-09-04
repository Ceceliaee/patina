import type { WebActivitySegment } from "../types/webActivity.ts";

export interface CompiledWebActivitySegment extends WebActivitySegment {
  endTime: number;
  sourceIds: number[];
  isLive: boolean;
}

export function compileWebActivitySegments(
  segments: readonly WebActivitySegment[],
  startMs: number,
  endMs: number,
  nowMs: number,
): CompiledWebActivitySegment[] {
  const ordered = segments.map((segment) => ({
    ...segment,
    normalizedDomain: segment.normalizedDomain.trim().toLowerCase(),
    startTime: Math.max(startMs, segment.startTime),
    endTime: Math.min(endMs, nowMs, segment.endTime ?? nowMs),
    sourceIds: [segment.id],
    isLive: segment.endTime === null,
  })).filter(segment => Number.isFinite(segment.startTime)
    && Number.isFinite(segment.endTime) && segment.endTime > segment.startTime)
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime || a.id - b.id);
  const previousBySource = new Map<string, CompiledWebActivitySegment>();
  const result: CompiledWebActivitySegment[] = [];
  for (const segment of ordered) {
    const key = JSON.stringify([segment.browserClientId, segment.browserKind,
      segment.browserExeName, segment.normalizedDomain]);
    const previous = previousBySource.get(key);
    if (previous && segment.startTime < previous.endTime) {
      previous.sourceIds = Array.from(new Set([...previous.sourceIds, segment.id]));
      segment.startTime = previous.endTime;
    }
    if (segment.endTime <= segment.startTime) continue;
    segment.duration = segment.endTime - segment.startTime;
    previousBySource.set(key, segment);
    result.push(segment);
  }
  return result.sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime || a.id - b.id);
}

interface WebActivityTimelineMergeItem {
  normalizedDomain: string;
  startTime: number;
  endTime: number | null;
  duration: number;
}

export function getWebActivityTimelineItemEndTime(
  item: WebActivityTimelineMergeItem,
) {
  return item.endTime ?? item.startTime + item.duration;
}

export function mergeWebActivityTimelineItemsByDomain<
  T extends WebActivityTimelineMergeItem,
>(
  items: readonly T[],
  mergeThresholdSecs: number,
  mergeItems: (current: T, next: T) => T,
): T[] {
  if (items.length === 0) return [];

  const mergeThresholdMs = Math.max(0, mergeThresholdSecs) * 1000;
  const ordered = items
    .slice()
    .sort((left, right) => left.startTime - right.startTime);
  const merged: T[] = [];
  const lastGroupByDomain = new Map<string, number>();

  for (const item of ordered) {
    const groupIndex = lastGroupByDomain.get(item.normalizedDomain);
    const current = groupIndex === undefined ? undefined : merged[groupIndex];
    if (!current) {
      merged.push({ ...item });
      lastGroupByDomain.set(item.normalizedDomain, merged.length - 1);
      continue;
    }

    const gapFromCurrent = item.startTime
      - getWebActivityTimelineItemEndTime(current);
    if (
      item.normalizedDomain === current.normalizedDomain
      && gapFromCurrent >= 0
      && gapFromCurrent <= mergeThresholdMs
    ) {
      merged[groupIndex!] = mergeItems(current, item);
      continue;
    }

    merged.push({ ...item });
    lastGroupByDomain.set(item.normalizedDomain, merged.length - 1);
  }

  return merged;
}
