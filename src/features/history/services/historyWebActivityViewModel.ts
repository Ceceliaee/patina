import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type {
  WebActivitySegment,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";

export interface WebDomainDistributionItem {
  key: string;
  domain: string;
  label: string;
  duration: number;
  percentage: number;
  color: string;
  faviconUrl: string | null;
  category: AppCategory;
}

export interface WebTimelineItem {
  id: string;
  domain: string;
  normalizedDomain: string;
  label: string;
  title: string | null;
  url: string | null;
  faviconUrl: string | null;
  startTime: number;
  endTime: number | null;
  duration: number;
  color: string;
  category: AppCategory;
}

function stableDomainColor(normalizedDomain: string) {
  const palette = [
    "#36AC7E",
    "#4790CF",
    "#6F7AE6",
    "#B07E55",
    "#35A69E",
    "#C56A73",
    "#8C6FA1",
  ];
  let hash = 0;
  for (const char of normalizedDomain) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return palette[hash % palette.length];
}

function clampSegmentToRange(segment: WebActivitySegment, startMs: number, endMs: number, nowMs: number) {
  const startTime = Math.max(startMs, segment.startTime);
  const rawEndTime = segment.endTime ?? nowMs;
  const endTime = Math.min(endMs, Math.max(segment.startTime, rawEndTime));
  const duration = Math.max(0, endTime - startTime);
  return {
    startTime,
    endTime: segment.endTime === null ? null : endTime,
    duration,
  };
}

function resolveWebCategory(
  normalizedDomain: string,
  overrides: Record<string, WebDomainOverride>,
): AppCategory {
  return overrides[normalizedDomain]?.category ?? "other";
}

function resolveWebLabel(segment: WebActivitySegment, overrides: Record<string, WebDomainOverride>): string {
  return overrides[segment.normalizedDomain]?.displayName?.trim()
    || segment.domain
    || segment.normalizedDomain;
}

function resolveWebColor(
  normalizedDomain: string,
  category: AppCategory,
  overrides: Record<string, WebDomainOverride>,
  iconThemeColors: Record<string, string>,
): string {
  const overrideColor = overrides[normalizedDomain]?.color;
  if (overrideColor) return overrideColor;
  const iconColor = iconThemeColors[normalizedDomain];
  if (iconColor) return iconColor;
  if (category !== "other") return AppClassification.getCategoryColor(category);
  return stableDomainColor(normalizedDomain);
}

function preferFaviconUrl(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  if (!current.startsWith("data:") && candidate.startsWith("data:")) return candidate;
  return current;
}

function getWebTimelineSubtitle(item: WebTimelineItem) {
  return (item.title || item.url || item.domain).trim();
}

function getWebTimelineMergeKey(item: WebTimelineItem) {
  return `${item.normalizedDomain}\n${getWebTimelineSubtitle(item)}`;
}

function getWebTimelineItemEndTime(item: WebTimelineItem) {
  return item.endTime ?? item.startTime + item.duration;
}

function mergeWebTimelineItems(current: WebTimelineItem, next: WebTimelineItem): WebTimelineItem {
  const currentEnd = getWebTimelineItemEndTime(current);
  const nextEnd = getWebTimelineItemEndTime(next);
  return {
    ...current,
    id: `${current.id}_${next.id}`,
    faviconUrl: preferFaviconUrl(current.faviconUrl, next.faviconUrl),
    startTime: Math.min(current.startTime, next.startTime),
    endTime: current.endTime === null || next.endTime === null ? null : Math.max(currentEnd, nextEnd),
    duration: current.duration + next.duration,
  };
}

function mergeWebTimelineItemsByTitle(
  items: WebTimelineItem[],
  mergeThresholdSecs: number,
) {
  if (items.length === 0) return [];

  const mergeThresholdMs = Math.max(0, mergeThresholdSecs) * 1000;
  const ordered = items.slice().sort((left, right) => left.startTime - right.startTime);
  const merged: WebTimelineItem[] = [];
  let index = 0;

  while (index < ordered.length) {
    let current = { ...ordered[index]! };
    const currentMergeKey = getWebTimelineMergeKey(current);
    let nextIndex = index + 1;

    while (nextIndex < ordered.length) {
      const nextCandidate = ordered[nextIndex]!;
      const previousCandidate = ordered[nextIndex - 1]!;
      const gapToNext = nextCandidate.startTime - getWebTimelineItemEndTime(previousCandidate);

      if (gapToNext > mergeThresholdMs) {
        break;
      }

      if (getWebTimelineMergeKey(nextCandidate) === currentMergeKey) {
        const gapFromCurrent = nextCandidate.startTime - getWebTimelineItemEndTime(current);
        if (gapFromCurrent <= mergeThresholdMs) {
          current = mergeWebTimelineItems(current, nextCandidate);
          index = nextIndex;
          nextIndex += 1;
          continue;
        }

        break;
      }

      nextIndex += 1;
    }

    merged.push(current);
    index += 1;
  }

  return merged;
}

function filterWebTimelineItemsForDisplay(
  items: WebTimelineItem[],
  minSessionSecs: number,
) {
  const minDurationMs = Math.max(0, minSessionSecs) * 1000;
  if (minDurationMs <= 0) {
    return items;
  }

  return items.filter((item) => item.duration >= minDurationMs);
}

export function buildWebDomainDistribution(
  segments: WebActivitySegment[],
  range: { startMs: number; endMs: number },
  nowMs: number,
  overrides: Record<string, WebDomainOverride> = {},
  iconThemeColors: Record<string, string> = {},
): WebDomainDistributionItem[] {
  const groups = new Map<string, Omit<WebDomainDistributionItem, "percentage">>();
  let totalDuration = 0;

  for (const segment of segments) {
    const clipped = clampSegmentToRange(segment, range.startMs, range.endMs, nowMs);
    if (clipped.duration <= 0) continue;

    const key = segment.normalizedDomain;
    const current = groups.get(key);
    totalDuration += clipped.duration;

    if (current) {
      current.duration += clipped.duration;
      current.faviconUrl = preferFaviconUrl(current.faviconUrl, segment.faviconUrl);
      continue;
    }

    const category = resolveWebCategory(key, overrides);
    const label = resolveWebLabel(segment, overrides);
    groups.set(key, {
      key,
      domain: segment.domain || key,
      label,
      duration: clipped.duration,
      color: resolveWebColor(key, category, overrides, iconThemeColors),
      faviconUrl: segment.faviconUrl,
      category,
    });
  }

  return Array.from(groups.values())
    .map((item) => ({
      ...item,
      percentage: totalDuration > 0 ? (item.duration / totalDuration) * 100 : 0,
    }))
    .sort((left, right) => right.duration - left.duration || left.label.localeCompare(right.label));
}

export function buildWebTimelineItems(
  segments: WebActivitySegment[],
  range: { startMs: number; endMs: number },
  nowMs: number,
  overrides: Record<string, WebDomainOverride> = {},
  iconThemeColors: Record<string, string> = {},
  mergeThresholdSecs: number = 0,
  minSessionSecs: number = 0,
): WebTimelineItem[] {
  const items = segments
    .map((segment) => {
      const clipped = clampSegmentToRange(segment, range.startMs, range.endMs, nowMs);
      if (clipped.duration <= 0) return null;
      const category = resolveWebCategory(segment.normalizedDomain, overrides);
      return {
        id: String(segment.id),
        domain: segment.domain || segment.normalizedDomain,
        normalizedDomain: segment.normalizedDomain,
        label: resolveWebLabel(segment, overrides),
        title: segment.title,
        url: segment.url,
        faviconUrl: segment.faviconUrl,
        startTime: clipped.startTime,
        endTime: clipped.endTime,
        duration: clipped.duration,
        color: resolveWebColor(segment.normalizedDomain, category, overrides, iconThemeColors),
        category,
      } satisfies WebTimelineItem;
    })
    .filter((item): item is WebTimelineItem => Boolean(item));

  return filterWebTimelineItemsForDisplay(
    mergeWebTimelineItemsByTitle(items, mergeThresholdSecs),
    minSessionSecs,
  )
    .sort((left, right) => right.startTime - left.startTime);
}
