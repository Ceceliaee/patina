import {
  DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS,
  type HistoryTimelineDisplayMode,
} from "./historyTimelineViewModel.ts";

const HISTORY_TIMELINE_MODE_KEY = "patina:history-timeline-mode";
const HISTORY_DAY_DISTRIBUTION_MODE_KEY = "patina:history-day-distribution-mode";
const HISTORY_TIMELINE_ZOOM_HOURS_KEY = "patina:history-timeline-zoom-hours";

export type DayDistributionMode = "app" | "category" | "web";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isDayDistributionMode(value: string | null): value is DayDistributionMode {
  return value === "app" || value === "category" || value === "web";
}

function isHistoryTimelineMode(value: string | null): value is HistoryTimelineDisplayMode {
  return value === "app" || value === "category";
}

function parseHistoryTimelineZoomHours(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 1 && numericValue <= 24
    ? numericValue
    : null;
}

export function readHistoryTimelineMode(): HistoryTimelineDisplayMode {
  const storage = getStorage();
  if (!storage) return "app";

  try {
    const value = storage.getItem(HISTORY_TIMELINE_MODE_KEY);
    return isHistoryTimelineMode(value) ? value : "app";
  } catch {
    return "app";
  }
}

export function rememberHistoryTimelineMode(mode: HistoryTimelineDisplayMode) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(HISTORY_TIMELINE_MODE_KEY, mode);
  } catch {
    // History layout preferences are best-effort; never block the interaction.
  }
}

export function readHistoryTimelineZoomHours(): number {
  const storage = getStorage();
  if (!storage) return DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS;

  try {
    return parseHistoryTimelineZoomHours(storage.getItem(HISTORY_TIMELINE_ZOOM_HOURS_KEY))
      ?? DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS;
  } catch {
    return DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS;
  }
}

export function rememberHistoryTimelineZoomHours(zoomHours: number) {
  const storage = getStorage();
  if (!storage || !Number.isFinite(zoomHours) || zoomHours < 1 || zoomHours > 24) return;

  try {
    storage.setItem(HISTORY_TIMELINE_ZOOM_HOURS_KEY, String(Number(zoomHours.toFixed(4))));
  } catch {
    // History layout preferences are best-effort; never block the interaction.
  }
}

export function readHistoryDayDistributionMode(): DayDistributionMode {
  const storage = getStorage();
  if (!storage) return "app";

  try {
    const value = storage.getItem(HISTORY_DAY_DISTRIBUTION_MODE_KEY);
    return isDayDistributionMode(value) ? value : "app";
  } catch {
    return "app";
  }
}

export function rememberHistoryDayDistributionMode(mode: DayDistributionMode) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(HISTORY_DAY_DISTRIBUTION_MODE_KEY, mode);
  } catch {
    // History layout preferences are best-effort; never block the interaction.
  }
}

export function resolveEffectiveDayDistributionMode(
  mode: DayDistributionMode,
  webActivityEnabled: boolean,
): DayDistributionMode {
  return !webActivityEnabled && mode === "web" ? "app" : mode;
}
