interface TimelineMergeSegment {
  startTime: number;
  endTime: number;
}

interface MergeContiguousTimelineSegmentsOptions<T extends TimelineMergeSegment> {
  mergeThresholdMs: number;
  getKey: (segment: T) => string;
  merge: (current: T, next: T) => T;
}

export function mergeContiguousTimelineSegments<T extends TimelineMergeSegment>(
  segments: readonly T[],
  {
    mergeThresholdMs,
    getKey,
    merge,
  }: MergeContiguousTimelineSegmentsOptions<T>,
): T[] {
  const safeMergeThresholdMs = Number.isFinite(mergeThresholdMs)
    ? Math.max(0, mergeThresholdMs)
    : 0;
  const merged: T[] = [];

  for (const segment of segments) {
    const current = merged[merged.length - 1];
    if (!current) {
      merged.push(segment);
      continue;
    }

    const gapMs = segment.startTime - current.endTime;
    if (
      getKey(segment) === getKey(current)
      && gapMs >= 0
      && gapMs <= safeMergeThresholdMs
    ) {
      merged[merged.length - 1] = merge(current, segment);
      continue;
    }

    merged.push(segment);
  }

  return merged;
}
