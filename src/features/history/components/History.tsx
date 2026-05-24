import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Minus, Plus } from "lucide-react";
import { type HistorySession } from "../../../shared/types/sessions";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
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
import QuietChartTooltip from "../../../shared/components/QuietChartTooltip";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import {
  getHistorySnapshotCache,
  setHistorySnapshotCache,
} from "../services/historySnapshotCache";

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
}

const TIMELINE_MIN_SESSION_MINUTES_RANGE = { min: 1, max: 10 } as const;
const clampMinute = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date: Date, delta: number) => new Date(date.getFullYear(), date.getMonth() + delta, 1);
const isSameDay = (left: Date, right: Date) => left.toDateString() === right.toDateString();
const formatCalendarMonth = (date: Date) => UI_TEXT.date.yearMonthLabel(date.getFullYear(), date.getMonth() + 1);
type TimelineDetailsPopover = {
  sessionId: number;
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
}: Props) {
  const initialDate = new Date();
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
  const [nowMs, setNowMs] = useState(() => initialCachedSnapshot?.fetchedAtMs ?? Date.now());
  const [loading, setLoading] = useState(!initialCachedSnapshot);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(Boolean(initialCachedSnapshot));
  const [timelineDetailsPopover, setTimelineDetailsPopover] = useState<TimelineDetailsPopover | null>(null);
  const timelineDetailsPopoverRef = useRef<HTMLDivElement | null>(null);
  const timelineDetailsTriggerRef = useRef<HTMLElement | null>(null);
  const hasLoadedRef = useRef(false);

  const toggleTimelineSessionDetails = useCallback((
    sessionId: number,
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

  const loadData = useCallback(async (showLoading: boolean = false) => {
    const cachedSnapshot = getHistorySnapshotCache(selectedDate);

    if (cachedSnapshot) {
      setRawDaySessions(cachedSnapshot.daySessions);
      setRawWeeklySessions(cachedSnapshot.weeklySessions);
      setNowMs(cachedSnapshot.fetchedAtMs);
      setHasFetchedOnce(true);
      setLoading(false);
    }

    if (showLoading) {
      setLoading(!cachedSnapshot);
    }

    try {
      const snapshot = await loadHistorySnapshot(selectedDate);
      setHistorySnapshotCache(snapshot, selectedDate);

      setRawDaySessions(snapshot.daySessions);
      setRawWeeklySessions(snapshot.weeklySessions);
      setNowMs(snapshot.fetchedAtMs);
      setHasFetchedOnce(true);
      hasLoadedRef.current = true;
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [loadHistorySnapshot, selectedDate]);

  useEffect(() => {
    void loadData(!hasLoadedRef.current);
  }, [loadData, refreshKey]);

  useEffect(() => {
    const hasLiveSession = rawDaySessions.some((session) => session.endTime === null)
      || rawWeeklySessions.some((session) => session.endTime === null);

    if (!hasLiveSession || trackerHealth.status !== "healthy") {
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
  }, [rawDaySessions, rawWeeklySessions, refreshIntervalSecs, trackerHealth.status]);

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
  const showInitialLoading = loading && !hasFetchedOnce;
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
    timelineSessions,
    appSummary,
    hourlyActivity,
  } = historyView;

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

      <div className="flex gap-4 md:gap-5 min-h-0 flex-1">
        <div className="w-5/12 flex flex-col gap-4 md:gap-5 min-h-0 history-left-column">
          <div className="qp-panel p-5 history-pulse-card">
            <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{UI_TEXT.history.dailyHourlyActivity}</h3>
            {showInitialLoading ? (
              <div className="h-[120px] pt-3 flex items-center justify-center text-[var(--qp-text-tertiary)] text-xs">
                {UI_TEXT.history.loading}
              </div>
            ) : (
              <div className="pt-3 history-pulse-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyActivity} margin={{ top: 4, right: 15, left: 0, bottom: 0 }}>
                    <XAxis
                      dataKey="hour"
                      tick={{ fontSize: 10, fill: "var(--qp-text-tertiary)" }}
                      axisLine={false}
                      tickLine={false}
                      interval={5}
                      tickMargin={8}
                      padding={{ left: 10, right: 10 }}
                    />
                    <YAxis hide domain={[0, 60]} allowDataOverflow />
                    <QuietChartTooltip
                      cursor={{ fill: "var(--qp-chart-cursor)" }}
                      formatter={(value) => [`${Math.round(Number(value))}m`, UI_TEXT.dashboard.activeMinutes]}
                    />
                    <Bar dataKey="minutes" fill="var(--qp-accent-default)" radius={[3, 3, 0, 0]} barSize={8} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          <div className="qp-panel p-5 flex-1 min-h-0 flex flex-col history-app-distribution-card">
            <div className="mb-4">
              <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{UI_TEXT.history.appDistribution}</h3>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1 pt-2">
              {showInitialLoading ? (
                <p className="text-[var(--qp-text-tertiary)] text-xs text-center mt-8">{UI_TEXT.history.loading}</p>
              ) : appSummary.length === 0 ? (
                <p className="text-[var(--qp-text-tertiary)] text-xs text-center mt-8">{UI_TEXT.history.noData}</p>
              ) : (
                <div className="space-y-4">
                  {appSummary.map((app) => {
                    const mapped = AppClassification.mapApp(app.exeName, { appName: app.appName });
                    const overrideColor = AppClassification.getUserOverride(app.exeName)?.color;
                    const accentColor = overrideColor ?? iconThemeColors[app.exeName] ?? mapped.color;
                    const appName = app.appName.trim() || mapped.name;
                    return (
                      <div key={app.exeName} className="space-y-1.5">
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium text-[var(--qp-text-secondary)] flex items-center gap-1.5 min-w-0">
                            {icons[app.exeName] && <img src={icons[app.exeName]} className="w-3.5 h-3.5 object-contain" alt="" />}
                            <span className="truncate">{appName}</span>
                          </span>
                          <span className="text-[var(--qp-text-tertiary)] tabular-nums">{formatDuration(app.duration)}</span>
                        </div>
                        <div className="h-1.5 bg-[var(--qp-track-muted)] rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${app.percentage}%` }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            className="h-full rounded-full"
                            style={{ backgroundColor: accentColor }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 qp-panel p-5 flex flex-col overflow-hidden min-h-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{UI_TEXT.history.timeline}</h3>
            <div className="flex max-w-[124px] items-center justify-end gap-1.5">
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
          </div>
          {loading ? (
            <div className="flex-1 flex items-center justify-center text-[var(--qp-text-tertiary)] text-sm">{UI_TEXT.history.loading}</div>
          ) : timelineSessions.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[var(--qp-text-tertiary)] text-sm">{UI_TEXT.history.emptyDay}</div>
          ) : (
            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-1">
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
