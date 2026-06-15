import type { HistoryTimelineDisplayMode } from "./historyTimelineViewModel.ts";

const HISTORY_TIMELINE_MODE_KEY = "patina:history-timeline-mode";
const HISTORY_DAY_DISTRIBUTION_MODE_KEY = "patina:history-day-distribution-mode";

export type DayDistributionMode = "app" | "category" | "web";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isDayDistributionMode(value: string | null): value is DayDistributionMode {
  return value === "app" || value === "category" || value === "web";
}

function isHistoryTimelineMode(value: string | null): value is HistoryTimelineDisplayMode {
  return value === "app" || value === "category";
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
