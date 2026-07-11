import { useCallback, useEffect, useMemo, useState } from "react";
import { queryScreenshots } from "../services/historyScreenshots.ts";
import type { ScreenshotEntry } from "../services/historyScreenshots.ts";
import { buildHistoryAppTimelineViewModel } from "../services/historyAppTimelineViewModel.ts";
import type { HistoryAppTimelineViewModel } from "../services/historyAppTimelineViewModel.ts";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler.ts";

export interface HistoryScreenshotState {
  dayScreenshots: ScreenshotEntry[];
  screenshotsBySessionId: Record<number, ScreenshotEntry[]>;
  appTimelineZoomLevel: number;
  appTimelineViewportStartRatio: number;
  appTimelineView: HistoryAppTimelineViewModel;
  handleAppTimelineZoomChange: (zoomLevel: number, viewportStartRatio: number) => void;
}

export function useHistoryScreenshots(params: {
  selectedDate: Date;
  compiledSessions: CompiledSession[];
  nowMs: number;
  mergeThresholdSecs: number;
  iconThemeColors: Record<string, string>;
}): HistoryScreenshotState {
  const { selectedDate, compiledSessions, nowMs, mergeThresholdSecs, iconThemeColors } = params;

  const [dayScreenshots, setDayScreenshots] = useState<ScreenshotEntry[]>([]);
  const [appTimelineZoomLevel, setAppTimelineZoomLevel] = useState(1);
  const [appTimelineViewportStartRatio, setAppTimelineViewportStartRatio] = useState(0);

  useEffect(() => {
    const start = new Date(selectedDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(selectedDate);
    end.setHours(23, 59, 59, 999);
    queryScreenshots(start.getTime(), end.getTime())
      .then(setDayScreenshots)
      .catch(() => setDayScreenshots([]));
  }, [selectedDate]);

  useEffect(() => {
    setAppTimelineZoomLevel(1);
    setAppTimelineViewportStartRatio(0);
  }, [selectedDate]);

  const screenshotsBySessionId: Record<number, ScreenshotEntry[]> = useMemo(() => {
    const map: Record<number, ScreenshotEntry[]> = {};
    for (const s of dayScreenshots) {
      if (s.sessionId == null) continue;
      (map[s.sessionId] ??= []).push(s);
    }
    return map;
  }, [dayScreenshots]);

  const appTimelineView = useMemo(
    () =>
      buildHistoryAppTimelineViewModel({
        sessions: compiledSessions,
        selectedDate,
        nowMs,
        mergeThresholdSecs,
        iconThemeColors,
        zoomLevel: appTimelineZoomLevel,
        viewportStartRatio: appTimelineViewportStartRatio,
      }),
    [
      compiledSessions,
      iconThemeColors,
      mergeThresholdSecs,
      nowMs,
      selectedDate,
      appTimelineZoomLevel,
      appTimelineViewportStartRatio,
    ],
  );

  const handleAppTimelineZoomChange = useCallback(
    (zoomLevel: number, viewportStartRatio: number) => {
      setAppTimelineZoomLevel(zoomLevel);
      setAppTimelineViewportStartRatio(viewportStartRatio);
    },
    [],
  );

  return {
    dayScreenshots,
    screenshotsBySessionId,
    appTimelineZoomLevel,
    appTimelineViewportStartRatio,
    appTimelineView,
    handleAppTimelineZoomChange,
  };
}
