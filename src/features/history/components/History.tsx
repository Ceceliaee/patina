import {
  useState,
  useEffect,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type { CSSProperties } from "react";
import { Clock, Expand, Minus, Plus, Tags, X, ZoomIn } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import {
  formatDuration,
  formatTime,
} from "../services/historyFormatting";
import { useIconThemeColors } from "../../../shared/hooks/useIconThemeColors";
import { useRequestedAppIcons } from "../../../shared/hooks/useRequestedAppIcons.ts";
import {
  buildHistoryReadModel,
  type HistorySnapshot,
  type HistorySnapshotLoadOptions,
} from "../services/historyReadModel";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import HistoryHorizontalTimeline from "./HistoryHorizontalTimeline.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import QuietSegmentedFilter, { type QuietSegmentedFilterOption } from "../../../shared/components/QuietSegmentedFilter";
import type { HourlyActivityChartMode } from "../../../shared/settings/appSettings.ts";
import {
  buildHistoryTimelineViewModel,
  getHistoryTimelineZoomDurationMs,
  MAX_HISTORY_TIMELINE_VIEWPORT_DURATION_MS,
  normalizeHistoryTimelineViewport,
  normalizeHistoryTimelineViewportAroundFocus,
  snapHistoryTimelineFocusToNearestHalfHour,
  type HistoryTimelineDisplayMode,
  type HistoryTimelineViewport,
} from "../services/historyTimelineViewModel.ts";
import {
  useHistoryTimelineViewportInteraction,
  type HistoryTimelineViewportChangeReason,
} from "../hooks/useHistoryTimelineViewportInteraction.ts";
import { useHistorySnapshotRuntime } from "../hooks/useHistorySnapshotRuntime.ts";
import {
  readHistoryDayDistributionMode,
  readHistoryTimelineMode,
  readHistoryTimelineZoomHours,
  rememberHistoryDayDistributionMode,
  rememberHistoryTimelineMode,
  rememberHistoryTimelineZoomHours,
  resolveEffectiveDayDistributionMode,
  type DayDistributionMode,
} from "../services/historyLayoutPreferenceStorage.ts";
import {
  buildWebDomainDistribution,
  buildWebTimelineItems,
} from "../services/historyWebActivityViewModel.ts";
import { loadHistoryIconsForExecutables } from "../services/historyIconService.ts";
import {
  addLocalDays,
  formatLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
  startOfLocalMonth,
} from "../../../shared/lib/localDate.ts";
import HistoryDaySummaryPanel, { type HistoryDaySummaryView } from "./HistoryDaySummaryPanel.tsx";
import HistoryDayDistributionPanel, {
  type HistoryDayDistributionItem,
} from "./HistoryDayDistributionPanel.tsx";
import HistoryTimelineDetailsPopover, {
  type HistoryTimelineDetailsPopoverState,
  type TimelineDetailTitle,
} from "./HistoryTimelineDetailsPopover.tsx";
import {
  HistoryTimelineList,
  HistoryWebTimelineList,
} from "./HistoryTimelineLists.tsx";
import HistoryHourlyActivityPanel from "./HistoryHourlyActivityPanel.tsx";
import HistoryDateNavigator from "./HistoryDateNavigator.tsx";
import HistoryTimelineDialogDateControls from "./HistoryTimelineDialogDateControls.tsx";
import HistoryTimelineZoomDialog from "./HistoryTimelineZoomDialog.tsx";

interface Props {
  icons: Record<string, string>;
  refreshKey?: number;
  refreshIntervalSecs: number;
  mergeThresholdSecs: number;
  minSessionSecs: number;
  onMinSessionSecsChange?: (value: number) => void;
  trackerHealth: TrackerHealthSnapshot;
  getHistorySeedSnapshot: (date: Date) => HistorySnapshot | null;
  loadHistorySnapshot: (
    date: Date,
    rollingDayCount?: number,
    options?: HistorySnapshotLoadOptions,
  ) => Promise<HistorySnapshot>;
  mappingVersion?: number;
  selectedDateRequest?: {
    dateKey: string;
    requestId: number;
  } | null;
  hourlyActivityChartMode: HourlyActivityChartMode;
  onHourlyActivityChartModeChange: (mode: HourlyActivityChartMode) => void;
  refreshEnabled?: boolean;
  webActivityEnabled?: boolean;
  titleRecordingEnabled?: boolean;
}

const TIMELINE_MIN_SESSION_MINUTES_RANGE = { min: 1, max: 10 } as const;
const clampMinute = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const startOfDay = startOfLocalDay;
const startOfMonth = startOfLocalMonth;
const DAY_SUMMARY_EMPTY_MARK = "—";
const DAY_SUMMARY_MIN_SPAN_SESSION_MS = 60_000;
const formatTimelineWindowBoundary = (timeMs: number, dayEndMs: number) => (
  timeMs === dayEndMs ? "24:00" : formatTime(timeMs)
);
const getHistoryTimelineModeActionLabel = (mode: HistoryTimelineDisplayMode) => (
  mode === "category"
    ? UI_TEXT.history.showTimelineByApp
    : UI_TEXT.history.showTimelineByCategory
);
const getHourlyActivityModeActionLabel = (mode: HourlyActivityChartMode) => (
  mode === "category"
    ? UI_TEXT.history.showTotalHourlyActivity
    : UI_TEXT.history.showHourlyActivityByCategory
);
const formatHistoryDateCacheKey = (date: Date) => {
  return formatLocalDateKey(startOfDay(date));
};
type TimelineDialogMode = "app" | "web";
function cleanTimelineDetailTitle(sample: TimelineDetailTitle, appName: string): TimelineDetailTitle {
  if (sample.isUntitled) {
    return sample;
  }

  const normalizedTitle = sample.title.trim();
  const normalizedAppName = appName.trim();
  if (!normalizedTitle || !normalizedAppName) {
    return { ...sample, title: normalizedTitle };
  }

  const suffixPattern = new RegExp(`\\s+-\\s+${normalizedAppName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  return {
    ...sample,
    title: normalizedTitle.replace(suffixPattern, "").trim(),
  };
}

function cleanTimelineDetailTitles(samples: TimelineDetailTitle[], appName: string) {
  return samples
    .map((sample) => cleanTimelineDetailTitle(sample, appName))
    .filter((sample) => sample.isUntitled || sample.title);
}

function resolveTimelineDetailsPopoverPosition(
  anchor: { top: number; bottom: number; centerX: number },
  itemCount: number,
  measuredHeight?: number,
) {
  const popoverHalfWidth = 142;
  const viewportPadding = 12;
  const gap = 8;
  const estimatedHeight = Math.min(260, Math.max(48, 20 + itemCount * 40 + Math.max(0, itemCount - 1) * 6));
  const height = measuredHeight ?? estimatedHeight;
  const boundedHeight = Math.min(height, window.innerHeight - viewportPadding * 2);
  const spaceBelow = window.innerHeight - anchor.bottom - gap - viewportPadding;
  const spaceAbove = anchor.top - gap - viewportPadding;
  const placement: "top" | "bottom" = spaceBelow < height && spaceAbove > spaceBelow ? "top" : "bottom";
  const preferredTop = placement === "top" ? anchor.top - height - gap : anchor.bottom + gap;

  return {
    left: Math.min(
      Math.max(anchor.centerX, popoverHalfWidth + viewportPadding),
      window.innerWidth - popoverHalfWidth - viewportPadding,
    ),
    top: Math.min(
      Math.max(preferredTop, viewportPadding),
      window.innerHeight - boundedHeight - viewportPadding,
    ),
    placement,
  };
}
export default function History({
  icons,
  refreshKey = 0,
  refreshIntervalSecs,
  mergeThresholdSecs,
  minSessionSecs,
  onMinSessionSecsChange,
  trackerHealth,
  getHistorySeedSnapshot,
  loadHistorySnapshot,
  mappingVersion = 0,
  selectedDateRequest = null,
  hourlyActivityChartMode,
  onHourlyActivityChartModeChange,
  refreshEnabled = true,
  webActivityEnabled = false,
  titleRecordingEnabled = true,
}: Props) {
  const requestedInitialDate = selectedDateRequest ? parseLocalDateKey(selectedDateRequest.dateKey) : null;
  const selectedDateRequestId = selectedDateRequest?.requestId ?? null;
  const selectedDateRequestDateKey = selectedDateRequest?.dateKey ?? null;
  const initialDate = requestedInitialDate ?? new Date();
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const calendarPopoverRef = useRef<HTMLDivElement | null>(null);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(initialDate));
  const [calendarPosition, setCalendarPosition] = useState({ left: 0, top: 0 });
  const {
    contentState,
    nowMs,
    rawDaySessions,
    rawDayWebSegments,
    rawWeeklySessions,
    setNowMs,
    snapshotIcons,
    visibleDateKey,
    webDomainFavicons,
    webDomainOverrides,
  } = useHistorySnapshotRuntime({
    getHistorySeedSnapshot,
    loadHistorySnapshot,
    mappingVersion,
    refreshEnabled,
    refreshKey,
    selectedDate,
    titleRecordingEnabled,
    webActivityEnabled,
  });
  const historyIconExeNames = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const session of [...rawDaySessions, ...rawWeeklySessions]) {
      const exeName = session.exeName.trim();
      if (!exeName || seen.has(exeName)) continue;

      seen.add(exeName);
      result.push(exeName);
    }

    return result;
  }, [rawDaySessions, rawWeeklySessions]);
  const baseHistoryIcons = useMemo(() => ({
    ...icons,
    ...snapshotIcons,
  }), [icons, snapshotIcons]);
  const historyIcons = useRequestedAppIcons({
    baseIcons: baseHistoryIcons,
    exeNames: historyIconExeNames,
    loadIcons: loadHistoryIconsForExecutables,
    onError: (error) => {
      console.warn("Failed to refresh history app icons:", error);
    },
  });
  const iconThemeColors = useIconThemeColors(historyIcons);
  const webDomainIcons = useMemo(() => {
    if (!webActivityEnabled) return {};

    const next: Record<string, string> = { ...webDomainFavicons };
    for (const segment of rawDayWebSegments) {
      const faviconUrl = segment.faviconUrl?.trim();
      if (!faviconUrl) continue;

      const current = next[segment.normalizedDomain];
      if (!current || faviconUrl.startsWith("data:")) {
        next[segment.normalizedDomain] = faviconUrl;
      }
    }
    return next;
  }, [rawDayWebSegments, webActivityEnabled, webDomainFavicons]);
  const webDomainIconThemeColors = useIconThemeColors(webDomainIcons);
  const [timelineDialogOpen, setTimelineDialogOpen] = useState(false);
  const [timelineDialogMode, setTimelineDialogMode] = useState<TimelineDialogMode>("app");
  const [timelineDialogSyncedHeight, setTimelineDialogSyncedHeight] = useState<number | null>(null);
  const [timelineZoomDialogOpen, setTimelineZoomDialogOpen] = useState(false);
  const [timelineViewport, setTimelineViewport] = useState<HistoryTimelineViewport>(() => (
    normalizeHistoryTimelineViewport({
      selectedDate: initialDate,
      requestedDurationMs: getHistoryTimelineZoomDurationMs(readHistoryTimelineZoomHours()),
      requestedStartMs: startOfDay(initialDate).getTime(),
    })
  ));
  const [historyTimelineMode, setHistoryTimelineMode] = useState<HistoryTimelineDisplayMode>(
    readHistoryTimelineMode,
  );
  const [dayDistributionMode, setDayDistributionMode] = useState<DayDistributionMode>(
    readHistoryDayDistributionMode,
  );
  const [timelineDetailsPopover, setTimelineDetailsPopover] = useState<HistoryTimelineDetailsPopoverState | null>(null);
  const timelineDialogBodyRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportInteractionRef = useRef<HTMLDivElement | null>(null);
  const timelineDetailsPopoverRef = useRef<HTMLDivElement | null>(null);
  const timelineDetailsTriggerRef = useRef<HTMLElement | null>(null);
  const timelineViewportWasPannedRef = useRef(false);
  const historyCopy = UI_TEXT.history;
  const resetTimelineViewportForDate = useCallback((date: Date) => {
    timelineViewportWasPannedRef.current = false;
    setTimelineViewport(normalizeHistoryTimelineViewport({
      selectedDate: date,
      requestedDurationMs: getHistoryTimelineZoomDurationMs(readHistoryTimelineZoomHours()),
      requestedStartMs: startOfDay(date).getTime(),
    }));
  }, []);

  useEffect(() => {
    if (webActivityEnabled || dayDistributionMode !== "web") return;

    setDayDistributionMode("app");
  }, [dayDistributionMode, webActivityEnabled]);

  useEffect(() => {
    if (webActivityEnabled || timelineDialogMode !== "web") return;

    setTimelineDialogMode("app");
  }, [timelineDialogMode, webActivityEnabled]);

  useEffect(() => {
    if (selectedDateRequestId === null || !selectedDateRequestDateKey) return;
    const nextDate = parseLocalDateKey(selectedDateRequestDateKey);
    if (!nextDate || startOfDay(nextDate) > startOfDay(new Date())) {
      return;
    }

    setSelectedDate(nextDate);
    setCalendarMonth(startOfMonth(nextDate));
    setCalendarOpen(false);
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
  }, [selectedDateRequestDateKey, selectedDateRequestId]);

  const toggleTimelineSessionDetails = useCallback((
    sessionId: number | string,
    appName: string,
    titleSamples: TimelineDetailTitle[],
    trigger: HTMLElement,
  ) => {
    timelineDetailsTriggerRef.current = trigger;
    setTimelineDetailsPopover((current) => {
      if (current?.sessionId === sessionId) {
        timelineDetailsTriggerRef.current = null;
        return null;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const cleanedTitles = cleanTimelineDetailTitles(titleSamples, appName);
      const anchor = {
        top: triggerRect.top,
        bottom: triggerRect.bottom,
        centerX: triggerRect.left + triggerRect.width / 2,
      };
      const position = resolveTimelineDetailsPopoverPosition(anchor, cleanedTitles.length);

      return {
        sessionId,
        titleSamples: cleanedTitles,
        left: position.left,
        top: position.top,
        anchorTop: anchor.top,
        anchorBottom: anchor.bottom,
        anchorCenterX: anchor.centerX,
        placement: position.placement,
      };
    });
  }, []);

  const updateTimelineDetailsPopoverPosition = useCallback(() => {
    const trigger = timelineDetailsTriggerRef.current;
    if (!trigger?.isConnected) return;

    const triggerRect = trigger.getBoundingClientRect();
    const anchor = {
      top: triggerRect.top,
      bottom: triggerRect.bottom,
      centerX: triggerRect.left + triggerRect.width / 2,
    };
    const measuredHeight = timelineDetailsPopoverRef.current?.offsetHeight;

    setTimelineDetailsPopover((current) => {
      if (!current) return current;

      const position = resolveTimelineDetailsPopoverPosition(
        anchor,
        current.titleSamples.length,
        measuredHeight,
      );

      if (
        Math.abs(position.left - current.left) < 1
        && Math.abs(position.top - current.top) < 1
        && Math.abs(anchor.top - current.anchorTop) < 1
        && Math.abs(anchor.bottom - current.anchorBottom) < 1
        && Math.abs(anchor.centerX - current.anchorCenterX) < 1
        && position.placement === current.placement
      ) {
        return current;
      }

      return {
        ...current,
        left: position.left,
        top: position.top,
        anchorTop: anchor.top,
        anchorBottom: anchor.bottom,
        anchorCenterX: anchor.centerX,
        placement: position.placement,
      };
    });
  }, []);

  useLayoutEffect(() => {
    if (!timelineDetailsPopover) return undefined;
    updateTimelineDetailsPopoverPosition();
    return undefined;
  }, [timelineDetailsPopover, updateTimelineDetailsPopoverPosition]);

  useEffect(() => {
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
    resetTimelineViewportForDate(selectedDate);
  }, [resetTimelineViewportForDate, selectedDate]);

  useEffect(() => {
    const hasLiveWebSegment = webActivityEnabled
      && rawDayWebSegments.some((segment) => segment.endTime === null);
    const hasLiveSession = rawDaySessions.some((session) => session.endTime === null)
      || rawWeeklySessions.some((session) => session.endTime === null)
      || hasLiveWebSegment;

    if (!refreshEnabled || !hasLiveSession || trackerHealth.status !== "healthy") {
      return;
    }

    // Keep live durations moving locally so the UI stays fresh without
    // refetching the selected day and weekly range on every timer tick.
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, refreshIntervalSecs * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [rawDaySessions, rawWeeklySessions, rawDayWebSegments, refreshEnabled, refreshIntervalSecs, setNowMs, trackerHealth.status, webActivityEnabled]);

  const changeDate = (delta: number) => {
    const nextDate = addLocalDays(selectedDate, delta);
    if (startOfDay(nextDate) <= startOfDay(new Date())) {
      setSelectedDate(nextDate);
      setCalendarMonth(startOfMonth(nextDate));
    }
  };
  const openDatePicker = () => {
    const triggerRect = datePickerRef.current?.getBoundingClientRect();
    if (triggerRect) {
      const popoverHalfWidth = 118;
      const viewportPadding = 12;
      const centeredLeft = triggerRect.left + triggerRect.width / 2;
      setCalendarPosition({
        left: Math.min(
          Math.max(centeredLeft, popoverHalfWidth + viewportPadding),
          window.innerWidth - popoverHalfWidth - viewportPadding,
        ),
        top: triggerRect.bottom + 8,
      });
    }
    setCalendarMonth(startOfMonth(selectedDate));
    setCalendarOpen((open) => !open);
  };
  const selectCalendarDate = (date: Date) => {
    if (startOfDay(date) > startOfDay(new Date())) return;
    setSelectedDate(date);
    setCalendarMonth(startOfMonth(date));
    setCalendarOpen(false);
  };
  const today = new Date();

  useEffect(() => {
    if (!calendarOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !datePickerRef.current?.contains(target)
        && !calendarPopoverRef.current?.contains(target)
      ) {
        setCalendarOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCalendarOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [calendarOpen]);

  useEffect(() => {
    if (!timelineDetailsPopover) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (timelineDetailsPopoverRef.current?.contains(target)) return;
      if (timelineDetailsTriggerRef.current?.contains(target)) return;
      timelineDetailsTriggerRef.current = null;
      setTimelineDetailsPopover(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        timelineDetailsTriggerRef.current = null;
        setTimelineDetailsPopover(null);
      }
    };
    const handleResize = () => {
      updateTimelineDetailsPopoverPosition();
    };
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && timelineDetailsPopoverRef.current?.contains(target)) return;
      timelineDetailsTriggerRef.current = null;
      setTimelineDetailsPopover(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [timelineDetailsPopover, updateTimelineDetailsPopoverPosition]);

  const isToday = selectedDate.toDateString() === today.toDateString();
  const selectedDateKey = formatHistoryDateCacheKey(selectedDate);
  const hasVisibleSnapshotForSelectedDate = visibleDateKey === selectedDateKey;
  const showQuietPlaceholder = !hasVisibleSnapshotForSelectedDate
    || contentState === "cold-loading";
  const contentPlaceholderMessage = contentState === "error"
    ? historyCopy.loadFailed
    : "";
  const historyView = useMemo(
    () => (void mappingVersion, buildHistoryReadModel({
      daySessions: rawDaySessions,
      weeklySessions: rawWeeklySessions,
      selectedDate,
      nowMs,
      trackerHealth,
      minSessionSecs,
      mergeThresholdSecs,
    })),
    [mappingVersion, mergeThresholdSecs, minSessionSecs, nowMs, rawDaySessions, rawWeeklySessions, selectedDate, trackerHealth],
  );
  const {
    compiledSessions,
    timelineSessions,
    appSummary,
    hourlyActivity,
    hourlyCategoryActivity,
  } = historyView;
  const historyTimelineView = useMemo(
    () => buildHistoryTimelineViewModel({
      sessions: compiledSessions,
      selectedDate,
      nowMs,
      mode: historyTimelineMode,
      mergeThresholdSecs,
    }),
    [compiledSessions, historyTimelineMode, mergeThresholdSecs, nowMs, selectedDate],
  );
  const historyTimelinePlaceholderView = useMemo(
    () => buildHistoryTimelineViewModel({
      sessions: [],
      selectedDate,
      nowMs,
      mode: historyTimelineMode,
      mergeThresholdSecs,
    }),
    [historyTimelineMode, mergeThresholdSecs, nowMs, selectedDate],
  );
  const visibleHistoryTimelineView = showQuietPlaceholder
    ? historyTimelinePlaceholderView
    : historyTimelineView;
  const selectedDayRange = useMemo(() => {
    const startMs = startOfDay(selectedDate).getTime();
    return {
      startMs,
      endMs: startMs + 24 * 60 * 60 * 1000,
    };
  }, [selectedDate]);
  const timelineZoomTimelineView = useMemo(
    () => buildHistoryTimelineViewModel({
      sessions: showQuietPlaceholder ? [] : compiledSessions,
      selectedDate,
      nowMs,
      mode: historyTimelineMode,
      mergeThresholdSecs,
      viewport: timelineViewport,
    }),
    [
      compiledSessions,
      historyTimelineMode,
      mergeThresholdSecs,
      nowMs,
      selectedDate,
      showQuietPlaceholder,
      timelineViewport,
    ],
  );
  const timelineWindowLabel = historyCopy.timelineWindowLabel(
    formatTimelineWindowBoundary(timelineViewport.startMs, selectedDayRange.endMs),
    formatTimelineWindowBoundary(timelineViewport.endMs, selectedDayRange.endMs),
  );
  const timelineZoomHours = timelineViewport.durationMs / (60 * 60_000);
  const appDistributionItems = useMemo<HistoryDayDistributionItem[]>(
    () => appSummary.map((app) => {
      const mapped = AppClassification.mapApp(app.exeName, { appName: app.appName });
      const overrideColor = AppClassification.getUserOverride(app.exeName)?.color;
      const accentColor = overrideColor ?? iconThemeColors[app.exeName] ?? mapped.color;
      const appName = app.appName.trim() || mapped.name;
      return {
        key: app.exeName,
        label: appName,
        duration: app.duration,
        percentage: app.percentage,
        color: accentColor,
        iconSrc: historyIcons[app.exeName],
        kind: "app",
      };
    }),
    [appSummary, historyIcons, iconThemeColors],
  );
  const categoryDistributionItems = useMemo<HistoryDayDistributionItem[]>(() => {
    const summaries = new Map<string, Omit<HistoryDayDistributionItem, "key" | "percentage">>();
    let totalDuration = 0;

    for (const session of compiledSessions) {
      const duration = Math.max(0, session.duration ?? 0);
      if (duration <= 0) continue;

      const mapped = AppClassification.mapApp(session.appKey, { appName: session.displayName });
      const category = mapped.category;
      const current = summaries.get(category);
      totalDuration += duration;

      if (current) {
        current.duration += duration;
        continue;
      }

      summaries.set(category, {
        label: AppClassification.getCategoryLabel(category),
        duration,
        color: AppClassification.getCategoryColor(category),
        category,
        kind: "category",
      });
    }

    return Array.from(summaries.entries())
      .map(([category, summary]) => ({
        ...summary,
        key: category,
        percentage: totalDuration > 0 ? (summary.duration / totalDuration) * 100 : 0,
      }))
      .sort((left, right) => right.duration - left.duration || left.label.localeCompare(right.label));
  }, [compiledSessions]);
  const webDistributionItems = useMemo<HistoryDayDistributionItem[]>(
    () => {
      if (!webActivityEnabled) return [];

      return buildWebDomainDistribution(
        rawDayWebSegments,
        selectedDayRange,
        nowMs,
        webDomainOverrides,
        webDomainIconThemeColors,
        webDomainFavicons,
      )
        .map((item) => ({
          key: item.key,
          label: item.label,
          duration: item.duration,
          percentage: item.percentage,
          color: item.color,
          iconSrc: item.faviconUrl ?? undefined,
          category: item.category,
          kind: "web" as const,
        }));
    },
    [
      nowMs,
      rawDayWebSegments,
      selectedDayRange,
      webActivityEnabled,
      webDomainFavicons,
      webDomainIconThemeColors,
      webDomainOverrides,
    ],
  );
  const webTimelineItems = useMemo(
    () => {
      if (!webActivityEnabled) return [];

      return buildWebTimelineItems(
        rawDayWebSegments,
        selectedDayRange,
        nowMs,
        webDomainOverrides,
        webDomainIconThemeColors,
        mergeThresholdSecs,
        minSessionSecs,
        webDomainFavicons,
      );
    },
    [
      mergeThresholdSecs,
      minSessionSecs,
      nowMs,
      rawDayWebSegments,
      selectedDayRange,
      webActivityEnabled,
      webDomainFavicons,
      webDomainIconThemeColors,
      webDomainOverrides,
    ],
  );
  const effectiveDayDistributionMode = resolveEffectiveDayDistributionMode(
    dayDistributionMode,
    webActivityEnabled,
  );
  const dayDistributionOptions: QuietSegmentedFilterOption<DayDistributionMode>[] = webActivityEnabled
    ? [
      { value: "app", label: historyCopy.distributionByApp },
      { value: "category", label: historyCopy.distributionByCategory },
      { value: "web", label: historyCopy.distributionByWeb },
    ]
    : [
      { value: "app", label: historyCopy.distributionByApp },
      { value: "category", label: historyCopy.distributionByCategory },
    ];
  const dayDistributionItems = effectiveDayDistributionMode === "web"
    ? webDistributionItems
    : effectiveDayDistributionMode === "category"
      ? categoryDistributionItems
      : appDistributionItems;
  const daySummaryView = useMemo<HistoryDaySummaryView>(() => {
    const activeDurationMs = compiledSessions.reduce(
      (total, session) => total + Math.max(0, session.duration ?? 0),
      0,
    );
    const activeSessions = compiledSessions.filter((session) => (session.duration ?? 0) > 0);
    const significantSessions = activeSessions.filter((session) => (
      (session.duration ?? 0) >= DAY_SUMMARY_MIN_SPAN_SESSION_MS
    ));
    const spanSessions = significantSessions.length > 0 ? significantSessions : activeSessions;
    const firstStartTime = spanSessions.reduce<number | null>((earliest, session) => (
      earliest === null ? session.startTime : Math.min(earliest, session.startTime)
    ), null);
    const lastEndTime = spanSessions.reduce<number | null>((latest, session) => {
      const endTime = session.endTime ?? session.startTime + Math.max(0, session.duration ?? 0);
      return latest === null ? endTime : Math.max(latest, endTime);
    }, null);
    const peakHour = hourlyActivity.reduce<{
      hour: string;
      minutes: number;
      surroundingMinutes: number;
    }>((peak, point, index) => {
      const surroundingMinutes = (hourlyActivity[index - 1]?.minutes ?? 0)
        + (hourlyActivity[index + 1]?.minutes ?? 0);
      if (
        point.minutes > peak.minutes
        || (point.minutes === peak.minutes && surroundingMinutes > peak.surroundingMinutes)
      ) {
        return {
          hour: point.hour,
          minutes: point.minutes,
          surroundingMinutes,
        };
      }
      return peak;
    }, { hour: "", minutes: 0, surroundingMinutes: -1 });

    return {
      activeDurationLabel: activeDurationMs > 0 ? formatDuration(activeDurationMs) : "0m",
      activeSpanLabel: firstStartTime !== null && lastEndTime !== null
        ? `${formatTime(firstStartTime)} - ${formatTime(lastEndTime)}`
        : DAY_SUMMARY_EMPTY_MARK,
      peakHourLabel: peakHour.minutes > 0
        ? `${peakHour.hour} · ${formatDuration(peakHour.minutes * 60_000)}`
        : DAY_SUMMARY_EMPTY_MARK,
    };
  }, [compiledSessions, hourlyActivity]);
  const visibleDaySummaryView = showQuietPlaceholder
    ? {
      activeDurationLabel: DAY_SUMMARY_EMPTY_MARK,
      activeSpanLabel: DAY_SUMMARY_EMPTY_MARK,
      peakHourLabel: DAY_SUMMARY_EMPTY_MARK,
    }
    : daySummaryView;

  const minSessionMinutes = clampMinute(
    Math.max(1, Math.round(minSessionSecs / 60)),
    TIMELINE_MIN_SESSION_MINUTES_RANGE.min,
    TIMELINE_MIN_SESSION_MINUTES_RANGE.max,
  );
  const canDecreaseMinSession = minSessionMinutes > TIMELINE_MIN_SESSION_MINUTES_RANGE.min;
  const canIncreaseMinSession = minSessionMinutes < TIMELINE_MIN_SESSION_MINUTES_RANGE.max;
  const updateMinSessionMinutes = (nextMinutes: number) => {
    const clampedMinutes = clampMinute(
      nextMinutes,
      TIMELINE_MIN_SESSION_MINUTES_RANGE.min,
      TIMELINE_MIN_SESSION_MINUTES_RANGE.max,
    );
    onMinSessionSecsChange?.(clampedMinutes * 60);
  };
  const getInitialTimelineZoomFocusMs = useCallback(() => {
    const currentTime = new Date(nowMs);
    const sameTimeOfSelectedDay = new Date(selectedDate);
    sameTimeOfSelectedDay.setHours(
      currentTime.getHours(),
      currentTime.getMinutes(),
      currentTime.getSeconds(),
      currentTime.getMilliseconds(),
    );
    return snapHistoryTimelineFocusToNearestHalfHour({
      selectedDate,
      requestedTimeMs: sameTimeOfSelectedDay.getTime(),
    });
  }, [nowMs, selectedDate]);
  const handleTimelineZoomChange = (requestedHours: number) => {
    const nextZoomHours = Math.min(24, Math.max(1, requestedHours));
    const nextDurationMs = getHistoryTimelineZoomDurationMs(nextZoomHours);
    if (Math.abs(nextDurationMs - timelineViewport.durationMs) < 1) return;

    const currentCenterMs = timelineViewport.startMs
      + timelineViewport.durationMs / 2;
    const focusTimeMs = timelineViewportWasPannedRef.current
      ? currentCenterMs
      : getInitialTimelineZoomFocusMs();
    const nextViewport = normalizeHistoryTimelineViewportAroundFocus({
      selectedDate,
      durationMs: nextDurationMs,
      focusTimeMs,
    });

    if (nextZoomHours === 24) {
      timelineViewportWasPannedRef.current = false;
    }
    rememberHistoryTimelineZoomHours(nextZoomHours);
    setTimelineViewport(nextViewport);
  };
  const handleTimelineViewportChange = useCallback((
    nextViewport: HistoryTimelineViewport,
    reason: HistoryTimelineViewportChangeReason,
  ) => {
    if (reason === "pan") {
      timelineViewportWasPannedRef.current = true;
    } else {
      const nextZoomHours = nextViewport.durationMs / (60 * 60_000);
      rememberHistoryTimelineZoomHours(nextZoomHours);
      if (nextViewport.durationMs >= MAX_HISTORY_TIMELINE_VIEWPORT_DURATION_MS) {
        timelineViewportWasPannedRef.current = false;
      }
    }
    setTimelineViewport(nextViewport);
  }, []);
  const {
    isDragging: timelineViewportIsDragging,
    cancelInteraction: cancelTimelineViewportInteraction,
    interactionProps: timelineViewportInteractionProps,
  } = useHistoryTimelineViewportInteraction({
    selectedDate,
    viewport: timelineViewport,
    enabled: timelineZoomDialogOpen,
    interactionRef: timelineViewportInteractionRef,
    onViewportChange: handleTimelineViewportChange,
  });
  const toggleHistoryTimelineMode = () => {
    setHistoryTimelineMode((mode) => {
      const nextMode = mode === "category" ? "app" : "category";
      rememberHistoryTimelineMode(nextMode);
      return nextMode;
    });
  };
  const changeTimelineDialogMode = (mode: TimelineDialogMode) => {
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
    setTimelineDialogMode(mode);
  };
  const openTimelineDialog = () => {
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
    setTimelineDialogOpen(true);
  };
  const closeTimelineDialog = () => {
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
    setTimelineDialogOpen(false);
  };
  const openTimelineZoomDialog = () => {
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
    timelineViewportWasPannedRef.current = false;
    const nextZoomHours = readHistoryTimelineZoomHours();
    const nextViewport = normalizeHistoryTimelineViewportAroundFocus({
      selectedDate,
      durationMs: getHistoryTimelineZoomDurationMs(nextZoomHours),
      focusTimeMs: getInitialTimelineZoomFocusMs(),
    });
    setTimelineViewport(nextViewport);
    setTimelineZoomDialogOpen(true);
  };
  const closeTimelineZoomDialog = () => {
    cancelTimelineViewportInteraction();
    setTimelineZoomDialogOpen(false);
  };
  useEffect(() => {
    if (timelineDialogOpen) return;
    setTimelineDialogSyncedHeight(null);
  }, [timelineDialogOpen]);

  useLayoutEffect(() => {
    if (!timelineDialogOpen) return;
    const body = timelineDialogBodyRef.current;
    if (!body) return;

    const measuredHeight = Math.ceil(body.getBoundingClientRect().height);
    if (measuredHeight <= 0) return;

    setTimelineDialogSyncedHeight((current) => (
      current === null || measuredHeight > current ? measuredHeight : current
    ));
  }, [
    showQuietPlaceholder,
    minSessionMinutes,
    selectedDate,
    timelineDialogMode,
    timelineDialogOpen,
    timelineSessions.length,
    webTimelineItems.length,
  ]);

  const timelineDialogBodyStyle = timelineDialogSyncedHeight === null
    ? undefined
    : ({ minHeight: `${timelineDialogSyncedHeight}px` } satisfies CSSProperties);
  const handleDayDistributionModeChange = (mode: DayDistributionMode) => {
    setDayDistributionMode(mode);
    rememberHistoryDayDistributionMode(mode);
  };
  const renderTimelineModeAction = (className = "") => (
    <QuietIconAction
      icon={<Tags size={15} />}
      title={getHistoryTimelineModeActionLabel(historyTimelineMode)}
      ariaLabel={getHistoryTimelineModeActionLabel(historyTimelineMode)}
      pressed={historyTimelineMode === "category"}
      className={`history-timeline-mode-toggle history-horizontal-timeline-action ${className}`.trim()}
      showTooltip={false}
      onClick={toggleHistoryTimelineMode}
    />
  );
  const renderTimelineZoomAction = (className = "") => (
    <QuietIconAction
      icon={<ZoomIn size={14} />}
      title={historyCopy.openTimelineZoom}
      ariaLabel={historyCopy.openTimelineZoom}
      className={`history-horizontal-timeline-action history-timeline-zoom-open ${className}`.trim()}
      onClick={openTimelineZoomDialog}
    />
  );
  const timelineAxisActions = (
    <>
      {renderTimelineModeAction("history-horizontal-timeline-mode-toggle")}
      {renderTimelineZoomAction()}
      <QuietIconAction
        icon={<Expand size={15} />}
        title={historyCopy.openTimeline}
        ariaLabel={historyCopy.openTimeline}
        className="history-horizontal-timeline-action history-timeline-open"
        onClick={openTimelineDialog}
      />
    </>
  );
  const renderTimelineDurationControls = (className = "") => (
    <div className={`flex max-w-[124px] items-center justify-end gap-1.5 ${className}`.trim()}>
      <button
        type="button"
        onClick={() => updateMinSessionMinutes(minSessionMinutes - 1)}
        disabled={!canDecreaseMinSession}
        aria-label={UI_TEXT.accessibility.history.decreaseMinDuration}
        className="qp-button-secondary inline-flex h-6 w-6 items-center justify-center rounded-[6px] p-0 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Minus size={11} />
      </button>
      <span className="min-w-[62px] text-center text-xs font-medium tabular-nums text-[var(--qp-text-secondary)]">
        {UI_TEXT.settings.minuteValue(minSessionMinutes)}
      </span>
      <button
        type="button"
        onClick={() => updateMinSessionMinutes(minSessionMinutes + 1)}
        disabled={!canIncreaseMinSession}
        aria-label={UI_TEXT.accessibility.history.increaseMinDuration}
        className="qp-button-secondary inline-flex h-6 w-6 items-center justify-center rounded-[6px] p-0 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Plus size={11} />
      </button>
    </div>
  );
  const effectiveTimelineDialogMode = webActivityEnabled ? timelineDialogMode : "app";
  const timelineDialogModeOptions: QuietSegmentedFilterOption<TimelineDialogMode>[] = webActivityEnabled
    ? [
      { value: "app", label: historyCopy.timelineTabApp },
      { value: "web", label: historyCopy.timelineTabWeb },
    ]
    : [
      { value: "app", label: historyCopy.timelineTabApp },
    ];
  const renderTimelineList = (className = "") => (
    <HistoryTimelineList
      loading={showQuietPlaceholder}
      timelineSessions={timelineSessions}
      icons={historyIcons}
      iconThemeColors={iconThemeColors}
      detailsPopover={timelineDetailsPopover}
      className={className}
      onToggleSessionDetails={toggleTimelineSessionDetails}
    />
  );
  const renderWebTimelineList = (className = "") => (
    <HistoryWebTimelineList
      loading={showQuietPlaceholder}
      items={webTimelineItems}
      detailsPopover={timelineDetailsPopover}
      className={className}
      onToggleSessionDetails={toggleTimelineSessionDetails}
    />
  );
  const renderDayDistribution = () => (
    <HistoryDayDistributionPanel
      title={historyCopy.dayDistribution}
      mode={effectiveDayDistributionMode}
      modeOptions={dayDistributionOptions}
      items={dayDistributionItems}
      showQuietPlaceholder={showQuietPlaceholder}
      placeholderMessage={contentPlaceholderMessage}
      onModeChange={handleDayDistributionModeChange}
    />
  );
  const renderDaySummary = () => (
    <HistoryDaySummaryPanel copy={historyCopy} view={visibleDaySummaryView} />
  );

  return (
    <div
      className="flex-1 min-h-0 flex flex-col gap-4 md:gap-5 h-full overflow-hidden"
      data-history-content-state={contentState}
      data-history-content-date={visibleDateKey ?? ""}
    >
      <QuietPageHeader
        icon={<Clock size={18} />}
        title={UI_TEXT.history.title}
        subtitle={UI_TEXT.history.subtitle}
        rightSlot={(
          <HistoryDateNavigator
            datePickerRef={datePickerRef}
            calendarPopoverRef={calendarPopoverRef}
            selectedDate={selectedDate}
            today={today}
            isToday={isToday}
            calendarOpen={calendarOpen}
            calendarPosition={calendarPosition}
            calendarMonth={calendarMonth}
            onCalendarMonthChange={setCalendarMonth}
            onChangeDate={changeDate}
            onOpenDatePicker={openDatePicker}
            onSelectCalendarDate={selectCalendarDate}
          />
        )}
      />

      <div className="qp-panel p-5 history-overview-timeline-card">
        <HistoryHorizontalTimeline
          viewModel={visibleHistoryTimelineView}
          mode={historyTimelineMode}
          iconThemeColors={iconThemeColors}
          title={historyCopy.timelineAxis}
          actions={showQuietPlaceholder ? null : timelineAxisActions}
          showEmptyMessage
          emptyMessage={showQuietPlaceholder ? contentPlaceholderMessage : undefined}
        />
      </div>

      <div className="flex gap-4 md:gap-5 min-h-0 flex-1">
        <div className="w-5/12 flex flex-col gap-4 md:gap-5 min-h-0 history-left-column">
          {renderDaySummary()}
          <HistoryHourlyActivityPanel
            mode={hourlyActivityChartMode}
            hourlyActivity={hourlyActivity}
            hourlyCategoryActivity={hourlyCategoryActivity}
            showQuietPlaceholder={showQuietPlaceholder}
            actionLabel={getHourlyActivityModeActionLabel(hourlyActivityChartMode)}
            onToggleMode={() => onHourlyActivityChartModeChange(
              hourlyActivityChartMode === "category" ? "total" : "category",
            )}
          />
        </div>

        <div className="flex-1 qp-panel p-5 flex flex-col overflow-hidden min-h-0 history-app-distribution-card">
          {renderDayDistribution()}
        </div>
      </div>

      <HistoryTimelineDetailsPopover
        popover={timelineDetailsPopover}
        popoverRef={timelineDetailsPopoverRef}
      />

      <QuietDialog
        open={timelineDialogOpen}
        title={UI_TEXT.history.timeline}
        surfaceClassName="history-timeline-dialog-surface"
        onClose={closeTimelineDialog}
      >
        <button
          type="button"
          className="qp-dialog-close-button history-timeline-dialog-close"
          aria-label={UI_TEXT.common.close}
          onClick={closeTimelineDialog}
        >
          <X size={16} aria-hidden />
        </button>
        <div
          ref={timelineDialogBodyRef}
          className="history-timeline-dialog-body"
          style={timelineDialogBodyStyle}
        >
          <div className="history-timeline-dialog-toolbar">
            <div className="history-timeline-dialog-toolbar-main">
              {webActivityEnabled && (
                <QuietSegmentedFilter<TimelineDialogMode>
                  value={effectiveTimelineDialogMode}
                  options={timelineDialogModeOptions}
                  onChange={changeTimelineDialogMode}
                  className="history-timeline-dialog-mode-switch"
                />
              )}
              <span className="history-timeline-dialog-meta">
                {UI_TEXT.history.sessionCount(
                  effectiveTimelineDialogMode === "web" ? webTimelineItems.length : timelineSessions.length,
                )}
              </span>
            </div>
            <HistoryTimelineDialogDateControls
              selectedDate={selectedDate}
              isToday={isToday}
              onChangeDate={changeDate}
              className="history-timeline-dialog-date-controls"
            />
            <div className="history-timeline-dialog-actions">
              {renderTimelineDurationControls("history-timeline-dialog-duration-controls")}
            </div>
          </div>
          {effectiveTimelineDialogMode === "web"
            ? renderWebTimelineList("history-timeline-dialog-list")
            : renderTimelineList("history-timeline-dialog-list")}
        </div>
      </QuietDialog>

      <HistoryTimelineZoomDialog
        open={timelineZoomDialogOpen}
        onClose={closeTimelineZoomDialog}
        zoomHours={timelineZoomHours}
        onZoomHoursChange={handleTimelineZoomChange}
        windowLabel={timelineWindowLabel}
        modeAction={renderTimelineModeAction("history-timeline-zoom-dialog-mode-toggle")}
        interactionRef={timelineViewportInteractionRef}
        interactionProps={timelineViewportInteractionProps}
        interactionLabel={historyCopy.timelineInteractionHint}
        isDragging={timelineViewportIsDragging}
        viewModel={timelineZoomTimelineView}
        mode={historyTimelineMode}
        iconThemeColors={iconThemeColors}
        appIcons={historyIcons}
        showEmptyMessage={!showQuietPlaceholder}
        emptyMessage={historyCopy.emptyTimelineWindow}
      />
    </div>
  );
}
