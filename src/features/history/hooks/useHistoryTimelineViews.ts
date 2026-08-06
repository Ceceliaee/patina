import { useMemo } from "react";
import type { UiText } from "../../../shared/i18n/generated/contract.ts";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler.ts";
import type {
  WebActivitySegment,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
import {
  buildAppTimelineSources,
  buildHistoryTimelineViewModelFromSources,
  type HistoryTimelineDisplayMode,
  type HistoryTimelineSourceItem,
  type HistoryTimelineViewport,
} from "../services/historyTimelineViewModel.ts";
import { buildHistoryWebTimelineSources } from "../services/historyWebActivityViewModel.ts";
import type { HistoryContentState } from "./useHistorySnapshotRuntime.ts";

const EMPTY_TIMELINE_SOURCES: HistoryTimelineSourceItem[] = [];

interface Params {
  sessions: CompiledSession[];
  webSegments: WebActivitySegment[];
  selectedDate: Date;
  nowMs: number;
  mode: HistoryTimelineDisplayMode;
  appIconThemeColors: Record<string, string>;
  webIconThemeColors: Record<string, string>;
  webDomainOverrides: Record<string, WebDomainOverride>;
  mergeThresholdSecs: number;
  showQuietPlaceholder: boolean;
  viewport: HistoryTimelineViewport;
  uiText: UiText;
}

export function shouldHideTimelineContent({
  showQuietPlaceholder,
  contentState,
  sessionCount,
  aggregateCount,
  mode,
  webDataReady,
}: {
  showQuietPlaceholder: boolean;
  contentState: HistoryContentState;
  sessionCount: number;
  aggregateCount: number;
  mode: HistoryTimelineDisplayMode;
  webDataReady: boolean;
}) {
  return showQuietPlaceholder
    || (contentState === "bootstrap" && sessionCount === 0 && aggregateCount > 0)
    || (mode === "web" && !webDataReady);
}

export function useHistoryTimelineViews({
  sessions,
  webSegments,
  selectedDate,
  nowMs,
  mode,
  appIconThemeColors,
  webIconThemeColors,
  webDomainOverrides,
  mergeThresholdSecs,
  showQuietPlaceholder,
  viewport,
  uiText,
}: Params) {
  const appSources = useMemo(
    () => buildAppTimelineSources(sessions, appIconThemeColors, uiText),
    [appIconThemeColors, sessions, uiText],
  );
  const webSources = useMemo(
    () => buildHistoryWebTimelineSources({
      segments: webSegments,
      nowMs,
      overrides: webDomainOverrides,
      iconThemeColors: webIconThemeColors,
      uiText,
    }),
    [nowMs, webDomainOverrides, webIconThemeColors, webSegments, uiText],
  );
  const sources = mode === "web" ? webSources : appSources;
  const visibleSources = showQuietPlaceholder ? EMPTY_TIMELINE_SOURCES : sources;

  const fullDayView = useMemo(() => (
    buildHistoryTimelineViewModelFromSources({
      sources: visibleSources,
      selectedDate,
      nowMs,
      mode,
      mergeThresholdSecs,
    })
  ), [mergeThresholdSecs, mode, nowMs, selectedDate, visibleSources]);
  const zoomView = useMemo(() => (
    buildHistoryTimelineViewModelFromSources({
      sources: visibleSources,
      selectedDate,
      nowMs,
      mode,
      mergeThresholdSecs,
      viewport,
    })
  ), [mergeThresholdSecs, mode, nowMs, selectedDate, viewport, visibleSources]);

  return { fullDayView, zoomView };
}
