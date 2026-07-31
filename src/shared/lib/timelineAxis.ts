const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MIN_EDGE_TICK_GAP_RATIO = 0.05;

const TIMELINE_AXIS_INTERVALS_MS = [
  5 * MINUTE_MS,
  10 * MINUTE_MS,
  15 * MINUTE_MS,
  30 * MINUTE_MS,
  HOUR_MS,
  2 * HOUR_MS,
  3 * HOUR_MS,
  6 * HOUR_MS,
] as const;

export interface TimelineAxisViewport {
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface TimelineAxisTick {
  label: string;
  ratio: number;
}

export function resolveTimelineFocusAtReferenceLocalTime({
  selectedDate,
  referenceTimeMs,
}: {
  selectedDate: Date;
  referenceTimeMs: number;
}) {
  const referenceTime = new Date(
    Number.isFinite(referenceTimeMs)
      ? referenceTimeMs
      : selectedDate.getTime(),
  );
  const focusTime = new Date(selectedDate);
  focusTime.setHours(
    referenceTime.getHours(),
    referenceTime.getMinutes(),
    referenceTime.getSeconds(),
    referenceTime.getMilliseconds(),
  );
  return focusTime.getTime();
}

export function snapTimelineFocusToNearestInterval({
  dayStartMs,
  dayEndMs,
  requestedTimeMs,
  intervalMs,
}: {
  dayStartMs: number;
  dayEndMs: number;
  requestedTimeMs: number;
  intervalMs: number;
}) {
  const safeRequestedTimeMs = Number.isFinite(requestedTimeMs)
    ? requestedTimeMs
    : dayStartMs;
  const safeIntervalMs = Number.isFinite(intervalMs) && intervalMs > 0
    ? intervalMs
    : MINUTE_MS;
  const snappedTimeMs = dayStartMs
    + Math.round(
      (safeRequestedTimeMs - dayStartMs) / safeIntervalMs,
    ) * safeIntervalMs;
  return Math.min(dayEndMs, Math.max(dayStartMs, snappedTimeMs));
}

function clampRatio(value: number) {
  return Math.min(1, Math.max(0, value));
}

function formatAxisLabel(timeMs: number, dayEndMs: number) {
  if (timeMs === dayEndMs) {
    return "24:00";
  }

  const time = new Date(timeMs);
  return `${String(time.getHours()).padStart(2, "0")}:${String(
    time.getMinutes(),
  ).padStart(2, "0")}`;
}

function getAxisIntervalMs(durationMs: number) {
  const targetIntervalMs = durationMs / 4;
  return TIMELINE_AXIS_INTERVALS_MS.find(
    (intervalMs) => intervalMs >= targetIntervalMs,
  ) ?? TIMELINE_AXIS_INTERVALS_MS[TIMELINE_AXIS_INTERVALS_MS.length - 1];
}

export function buildTimelineAxisTicks(
  viewport: TimelineAxisViewport,
  dayStartMs: number,
  dayEndMs: number,
): TimelineAxisTick[] {
  const viewportDurationMs = Math.max(1, viewport.durationMs);
  const intervalMs = getAxisIntervalMs(viewportDurationMs);
  const ticks: TimelineAxisTick[] = [{
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
      ratio < MIN_EDGE_TICK_GAP_RATIO
      || 1 - ratio < MIN_EDGE_TICK_GAP_RATIO
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
