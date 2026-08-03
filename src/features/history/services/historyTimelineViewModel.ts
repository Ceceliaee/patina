import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler.ts";
import {
  buildTimelineAxisTicks,
  snapTimelineFocusToNearestInterval,
  type TimelineAxisTick,
} from "../../../shared/lib/timelineAxis.ts";
import { mergeContiguousTimelineSegments } from "../../../shared/lib/timelineSegmentMerge.ts";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const HALF_HOUR_MS = 30 * MINUTE_MS;
const MINUTE_BOUNDARY_SNAP_MS = 1_000;
const MIN_VISIBLE_TIMELINE_SEGMENT_MS = 30_000;

export type HistoryTimelineDisplayMode = "app" | "category" | "web";
export type HistoryTimelineSourceKind = "app" | "web";
export type HistoryTimelineZoomHours = number;
export const DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS: HistoryTimelineZoomHours = 4;
export const MIN_HISTORY_TIMELINE_VIEWPORT_DURATION_MS = HOUR_MS;
export const MAX_HISTORY_TIMELINE_VIEWPORT_DURATION_MS = DAY_MS;

export interface HistoryTimelineViewport {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export type HistoryTimelineAxisTick = TimelineAxisTick;

export interface HistoryTimelineTitleSample {
  title: string;
  secondaryText?: string | null;
  startTime: number;
  endTime: number;
  isUntitled?: boolean;
}

export interface HistoryTimelineSourceItem {
  id: string;
  sourceKind: HistoryTimelineSourceKind;
  sourceKey: string;
  sourceLabel: string;
  sourceColor: string;
  iconKeys: string[];
  category: AppCategory;
  categoryLabel: string;
  categoryColor: string;
  fallbackTitle: string;
  startTime: number;
  endTime: number;
  titleSampleDetails: HistoryTimelineTitleSample[];
  isLive: boolean;
}

export interface HistoryTimelineSegment {
  id: string;
  sourceId: string;
  timelineKey: string;
  sourceKind: HistoryTimelineSourceKind;
  sourceKey: string;
  sourceLabel: string;
  label: string;
  color: string;
  iconKeys: string[];
  category: AppCategory;
  categoryLabel: string;
  categoryColor: string;
  startTime: number;
  endTime: number;
  duration: number;
  startRatio: number;
  endRatio: number;
  widthRatio: number;
  titleSamples: string[];
  titleSampleDetails: HistoryTimelineTitleSample[];
  alternateLabels: string[];
  isLive: boolean;
}

export interface HistoryTimelineLegendItem {
  key: string;
  label: string;
  duration: number;
  percentage: number;
  color: string;
  category: AppCategory;
}

export interface HistoryTimelineLane {
  key: string;
  label: string;
  duration: number;
  color: string;
  iconKeys: string[];
  category: AppCategory;
  segments: HistoryTimelineSegment[];
}

export interface HistoryTimelineViewModel {
  segments: HistoryTimelineSegment[];
  lanes: HistoryTimelineLane[];
  legendItems: HistoryTimelineLegendItem[];
  axisTicks: HistoryTimelineAxisTick[];
  dayStartMs: number;
  dayEndMs: number;
  viewportStartMs: number;
  viewportEndMs: number;
  viewportDurationMs: number;
  zoomHours: number;
  visibleEndMs: number;
  visibleEndRatio: number;
}

interface BuildHistoryTimelineViewModelParams {
  sessions: CompiledSession[];
  selectedDate: Date;
  nowMs: number;
  mode: Exclude<HistoryTimelineDisplayMode, "web">;
  iconThemeColors?: Record<string, string>;
  mergeThresholdSecs?: number;
  viewport?: HistoryTimelineViewport;
}

interface BuildHistoryTimelineViewModelFromSourcesParams {
  sources: HistoryTimelineSourceItem[];
  selectedDate: Date;
  nowMs: number;
  mode: HistoryTimelineDisplayMode;
  mergeThresholdSecs?: number;
  viewport?: HistoryTimelineViewport;
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

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function getHistoryTimelineZoomDurationMs(zoomHours: number) {
  if (!Number.isFinite(zoomHours)) {
    return MAX_HISTORY_TIMELINE_VIEWPORT_DURATION_MS;
  }

  return clampNumber(
    zoomHours * HOUR_MS,
    MIN_HISTORY_TIMELINE_VIEWPORT_DURATION_MS,
    MAX_HISTORY_TIMELINE_VIEWPORT_DURATION_MS,
  );
}

export function normalizeHistoryTimelineViewport({
  selectedDate,
  requestedDurationMs,
  requestedStartMs,
}: {
  selectedDate: Date;
  requestedDurationMs?: number | null;
  requestedStartMs?: number | null;
}): HistoryTimelineViewport {
  const { dayStartMs, dayEndMs } = getFullDayRange(selectedDate);
  const safeRequestedDurationMs = typeof requestedDurationMs === "number"
    && Number.isFinite(requestedDurationMs)
    ? requestedDurationMs
    : MAX_HISTORY_TIMELINE_VIEWPORT_DURATION_MS;
  const durationMs = clampNumber(
    safeRequestedDurationMs,
    MIN_HISTORY_TIMELINE_VIEWPORT_DURATION_MS,
    dayEndMs - dayStartMs,
  );

  if (durationMs >= dayEndMs - dayStartMs) {
    return {
      startMs: dayStartMs,
      endMs: dayEndMs,
      durationMs: dayEndMs - dayStartMs,
    };
  }

  const maxStartMs = dayEndMs - durationMs;
  const safeRequestedStartMs = typeof requestedStartMs === "number" && Number.isFinite(requestedStartMs)
    ? requestedStartMs
    : dayStartMs;
  const startMs = clampNumber(safeRequestedStartMs, dayStartMs, maxStartMs);

  return {
    startMs,
    endMs: startMs + durationMs,
    durationMs,
  };
}

export function snapHistoryTimelineFocusToNearestHalfHour({
  selectedDate,
  requestedTimeMs,
}: {
  selectedDate: Date;
  requestedTimeMs: number;
}) {
  const { dayStartMs, dayEndMs } = getFullDayRange(selectedDate);
  return snapTimelineFocusToNearestInterval({
    dayStartMs,
    dayEndMs,
    requestedTimeMs,
    intervalMs: HALF_HOUR_MS,
  });
}

export function normalizeHistoryTimelineViewportAroundFocus({
  selectedDate,
  durationMs,
  focusTimeMs,
}: {
  selectedDate: Date;
  durationMs: number;
  focusTimeMs: number;
}) {
  const focusMs = snapHistoryTimelineFocusToNearestHalfHour({
    selectedDate,
    requestedTimeMs: focusTimeMs,
  });
  return normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: durationMs,
    requestedStartMs: focusMs - durationMs / 2,
  });
}

export function zoomHistoryTimelineViewportAroundAnchor({
  selectedDate,
  viewport,
  anchorRatio,
  requestedDurationMs,
}: {
  selectedDate: Date;
  viewport: HistoryTimelineViewport;
  anchorRatio: number;
  requestedDurationMs: number;
}) {
  const safeAnchorRatio = clampRatio(anchorRatio);
  const anchorTimeMs = viewport.startMs + safeAnchorRatio * viewport.durationMs;
  const durationMs = clampNumber(
    Number.isFinite(requestedDurationMs) ? requestedDurationMs : viewport.durationMs,
    MIN_HISTORY_TIMELINE_VIEWPORT_DURATION_MS,
    MAX_HISTORY_TIMELINE_VIEWPORT_DURATION_MS,
  );

  return normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: durationMs,
    requestedStartMs: anchorTimeMs - safeAnchorRatio * durationMs,
  });
}

export function panHistoryTimelineViewport({
  selectedDate,
  viewport,
  deltaMs,
}: {
  selectedDate: Date;
  viewport: HistoryTimelineViewport;
  deltaMs: number;
}) {
  return normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: viewport.durationMs,
    requestedStartMs: viewport.startMs + (Number.isFinite(deltaMs) ? deltaMs : 0),
  });
}

export function panHistoryTimelineViewportForKey({
  selectedDate,
  viewport,
  key,
}: {
  selectedDate: Date;
  viewport: HistoryTimelineViewport;
  key: string;
}): HistoryTimelineViewport | null {
  const { dayStartMs, dayEndMs } = getFullDayRange(selectedDate);
  const panStepMs = viewport.durationMs / 10;
  const deltaMs = key === "ArrowLeft"
    ? -panStepMs
    : key === "ArrowRight"
      ? panStepMs
      : key === "Home"
        ? dayStartMs - viewport.startMs
        : key === "End"
          ? dayEndMs - viewport.endMs
          : null;

  return deltaMs === null
    ? null
    : panHistoryTimelineViewport({ selectedDate, viewport, deltaMs });
}

export function panHistoryTimelineViewportByPixels({
  selectedDate,
  viewport,
  deltaPx,
  trackWidthPx,
}: {
  selectedDate: Date;
  viewport: HistoryTimelineViewport;
  deltaPx: number;
  trackWidthPx: number;
}) {
  if (!Number.isFinite(deltaPx) || !Number.isFinite(trackWidthPx) || trackWidthPx <= 0) {
    return viewport;
  }

  return panHistoryTimelineViewport({
    selectedDate,
    viewport,
    deltaMs: -(deltaPx / trackWidthPx) * viewport.durationMs,
  });
}

function resolveVisibleEndMs(selectedDate: Date, nowMs: number, dayStartMs: number, dayEndMs: number) {
  const nowDate = new Date(nowMs);
  const selectedIsToday = selectedDate.toDateString() === nowDate.toDateString();
  if (!selectedIsToday) {
    return dayEndMs;
  }

  return Math.min(dayEndMs, Math.max(dayStartMs, nowMs));
}

function resolveAppSourceColor(
  session: CompiledSession,
  iconThemeColors: Record<string, string>,
) {
  const overrideColor = AppClassification.getUserOverride(session.appKey)?.color
    ?? AppClassification.getUserOverride(session.exeName)?.color;
  const mapped = AppClassification.mapApp(session.appKey, { appName: session.displayName });

  return overrideColor
    ?? iconThemeColors[session.appKey]
    ?? iconThemeColors[session.exeName]
    ?? mapped.color;
}

export function buildAppTimelineSources(
  sessions: CompiledSession[],
  iconThemeColors: Record<string, string>,
): HistoryTimelineSourceItem[] {
  return sessions.map((session) => {
    const mapped = AppClassification.mapApp(session.appKey, { appName: session.displayName });
    return {
      id: String(session.id),
      sourceKind: "app",
      sourceKey: session.appKey,
      sourceLabel: session.displayName,
      sourceColor: resolveAppSourceColor(session, iconThemeColors),
      iconKeys: Array.from(new Set([session.exeName, session.appKey].filter(Boolean))),
      category: mapped.category,
      categoryLabel: AppClassification.getCategoryLabel(mapped.category),
      categoryColor: AppClassification.getCategoryColor(mapped.category),
      fallbackTitle: session.displayTitle,
      startTime: session.startTime,
      endTime: Math.max(session.startTime, session.endTime ?? session.startTime),
      titleSampleDetails: session.titleSampleDetails.map((sample) => ({ ...sample })),
      isLive: session.isLive,
    } satisfies HistoryTimelineSourceItem;
  });
}

function clipTitleSampleDetails(
  source: HistoryTimelineSourceItem,
  clippedStart: number,
  clippedEnd: number,
) {
  const details = source.titleSampleDetails
    .map((sample) => ({
      title: sample.title,
      ...(sample.secondaryText ? { secondaryText: sample.secondaryText } : {}),
      startTime: Math.max(sample.startTime, clippedStart),
      endTime: Math.min(sample.endTime, clippedEnd),
      ...(sample.isUntitled ? { isUntitled: true } : {}),
    }))
    .filter((sample) => (
      (sample.isUntitled || sample.title.trim())
      && sample.endTime > sample.startTime
    ));

  if (details.length > 0) {
    return details;
  }

  const fallbackTitle = source.fallbackTitle.trim();
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
      ...(sample.secondaryText ? { secondaryText: sample.secondaryText } : {}),
      startTime: Math.max(sample.startTime, clippedStart),
      endTime: Math.min(sample.endTime, clippedEnd),
      ...(sample.isUntitled ? { isUntitled: true } : {}),
    }))
    .filter((sample) => (
      (sample.isUntitled || sample.title.trim())
      && sample.endTime > sample.startTime
    ));
}

function buildSegment(
  source: HistoryTimelineSourceItem,
  dayStartMs: number,
  dayEndMs: number,
  visibleEndMs: number,
  viewport: HistoryTimelineViewport,
): HistoryTimelineSegment | null {
  const clippedStart = Math.max(source.startTime, dayStartMs, viewport.startMs);
  const clippedEnd = Math.min(source.endTime, dayEndMs, visibleEndMs, viewport.endMs);

  if (clippedEnd <= clippedStart) {
    return null;
  }

  const viewportDurationMs = Math.max(1, viewport.endMs - viewport.startMs);
  const startRatio = clampRatio((clippedStart - viewport.startMs) / viewportDurationMs);
  const endRatio = clampRatio((clippedEnd - viewport.startMs) / viewportDurationMs);
  const titleSampleDetails = clipTitleSampleDetails(source, clippedStart, clippedEnd);

  return {
    id: `${source.id}-${clippedStart}-${clippedEnd}`,
    sourceId: source.id,
    timelineKey: `${source.sourceKind}:${source.sourceKey}`,
    sourceKind: source.sourceKind,
    sourceKey: source.sourceKey,
    sourceLabel: source.sourceLabel,
    label: source.sourceLabel,
    color: source.sourceColor,
    iconKeys: source.iconKeys,
    category: source.category,
    categoryLabel: source.categoryLabel,
    categoryColor: source.categoryColor,
    startTime: clippedStart,
    endTime: clippedEnd,
    duration: clippedEnd - clippedStart,
    startRatio,
    endRatio,
    widthRatio: Math.max(0, endRatio - startRatio),
    titleSamples: titleSampleDetails
      .filter((sample) => !sample.isUntitled)
      .map((sample) => sample.title),
    titleSampleDetails,
    alternateLabels: [],
    isLive: source.isLive,
  };
}

function mergeTitleSampleDetails(
  current: HistoryTimelineSegment["titleSampleDetails"],
  next: HistoryTimelineSegment["titleSampleDetails"],
) {
  const sorted = [...current, ...next]
    .filter((sample) => (
      (sample.isUntitled || sample.title.trim())
      && sample.endTime > sample.startTime
    ))
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);

  return sorted.reduce<HistoryTimelineSegment["titleSampleDetails"]>((merged, sample) => {
    const previous = merged[merged.length - 1];
    const sameTitle = previous
      && Boolean(previous.isUntitled) === Boolean(sample.isUntitled)
      && (sample.isUntitled || previous.title === sample.title)
      && previous.secondaryText === sample.secondaryText;
    if (sameTitle && sample.startTime <= previous.endTime) {
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
    id: `${current.id}_${next.sourceId}-${next.endTime}`,
    endTime,
    duration: current.duration + next.duration,
    startRatio,
    endRatio,
    widthRatio: Math.max(0, endRatio - startRatio),
    titleSamples: titleSampleDetails
      .filter((sample) => !sample.isUntitled)
      .map((sample) => sample.title),
    titleSampleDetails,
    alternateLabels: mergeAlternateLabels(current.alternateLabels, next.alternateLabels),
    isLive: current.isLive || next.isLive,
  };
}

function resolveTimelineKey(segment: HistoryTimelineSegment, mode: HistoryTimelineDisplayMode) {
  return mode === "category"
    ? `category:${segment.category}`
    : `${segment.sourceKind}:${segment.sourceKey}`;
}

interface MinuteTimelineItem {
  key: string;
  sourceKind: HistoryTimelineSourceKind;
  sourceKey: string;
  sourceLabel: string;
  sourceColor: string;
  iconKeys: string[];
  category: AppCategory;
  categoryLabel: string;
  categoryColor: string;
  duration: number;
  firstSeenAt: number;
  sourceIds: string[];
  titleSampleDetails: HistoryTimelineSegment["titleSampleDetails"];
  isLive: boolean;
}

interface MinuteTimelineBucket {
  startTime: number;
  endTime: number;
  activeStartTime: number | null;
  activeEndTime: number | null;
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
    activeStartTime: null,
    activeEndTime: null,
    items: new Map<string, MinuteTimelineItem>(),
  };
  buckets.set(minuteStart, bucket);
  return bucket;
}

function snapToMinuteBoundary(value: number, boundary: number) {
  return Math.abs(value - boundary) <= MINUTE_BOUNDARY_SNAP_MS ? boundary : value;
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
  const visibleOverlapStart = snapToMinuteBoundary(overlapStart, bucket.startTime);
  const visibleOverlapEnd = snapToMinuteBoundary(overlapEnd, bucket.endTime);

  bucket.activeStartTime = bucket.activeStartTime === null
    ? visibleOverlapStart
    : Math.min(bucket.activeStartTime, visibleOverlapStart);
  bucket.activeEndTime = bucket.activeEndTime === null
    ? visibleOverlapEnd
    : Math.max(bucket.activeEndTime, visibleOverlapEnd);

  if (existing) {
    existing.duration += overlapEnd - overlapStart;
    existing.firstSeenAt = Math.min(existing.firstSeenAt, overlapStart);
    existing.sourceIds = Array.from(new Set([
      ...existing.sourceIds,
      segment.sourceId,
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
    sourceKind: segment.sourceKind,
    sourceKey: segment.sourceKey,
    sourceLabel: segment.sourceLabel,
    sourceColor: segment.color,
    iconKeys: segment.iconKeys,
    category: segment.category,
    categoryLabel: segment.categoryLabel,
    categoryColor: segment.categoryColor,
    duration: overlapEnd - overlapStart,
    firstSeenAt: overlapStart,
    sourceIds: [segment.sourceId],
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
  return mode === "category" ? item.categoryLabel : item.sourceLabel;
}

function getItemColor(item: MinuteTimelineItem, mode: HistoryTimelineDisplayMode) {
  return mode === "category" ? item.categoryColor : item.sourceColor;
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
  viewportStartMs: number,
  viewportDurationMs: number,
  mode: HistoryTimelineDisplayMode,
) {
  const dominant = selectDominantMinuteItem(bucket);
  const startTime = bucket.activeStartTime ?? bucket.startTime;
  const endTime = bucket.activeEndTime ?? bucket.endTime;
  if (!dominant || endTime <= startTime) {
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
  const titleSamples = dominant.titleSampleDetails
    .filter((sample) => !sample.isUntitled)
    .map((sample) => sample.title);
  const startRatio = clampRatio((startTime - viewportStartMs) / viewportDurationMs);
  const endRatio = clampRatio((endTime - viewportStartMs) / viewportDurationMs);

  return {
    id: `${dominant.key}-${bucket.startTime}-${bucket.endTime}`,
    sourceId: dominant.sourceIds[0] ?? dominant.key,
    timelineKey: dominant.key,
    sourceKind: dominant.sourceKind,
    sourceKey: dominant.sourceKey,
    sourceLabel: dominant.sourceLabel,
    label: getItemLabel(dominant, mode),
    color: getItemColor(dominant, mode),
    iconKeys: mode === "category" ? [] : dominant.iconKeys,
    category: dominant.category,
    categoryLabel: dominant.categoryLabel,
    categoryColor: dominant.categoryColor,
    startTime,
    endTime,
    duration: dominant.duration,
    startRatio,
    endRatio,
    widthRatio: Math.max(0, endRatio - startRatio),
    titleSamples,
    titleSampleDetails: dominant.titleSampleDetails,
    alternateLabels,
    isLive: dominant.isLive,
  } satisfies HistoryTimelineSegment;
}

function mergeContiguousDominantMinuteSegments(
  segments: HistoryTimelineSegment[],
  mergeThresholdMs: number,
) {
  return mergeContiguousTimelineSegments(segments, {
    mergeThresholdMs,
    getKey: (segment) => segment.timelineKey,
    merge: mergeAdjacentTimelineSegments,
  });
}

function keepVisibleTimelineSegments(segments: HistoryTimelineSegment[]) {
  return segments.filter((segment) => segment.duration >= MIN_VISIBLE_TIMELINE_SEGMENT_MS);
}

function buildDominantMinuteSegments(
  segments: HistoryTimelineSegment[],
  dayStartMs: number,
  visibleEndMs: number,
  viewport: HistoryTimelineViewport,
  mode: HistoryTimelineDisplayMode,
  mergeThresholdMs: number,
) {
  const viewportDurationMs = Math.max(1, viewport.endMs - viewport.startMs);
  const timelineEndMs = Math.min(visibleEndMs, viewport.endMs);
  const minuteSegments = buildMinuteBuckets(segments, dayStartMs, timelineEndMs, mode)
    .map((bucket) => buildMinuteSegment(bucket, viewport.startMs, viewportDurationMs, mode))
    .filter((segment): segment is HistoryTimelineSegment => Boolean(segment));

  return keepVisibleTimelineSegments(
    mergeContiguousDominantMinuteSegments(minuteSegments, mergeThresholdMs),
  );
}

function buildLegendItems(
  segments: HistoryTimelineSegment[],
  mode: HistoryTimelineDisplayMode,
): HistoryTimelineLegendItem[] {
  const totalDuration = segments.reduce((total, segment) => total + segment.duration, 0);
  const groups = new Map<string, HistoryTimelineLegendItem>();

  for (const segment of segments) {
    const key = mode === "category" ? segment.category : segment.sourceKey;
    const existing = groups.get(key);

    if (existing) {
      existing.duration += segment.duration;
      continue;
    }

    groups.set(key, {
      key,
      label: segment.label,
      duration: segment.duration,
      percentage: 0,
      color: segment.color,
      category: segment.category,
    });
  }

  return Array.from(groups.values())
    .map((item) => ({
      ...item,
      percentage: totalDuration > 0 ? (item.duration / totalDuration) * 100 : 0,
    }))
    .sort((a, b) => b.duration - a.duration);
}

function buildTimelineLanes(
  segments: HistoryTimelineSegment[],
  mode: HistoryTimelineDisplayMode,
): HistoryTimelineLane[] {
  const lanes = new Map<string, HistoryTimelineLane>();

  for (const segment of segments) {
    const key = mode === "category" ? segment.category : segment.sourceKey;
    const existing = lanes.get(key);
    if (existing) {
      existing.duration += segment.duration;
      existing.segments.push(segment);
      continue;
    }

    lanes.set(key, {
      key,
      label: segment.label,
      duration: segment.duration,
      color: segment.color,
      iconKeys: segment.iconKeys,
      category: segment.category,
      segments: [segment],
    });
  }

  return Array.from(lanes.values()).sort((left, right) => (
    right.duration - left.duration
    || left.label.localeCompare(right.label)
    || left.key.localeCompare(right.key)
  ));
}

export function buildHistoryTimelineViewModelFromSources({
  sources,
  selectedDate,
  nowMs,
  mode,
  mergeThresholdSecs = 0,
  viewport: requestedViewport,
}: BuildHistoryTimelineViewModelFromSourcesParams): HistoryTimelineViewModel {
  const { dayStartMs, dayEndMs } = getFullDayRange(selectedDate);
  const viewport = requestedViewport ?? normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: MAX_HISTORY_TIMELINE_VIEWPORT_DURATION_MS,
    requestedStartMs: dayStartMs,
  });
  const visibleEndMs = resolveVisibleEndMs(selectedDate, nowMs, dayStartMs, dayEndMs);
  const mergeThresholdMs = Math.max(0, mergeThresholdSecs) * 1000;
  const rawSegments = sources
    .map((source) => buildSegment(source, dayStartMs, dayEndMs, visibleEndMs, viewport))
    .filter((segment): segment is HistoryTimelineSegment => Boolean(segment))
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
  const segments = buildDominantMinuteSegments(
    rawSegments,
    dayStartMs,
    visibleEndMs,
    viewport,
    mode,
    mergeThresholdMs,
  );
  const viewportDurationMs = Math.max(1, viewport.durationMs);

  return {
    segments,
    lanes: buildTimelineLanes(segments, mode),
    legendItems: buildLegendItems(segments, mode),
    axisTicks: buildTimelineAxisTicks(viewport, dayStartMs, dayEndMs),
    dayStartMs,
    dayEndMs,
    viewportStartMs: viewport.startMs,
    viewportEndMs: viewport.endMs,
    viewportDurationMs,
    zoomHours: viewportDurationMs / HOUR_MS,
    visibleEndMs,
    visibleEndRatio: clampRatio((visibleEndMs - dayStartMs) / DAY_MS),
  };
}

export function buildHistoryTimelineViewModel({
  sessions,
  selectedDate,
  nowMs,
  mode,
  iconThemeColors = {},
  mergeThresholdSecs = 0,
  viewport,
}: BuildHistoryTimelineViewModelParams): HistoryTimelineViewModel {
  return buildHistoryTimelineViewModelFromSources({
    sources: buildAppTimelineSources(sessions, iconThemeColors),
    selectedDate,
    nowMs,
    mode,
    mergeThresholdSecs,
    viewport,
  });
}
