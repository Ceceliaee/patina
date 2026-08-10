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

  for (const item of ordered) {
    const current = merged[merged.length - 1];
    if (!current) {
      merged.push({ ...item });
      continue;
    }

    const gapFromCurrent = item.startTime
      - getWebActivityTimelineItemEndTime(current);
    if (
      item.normalizedDomain === current.normalizedDomain
      && gapFromCurrent >= 0
      && gapFromCurrent <= mergeThresholdMs
    ) {
      merged[merged.length - 1] = mergeItems(current, item);
      continue;
    }

    merged.push({ ...item });
  }

  return merged;
}
