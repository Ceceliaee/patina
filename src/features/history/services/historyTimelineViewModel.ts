import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export type HistoryTimelineDisplayMode = "app" | "category";

export interface HistoryTimelineAxisTick {
  label: string;
  ratio: number;
}

export interface HistoryTimelineSegment {
  id: string;
  sourceSessionId: number;
  timelineKey: string;
  appKey: string;
  exeName: string;
  displayName: string;
  displayTitle: string;
  category: AppCategory;
  categoryLabel: string;
  startTime: number;
  endTime: number;
  duration: number;
  startRatio: number;
  endRatio: number;
  widthRatio: number;
  titleSamples: string[];
  titleSampleDetails: Array<{
    title: string;
    startTime: number;
    endTime: number;
  }>;
  alternateLabels: string[];
  isLive: boolean;
}

export interface HistoryTimelineLegendItem {
  key: string;
  label: string;
  duration: number;
  percentage: number;
  category: AppCategory;
  exeName: string;
}

export interface HistoryTimelineViewModel {
  segments: HistoryTimelineSegment[];
  legendItems: HistoryTimelineLegendItem[];
  axisTicks: HistoryTimelineAxisTick[];
  dayStartMs: number;
  dayEndMs: number;
  visibleEndMs: number;
  visibleEndRatio: number;
}

interface BuildHistoryTimelineViewModelParams {
  sessions: CompiledSession[];
  selectedDate: Date;
  nowMs: number;
  mode: HistoryTimelineDisplayMode;
  mergeThresholdSecs?: number;
}

function getFullDayRange(date: Date) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  return {
    dayStartMs: dayStart.getTime(),
    dayEndMs: dayStart.getTime() + DAY_MS,
  };
}

function clampRatio(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function formatAxisLabel(hour: number) {
  return `${String(hour).padStart(2, "0")}:00`;
}

function buildAxisTicks(): HistoryTimelineAxisTick[] {
  return [0, 6, 12, 18, 24].map((hour) => ({
    label: formatAxisLabel(hour),
    ratio: hour / 24,
  }));
}

function resolveVisibleEndMs(selectedDate: Date, nowMs: number, dayStartMs: number, dayEndMs: number) {
  const nowDate = new Date(nowMs);
  const selectedIsToday = selectedDate.toDateString() === nowDate.toDateString();
  if (!selectedIsToday) {
    return dayEndMs;
  }

  return Math.min(dayEndMs, Math.max(dayStartMs, nowMs));
}

function clipTitleSampleDetails(
  session: CompiledSession,
  clippedStart: number,
  clippedEnd: number,
) {
  const details = session.titleSampleDetails
    .map((sample) => ({
      title: sample.title,
      startTime: Math.max(sample.startTime, clippedStart),
      endTime: Math.min(sample.endTime, clippedEnd),
    }))
    .filter((sample) => sample.title.trim() && sample.endTime > sample.startTime);

  if (details.length > 0) {
    return details;
  }

  const fallbackTitle = session.displayTitle.trim();
  if (!fallbackTitle) {
    return [];
  }

  return [{
    title: fallbackTitle,
    startTime: clippedStart,
    endTime: clippedEnd,
  }];
}

function clipSegmentTitleSampleDetails(
  segment: HistoryTimelineSegment,
  clippedStart: number,
  clippedEnd: number,
) {
  return segment.titleSampleDetails
    .map((sample) => ({
      title: sample.title,
      startTime: Math.max(sample.startTime, clippedStart),
      endTime: Math.min(sample.endTime, clippedEnd),
    }))
    .filter((sample) => sample.title.trim() && sample.endTime > sample.startTime);
}

function buildSegment(
  session: CompiledSession,
  dayStartMs: number,
  dayEndMs: number,
  visibleEndMs: number,
): HistoryTimelineSegment | null {
  const rawEndTime = Math.max(session.startTime, session.endTime ?? session.startTime);
  const clippedStart = Math.max(session.startTime, dayStartMs);
  const clippedEnd = Math.min(rawEndTime, dayEndMs, visibleEndMs);

  if (clippedEnd <= clippedStart) {
    return null;
  }

  const mapped = AppClassification.mapApp(session.appKey, { appName: session.displayName });
  const startRatio = clampRatio((clippedStart - dayStartMs) / DAY_MS);
  const endRatio = clampRatio((clippedEnd - dayStartMs) / DAY_MS);
  const titleSampleDetails = clipTitleSampleDetails(session, clippedStart, clippedEnd);

  return {
    id: `${session.id}-${clippedStart}-${clippedEnd}`,
    sourceSessionId: session.id,
    timelineKey: `app:${session.appKey}`,
    appKey: session.appKey,
    exeName: session.exeName,
    displayName: session.displayName,
    displayTitle: session.displayTitle,
    category: mapped.category,
    categoryLabel: AppClassification.getCategoryLabel(mapped.category),
    startTime: clippedStart,
    endTime: clippedEnd,
    duration: clippedEnd - clippedStart,
    startRatio,
    endRatio,
    widthRatio: Math.max(0, endRatio - startRatio),
    titleSamples: titleSampleDetails.map((sample) => sample.title),
    titleSampleDetails,
    alternateLabels: [],
    isLive: session.isLive,
  };
}

function mergeTitleSampleDetails(
  current: HistoryTimelineSegment["titleSampleDetails"],
  next: HistoryTimelineSegment["titleSampleDetails"],
) {
  const sorted = [...current, ...next]
    .filter((sample) => sample.title.trim() && sample.endTime > sample.startTime)
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

  return sorted.reduce<HistoryTimelineSegment["titleSampleDetails"]>((merged, sample) => {
    const previous = merged[merged.length - 1];
    if (previous?.title === sample.title && sample.startTime <= previous.endTime) {
      previous.endTime = Math.max(previous.endTime, sample.endTime);
      return merged;
    }

    merged.push({ ...sample });
    return merged;
  }, []);
}

function mergeAlternateLabels(current: string[], next: string[]) {
  return Array.from(new Set([...current, ...next]));
}

function mergeAdjacentTimelineSegments(
  current: HistoryTimelineSegment,
  next: HistoryTimelineSegment,
): HistoryTimelineSegment {
  const endTime = Math.max(current.endTime, next.endTime);
  const startRatio = Math.min(current.startRatio, next.startRatio);
  const endRatio = Math.max(current.endRatio, next.endRatio);
  const titleSampleDetails = mergeTitleSampleDetails(
    current.titleSampleDetails,
    next.titleSampleDetails,
  );

  return {
    ...current,
    id: `${current.id}_${next.sourceSessionId}-${next.endTime}`,
    endTime,
    duration: current.duration + next.duration,
    startRatio,
    endRatio,
    widthRatio: Math.max(0, endRatio - startRatio),
    titleSamples: titleSampleDetails.map((sample) => sample.title),
    titleSampleDetails,
    alternateLabels: mergeAlternateLabels(current.alternateLabels, next.alternateLabels),
    isLive: current.isLive || next.isLive,
  };
}

function resolveTimelineKey(segment: HistoryTimelineSegment, mode: HistoryTimelineDisplayMode) {
  return mode === "category" ? `category:${segment.category}` : `app:${segment.appKey}`;
}

interface MinuteTimelineItem {
  key: string;
  appKey: string;
  exeName: string;
  displayName: string;
  displayTitle: string;
  category: AppCategory;
  categoryLabel: string;
  duration: number;
  firstSeenAt: number;
  sourceSessionIds: number[];
  titleSampleDetails: HistoryTimelineSegment["titleSampleDetails"];
  isLive: boolean;
}

interface MinuteTimelineBucket {
  startTime: number;
  endTime: number;
  items: Map<string, MinuteTimelineItem>;
}

function getMinuteStart(timeMs: number, dayStartMs: number) {
  return dayStartMs + Math.floor((timeMs - dayStartMs) / MINUTE_MS) * MINUTE_MS;
}

function getOrCreateMinuteBucket(
  buckets: Map<number, MinuteTimelineBucket>,
  minuteStart: number,
  visibleEndMs: number,
) {
  const existing = buckets.get(minuteStart);
  if (existing) {
    return existing;
  }

  const bucket = {
    startTime: minuteStart,
    endTime: Math.min(minuteStart + MINUTE_MS, visibleEndMs),
    items: new Map<string, MinuteTimelineItem>(),
  };
  buckets.set(minuteStart, bucket);
  return bucket;
}

function addSegmentOverlapToMinuteBucket(
  bucket: MinuteTimelineBucket,
  segment: HistoryTimelineSegment,
  mode: HistoryTimelineDisplayMode,
  overlapStart: number,
  overlapEnd: number,
) {
  const key = resolveTimelineKey(segment, mode);
  const existing = bucket.items.get(key);
  const titleSampleDetails = clipSegmentTitleSampleDetails(segment, overlapStart, overlapEnd);

  if (existing) {
    existing.duration += overlapEnd - overlapStart;
    existing.firstSeenAt = Math.min(existing.firstSeenAt, overlapStart);
    existing.sourceSessionIds = Array.from(new Set([
      ...existing.sourceSessionIds,
      segment.sourceSessionId,
    ]));
    existing.titleSampleDetails = mergeTitleSampleDetails(
      existing.titleSampleDetails,
      titleSampleDetails,
    );
    existing.isLive = existing.isLive || segment.isLive;
    return;
  }

  bucket.items.set(key, {
    key,
    appKey: segment.appKey,
    exeName: segment.exeName,
    displayName: segment.displayName,
    displayTitle: segment.displayTitle,
    category: segment.category,
    categoryLabel: segment.categoryLabel,
    duration: overlapEnd - overlapStart,
    firstSeenAt: overlapStart,
    sourceSessionIds: [segment.sourceSessionId],
    titleSampleDetails,
    isLive: segment.isLive,
  });
}

function buildMinuteBuckets(
  segments: HistoryTimelineSegment[],
  dayStartMs: number,
  visibleEndMs: number,
  mode: HistoryTimelineDisplayMode,
) {
  const buckets = new Map<number, MinuteTimelineBucket>();

  for (const segment of segments) {
    let minuteStart = getMinuteStart(segment.startTime, dayStartMs);

    while (minuteStart < segment.endTime && minuteStart < visibleEndMs) {
      const bucket = getOrCreateMinuteBucket(buckets, minuteStart, visibleEndMs);
      const overlapStart = Math.max(segment.startTime, bucket.startTime);
      const overlapEnd = Math.min(segment.endTime, bucket.endTime);

      if (overlapEnd > overlapStart) {
        addSegmentOverlapToMinuteBucket(bucket, segment, mode, overlapStart, overlapEnd);
      }

      minuteStart += MINUTE_MS;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.startTime - b.startTime);
}

function getItemLabel(item: MinuteTimelineItem, mode: HistoryTimelineDisplayMode) {
  return mode === "category" ? item.categoryLabel : item.displayName;
}

function selectDominantMinuteItem(bucket: MinuteTimelineBucket) {
  return Array.from(bucket.items.values()).sort((left, right) => (
    right.duration - left.duration
    || left.firstSeenAt - right.firstSeenAt
    || left.key.localeCompare(right.key)
  ))[0];
}

function buildMinuteSegment(
  bucket: MinuteTimelineBucket,
  dayStartMs: number,
  mode: HistoryTimelineDisplayMode,
) {
  const dominant = selectDominantMinuteItem(bucket);
  if (!dominant) {
    return null;
  }

  const alternateLabels = Array.from(bucket.items.values())
    .filter((item) => item.key !== dominant.key)
    .sort((left, right) => (
      right.duration - left.duration
      || left.firstSeenAt - right.firstSeenAt
      || left.key.localeCompare(right.key)
    ))
    .map((item) => getItemLabel(item, mode));
  const titleSamples = dominant.titleSampleDetails.map((sample) => sample.title);
  const startRatio = clampRatio((bucket.startTime - dayStartMs) / DAY_MS);
  const endRatio = clampRatio((bucket.endTime - dayStartMs) / DAY_MS);

  return {
    id: `${dominant.key}-${bucket.startTime}-${bucket.endTime}`,
    sourceSessionId: dominant.sourceSessionIds[0] ?? 0,
    timelineKey: dominant.key,
    appKey: dominant.appKey,
    exeName: dominant.exeName,
    displayName: dominant.displayName,
    displayTitle: dominant.displayTitle,
    category: dominant.category,
    categoryLabel: dominant.categoryLabel,
    startTime: bucket.startTime,
    endTime: bucket.endTime,
    duration: bucket.endTime - bucket.startTime,
    startRatio,
    endRatio,
    widthRatio: Math.max(0, endRatio - startRatio),
    titleSamples,
    titleSampleDetails: dominant.titleSampleDetails,
    alternateLabels,
    isLive: dominant.isLive,
  } satisfies HistoryTimelineSegment;
}

function mergeContiguousDominantMinuteSegments(segments: HistoryTimelineSegment[]) {
  const merged: HistoryTimelineSegment[] = [];

  for (const segment of segments) {
    const current = merged[merged.length - 1];
    if (!current) {
      merged.push(segment);
      continue;
    }

    if (segment.timelineKey === current.timelineKey && segment.startTime === current.endTime) {
      merged[merged.length - 1] = mergeAdjacentTimelineSegments(current, segment);
      continue;
    }

    merged.push(segment);
  }

  return merged;
}

function buildDominantMinuteSegments(
  segments: HistoryTimelineSegment[],
  dayStartMs: number,
  visibleEndMs: number,
  mode: HistoryTimelineDisplayMode,
) {
  const minuteSegments = buildMinuteBuckets(segments, dayStartMs, visibleEndMs, mode)
    .map((bucket) => buildMinuteSegment(bucket, dayStartMs, mode))
    .filter((segment): segment is HistoryTimelineSegment => Boolean(segment));

  return mergeContiguousDominantMinuteSegments(minuteSegments);
}

function buildLegendItems(
  segments: HistoryTimelineSegment[],
  mode: HistoryTimelineDisplayMode,
): HistoryTimelineLegendItem[] {
  const totalDuration = segments.reduce((total, segment) => total + segment.duration, 0);
  const groups = new Map<string, HistoryTimelineLegendItem>();

  for (const segment of segments) {
    const key = mode === "category" ? segment.category : segment.appKey;
    const existing = groups.get(key);

    if (existing) {
      existing.duration += segment.duration;
      continue;
    }

    groups.set(key, {
      key,
      label: mode === "category" ? segment.categoryLabel : segment.displayName,
      duration: segment.duration,
      percentage: 0,
      category: segment.category,
      exeName: segment.exeName,
    });
  }

  return Array.from(groups.values())
    .map((item) => ({
      ...item,
      percentage: totalDuration > 0 ? (item.duration / totalDuration) * 100 : 0,
    }))
    .sort((a, b) => b.duration - a.duration);
}

export function buildHistoryTimelineViewModel({
  sessions,
  selectedDate,
  nowMs,
  mode,
}: BuildHistoryTimelineViewModelParams): HistoryTimelineViewModel {
  const { dayStartMs, dayEndMs } = getFullDayRange(selectedDate);
  const visibleEndMs = resolveVisibleEndMs(selectedDate, nowMs, dayStartMs, dayEndMs);
  const rawSegments = sessions
    .map((session) => buildSegment(session, dayStartMs, dayEndMs, visibleEndMs))
    .filter((segment): segment is HistoryTimelineSegment => Boolean(segment))
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  const segments = buildDominantMinuteSegments(rawSegments, dayStartMs, visibleEndMs, mode);

  return {
    segments,
    legendItems: buildLegendItems(segments, mode),
    axisTicks: buildAxisTicks(),
    dayStartMs,
    dayEndMs,
    visibleEndMs,
    visibleEndRatio: clampRatio((visibleEndMs - dayStartMs) / DAY_MS),
  };
}
