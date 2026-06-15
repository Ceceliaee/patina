import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Expand, Globe2, Layers3, Minus, Plus, Tags, X } from "lucide-react";
import { type HistorySession } from "../../../shared/types/sessions";
import type { WebActivitySegment } from "../../../shared/types/webActivity.ts";
import type { WebDomainOverride } from "../../../shared/types/webActivity.ts";
import { getUiLocale, UI_TEXT } from "../../../shared/copy/uiText.ts";
import {
  formatDuration,
  formatTime,
  formatDateLabel,
} from "../services/historyFormatting";
import { useIconThemeColors } from "../../../shared/hooks/useIconThemeColors";
import {
  buildHistoryReadModel,
  type HistorySnapshot,
} from "../services/historyReadModel";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import HourlyActivityChart from "../../../shared/charts/HourlyActivityChart";
import HistoryHorizontalTimeline from "./HistoryHorizontalTimeline.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import QuietSegmentedFilter, { type QuietSegmentedFilterOption } from "../../../shared/components/QuietSegmentedFilter";
import type { HourlyActivityChartMode } from "../../../shared/settings/appSettings.ts";
import {
  getHistorySnapshotCache,
  setHistorySnapshotCache,
} from "../services/historySnapshotCache";
import {
  buildHistoryTimelineViewModel,
  type HistoryTimelineDisplayMode,
} from "../services/historyTimelineViewModel.ts";
import {
  readHistoryDayDistributionMode,
  readHistoryTimelineMode,
  rememberHistoryDayDistributionMode,
  rememberHistoryTimelineMode,
  type DayDistributionMode,
} from "../services/historyLayoutPreferenceStorage.ts";
import {
  buildWebDomainDistribution,
  buildWebTimelineItems,
  type WebTimelineItem,
} from "../services/historyWebActivityViewModel.ts";

interface Props {
  icons: Record<string, string>;
  refreshKey?: number;
  refreshIntervalSecs: number;
  mergeThresholdSecs: number;
  minSessionSecs: number;
  onMinSessionSecsChange?: (value: number) => void;
  trackerHealth: TrackerHealthSnapshot;
  loadHistorySnapshot: (date: Date, rollingDayCount?: number) => Promise<HistorySnapshot>;
  mappingVersion?: number;
  selectedDateRequest?: {
    dateKey: string;
    requestId: number;
  } | null;
  hourlyActivityChartMode: HourlyActivityChartMode;
  onHourlyActivityChartModeChange: (mode: HourlyActivityChartMode) => void;
  refreshEnabled?: boolean;
}

const TIMELINE_MIN_SESSION_MINUTES_RANGE = { min: 1, max: 10 } as const;
interface DayDistributionItem {
  key: string;
  label: string;
  subtitle?: string;
  duration: number;
  percentage: number;
  color: string;
  iconSrc?: string;
  category?: AppCategory;
  kind?: "app" | "category" | "web";
}
interface DaySummaryView {
  activeDurationLabel: string;
  activeSpanLabel: string;
  peakHourLabel: string;
}
const clampMinute = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date: Date, delta: number) => new Date(date.getFullYear(), date.getMonth() + delta, 1);
const isSameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString();
const DAY_SUMMARY_EMPTY_MARK = "—";
const formatCalendarMonth = (date: Date) => UI_TEXT.date.yearMonthLabel(date.getFullYear(), date.getMonth() + 1);
const formatDistributionPercentage = (percentage: number) => {
  if (!Number.isFinite(percentage)) return "0%";

  const boundedPercentage = Math.min(100, Math.max(0, percentage));
  return `${Math.round(boundedPercentage)}%`;
};
const getHistoryTimelineModeActionLabel = (mode: HistoryTimelineDisplayMode) => {
  const isEnglish = getUiLocale() === "en-US";
  if (mode === "category") {
    return isEnglish ? "Show by app" : "按应用显示";
  }
  return isEnglish ? "Show by category" : "按分类显示";
};
const getHistoryFeatureCopy = () => {
  const isEnglish = getUiLocale() === "en-US";
  return isEnglish
    ? {
      daySummary: "Day Summary",
      activeDuration: "Active time",
      activeSpan: "Active span",
      peakHour: "Peak hour",
      showHourlyActivityByCategory: "Show by category",
      showTotalHourlyActivity: "Show total activity",
      dayDistribution: "Day Distribution",
      distributionByApp: "Apps",
      distributionByCategory: "Categories",
      distributionByWeb: "Web",
      timelineTabApp: "Apps",
      timelineTabWeb: "Web",
      timelineAxis: "Day Timeline",
      openTimeline: "Open timeline",
    }
    : {
      daySummary: "当日摘要",
      activeDuration: "活跃时长",
      activeSpan: "活跃跨度",
      peakHour: "高峰时段",
      showHourlyActivityByCategory: "按分类显示",
      showTotalHourlyActivity: "显示总活动",
      dayDistribution: "当日分布",
      distributionByApp: "应用",
      distributionByCategory: "分类",
      distributionByWeb: "网页",
      timelineTabApp: "应用",
      timelineTabWeb: "网页",
      timelineAxis: "时间轴",
      openTimeline: "打开时间线",
    };
};
const getHourlyActivityModeActionLabel = (mode: HourlyActivityChartMode) => {
  const copy = getHistoryFeatureCopy();
  return mode === "category"
    ? copy.showTotalHourlyActivity
    : copy.showHourlyActivityByCategory;
};
const formatHistoryDateCacheKey = (date: Date) => {
  const localDate = startOfDay(date);
  return [
    localDate.getFullYear(),
    String(localDate.getMonth() + 1).padStart(2, "0"),
    String(localDate.getDate()).padStart(2, "0"),
  ].join("-");
};

function parseLocalDateKey(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }

  return date;
}
type TimelineDetailsPopover = {
  sessionId: number | string;
  titleSamples: TimelineDetailTitle[];
  left: number;
  top: number;
  anchorTop: number;
  anchorBottom: number;
  anchorCenterX: number;
  placement: "top" | "bottom";
};

type TimelineDetailTitle = {
  title: string;
  startTime: number;
  endTime: number | null;
};
type TimelineDialogMode = "app" | "web";

function cleanTimelineDetailTitle(sample: TimelineDetailTitle, appName: string): TimelineDetailTitle {
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
    .filter((sample) => sample.title);
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
const buildCalendarDays = (month: Date) => {
  const monthStart = startOfMonth(month);
  const mondayOffset = (monthStart.getDay() + 6) % 7;
  const gridStart = new Date(monthStart);
  gridStart.setDate(monthStart.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
};

export default function History({
  icons,
  refreshKey = 0,
  refreshIntervalSecs,
  mergeThresholdSecs,
  minSessionSecs,
  onMinSessionSecsChange,
  trackerHealth,
  loadHistorySnapshot,
  mappingVersion = 0,
  selectedDateRequest = null,
  hourlyActivityChartMode,
  onHourlyActivityChartModeChange,
  refreshEnabled = true,
}: Props) {
  const requestedInitialDate = selectedDateRequest ? parseLocalDateKey(selectedDateRequest.dateKey) : null;
  const initialDate = requestedInitialDate ?? new Date();
  const initialCachedSnapshot = getHistorySnapshotCache(initialDate);
  const iconThemeColors = useIconThemeColors(icons);
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const calendarPopoverRef = useRef<HTMLDivElement | null>(null);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(initialDate));
  const [calendarPosition, setCalendarPosition] = useState({ left: 0, top: 0 });
  const [rawDaySessions, setRawDaySessions] = useState<HistorySession[]>(
    () => initialCachedSnapshot?.daySessions ?? [],
  );
  const [rawWeeklySessions, setRawWeeklySessions] = useState<HistorySession[]>(
    () => initialCachedSnapshot?.weeklySessions ?? [],
  );
  const [rawDayWebSegments, setRawDayWebSegments] = useState<WebActivitySegment[]>(
    () => initialCachedSnapshot?.dayWebSegments ?? [],
  );
  const [webDomainOverrides, setWebDomainOverrides] = useState<Record<string, WebDomainOverride>>(
    () => initialCachedSnapshot?.webDomainOverrides ?? {},
  );
  const webDomainIcons = useMemo(() => {
    const next: Record<string, string> = {};
    for (const segment of rawDayWebSegments) {
      const faviconUrl = segment.faviconUrl?.trim();
      if (!faviconUrl) continue;

      const current = next[segment.normalizedDomain];
      if (!current || faviconUrl.startsWith("data:")) {
        next[segment.normalizedDomain] = faviconUrl;
      }
    }
    return next;
  }, [rawDayWebSegments]);
  const webDomainIconThemeColors = useIconThemeColors(webDomainIcons);
  const [nowMs, setNowMs] = useState(() => initialCachedSnapshot?.fetchedAtMs ?? Date.now());
  const [loading, setLoading] = useState(!initialCachedSnapshot);
  const [visibleDateKey, setVisibleDateKey] = useState(() => (
    initialCachedSnapshot ? formatHistoryDateCacheKey(initialDate) : null
  ));
  const [timelineDialogOpen, setTimelineDialogOpen] = useState(false);
  const [timelineDialogMode, setTimelineDialogMode] = useState<TimelineDialogMode>("app");
  const [timelineDialogSyncedHeight, setTimelineDialogSyncedHeight] = useState<number | null>(null);
  const [historyTimelineMode, setHistoryTimelineMode] = useState<HistoryTimelineDisplayMode>(
    readHistoryTimelineMode,
  );
  const [dayDistributionMode, setDayDistributionMode] = useState<DayDistributionMode>(
    readHistoryDayDistributionMode,
  );
  const [timelineDetailsPopover, setTimelineDetailsPopover] = useState<TimelineDetailsPopover | null>(null);
  const timelineDialogBodyRef = useRef<HTMLDivElement | null>(null);
  const timelineDetailsPopoverRef = useRef<HTMLDivElement | null>(null);
  const timelineDetailsTriggerRef = useRef<HTMLElement | null>(null);
  const hasLoadedRef = useRef(false);
  const historyCopy = getHistoryFeatureCopy();

  useEffect(() => {
    if (!selectedDateRequest) return;
    const nextDate = parseLocalDateKey(selectedDateRequest.dateKey);
    if (!nextDate || startOfDay(nextDate) > startOfDay(new Date())) {
      return;
    }

    setSelectedDate(nextDate);
    setCalendarMonth(startOfMonth(nextDate));
    setCalendarOpen(false);
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
  }, [selectedDateRequest?.requestId]);

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
  }, [selectedDate]);

  useEffect(() => {
    if (!refreshEnabled) return undefined;

    let cancelled = false;
    const requestDate = new Date(selectedDate);
    const cachedSnapshot = getHistorySnapshotCache(requestDate);
    const requestDateKey = formatHistoryDateCacheKey(requestDate);

    if (cachedSnapshot) {
      setRawDaySessions(cachedSnapshot.daySessions);
      setRawWeeklySessions(cachedSnapshot.weeklySessions);
      setRawDayWebSegments(cachedSnapshot.dayWebSegments);
      setWebDomainOverrides(cachedSnapshot.webDomainOverrides);
      setNowMs(cachedSnapshot.fetchedAtMs);
      setVisibleDateKey(requestDateKey);
      setLoading(false);
    } else if (visibleDateKey !== requestDateKey) {
      setRawDaySessions([]);
      setRawWeeklySessions([]);
      setRawDayWebSegments([]);
      setWebDomainOverrides({});
      setVisibleDateKey(null);
    }

    if (!cachedSnapshot) {
      setLoading(!cachedSnapshot);
    }

    const load = async () => {
      try {
        const snapshot = await loadHistorySnapshot(requestDate);
        if (cancelled) return;

        setHistorySnapshotCache(snapshot, requestDate);

        setRawDaySessions(snapshot.daySessions);
        setRawWeeklySessions(snapshot.weeklySessions);
        setRawDayWebSegments(snapshot.dayWebSegments);
        setWebDomainOverrides(snapshot.webDomainOverrides);
        setNowMs(snapshot.fetchedAtMs);
        setVisibleDateKey(requestDateKey);
        hasLoadedRef.current = true;
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [loadHistorySnapshot, refreshEnabled, refreshKey, selectedDate]);

  useEffect(() => {
    const hasLiveSession = rawDaySessions.some((session) => session.endTime === null)
      || rawWeeklySessions.some((session) => session.endTime === null)
      || rawDayWebSegments.some((segment) => segment.endTime === null);

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
  }, [rawDaySessions, rawWeeklySessions, rawDayWebSegments, refreshEnabled, refreshIntervalSecs, trackerHealth.status]);

  const changeDate = (delta: number) => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() + delta);
    if (nextDate <= new Date()) {
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
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const canGoNextCalendarMonth = startOfMonth(addMonths(calendarMonth, 1)) <= startOfMonth(today);

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
  const showQuietPlaceholder = loading;
  const historyView = useMemo(
    () => buildHistoryReadModel({
      daySessions: rawDaySessions,
      weeklySessions: rawWeeklySessions,
      selectedDate,
      nowMs,
      trackerHealth,
      minSessionSecs,
      mergeThresholdSecs,
    }),
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
  const appDistributionItems = useMemo<DayDistributionItem[]>(
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
        iconSrc: icons[app.exeName],
        kind: "app",
      };
    }),
    [appSummary, iconThemeColors, icons],
  );
  const categoryDistributionItems = useMemo<DayDistributionItem[]>(() => {
    const summaries = new Map<AppCategory, Omit<DayDistributionItem, "key" | "percentage">>();
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
  const webDistributionItems = useMemo<DayDistributionItem[]>(
    () => buildWebDomainDistribution(
      rawDayWebSegments,
      selectedDayRange,
      nowMs,
      webDomainOverrides,
      webDomainIconThemeColors,
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
      })),
    [nowMs, rawDayWebSegments, selectedDayRange, webDomainIconThemeColors, webDomainOverrides],
  );
  const webTimelineItems = useMemo(
    () => buildWebTimelineItems(
      rawDayWebSegments,
      selectedDayRange,
      nowMs,
      webDomainOverrides,
      webDomainIconThemeColors,
      mergeThresholdSecs,
      minSessionSecs,
    ),
    [
      mergeThresholdSecs,
      minSessionSecs,
      nowMs,
      rawDayWebSegments,
      selectedDayRange,
      webDomainIconThemeColors,
      webDomainOverrides,
    ],
  );
  const dayDistributionOptions: QuietSegmentedFilterOption<DayDistributionMode>[] = [
    { value: "app", label: historyCopy.distributionByApp },
    { value: "category", label: historyCopy.distributionByCategory },
    { value: "web", label: historyCopy.distributionByWeb },
  ];
  const dayDistributionItems = dayDistributionMode === "web"
    ? webDistributionItems
    : dayDistributionMode === "category"
      ? categoryDistributionItems
      : appDistributionItems;
  const daySummaryView = useMemo<DaySummaryView>(() => {
    const activeDurationMs = compiledSessions.reduce(
      (total, session) => total + Math.max(0, session.duration ?? 0),
      0,
    );
    const activeSessions = compiledSessions.filter((session) => (session.duration ?? 0) > 0);
    const firstStartTime = activeSessions.reduce<number | null>((earliest, session) => (
      earliest === null ? session.startTime : Math.min(earliest, session.startTime)
    ), null);
    const lastEndTime = activeSessions.reduce<number | null>((latest, session) => {
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
  const toggleHistoryTimelineMode = () => {
    setHistoryTimelineMode((mode) => {
      const nextMode = mode === "category" ? "app" : "category";
      rememberHistoryTimelineMode(nextMode);
      return nextMode;
    });
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
    loading,
    minSessionMinutes,
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
  const timelineAxisActions = (
    <>
      {renderTimelineModeAction("history-horizontal-timeline-mode-toggle")}
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
  const timelineDialogModeOptions: QuietSegmentedFilterOption<TimelineDialogMode>[] = [
    { value: "app", label: historyCopy.timelineTabApp },
    { value: "web", label: historyCopy.timelineTabWeb },
  ];
  const getWebTimelineItemAriaLabel = (item: WebTimelineItem) => {
    const timeLabel = `${formatTime(item.startTime)} - ${item.endTime ? formatTime(item.endTime) : UI_TEXT.history.untilNow}`;
    const durationLabel = formatDuration(item.duration);
    if (getUiLocale() === "en-US") {
      return `${item.label}, ${item.title ?? "Untitled page"}, ${timeLabel}, ${durationLabel}`;
    }
    return `${item.label}，${item.title ?? "无标题网页"}，${timeLabel}，${durationLabel}`;
  };
  const renderTimelineList = (className = "") => {
    if (loading) {
      return <div className="flex-1" aria-hidden="true" />;
    }

    if (timelineSessions.length === 0) {
      return (
        <div className={`history-timeline-list-empty flex-1 flex items-center justify-center text-[var(--qp-text-tertiary)] text-sm ${className}`.trim()}>
          {UI_TEXT.history.emptyDay}
        </div>
      );
    }

    return (
      <div className={`history-timeline-list flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1 ${className}`.trim()}>
        <AnimatePresence initial={false}>
          {timelineSessions.map((session) => {
            const mapped = AppClassification.mapApp(session.exeName, { appName: session.displayName });
            const overrideColor = AppClassification.getUserOverride(session.exeName)?.color;
            const accentColor = overrideColor ?? iconThemeColors[session.exeName] ?? mapped.color;
            const titleSamples = session.titleSamples.length > 0
              ? session.titleSamples
              : (session.displayTitle ? [session.displayTitle] : []);
            const titleSampleDetails = session.titleSampleDetails.length > 0
              ? session.titleSampleDetails
              : titleSamples.map((title) => ({
                title,
                startTime: session.startTime,
                endTime: session.endTime,
              }));
            const hasDetails = titleSampleDetails.length > 0;
            const isExpanded = timelineDetailsPopover?.sessionId === session.id;
            const detailPlacement = isExpanded ? timelineDetailsPopover.placement : "bottom";

            return (
              <div
                key={session.id}
                className="flex items-center gap-3 p-3 border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-elevated)] rounded-[10px] hover:border-[var(--qp-border-strong)] hover:bg-[var(--qp-bg-panel)] transition-colors"
              >
                <div
                  className="w-1 self-stretch rounded-full flex-shrink-0"
                  style={{ backgroundColor: accentColor }}
                />
                <div className="w-8 h-8 rounded-[8px] bg-[var(--qp-bg-panel)] border border-[var(--qp-border-subtle)] flex items-center justify-center flex-shrink-0 overflow-hidden p-1.5">
                  {icons[session.exeName] ? (
                    <img src={icons[session.exeName]} className="w-full h-full object-contain" alt="" />
                  ) : (
                    <div className="text-[10px] font-semibold opacity-35 text-[var(--qp-text-secondary)]">{mapped.category[0].toUpperCase()}</div>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 items-center gap-1.5">
                  <div className="flex min-w-0 flex-1 items-end gap-1.5">
                    <div className="min-w-0 truncate text-sm font-semibold text-[var(--qp-text-primary)]">
                      {session.displayName}
                    </div>
                    <span className="inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[5px] border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-panel)] px-1.5 text-[9px] font-semibold leading-none text-[var(--qp-text-tertiary)]">
                      <span>
                        {UI_TEXT.history.activitySegmentCount(session.mergedCount)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {UI_TEXT.history.titleRowCount(titleSampleDetails.length)}
                      </span>
                    </span>
                    {hasDetails && (
                      <button
                        type="button"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => toggleTimelineSessionDetails(
                          session.id,
                          session.displayName,
                          titleSampleDetails,
                          event.currentTarget,
                        )}
                        aria-expanded={isExpanded}
                        aria-label={UI_TEXT.accessibility.history.toggleActivityDetails(
                          isExpanded,
                          session.displayName,
                        )}
                        className="qp-button-secondary inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] p-0 text-[var(--qp-text-tertiary)]"
                      >
                        {isExpanded
                          ? detailPlacement === "top"
                            ? <ChevronUp size={11} aria-hidden="true" />
                            : <ChevronDown size={11} aria-hidden="true" />
                          : <ChevronRight size={11} aria-hidden="true" />}
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs font-semibold text-[var(--qp-text-primary)] tabular-nums">{formatDuration(session.duration || 0)}</div>
                  <div className="text-[10px] text-[var(--qp-text-tertiary)] mt-0.5 tabular-nums">
                    {formatTime(session.startTime)}
                    {session.endTime ? ` - ${formatTime(session.endTime)}` : ` ${UI_TEXT.history.untilNow}`}
                  </div>
                </div>
              </div>
            );
          })}
        </AnimatePresence>
      </div>
    );
  };
  const renderWebTimelineList = (className = "") => {
    if (loading) {
      return <div className="flex-1" aria-hidden="true" />;
    }

    if (webTimelineItems.length === 0) {
      return (
        <div className={`history-timeline-list-empty flex-1 flex items-center justify-center text-[var(--qp-text-tertiary)] text-sm ${className}`.trim()}>
          {UI_TEXT.history.emptyDay}
        </div>
      );
    }

    return (
      <div className={`history-timeline-list flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1 ${className}`.trim()}>
        <AnimatePresence initial={false}>
          {webTimelineItems.map((item) => (
            <div
              key={item.id}
              tabIndex={0}
              aria-label={getWebTimelineItemAriaLabel(item)}
              className="flex items-center gap-3 p-3 border border-[var(--qp-border-subtle)] bg-[var(--qp-bg-elevated)] rounded-[10px] hover:border-[var(--qp-border-strong)] hover:bg-[var(--qp-bg-panel)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--qp-focus-ring)] transition-colors"
            >
              <div
                className="w-1 self-stretch rounded-full flex-shrink-0"
                style={{ backgroundColor: item.color }}
              />
              <div className="w-8 h-8 rounded-[8px] bg-[var(--qp-bg-panel)] border border-[var(--qp-border-subtle)] flex items-center justify-center flex-shrink-0 overflow-hidden p-1.5">
                {item.faviconUrl ? (
                  <img src={item.faviconUrl} className="w-full h-full object-contain" alt="" />
                ) : (
                  <Globe2 size={15} className="text-[var(--qp-text-tertiary)]" aria-hidden="true" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-[var(--qp-text-primary)]">
                    {item.label}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-[var(--qp-text-tertiary)]">
                    {item.title || item.url || item.domain}
                  </div>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-xs font-semibold text-[var(--qp-text-primary)] tabular-nums">
                  {formatDuration(item.duration || 0)}
                </div>
                <div className="text-[10px] text-[var(--qp-text-tertiary)] mt-0.5 tabular-nums">
                  {formatTime(item.startTime)}
                  {item.endTime ? ` - ${formatTime(item.endTime)}` : ` ${UI_TEXT.history.untilNow}`}
                </div>
              </div>
            </div>
          ))}
        </AnimatePresence>
      </div>
    );
  };
  const renderDayDistribution = () => (
    <>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{historyCopy.dayDistribution}</h3>
        <QuietSegmentedFilter
          value={dayDistributionMode}
          options={dayDistributionOptions}
          onChange={handleDayDistributionModeChange}
          className="qp-segmented-filter-compact history-day-distribution-mode-switch"
        />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 pt-2">
        {showQuietPlaceholder ? (
          <div className="h-24" aria-hidden="true" />
        ) : dayDistributionItems.length === 0 ? (
          <p className="text-[var(--qp-text-tertiary)] text-xs text-center mt-8">{UI_TEXT.history.noData}</p>
        ) : (
          <div className="space-y-4">
            {dayDistributionItems.map((item) => (
              <div key={item.key} className="space-y-1.5">
                <div className="mb-1 flex items-center justify-between gap-3">
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium leading-[1.2] text-[var(--qp-text-secondary)]">
                    {item.iconSrc ? (
                      <img src={item.iconSrc} className="h-3.5 w-3.5 shrink-0 object-contain" alt="" />
                    ) : item.kind === "web" ? (
                      <Globe2 size={14} className="shrink-0 text-[var(--qp-text-tertiary)]" aria-hidden="true" />
                    ) : (
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 leading-[1.2]">
                      <span className="block truncate text-xs font-medium leading-[1.2]">{item.label}</span>
                      {item.subtitle && (
                        <span className="mt-0.5 block truncate text-[10px] font-normal text-[var(--qp-text-tertiary)]">
                          {item.subtitle}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium leading-[1.2] text-[var(--qp-text-tertiary)] tabular-nums">
                    <span>{formatDuration(item.duration)}</span>
                    <span className="font-normal opacity-70"> · {formatDistributionPercentage(item.percentage)}</span>
                  </span>
                </div>
                <div className="h-1.5 bg-[var(--qp-track-muted)] rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${item.percentage}%` }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
  const renderDaySummary = () => (
    <div className="qp-panel p-5 history-day-summary-card">
      <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{historyCopy.daySummary}</h3>
      <div className="history-day-summary-body">
        <div className="history-day-summary-primary">
          <span className="history-day-summary-label">{historyCopy.activeDuration}</span>
          <strong className="history-day-summary-value">{daySummaryView.activeDurationLabel}</strong>
        </div>
        <div className="history-day-summary-details">
          <div className="history-day-summary-detail">
            <span>{historyCopy.activeSpan}</span>
            <strong>{daySummaryView.activeSpanLabel}</strong>
          </div>
          <div className="history-day-summary-detail">
            <span>{historyCopy.peakHour}</span>
            <strong>{daySummaryView.peakHourLabel}</strong>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-4 md:gap-5 h-full overflow-hidden">
      <QuietPageHeader
        icon={<Clock size={18} />}
        title={UI_TEXT.history.title}
        subtitle={`${formatDateLabel(selectedDate)} · ${UI_TEXT.history.sessionCount(timelineSessions.length)}`}
        rightSlot={(
          <div className="flex items-center gap-2 shrink-0">
            <motion.button
              whileTap={{ scale: 0.995 }}
              transition={{ duration: 0.1, ease: "easeOut" }}
              onClick={() => changeDate(-1)}
              className="qp-control w-9 h-9 !min-h-0 flex items-center justify-center text-[var(--qp-text-secondary)] hover:text-[var(--qp-text-primary)]"
            >
              <ChevronLeft size={16} />
            </motion.button>
            <div ref={datePickerRef} className="relative">
              <span
                role="button"
                tabIndex={0}
                onClick={openDatePicker}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openDatePicker();
                  }
                }}
                className="qp-status relative inline-flex min-w-[102px] cursor-pointer items-center justify-center px-3 py-1.5 text-center text-xs font-semibold text-[var(--qp-text-secondary)]"
              >
                {formatDateLabel(selectedDate)}
              </span>
              {createPortal((
              <AnimatePresence>
                {calendarOpen && (
                  <motion.div
                    ref={calendarPopoverRef}
                    initial={{ opacity: 0, y: -4, scale: 0.99 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.99 }}
                    transition={{ duration: 0.12, ease: "easeOut" }}
                    className="history-calendar-popover"
                    style={{
                      left: calendarPosition.left,
                      top: calendarPosition.top,
                    }}
                  >
                    <header className="history-calendar-header">
                      <button
                        type="button"
                        onClick={() => setCalendarMonth((month) => addMonths(month, -1))}
                        className="history-calendar-nav"
                        aria-label={UI_TEXT.accessibility.history.previousMonth}
                      >
                        <ChevronLeft size={14} />
                      </button>
                      <div className="history-calendar-title">{formatCalendarMonth(calendarMonth)}</div>
                      <button
                        type="button"
                        onClick={() => setCalendarMonth((month) => addMonths(month, 1))}
                        disabled={!canGoNextCalendarMonth}
                        className="history-calendar-nav"
                        aria-label={UI_TEXT.accessibility.history.nextMonth}
                      >
                        <ChevronRight size={14} />
                      </button>
                    </header>
                    <div className="history-calendar-grid history-calendar-weekdays">
                      {UI_TEXT.date.weekdaysShort.map((weekday) => (
                        <span key={weekday}>{weekday}</span>
                      ))}
                    </div>
                    <div className="history-calendar-grid">
                      {calendarDays.map((date) => {
                        const disabled = startOfDay(date) > startOfDay(today);
                        const muted = date.getMonth() !== calendarMonth.getMonth();
                        const selected = isSameDay(date, selectedDate);
                        return (
                          <button
                            key={date.toISOString()}
                            type="button"
                            disabled={disabled}
                            onClick={() => selectCalendarDate(date)}
                            className={`history-calendar-day ${muted ? "history-calendar-day-muted" : ""} ${
                              selected ? "history-calendar-day-selected" : ""
                            }`}
                          >
                            {date.getDate()}
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              ), document.body)}
            </div>
            <motion.button
              whileTap={{ scale: 0.995 }}
              transition={{ duration: 0.1, ease: "easeOut" }}
              onClick={() => changeDate(1)}
              disabled={isToday}
              className="qp-control w-9 h-9 !min-h-0 flex items-center justify-center text-[var(--qp-text-secondary)] hover:text-[var(--qp-text-primary)] disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </motion.button>
          </div>
        )}
      />

      <div className="qp-panel p-5 history-overview-timeline-card">
        <HistoryHorizontalTimeline
          viewModel={visibleHistoryTimelineView}
          mode={historyTimelineMode}
          iconThemeColors={iconThemeColors}
          title={historyCopy.timelineAxis}
          actions={showQuietPlaceholder ? null : timelineAxisActions}
          showEmptyMessage={!showQuietPlaceholder}
        />
      </div>

      <div className="flex gap-4 md:gap-5 min-h-0 flex-1">
        <div className="w-5/12 flex flex-col gap-4 md:gap-5 min-h-0 history-left-column">
          {renderDaySummary()}
          <div className="qp-panel p-5 history-pulse-card history-pulse-card-primary">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{UI_TEXT.history.dailyHourlyActivity}</h3>
              <QuietIconAction
                icon={<Layers3 size={15} />}
                title={getHourlyActivityModeActionLabel(hourlyActivityChartMode)}
                pressed={hourlyActivityChartMode === "category"}
                className="hourly-chart-mode-toggle history-pulse-mode-toggle"
                showTooltip={false}
                onClick={() => onHourlyActivityChartModeChange(
                  hourlyActivityChartMode === "category" ? "total" : "category",
                )}
              />
            </div>
            <div
              className="pt-3 history-pulse-chart"
              aria-hidden={showQuietPlaceholder ? "true" : undefined}
            >
                <HourlyActivityChart
                  mode={hourlyActivityChartMode}
                  hourlyActivity={hourlyActivity}
                  hourlyCategoryActivity={hourlyCategoryActivity}
                  margin={{ top: 4, right: 15, left: 0, bottom: 0 }}
                  padding={{ left: 10, right: 10 }}
                />
              </div>
          </div>
        </div>

        <div className="flex-1 qp-panel p-5 flex flex-col overflow-hidden min-h-0 history-app-distribution-card">
          {renderDayDistribution()}
        </div>
      </div>

      {createPortal((
        <AnimatePresence>
          {timelineDetailsPopover && (
            <motion.div
              ref={timelineDetailsPopoverRef}
              initial={{ opacity: 0, y: -4, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.99 }}
              transition={{ duration: 0.12, ease: "easeOut" }}
              className={`history-activity-popover history-activity-popover-${timelineDetailsPopover.placement}`}
              style={{
                left: timelineDetailsPopover.left,
                top: timelineDetailsPopover.top,
              }}
            >
              <div className="history-activity-popover-title">
                {UI_TEXT.history.titleDetails}
              </div>
              <div className="history-activity-popover-list">
                {timelineDetailsPopover.titleSamples.map((sample, index) => (
                  <div
                    key={`${timelineDetailsPopover.sessionId}-${index}-${sample.title}`}
                    className="history-activity-popover-item"
                  >
                    <span className="history-activity-popover-item-title">
                      {sample.title}
                    </span>
                    <span className="history-activity-popover-item-time">
                      {formatTime(sample.startTime)}
                      {sample.endTime ? ` - ${formatTime(sample.endTime)}` : ` ${UI_TEXT.history.untilNow}`}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      ), document.body)}

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
            <div className="flex min-w-0 items-center gap-3">
              <QuietSegmentedFilter
                value={timelineDialogMode}
                options={timelineDialogModeOptions}
                onChange={setTimelineDialogMode}
                className="qp-segmented-filter-compact history-timeline-dialog-mode-switch"
              />
              <span className="history-timeline-dialog-meta">
                {UI_TEXT.history.sessionCount(
                  timelineDialogMode === "web" ? webTimelineItems.length : timelineSessions.length,
                )}
              </span>
            </div>
            {renderTimelineDurationControls("history-timeline-dialog-duration-controls")}
          </div>
          {timelineDialogMode === "web"
            ? renderWebTimelineList("history-timeline-dialog-list")
            : renderTimelineList("history-timeline-dialog-list")}
        </div>
      </QuietDialog>
    </div>
  );
}
