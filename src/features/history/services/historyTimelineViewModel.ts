import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler.ts";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const HALF_HOUR_MS = 30 * MINUTE_MS;
const MINUTE_BOUNDARY_SNAP_MS = 1_000;
const MIN_VISIBLE_TIMELINE_SEGMENT_MS = 30_000;

export type HistoryTimelineDisplayMode = "app" | "category";
export type HistoryTimelineZoomHours = number;
export const DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS: HistoryTimelineZoomHours = 4;
export const MIN_HISTORY_TIMELINE_VIEWPORT_DURATION_MS = HOUR_MS;
export const MAX_HISTORY_TIMELINE_VIEWPORT_DURATION_MS = DAY_MS;

export interface HistoryTimelineViewport {
  startMs: number;
  endMs: number;
  durationMs: number;
}

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

export interface HistoryTimelineLane {
  key: string;
  label: string;
  duration: number;
  appKey: string;
  exeName: string;
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
  const safeRequestedTimeMs = typeof requestedTimeMs === "number" && Number.isFinite(requestedTimeMs)
    ? requestedTimeMs
    : dayStartMs;
  const snappedTimeMs = dayStartMs
    + Math.round((safeRequestedTimeMs - dayStartMs) / HALF_HOUR_MS) * HALF_HOUR_MS;

  return clampNumber(snappedTimeMs, dayStartMs, dayEndMs);
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

function formatAxisLabel(timeMs: number, dayEndMs: number) {
  if (timeMs === dayEndMs) {
    return "24:00";
  }

  const time = new Date(timeMs);
  return `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`;
}

const HISTORY_TIMELINE_AXIS_INTERVALS_MS = [
  5 * MINUTE_MS,
  10 * MINUTE_MS,
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  HOUR_MS,
  2 * HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
] as const;
const HISTORY_TIMELINE_MIN_EDGE_TICK_GAP_RATIO = 0.05;

function getAxisIntervalMs(durationMs: number) {
  const targetIntervalMs = durationMs / 4;
  return HISTORY_TIMELINE_AXIS_INTERVALS_MS.find((intervalMs) => intervalMs >= targetIntervalMs)
    ?? HISTORY_TIMELINE_AXIS_INTERVALS_MS[HISTORY_TIMELINE_AXIS_INTERVALS_MS.length - 1];
}

function buildAxisTicks(
  viewport: HistoryTimelineViewport,
  dayStartMs: number,
  dayEndMs: number,
): HistoryTimelineAxisTick[] {
  const viewportDurationMs = Math.max(1, viewport.durationMs);
  const intervalMs = getAxisIntervalMs(viewportDurationMs);
  const ticks: HistoryTimelineAxisTick[] = [{
    label: formatAxisLabel(viewport.startMs, dayEndMs),
    ratio: 0,
  }];
  const firstAlignedTickMs = dayStartMs
    + Math.ceil((viewport.startMs - dayStartMs) / intervalMs) * intervalMs;

  for (
    let timeMs = firstAlignedTickMs;
    timeMs < viewport.endMs;
    timeMs += intervalMs
  ) {
    if (timeMs <= viewport.startMs) continue;
    const ratio = clampRatio((timeMs - viewport.startMs) / viewportDurationMs);
    if (
      ratio < HISTORY_TIMELINE_MIN_EDGE_TICK_GAP_RATIO
      || 1 - ratio < HISTORY_TIMELINE_MIN_EDGE_TICK_GAP_RATIO
    ) {
      continue;
    }
    ticks.push({
      label: formatAxisLabel(timeMs, dayEndMs),
      ratio,
    });
  }

  const endLabel = formatAxisLabel(viewport.endMs, dayEndMs);
  const lastTick = ticks[ticks.length - 1];
  if (lastTick?.label === endLabel) {
    ticks[ticks.length - 1] = {
      label: endLabel,
      ratio: 1,
    };
  } else if (!lastTick || lastTick.ratio < 1) {
    ticks.push({
      label: endLabel,
      ratio: 1,
    });
  }

  return ticks;
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
  viewport: HistoryTimelineViewport,
): HistoryTimelineSegment | null {
  const rawEndTime = Math.max(session.startTime, session.endTime ?? session.startTime);
  const clippedStart = Math.max(session.startTime, dayStartMs, viewport.startMs);
  const clippedEnd = Math.min(rawEndTime, dayEndMs, visibleEndMs, viewport.endMs);

  if (clippedEnd <= clippedStart) {
    return null;
  }

  const mapped = AppClassification.mapApp(session.appKey, { appName: session.displayName });
  const viewportDurationMs = Math.max(1, viewport.endMs - viewport.startMs);
  const startRatio = clampRatio((clippedStart - viewport.startMs) / viewportDurationMs);
  const endRatio = clampRatio((clippedEnd - viewport.startMs) / viewportDurationMs);
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
  const titleSamples = dominant.titleSampleDetails.map((sample) => sample.title);
  const startRatio = clampRatio((startTime - viewportStartMs) / viewportDurationMs);
  const endRatio = clampRatio((endTime - viewportStartMs) / viewportDurationMs);

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
  const merged: HistoryTimelineSegment[] = [];

  for (const segment of segments) {
    const current = merged[merged.length - 1];
    if (!current) {
      merged.push(segment);
      continue;
    }

    const gapMs = segment.startTime - current.endTime;
    if (segment.timelineKey === current.timelineKey && gapMs >= 0 && gapMs <= mergeThresholdMs) {
      merged[merged.length - 1] = mergeAdjacentTimelineSegments(current, segment);
      continue;
    }

    merged.push(segment);
  }

  return merged;
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

function buildTimelineLanes(
  segments: HistoryTimelineSegment[],
  mode: HistoryTimelineDisplayMode,
): HistoryTimelineLane[] {
  const lanes = new Map<string, HistoryTimelineLane>();

  for (const segment of segments) {
    const key = mode === "category" ? segment.category : segment.appKey;
    const existing = lanes.get(key);
    if (existing) {
      existing.duration += segment.duration;
      existing.segments.push(segment);
      continue;
    }

    lanes.set(key, {
      key,
      label: mode === "category" ? segment.categoryLabel : segment.displayName,
      duration: segment.duration,
      appKey: segment.appKey,
      exeName: segment.exeName,
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

export function buildHistoryTimelineViewModel({
  sessions,
  selectedDate,
  nowMs,
  mode,
  mergeThresholdSecs = 0,
  viewport: requestedViewport,
}: BuildHistoryTimelineViewModelParams): HistoryTimelineViewModel {
  const { dayStartMs, dayEndMs } = getFullDayRange(selectedDate);
  const viewport = requestedViewport ?? normalizeHistoryTimelineViewport({
    selectedDate,
    requestedDurationMs: MAX_HISTORY_TIMELINE_VIEWPORT_DURATION_MS,
    requestedStartMs: dayStartMs,
  });
  const visibleEndMs = resolveVisibleEndMs(selectedDate, nowMs, dayStartMs, dayEndMs);
  const mergeThresholdMs = Math.max(0, mergeThresholdSecs) * 1000;
  const rawSegments = sessions
    .map((session) => buildSegment(session, dayStartMs, dayEndMs, visibleEndMs, viewport))
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
    axisTicks: buildAxisTicks(viewport, dayStartMs, dayEndMs),
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
