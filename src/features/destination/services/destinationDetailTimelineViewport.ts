import type {
  DestinationDetailActivity,
  DestinationDetailDayViewModel,
  DestinationDetailRecord,
} from "./destinationDetailReadModel.ts";
import {
  buildTimelineAxisTicks,
  resolveTimelineFocusAtReferenceLocalTime,
  snapTimelineFocusToNearestInterval,
  type TimelineAxisTick,
} from "../../../shared/lib/timelineAxis.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const HALF_HOUR_MS = 30 * MINUTE_MS;
const DAY_HOURS = 24;
const MIN_VIEWPORT_HOURS = 1;
const WHEEL_ZOOM_STEP_HOURS = 0.2;
const WHEEL_NOISE_THRESHOLD_PX = 0.5;
const MIN_VISIBLE_TIMELINE_SEGMENT_MS = 30_000;

export const DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS = 24;

export interface DestinationDetailTimelineViewport {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export type DestinationDetailTimelineAxisTick = TimelineAxisTick;

export interface DestinationDetailTimelineSegment {
  id: string;
  startTime: number;
  endTime: number;
  duration: number;
  current: boolean;
  startRatio: number;
  endRatio: number;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampRatio(value: number) {
  return clampNumber(value, 0, 1);
}

function getDayDurationMs(dayStartMs: number, dayEndMs: number) {
  return Math.max(1, dayEndMs - dayStartMs);
}

export function getDestinationDetailZoomDurationMs(
  zoomHours: number,
  dayStartMs: number,
  dayEndMs: number,
) {
  const dayDurationMs = getDayDurationMs(dayStartMs, dayEndMs);
  const safeHours = Number.isFinite(zoomHours) ? zoomHours : DAY_HOURS;
  return clampNumber(
    safeHours * HOUR_MS,
    Math.min(MIN_VIEWPORT_HOURS * HOUR_MS, dayDurationMs),
    dayDurationMs,
  );
}

export function normalizeDestinationDetailTimelineViewport({
  dayStartMs,
  dayEndMs,
  requestedDurationMs,
  requestedStartMs,
}: {
  dayStartMs: number;
  dayEndMs: number;
  requestedDurationMs: number;
  requestedStartMs: number;
}): DestinationDetailTimelineViewport {
  const dayDurationMs = getDayDurationMs(dayStartMs, dayEndMs);
  const durationMs = clampNumber(
    requestedDurationMs,
    Math.min(MIN_VIEWPORT_HOURS * HOUR_MS, dayDurationMs),
    dayDurationMs,
  );
  if (durationMs >= dayDurationMs) {
    return {
      startMs: dayStartMs,
      endMs: dayEndMs,
      durationMs: dayDurationMs,
    };
  }

  const startMs = clampNumber(
    requestedStartMs,
    dayStartMs,
    dayEndMs - durationMs,
  );
  return {
    startMs,
    endMs: startMs + durationMs,
    durationMs,
  };
}

export function getInitialDestinationDetailTimelineViewport(
  day: DestinationDetailDayViewModel,
  referenceTimeMs: number,
  zoomHours = DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS,
) {
  const durationMs = getDestinationDetailZoomDurationMs(
    zoomHours,
    day.dayStartMs,
    day.dayEndMs,
  );
  const referenceFocusMs = resolveTimelineFocusAtReferenceLocalTime({
    selectedDate: new Date(day.dayStartMs),
    referenceTimeMs,
  });
  const snappedFocusMs = snapTimelineFocusToNearestInterval({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedTimeMs: referenceFocusMs,
    intervalMs: HALF_HOUR_MS,
  });

  return normalizeDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: durationMs,
    requestedStartMs: snappedFocusMs - durationMs / 2,
  });
}

export function resizeDestinationDetailTimelineViewport({
  dayStartMs,
  dayEndMs,
  viewport,
  requestedZoomHours,
}: {
  dayStartMs: number;
  dayEndMs: number;
  viewport: DestinationDetailTimelineViewport;
  requestedZoomHours: number;
}) {
  const requestedDurationMs = getDestinationDetailZoomDurationMs(
    requestedZoomHours,
    dayStartMs,
    dayEndMs,
  );
  const focusMs = viewport.startMs + viewport.durationMs / 2;
  return normalizeDestinationDetailTimelineViewport({
    dayStartMs,
    dayEndMs,
    requestedDurationMs,
    requestedStartMs: focusMs - requestedDurationMs / 2,
  });
}

export function getDestinationDetailTimelineWheelZoomHours(
  currentZoomHours: number,
  normalizedDeltaY: number,
) {
  if (!Number.isFinite(currentZoomHours) || !Number.isFinite(normalizedDeltaY)) {
    return currentZoomHours;
  }
  if (Math.abs(normalizedDeltaY) < WHEEL_NOISE_THRESHOLD_PX) {
    return currentZoomHours;
  }
  return clampNumber(
    currentZoomHours + Math.sign(normalizedDeltaY) * WHEEL_ZOOM_STEP_HOURS,
    MIN_VIEWPORT_HOURS,
    DAY_HOURS,
  );
}

export function zoomDestinationDetailTimelineViewportAroundAnchor({
  dayStartMs,
  dayEndMs,
  viewport,
  anchorRatio,
  requestedZoomHours,
}: {
  dayStartMs: number;
  dayEndMs: number;
  viewport: DestinationDetailTimelineViewport;
  anchorRatio: number;
  requestedZoomHours: number;
}) {
  const normalizedAnchorRatio = clampRatio(anchorRatio);
  const requestedDurationMs = getDestinationDetailZoomDurationMs(
    requestedZoomHours,
    dayStartMs,
    dayEndMs,
  );
  const anchorMs = viewport.startMs
    + normalizedAnchorRatio * viewport.durationMs;
  return normalizeDestinationDetailTimelineViewport({
    dayStartMs,
    dayEndMs,
    requestedDurationMs,
    requestedStartMs: anchorMs - normalizedAnchorRatio * requestedDurationMs,
  });
}

export function panDestinationDetailTimelineViewport({
  dayStartMs,
  dayEndMs,
  viewport,
  deltaMs,
}: {
  dayStartMs: number;
  dayEndMs: number;
  viewport: DestinationDetailTimelineViewport;
  deltaMs: number;
}) {
  return normalizeDestinationDetailTimelineViewport({
    dayStartMs,
    dayEndMs,
    requestedDurationMs: viewport.durationMs,
    requestedStartMs: viewport.startMs + (Number.isFinite(deltaMs) ? deltaMs : 0),
  });
}

export function panDestinationDetailTimelineViewportByPixels({
  dayStartMs,
  dayEndMs,
  viewport,
  deltaPx,
  trackWidthPx,
}: {
  dayStartMs: number;
  dayEndMs: number;
  viewport: DestinationDetailTimelineViewport;
  deltaPx: number;
  trackWidthPx: number;
}) {
  if (!Number.isFinite(deltaPx) || !Number.isFinite(trackWidthPx) || trackWidthPx <= 0) {
    return viewport;
  }
  return panDestinationDetailTimelineViewport({
    dayStartMs,
    dayEndMs,
    viewport,
    deltaMs: -(deltaPx / trackWidthPx) * viewport.durationMs,
  });
}

export function buildDestinationDetailTimelineAxisTicks(
  viewport: DestinationDetailTimelineViewport,
  dayStartMs: number,
  dayEndMs: number,
): DestinationDetailTimelineAxisTick[] {
  return buildTimelineAxisTicks(viewport, dayStartMs, dayEndMs);
}

export function buildDestinationDetailTimelineSegments(
  activities: readonly DestinationDetailActivity[],
  viewport: DestinationDetailTimelineViewport,
  minimumDurationMs = MIN_VISIBLE_TIMELINE_SEGMENT_MS,
): DestinationDetailTimelineSegment[] {
  const visibleMinimumDurationMs = Math.max(
    MIN_VISIBLE_TIMELINE_SEGMENT_MS,
    Number.isFinite(minimumDurationMs) ? minimumDurationMs : 0,
  );

  return clipDestinationDetailActivitiesToViewport(activities, viewport)
    .flatMap<DestinationDetailTimelineSegment>((activity) => {
    if (activity.duration < visibleMinimumDurationMs) return [];
    return [{
      id: activity.id,
      startTime: activity.startTime,
      endTime: activity.endTime,
      duration: activity.duration,
      current: activity.current,
      startRatio: clampRatio(
        (activity.startTime - viewport.startMs) / viewport.durationMs,
      ),
      endRatio: clampRatio(
        (activity.endTime - viewport.startMs) / viewport.durationMs,
      ),
    }];
  });
}

function clipRecordToViewport(
  record: DestinationDetailRecord,
  viewport: DestinationDetailTimelineViewport,
) {
  const startTime = Math.max(record.startTime, viewport.startMs);
  const endTime = Math.min(record.endTime, viewport.endMs);
  if (endTime <= startTime) return null;
  return {
    ...record,
    startTime,
    endTime,
    duration: endTime - startTime,
  };
}

export function clipDestinationDetailActivitiesToViewport(
  activities: readonly DestinationDetailActivity[],
  viewport: DestinationDetailTimelineViewport,
) {
  return activities.flatMap<DestinationDetailActivity>((activity) => {
    const records = activity.records
      .map((record) => clipRecordToViewport(record, viewport))
      .filter((record): record is DestinationDetailRecord => Boolean(record));
    if (records.length === 0) return [];
    const detailRecords = activity.detailRecords
      ?.map((record) => clipRecordToViewport(record, viewport))
      .filter((record): record is DestinationDetailRecord => Boolean(record));

    return [{
      ...activity,
      startTime: records[0]?.startTime ?? activity.startTime,
      endTime: records[records.length - 1]?.endTime ?? activity.endTime,
      duration: records.reduce((total, record) => total + record.duration, 0),
      records,
      ...(detailRecords ? { detailRecords } : {}),
    }];
  });
}
