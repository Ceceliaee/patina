import type {
  DataDestinationDetailActivity,
  DataDestinationDetailDayViewModel,
  DataDestinationDetailRecord,
} from "./dataDestinationDetailReadModel.ts";
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
const DIRECT_MERGE_GAP_MS = 5_000;
const MIN_VISIBLE_TIMELINE_SEGMENT_MS = 30_000;

export const DEFAULT_DATA_DESTINATION_DETAIL_ZOOM_HOURS = 24;

export interface DataDestinationDetailTimelineViewport {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export type DataDestinationDetailTimelineAxisTick = TimelineAxisTick;

export interface DataDestinationDetailTimelineSegment {
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

export function getDataDestinationDetailZoomDurationMs(
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

export function normalizeDataDestinationDetailTimelineViewport({
  dayStartMs,
  dayEndMs,
  requestedDurationMs,
  requestedStartMs,
}: {
  dayStartMs: number;
  dayEndMs: number;
  requestedDurationMs: number;
  requestedStartMs: number;
}): DataDestinationDetailTimelineViewport {
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

export function getInitialDataDestinationDetailTimelineViewport(
  day: DataDestinationDetailDayViewModel,
  referenceTimeMs: number,
  zoomHours = DEFAULT_DATA_DESTINATION_DETAIL_ZOOM_HOURS,
) {
  const durationMs = getDataDestinationDetailZoomDurationMs(
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

  return normalizeDataDestinationDetailTimelineViewport({
    dayStartMs: day.dayStartMs,
    dayEndMs: day.dayEndMs,
    requestedDurationMs: durationMs,
    requestedStartMs: snappedFocusMs - durationMs / 2,
  });
}

export function resizeDataDestinationDetailTimelineViewport({
  dayStartMs,
  dayEndMs,
  viewport,
  requestedZoomHours,
}: {
  dayStartMs: number;
  dayEndMs: number;
  viewport: DataDestinationDetailTimelineViewport;
  requestedZoomHours: number;
}) {
  const requestedDurationMs = getDataDestinationDetailZoomDurationMs(
    requestedZoomHours,
    dayStartMs,
    dayEndMs,
  );
  const focusMs = viewport.startMs + viewport.durationMs / 2;
  return normalizeDataDestinationDetailTimelineViewport({
    dayStartMs,
    dayEndMs,
    requestedDurationMs,
    requestedStartMs: focusMs - requestedDurationMs / 2,
  });
}

export function getDataDestinationDetailTimelineWheelZoomHours(
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

export function zoomDataDestinationDetailTimelineViewportAroundAnchor({
  dayStartMs,
  dayEndMs,
  viewport,
  anchorRatio,
  requestedZoomHours,
}: {
  dayStartMs: number;
  dayEndMs: number;
  viewport: DataDestinationDetailTimelineViewport;
  anchorRatio: number;
  requestedZoomHours: number;
}) {
  const normalizedAnchorRatio = clampRatio(anchorRatio);
  const requestedDurationMs = getDataDestinationDetailZoomDurationMs(
    requestedZoomHours,
    dayStartMs,
    dayEndMs,
  );
  const anchorMs = viewport.startMs
    + normalizedAnchorRatio * viewport.durationMs;
  return normalizeDataDestinationDetailTimelineViewport({
    dayStartMs,
    dayEndMs,
    requestedDurationMs,
    requestedStartMs: anchorMs - normalizedAnchorRatio * requestedDurationMs,
  });
}

export function panDataDestinationDetailTimelineViewport({
  dayStartMs,
  dayEndMs,
  viewport,
  deltaMs,
}: {
  dayStartMs: number;
  dayEndMs: number;
  viewport: DataDestinationDetailTimelineViewport;
  deltaMs: number;
}) {
  return normalizeDataDestinationDetailTimelineViewport({
    dayStartMs,
    dayEndMs,
    requestedDurationMs: viewport.durationMs,
    requestedStartMs: viewport.startMs + (Number.isFinite(deltaMs) ? deltaMs : 0),
  });
}

export function panDataDestinationDetailTimelineViewportByPixels({
  dayStartMs,
  dayEndMs,
  viewport,
  deltaPx,
  trackWidthPx,
}: {
  dayStartMs: number;
  dayEndMs: number;
  viewport: DataDestinationDetailTimelineViewport;
  deltaPx: number;
  trackWidthPx: number;
}) {
  if (!Number.isFinite(deltaPx) || !Number.isFinite(trackWidthPx) || trackWidthPx <= 0) {
    return viewport;
  }
  return panDataDestinationDetailTimelineViewport({
    dayStartMs,
    dayEndMs,
    viewport,
    deltaMs: -(deltaPx / trackWidthPx) * viewport.durationMs,
  });
}

export function buildDataDestinationDetailTimelineAxisTicks(
  viewport: DataDestinationDetailTimelineViewport,
  dayStartMs: number,
  dayEndMs: number,
): DataDestinationDetailTimelineAxisTick[] {
  return buildTimelineAxisTicks(viewport, dayStartMs, dayEndMs);
}

export function buildDataDestinationDetailTimelineSegments(
  activities: readonly DataDestinationDetailActivity[],
  viewport: DataDestinationDetailTimelineViewport,
  minimumDurationMs = MIN_VISIBLE_TIMELINE_SEGMENT_MS,
): DataDestinationDetailTimelineSegment[] {
  const visibleMinimumDurationMs = Math.max(
    MIN_VISIBLE_TIMELINE_SEGMENT_MS,
    Number.isFinite(minimumDurationMs) ? minimumDurationMs : 0,
  );

  return clipDataDestinationDetailActivitiesToViewport(activities, viewport)
    .flatMap((activity) => {
      const merged = activity.records.reduce<Array<{
        id: string;
        startTime: number;
        endTime: number;
        current: boolean;
      }>>((segments, record) => {
        const previous = segments[segments.length - 1];
        const gapMs = previous ? record.startTime - previous.endTime : Number.POSITIVE_INFINITY;
        if (previous && gapMs >= 0 && gapMs <= DIRECT_MERGE_GAP_MS) {
          previous.endTime = Math.max(previous.endTime, record.endTime);
          previous.current = previous.current || record.current;
          return segments;
        }
        segments.push({
          id: `${activity.id}:${record.id}`,
          startTime: record.startTime,
          endTime: record.endTime,
          current: record.current,
        });
        return segments;
      }, []);

      return merged.flatMap<DataDestinationDetailTimelineSegment>((segment) => {
        const duration = segment.endTime - segment.startTime;
        if (duration < visibleMinimumDurationMs) return [];
        return [{
          ...segment,
          duration,
          startRatio: clampRatio(
            (segment.startTime - viewport.startMs) / viewport.durationMs,
          ),
          endRatio: clampRatio(
            (segment.endTime - viewport.startMs) / viewport.durationMs,
          ),
        }];
      });
    });
}

function clipRecordToViewport(
  record: DataDestinationDetailRecord,
  viewport: DataDestinationDetailTimelineViewport,
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

export function clipDataDestinationDetailActivitiesToViewport(
  activities: readonly DataDestinationDetailActivity[],
  viewport: DataDestinationDetailTimelineViewport,
) {
  return activities.flatMap<DataDestinationDetailActivity>((activity) => {
    const records = activity.records
      .map((record) => clipRecordToViewport(record, viewport))
      .filter((record): record is DataDestinationDetailRecord => Boolean(record));
    if (records.length === 0) return [];

    return [{
      ...activity,
      startTime: records[0]?.startTime ?? activity.startTime,
      endTime: records[records.length - 1]?.endTime ?? activity.endTime,
      duration: records.reduce((total, record) => total + record.duration, 0),
      records,
    }];
  });
}
