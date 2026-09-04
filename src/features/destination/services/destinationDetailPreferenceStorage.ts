import { DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS } from "./destinationDetailTimelineViewport.ts";
import { getBrowserLocalStorage } from "../../../platform/browser/browserStorageGateway.ts";

const DESTINATION_DETAIL_TIMELINE_ZOOM_HOURS_KEY =
  "patina:destination-detail-timeline-zoom-hours:v1";
const LEGACY_DETAIL_TIMELINE_ZOOM_HOURS_KEY =
  "patina:data-destination-detail-timeline-zoom-hours:v1";
const DETAIL_MIN_SECS_KEY = "patina:destination-detail-min-secs:v1";
const LEGACY_DETAIL_MIN_SECS_KEY = "patina:data-detail-min-secs";

const DEFAULT_DETAIL_MIN_SECS = 60;
export const DETAIL_MIN_SECS_RANGE = {
  min: 0,
  max: 600,
} as const;

function parseZoomHours(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const zoomHours = Number(value);
  return Number.isFinite(zoomHours) && zoomHours >= 1 && zoomHours <= 24
    ? zoomHours
    : null;
}

function parseMinSecs(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const seconds = Number(value);
  return Number.isInteger(seconds)
    && seconds % 60 === 0
    && seconds >= DETAIL_MIN_SECS_RANGE.min
    && seconds <= DETAIL_MIN_SECS_RANGE.max
    ? seconds
    : null;
}

export function clampDetailMinSecs(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_DETAIL_MIN_SECS;
  }
  return Math.min(
    DETAIL_MIN_SECS_RANGE.max,
    Math.max(
      DETAIL_MIN_SECS_RANGE.min,
      Math.round(value / 60) * 60,
    ),
  );
}

export function readDestinationDetailTimelineZoomHours(): number {
  const storage = getBrowserLocalStorage();
  if (!storage) return DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS;

  try {
    return parseZoomHours(
      storage.getItem(DESTINATION_DETAIL_TIMELINE_ZOOM_HOURS_KEY),
    ) ?? parseZoomHours(
      storage.getItem(LEGACY_DETAIL_TIMELINE_ZOOM_HOURS_KEY),
    ) ?? DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS;
  } catch {
    return DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS;
  }
}

export function rememberDestinationDetailTimelineZoomHours(zoomHours: number) {
  const storage = getBrowserLocalStorage();
  if (!storage || !Number.isFinite(zoomHours) || zoomHours < 1 || zoomHours > 24) {
    return;
  }

  try {
    storage.setItem(
      DESTINATION_DETAIL_TIMELINE_ZOOM_HOURS_KEY,
      String(Number(zoomHours.toFixed(4))),
    );
  } catch {
    // Detail timeline preferences are best-effort; never block the interaction.
  }
}

export function readDetailMinSecs(): number {
  const storage = getBrowserLocalStorage();
  if (!storage) return DEFAULT_DETAIL_MIN_SECS;

  try {
    return parseMinSecs(storage.getItem(DETAIL_MIN_SECS_KEY))
      ?? parseMinSecs(storage.getItem(LEGACY_DETAIL_MIN_SECS_KEY))
      ?? DEFAULT_DETAIL_MIN_SECS;
  } catch {
    return DEFAULT_DETAIL_MIN_SECS;
  }
}

export function saveDetailMinSecs(seconds: number) {
  const storage = getBrowserLocalStorage();
  const normalizedSeconds = parseMinSecs(String(seconds));
  if (!storage || normalizedSeconds === null) return;

  try {
    storage.setItem(DETAIL_MIN_SECS_KEY, String(normalizedSeconds));
  } catch {
    // Detail timeline preferences are best-effort; never block the interaction.
  }
}
