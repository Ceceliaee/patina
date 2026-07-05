import type { View } from "../types/view";

export const LONG_BACKGROUND_DELAY_MS = 5 * 60 * 1000;

const RETURN_HOME_SOURCE_VIEWS = new Set<View>(["data", "history"]);

export interface BackgroundReturnHomeInput {
  backgroundDurationMs: number;
  currentView: View;
  hasDirtyDraft: boolean;
  thresholdMs?: number;
}

export function shouldReturnHomeAfterBackground({
  backgroundDurationMs,
  currentView,
  hasDirtyDraft,
  thresholdMs = LONG_BACKGROUND_DELAY_MS,
}: BackgroundReturnHomeInput): boolean {
  if (backgroundDurationMs < thresholdMs) return false;
  if (hasDirtyDraft) return false;

  return RETURN_HOME_SOURCE_VIEWS.has(currentView);
}
