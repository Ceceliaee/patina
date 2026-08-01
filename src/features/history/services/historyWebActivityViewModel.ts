import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type {
  WebActivitySegment,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
import {
  getWebActivityTimelineItemEndTime,
  mergeWebActivityTimelineItemsByDomain,
} from "../../../shared/lib/webActivityTimelineCompiler.ts";
import {
  buildHistoryTimelineViewModelFromSources,
  type HistoryTimelineSourceItem,
  type HistoryTimelineViewport,
  type HistoryTimelineViewModel,
} from "./historyTimelineViewModel.ts";

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
  faviconUrl: string | null;
  startTime: number;
  endTime: number | null;
  duration: number;
  color: string;
  category: AppCategory;
  mergedCount: number;
  titleSamples: string[];
  titleSampleDetails: Array<{
    title: string;
    startTime: number;
    endTime: number | null;
    duration: number;
    isUntitled?: boolean;
  }>;
}

export function isWebDomainIncludedInStatistics(
  normalizedDomain: string,
  overrides: Record<string, WebDomainOverride>,
): boolean {
  return overrides[normalizedDomain]?.enabled !== false;
}

export function filterWebActivitySegmentsForStatistics(
  segments: WebActivitySegment[],
  overrides: Record<string, WebDomainOverride>,
): WebActivitySegment[] {
  return segments.filter((segment) => (
    isWebDomainIncludedInStatistics(segment.normalizedDomain, overrides)
  ));
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

function resolveWebFaviconUrl(
  segment: WebActivitySegment,
  webDomainFavicons: Record<string, string>,
): string | null {
  return preferFaviconUrl(
    webDomainFavicons[segment.normalizedDomain] ?? null,
    segment.faviconUrl,
  );
}

export function buildHistoryWebTimelineViewModel({
  segments,
  selectedDate,
  nowMs,
  overrides = {},
  iconThemeColors = {},
  mergeThresholdSecs = 0,
  viewport,
}: {
  segments: WebActivitySegment[];
  selectedDate: Date;
  nowMs: number;
  overrides?: Record<string, WebDomainOverride>;
  iconThemeColors?: Record<string, string>;
  mergeThresholdSecs?: number;
  viewport?: HistoryTimelineViewport;
}): HistoryTimelineViewModel {
  const sources = buildHistoryWebTimelineSources({
    segments,
    nowMs,
    overrides,
    iconThemeColors,
  });

  return buildHistoryTimelineViewModelFromSources({
    sources,
    selectedDate,
    nowMs,
    mode: "web",
    mergeThresholdSecs,
    viewport,
  });
}

export function buildHistoryWebTimelineSources({
  segments,
  nowMs,
  overrides = {},
  iconThemeColors = {},
}: {
  segments: WebActivitySegment[];
  nowMs: number;
  overrides?: Record<string, WebDomainOverride>;
  iconThemeColors?: Record<string, string>;
}): HistoryTimelineSourceItem[] {
  return filterWebActivitySegmentsForStatistics(segments, overrides)
    .map<HistoryTimelineSourceItem>((segment) => {
      const category = resolveWebCategory(segment.normalizedDomain, overrides);
      const endTime = Math.max(segment.startTime, segment.endTime ?? nowMs);
      const title = segment.title?.trim() ?? "";
      return {
        id: String(segment.id),
        sourceKind: "web",
        sourceKey: segment.normalizedDomain,
        sourceLabel: resolveWebLabel(segment, overrides),
        sourceColor: resolveWebColor(
          segment.normalizedDomain,
          category,
          overrides,
          iconThemeColors,
        ),
        iconKeys: [segment.normalizedDomain],
        category,
        categoryLabel: AppClassification.getCategoryLabel(category),
        categoryColor: AppClassification.getCategoryColor(category),
        fallbackTitle: title,
        startTime: segment.startTime,
        endTime,
        titleSampleDetails: [{
          title,
          startTime: segment.startTime,
          endTime,
          ...(title ? {} : { isUntitled: true }),
        }],
        isLive: segment.endTime === null,
      };
    });
}

function getWebTimelineTitleSample(
  segment: WebActivitySegment,
  clipped: { startTime: number; endTime: number | null; duration: number },
): WebTimelineItem["titleSampleDetails"][number] {
  const title = segment.title?.trim();

  if (title) {
    return {
      title,
      startTime: clipped.startTime,
      endTime: clipped.endTime,
      duration: clipped.duration,
    };
  }

  return {
    title: title ?? "",
    startTime: clipped.startTime,
    endTime: clipped.endTime,
    duration: clipped.duration,
    isUntitled: true,
  };
}

function getWebTitleSampleEndTime(sample: { startTime: number; endTime: number | null }) {
  return sample.endTime ?? sample.startTime;
}

function mergeWebTitleSampleDetails(
  current: WebTimelineItem["titleSampleDetails"],
  next: WebTimelineItem["titleSampleDetails"],
) {
  const sorted = [...current, ...next]
    .filter((sample) => (
      (sample.isUntitled || sample.title.trim())
      && (sample.endTime === null || getWebTitleSampleEndTime(sample) > sample.startTime)
    ))
    .map((sample) => ({ ...sample, title: sample.title.trim() }))
    .sort((left, right) => left.startTime - right.startTime || getWebTitleSampleEndTime(left) - getWebTitleSampleEndTime(right));

  return sorted.reduce<WebTimelineItem["titleSampleDetails"]>((merged, sample) => {
    const previous = merged[merged.length - 1];
    const sameTitleDetail = previous
      && Boolean(previous.isUntitled) === Boolean(sample.isUntitled)
      && (sample.isUntitled || previous.title === sample.title);

    if (sameTitleDetail) {
      previous.endTime = previous.endTime === null || sample.endTime === null
        ? null
        : Math.max(previous.endTime, sample.endTime);
      previous.duration += sample.duration;
      return merged;
    }

    merged.push(sample);
    return merged;
  }, []);
}

function getWebTitleSamples(titleSampleDetails: WebTimelineItem["titleSampleDetails"]) {
  return titleSampleDetails
    .filter((sample) => !sample.isUntitled)
    .map((sample) => sample.title);
}

function mergeWebTimelineItems(current: WebTimelineItem, next: WebTimelineItem): WebTimelineItem {
  const currentEnd = getWebActivityTimelineItemEndTime(current);
  const nextEnd = getWebActivityTimelineItemEndTime(next);
  const titleSampleDetails = mergeWebTitleSampleDetails(
    current.titleSampleDetails,
    next.titleSampleDetails,
  );

  return {
    ...current,
    id: `${current.id}_${next.id}`,
    faviconUrl: preferFaviconUrl(current.faviconUrl, next.faviconUrl),
    startTime: Math.min(current.startTime, next.startTime),
    endTime: current.endTime === null || next.endTime === null ? null : Math.max(currentEnd, nextEnd),
    duration: current.duration + next.duration,
    mergedCount: current.mergedCount + next.mergedCount,
    titleSamples: getWebTitleSamples(titleSampleDetails),
    titleSampleDetails,
  };
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
  webDomainFavicons: Record<string, string> = {},
): WebDomainDistributionItem[] {
  const groups = new Map<string, Omit<WebDomainDistributionItem, "percentage">>();
  let totalDuration = 0;

  for (const segment of segments) {
    if (!isWebDomainIncludedInStatistics(segment.normalizedDomain, overrides)) continue;

    const clipped = clampSegmentToRange(segment, range.startMs, range.endMs, nowMs);
    if (clipped.duration <= 0) continue;

    const key = segment.normalizedDomain;
    const current = groups.get(key);
    totalDuration += clipped.duration;

    if (current) {
      current.duration += clipped.duration;
      current.faviconUrl = preferFaviconUrl(
        current.faviconUrl,
        resolveWebFaviconUrl(segment, webDomainFavicons),
      );
      continue;
    }

    const category = resolveWebCategory(key, overrides);
    const label = resolveWebLabel(segment, overrides);
    const faviconUrl = resolveWebFaviconUrl(segment, webDomainFavicons);
    groups.set(key, {
      key,
      domain: segment.domain || key,
      label,
      duration: clipped.duration,
      color: resolveWebColor(key, category, overrides, iconThemeColors),
      faviconUrl,
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
  webDomainFavicons: Record<string, string> = {},
): WebTimelineItem[] {
  const items = filterWebActivitySegmentsForStatistics(segments, overrides)
    .map((segment) => {
      const clipped = clampSegmentToRange(segment, range.startMs, range.endMs, nowMs);
      if (clipped.duration <= 0) return null;
      const category = resolveWebCategory(segment.normalizedDomain, overrides);
      const titleSample = getWebTimelineTitleSample(segment, clipped);
      const titleSampleDetails: WebTimelineItem["titleSampleDetails"] = [titleSample];
      return {
        id: String(segment.id),
        domain: segment.domain || segment.normalizedDomain,
        normalizedDomain: segment.normalizedDomain,
        label: resolveWebLabel(segment, overrides),
        faviconUrl: resolveWebFaviconUrl(segment, webDomainFavicons),
        startTime: clipped.startTime,
        endTime: clipped.endTime,
        duration: clipped.duration,
        color: resolveWebColor(segment.normalizedDomain, category, overrides, iconThemeColors),
        category,
        mergedCount: 1,
        titleSamples: getWebTitleSamples(titleSampleDetails),
        titleSampleDetails,
      } satisfies WebTimelineItem;
    })
    .filter((item): item is WebTimelineItem => Boolean(item));

  return filterWebTimelineItemsForDisplay(
    mergeWebActivityTimelineItemsByDomain(
      items,
      mergeThresholdSecs,
      mergeWebTimelineItems,
    ),
    minSessionSecs,
  )
    .sort((left, right) => right.startTime - left.startTime);
}
