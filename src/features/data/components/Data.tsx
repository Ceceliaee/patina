import { type CSSProperties, type MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Clock3, Search } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import {
  buildDataAppTrendViewModel,
  buildDataTrendViewModel,
  buildActivityHeatmap,
  buildYearOptions,
  getCachedDataHeatmapSessions,
  getCachedEarliestSessionStartTime,
  type DataAppOption,
  type DataAppTrendViewModel,
  type DataTrendViewModel,
  type AggregateSessionRecord,
  type HeatmapWeek,
  type HeatmapSelection,
  loadDataHeatmapSnapshot,
} from "../services/dataReadModel.ts";
import {
  getCachedDataBootstrapSnapshot,
  loadPersistedDataBootstrapSnapshot,
  saveDataBootstrapSnapshot,
  type DataBootstrapSnapshot,
} from "../services/dataBootstrapSnapshot.ts";
import { prewarmDataFirstScreen } from "../services/dataFirstScreenPrewarm.ts";
import QuietChartTooltip from "../../../shared/components/QuietChartTooltip";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";
import QuietTooltip from "../../../shared/components/QuietTooltip";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking";
import {
  formatChartHours,
  formatDuration,
} from "../../history/services/historyFormatting";
import { resolveTrendDateFromChartEvent } from "../services/dataChartInteraction.ts";
import type { DataTrendSnapshot } from "../services/dataTrendSnapshot.ts";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import { useDataTrendSnapshot } from "../hooks/useDataTrendSnapshot.ts";
import DataTrendRangeControl from "./DataTrendRangeControl.tsx";

interface Props {
  icons: Record<string, string>;
  refreshKey?: number;
  trackerHealth: TrackerHealthSnapshot;
  loadDataTrendSnapshot: (selection: DataTrendRangeSelection, nowMs?: number) => Promise<DataTrendSnapshot>;
  mappingVersion?: number;
  onOpenHistoryDate?: (dateKey: string) => void;
  uiLanguage: AppLanguage;
}

function getAppInitial(appName: string) {
  const trimmed = appName.trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function getDataAppOptionDisplayKey(app: DataAppOption) {
  return `${app.appName.trim().toLowerCase().replace(/\s+/g, " ")}|${app.exeName.trim().toLowerCase()}`;
}

function dedupeDataAppOptions(options: DataAppOption[]) {
  const merged = new Map<string, DataAppOption>();

  for (const app of options) {
    const key = getDataAppOptionDisplayKey(app);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...app });
      continue;
    }

    existing.totalDuration += app.totalDuration;
    existing.percentage += app.percentage;
    existing.averageDuration += app.averageDuration;
    existing.activeDayCount = Math.max(existing.activeDayCount, app.activeDayCount);
  }

  return Array.from(merged.values()).sort((left, right) => right.totalDuration - left.totalDuration);
}

function filterDataAppOptionsForQuery(options: DataAppOption[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  const dedupedOptions = dedupeDataAppOptions(options);
  if (!normalizedQuery) return dedupedOptions;

  return dedupedOptions.filter((app) => (
    app.appName.toLowerCase().includes(normalizedQuery)
    || app.exeName.toLowerCase().includes(normalizedQuery)
  ));
}

const DATA_TREND_X_AXIS_MIN_TICK_GAP = 24;
const HEATMAP_WEEKDAY_COUNT = 7;
type DataChartDimension = { width: number; height: number };
type DataChartDimensionKey = "overviewTrend" | "appTrend";
type HeatmapGranularity = "daily" | "weekly";
const dataChartDimensionCache: Partial<Record<DataChartDimensionKey, DataChartDimension>> = {};
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getDataViewportSize() {
  if (typeof window === "undefined") {
    return { width: 1366, height: 768 };
  }

  return { width: window.innerWidth, height: window.innerHeight };
}

function getOverviewTrendChartInitialDimension(): DataChartDimension {
  const viewport = getDataViewportSize();
  const isWideReferenceLayout = viewport.width >= 1900;
  const width = isWideReferenceLayout
    ? 852
    : clampNumber(viewport.width - 296, 560, 1280);
  const height = viewport.width >= 1536 && viewport.height >= 900 ? 214 : viewport.width <= 900 ? 140 : 168;

  return { width, height };
}

function formatHeatmapShortDate(dateKey: string) {
  return dateKey.slice(5).replace("-", "/");
}

function buildWeeklyHeatmapCells(rows: HeatmapWeek[]) {
  const weeklyCells = rows.map((week) => {
    const inRangeCells = week.cells.filter((cell) => !cell.isOutsideYear);
    const visibleCells = inRangeCells.filter((cell) => !cell.isFuture);
    const duration = visibleCells.reduce((total, cell) => total + cell.duration, 0);
    const labelCells = visibleCells.length > 0
      ? visibleCells
      : inRangeCells.length > 0
        ? inRangeCells
        : week.cells;
    const firstCell = labelCells[0];
    const lastCell = labelCells[labelCells.length - 1];
    const dateLabel = firstCell && lastCell
      ? `${formatHeatmapShortDate(firstCell.date)} - ${formatHeatmapShortDate(lastCell.date)}`
      : week.key;
    const isOutsideYear = inRangeCells.length === 0;
    const isFuture = !isOutsideYear && visibleCells.length === 0;

    return {
      key: week.key,
      duration,
      intensity: 0,
      isFuture,
      isOutsideYear,
      label: `${dateLabel} · ${isFuture ? UI_TEXT.data.notStarted : formatDuration(duration)}`,
    };
  });
  const maxDuration = Math.max(1, ...weeklyCells.map((cell) => cell.duration));

  return weeklyCells.map((cell) => ({
    ...cell,
    activeRows: cell.duration <= 0 || cell.isFuture || cell.isOutsideYear
      ? 0
      : Math.max(1, Math.ceil((cell.duration / maxDuration) * HEATMAP_WEEKDAY_COUNT)),
    intensity: cell.duration <= 0 || cell.isFuture || cell.isOutsideYear ? 0 : 0.88,
  }));
}

function getAppTrendChartInitialDimension(): DataChartDimension {
  const viewport = getDataViewportSize();
  const width = viewport.width >= 1900
    ? 852
    : clampNumber(viewport.width - 520, 420, 860);
  const height = viewport.width >= 1900 ? 200 : viewport.width <= 900 ? 172 : 210;

  return { width, height };
}

function useDataChartInitialDimension(
  key: DataChartDimensionKey,
  getFallbackDimension: () => DataChartDimension,
) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [initialDimension, setInitialDimension] = useState<DataChartDimension>(
    () => dataChartDimensionCache[key] ?? getFallbackDimension(),
  );

  useIsomorphicLayoutEffect(() => {
    const element = chartRef.current;
    if (!element) {
      return undefined;
    }

    const syncDimension = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 0 || height <= 0) {
        return;
      }

      const next = { width, height };
      dataChartDimensionCache[key] = next;
      setInitialDimension((previous) => (
        previous.width === width && previous.height === height ? previous : next
      ));
    };

    syncDimension();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncDimension);
      return () => window.removeEventListener("resize", syncDimension);
    }

    const observer = new ResizeObserver(syncDimension);
    observer.observe(element);
    return () => observer.disconnect();
  }, [key]);

  return { chartRef, initialDimension };
}

export default function Data({
  icons,
  refreshKey = 0,
  loadDataTrendSnapshot,
  mappingVersion = 0,
  onOpenHistoryDate,
  uiLanguage,
}: Props) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const [selectedTrendRange, setSelectedTrendRange] = useState<DataTrendRangeSelection>({ kind: "rolling", days: 7 });
  const [selectedAppTrendRange, setSelectedAppTrendRange] = useState<DataTrendRangeSelection>({ kind: "rolling", days: 7 });
  const [selectedAppKey, setSelectedAppKey] = useState<string | null>(null);
  const [appSearchQuery, setAppSearchQuery] = useState("");
  const initialCachedHeatmapSessions = getCachedDataHeatmapSessions("recent", Date.now());
  const [bootstrapSnapshot, setBootstrapSnapshot] = useState<DataBootstrapSnapshot | null>(
    () => getCachedDataBootstrapSnapshot(),
  );
  const overviewTrend = useDataTrendSnapshot({
    selection: selectedTrendRange,
    refreshKey,
    loadSnapshot: loadDataTrendSnapshot,
  });
  const appTrend = useDataTrendSnapshot({
    selection: selectedAppTrendRange,
    refreshKey,
    loadSnapshot: loadDataTrendSnapshot,
  });
  const [selectedHeatmapView, setSelectedHeatmapView] = useState<HeatmapSelection>("recent");
  const [heatmapGranularity, setHeatmapGranularity] = useState<HeatmapGranularity>("daily");
  const [earliestStartTime, setEarliestStartTime] = useState<number | null>(
    getCachedEarliestSessionStartTime() ?? null,
  );
  const [yearSessions, setYearSessions] = useState<AggregateSessionRecord[]>(
    () => initialCachedHeatmapSessions ?? [],
  );
  const [yearSessionsView, setYearSessionsView] = useState<HeatmapSelection | null>(
    initialCachedHeatmapSessions ? "recent" : null,
  );
  const [heatmapLoading, setHeatmapLoading] = useState(!initialCachedHeatmapSessions);
  const overviewTrendChart = useDataChartInitialDimension(
    "overviewTrend",
    getOverviewTrendChartInitialDimension,
  );
  const appTrendChart = useDataChartInitialDimension(
    "appTrend",
    getAppTrendChartInitialDimension,
  );
  const nowMs = overviewTrend.nowMs;
  const lastTrendViewModelRef = useRef<{
    rangeCacheKey: string;
    viewModel: DataTrendViewModel;
  } | null>(null);
  const lastAppTrendViewModelRef = useRef<{
    rangeCacheKey: string;
    viewModel: DataAppTrendViewModel;
  } | null>(null);
  const lastHeatmapRowsRef = useRef<{
    selection: HeatmapSelection;
    rows: ReturnType<typeof buildActivityHeatmap>;
  } | null>(null);
  const appListRef = useRef<HTMLDivElement | null>(null);
  const hasFetchedHeatmapOnceRef = useRef(Boolean(initialCachedHeatmapSessions));
  const activeTrendDateRef = useRef<string | null>(null);
  const activeAppTrendDateRef = useRef<string | null>(null);

  useEffect(() => {
    if (bootstrapSnapshot) return;

    let cancelled = false;
    void loadPersistedDataBootstrapSnapshot().then((snapshot) => {
      if (!cancelled) {
        setBootstrapSnapshot(snapshot);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bootstrapSnapshot]);

  useEffect(() => {
    void prewarmDataFirstScreen({
      mappingVersion,
      reason: "data-opened",
      uiLanguage,
    });
  }, [mappingVersion, uiLanguage]);

  useEffect(() => {
    let cancelled = false;
    const loadYear = async () => {
      const nowForRange = Date.now();
      const cachedSessions = getCachedDataHeatmapSessions(selectedHeatmapView, nowForRange);

      if (cachedSessions) {
        setYearSessions(cachedSessions);
        setYearSessionsView(selectedHeatmapView);
        hasFetchedHeatmapOnceRef.current = true;
        setHeatmapLoading(false);
      } else {
        setHeatmapLoading(true);
      }

      try {
        const snapshot = await loadDataHeatmapSnapshot(selectedHeatmapView, nowForRange);
        if (cancelled) return;

        setEarliestStartTime(snapshot.earliestStartTime);
        setYearSessions(snapshot.sessions);
        setYearSessionsView(selectedHeatmapView);
        hasFetchedHeatmapOnceRef.current = true;

        if (snapshot.earliestStartTime) {
          const earliestYear = new Date(snapshot.earliestStartTime).getFullYear();
          if (selectedHeatmapView !== "recent" && selectedHeatmapView < earliestYear) {
            setSelectedHeatmapView(earliestYear);
          }
        }
      } finally {
        if (!cancelled) {
          setHeatmapLoading(false);
        }
      }
    };

    void loadYear();
    return () => {
      cancelled = true;
    };
  }, [selectedHeatmapView, refreshKey]);

  const trendViewModel = useMemo(() => {
    if (!overviewTrend.snapshot) return null;
    return buildDataTrendViewModel(overviewTrend.snapshot.sessions, overviewTrend.snapshot.range, overviewTrend.nowMs);
  }, [mappingVersion, overviewTrend.nowMs, overviewTrend.snapshot]);
  if (trendViewModel) {
    lastTrendViewModelRef.current = {
      rangeCacheKey: overviewTrend.resolvedRange.cacheKey,
      viewModel: trendViewModel,
    };
  }
  const matchingBootstrapSnapshot = bootstrapSnapshot
    && bootstrapSnapshot.mappingVersion === mappingVersion
    && bootstrapSnapshot.uiLanguage === uiLanguage
    ? bootstrapSnapshot
    : null;
  const bootstrapTrendViewModel = matchingBootstrapSnapshot?.overviewRangeCacheKey === overviewTrend.resolvedRange.cacheKey
    ? matchingBootstrapSnapshot.overviewTrendViewModel
    : null;
  const visibleTrendViewModel = trendViewModel
    ?? (lastTrendViewModelRef.current?.rangeCacheKey === overviewTrend.resolvedRange.cacheKey
      ? lastTrendViewModelRef.current.viewModel
      : null)
    ?? bootstrapTrendViewModel;
  const appTrendViewModel = useMemo(() => {
    if (!appTrend.snapshot) return null;
    return buildDataAppTrendViewModel(appTrend.snapshot.sessions, appTrend.snapshot.range, appTrend.nowMs, selectedAppKey);
  }, [appTrend.nowMs, appTrend.snapshot, mappingVersion, selectedAppKey]);
  const bootstrapAppTrendViewModel = matchingBootstrapSnapshot?.appRangeCacheKey === appTrend.resolvedRange.cacheKey
    ? matchingBootstrapSnapshot.appTrendViewModel
    : null;
  if (appTrendViewModel) {
    lastAppTrendViewModelRef.current = {
      rangeCacheKey: appTrend.resolvedRange.cacheKey,
      viewModel: appTrendViewModel,
    };
  }
  const visibleAppTrendViewModel = appTrendViewModel
    ?? (lastAppTrendViewModelRef.current?.rangeCacheKey === appTrend.resolvedRange.cacheKey
      ? lastAppTrendViewModelRef.current.viewModel
      : null)
    ?? bootstrapAppTrendViewModel;

  useEffect(() => {
    if (selectedAppKey !== null) return;

    const defaultAppKey = appTrendViewModel?.selectedApp?.appKey;
    if (defaultAppKey) {
      setSelectedAppKey(defaultAppKey);
    }
  }, [appTrendViewModel?.selectedApp?.appKey, selectedAppKey]);

  const filteredAppOptions = useMemo(() => {
    if (!visibleAppTrendViewModel) return [];
    return filterDataAppOptionsForQuery(visibleAppTrendViewModel.appOptions, appSearchQuery);
  }, [appSearchQuery, visibleAppTrendViewModel]);

  const hasAppSearchQuery = appSearchQuery.trim().length > 0;
  const appTrendSelectedAppMatchesSearch = !hasAppSearchQuery
    || Boolean(
      visibleAppTrendViewModel?.selectedApp
      && filteredAppOptions.some((app) => app.appKey === visibleAppTrendViewModel.selectedApp?.appKey),
    );
  const appTrendSelectionHiddenBySearch = hasAppSearchQuery && !appTrendSelectedAppMatchesSearch;
  const selectedAppTrendApp = appTrendSelectionHiddenBySearch ? null : visibleAppTrendViewModel?.selectedApp;
  const appTrendChartData = appTrendSelectionHiddenBySearch && visibleAppTrendViewModel
    ? visibleAppTrendViewModel.chartData.map((point) => ({ ...point, duration: 0, hours: 0 }))
    : (visibleAppTrendViewModel?.chartData ?? []);
  const appTrendChartAxis = appTrendSelectionHiddenBySearch
    ? { domainMax: 3, ticks: [0, 1, 2, 3] }
    : (visibleAppTrendViewModel?.chartAxis ?? { domainMax: 3, ticks: [0, 1, 2, 3] });
  const appTrendPeakDay = appTrendSelectionHiddenBySearch ? null : visibleAppTrendViewModel?.peakDay;

  useEffect(() => {
    if (!hasAppSearchQuery || !visibleAppTrendViewModel) return;
    const firstMatch = filteredAppOptions[0];
    if (!firstMatch) return;
    const selectedAppKeyIsVisible = Boolean(
      visibleAppTrendViewModel.selectedApp
      && filteredAppOptions.some((app) => app.appKey === visibleAppTrendViewModel.selectedApp?.appKey),
    );
    const nextSelectedAppKey = selectedAppKeyIsVisible ? selectedAppKey : firstMatch.appKey;
    if (selectedAppKey !== nextSelectedAppKey) {
      setSelectedAppKey(nextSelectedAppKey);
    }
  }, [filteredAppOptions, hasAppSearchQuery, selectedAppKey, visibleAppTrendViewModel]);

  useLayoutEffect(() => {
    appListRef.current?.scrollTo({ top: 0 });
  }, [hasAppSearchQuery]);

  const handleAppSearchQueryChange = (nextQuery: string) => {
    const wasSearching = appSearchQuery.trim().length > 0;
    const isSearching = nextQuery.trim().length > 0;
    setAppSearchQuery(nextQuery);
    appListRef.current?.scrollTo({ top: 0 });
    if (wasSearching && !isSearching) {
      setSelectedAppKey(null);
      return;
    }

    if (isSearching && visibleAppTrendViewModel) {
      const nextOptions = filterDataAppOptionsForQuery(visibleAppTrendViewModel.appOptions, nextQuery);
      const selectedAppKeyIsVisible = Boolean(
        visibleAppTrendViewModel.selectedApp
        && nextOptions.some((app) => app.appKey === visibleAppTrendViewModel.selectedApp?.appKey),
      );
      const firstMatch = nextOptions[0];
      if (!selectedAppKeyIsVisible && firstMatch) {
        setSelectedAppKey(firstMatch.appKey);
      }
    }
  };
  const heatmapRows = useMemo(() => (
    buildActivityHeatmap(yearSessions, selectedHeatmapView, nowMs)
  ), [nowMs, selectedHeatmapView, yearSessions]);
  const hasHeatmapRowsForSelectedView = yearSessionsView === selectedHeatmapView;
  if (!heatmapLoading && hasHeatmapRowsForSelectedView) {
    lastHeatmapRowsRef.current = {
      selection: selectedHeatmapView,
      rows: heatmapRows,
    };
  }
  const bootstrapHeatmapRows = matchingBootstrapSnapshot?.heatmapSelection === selectedHeatmapView
    ? matchingBootstrapSnapshot.heatmapRows
    : null;
  const heatmapPlaceholderRows = useMemo(() => (
    buildActivityHeatmap([], selectedHeatmapView, nowMs)
  ), [nowMs, selectedHeatmapView]);
  const canUseBootstrapHeatmap = Boolean(bootstrapHeatmapRows && (heatmapLoading || !hasHeatmapRowsForSelectedView));
  const visibleHeatmapRows = !heatmapLoading && hasHeatmapRowsForSelectedView
    ? heatmapRows
    : lastHeatmapRowsRef.current?.selection === selectedHeatmapView
      ? lastHeatmapRowsRef.current.rows
      : canUseBootstrapHeatmap
    ? bootstrapHeatmapRows!
        : heatmapPlaceholderRows;
  const weeklyHeatmapCells = useMemo(
    () => buildWeeklyHeatmapCells(visibleHeatmapRows),
    [visibleHeatmapRows],
  );
  const weeklyHeatmapCellsByKey = useMemo(
    () => new Map(weeklyHeatmapCells.map((cell) => [cell.key, cell])),
    [weeklyHeatmapCells],
  );
  const heatmapGranularityOptions = useMemo<Array<{ value: HeatmapGranularity; label: string }>>(() => [
    { value: "daily", label: UI_TEXT.data.heatmapDaily },
    { value: "weekly", label: UI_TEXT.data.heatmapWeekly },
  ], [uiLanguage]);
  const selectedHeatmapViewKey = String(selectedHeatmapView);
  const yearOptions = useMemo(
    () => buildYearOptions(earliestStartTime, currentYear),
    [currentYear, earliestStartTime],
  );
  const heatmapViewOptions = useMemo<HeatmapSelection[]>(
    () => ["recent", ...yearOptions],
    [yearOptions],
  );
  const selectedHeatmapViewIndex = heatmapViewOptions.findIndex((option) => option === selectedHeatmapView);
  const canSelectOlderHeatmapView = selectedHeatmapViewIndex >= 0
    && selectedHeatmapViewIndex < heatmapViewOptions.length - 1;
  const canSelectNewerHeatmapView = selectedHeatmapViewIndex > 0;
  const selectAdjacentHeatmapView = (delta: number) => {
    if (selectedHeatmapViewIndex < 0) return;
    const nextView = heatmapViewOptions[selectedHeatmapViewIndex + delta];
    if (nextView !== undefined) {
      setHeatmapLoading(true);
      setSelectedHeatmapView(nextView);
    }
  };
  const selectedHeatmapViewLabel = selectedHeatmapView === "recent"
    ? UI_TEXT.data.recentYear
    : String(selectedHeatmapView);
  const canOpenTrendHistory = visibleTrendViewModel?.granularity === "day" && Boolean(onOpenHistoryDate);
  const canOpenAppTrendHistory = visibleAppTrendViewModel?.granularity === "day"
    && !appTrendSelectionHiddenBySearch
    && Boolean(onOpenHistoryDate);
  const handleTrendMouseMove = (event: unknown) => {
    activeTrendDateRef.current = canOpenTrendHistory && visibleTrendViewModel
      ? resolveTrendDateFromChartEvent(event, visibleTrendViewModel.chartData)
      : null;
  };
  const handleTrendDoubleClick = () => {
    const dateKey = activeTrendDateRef.current;
    if (dateKey && canOpenTrendHistory) {
      onOpenHistoryDate?.(dateKey);
    }
  };
  const handleAppTrendMouseMove = (event: unknown) => {
    activeAppTrendDateRef.current = canOpenAppTrendHistory
      ? resolveTrendDateFromChartEvent(event, appTrendChartData)
      : null;
  };
  const handleAppTrendDoubleClick = () => {
    const dateKey = activeAppTrendDateRef.current;
    if (dateKey && canOpenAppTrendHistory) {
      onOpenHistoryDate?.(dateKey);
    }
  };
  const preventChartTextSelection = (event: MouseEvent<HTMLDivElement>, canOpenHistory: boolean) => {
    if (canOpenHistory && event.detail > 1) {
      event.preventDefault();
    }
  };
  const handleTrendDoubleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!canOpenTrendHistory) {
      return;
    }

    event.preventDefault();
    handleTrendDoubleClick();
  };
  const handleAppTrendDoubleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!canOpenAppTrendHistory) {
      return;
    }

    event.preventDefault();
    handleAppTrendDoubleClick();
  };

  useEffect(() => {
    if (!trendViewModel || !appTrendViewModel) return;
    if (heatmapLoading || yearSessionsView !== selectedHeatmapView) return;
    if (!overviewTrend.snapshot || !appTrend.snapshot) return;

    const snapshot: DataBootstrapSnapshot = {
      createdAtMs: Date.now(),
      overviewRangeCacheKey: overviewTrend.snapshot.range.cacheKey,
      appRangeCacheKey: appTrend.snapshot.range.cacheKey,
      heatmapSelection: selectedHeatmapView,
      mappingVersion,
      uiLanguage,
      overviewTrendViewModel: trendViewModel,
      appTrendViewModel,
      heatmapRows,
      earliestStartTime,
    };

    setBootstrapSnapshot(snapshot);
    void saveDataBootstrapSnapshot(snapshot);
  }, [
    appTrend.snapshot,
    appTrendViewModel,
    earliestStartTime,
    heatmapLoading,
    heatmapRows,
    mappingVersion,
    overviewTrend.snapshot,
    selectedHeatmapView,
    trendViewModel,
    uiLanguage,
    yearSessionsView,
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 md:gap-5 overflow-y-auto pr-1 custom-scrollbar">
      <QuietPageHeader
        icon={<BarChart3 size={18} />}
        title={UI_TEXT.data.title}
        subtitle={UI_TEXT.data.subtitle}
      />

      <div className="data-dashboard-grid">
      <div className="data-overview-grid">
        <div className="qp-panel p-5 md:p-6 data-trend-panel">
          <div className="data-trend-header">
            <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">
              {UI_TEXT.data.activityTrend}
            </h3>
            <div className="data-trend-inline-metrics" aria-label={UI_TEXT.accessibility.data.trendSummary}>
              <div className="data-trend-inline-metric">
                <Clock3 size={13} aria-hidden />
                <span>{visibleTrendViewModel?.metricLabels.total ?? UI_TEXT.data.weeklyTotal}</span>
                <strong>{visibleTrendViewModel ? formatDuration(visibleTrendViewModel.totalDuration) : "-"}</strong>
              </div>
              <div className="data-trend-inline-metric">
                <CalendarDays size={13} aria-hidden />
                <span>{visibleTrendViewModel?.metricLabels.average ?? UI_TEXT.data.dailyAverage}</span>
                <strong>{visibleTrendViewModel ? formatDuration(visibleTrendViewModel.averageDuration) : "-"}</strong>
              </div>
            </div>
            <DataTrendRangeControl
              ariaLabel={UI_TEXT.accessibility.data.trendRange}
              selection={selectedTrendRange}
              onChange={setSelectedTrendRange}
            />
          </div>
          <div className="pt-4">
            {!visibleTrendViewModel ? (
              <div
                className="data-trend-chart data-chart-placeholder flex items-center justify-center text-[var(--qp-text-tertiary)] text-xs"
                aria-hidden="true"
              />
            ) : (
              <div
                ref={overviewTrendChart.chartRef}
                className={`data-trend-chart ${canOpenTrendHistory ? "data-chart-openable" : ""}`}
                onMouseDownCapture={(event) => {
                  preventChartTextSelection(event, canOpenTrendHistory);
                }}
                onDoubleClickCapture={handleTrendDoubleClickCapture}
              >
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  initialDimension={overviewTrendChart.initialDimension}
                >
                  <AreaChart
                    data={visibleTrendViewModel.chartData}
                    margin={{ top: 8, right: 22, left: -18, bottom: 0 }}
                    onMouseMove={handleTrendMouseMove}
                    onMouseLeave={() => {
                      activeTrendDateRef.current = null;
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--qp-chart-grid)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 11, fill: "var(--qp-text-tertiary)" }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={DATA_TREND_X_AXIS_MIN_TICK_GAP}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: "var(--qp-text-tertiary)" }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                      ticks={visibleTrendViewModel.chartAxis.ticks}
                      domain={[0, visibleTrendViewModel.chartAxis.domainMax]}
                      tickFormatter={(value) => formatChartHours(Number(value))}
                    />
                    <QuietChartTooltip
                      formatter={(value) => [
                        formatDuration(Number(value) * 3600000),
                        UI_TEXT.data.duration,
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="hours"
                      stroke="var(--qp-accent-default)"
                      strokeWidth={2}
                      fill="var(--qp-accent-default)"
                      fillOpacity={0.12}
                      dot={{ fill: "var(--qp-accent-default)", r: 3 }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>

        <div className="qp-panel p-5 md:p-6 data-heatmap-panel">
          <div className="data-heatmap-panel-header">
            <div>
              <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">{UI_TEXT.data.activityHeatmap}</h3>
              <p className="mt-1 text-[11px] text-[var(--qp-text-tertiary)]">
                {selectedHeatmapViewLabel} · {UI_TEXT.data.activityHeatmapHint}
              </p>
            </div>
            <div className="data-heatmap-header-actions">
              <QuietSegmentedFilter
                value={heatmapGranularity}
                options={heatmapGranularityOptions}
                onChange={setHeatmapGranularity}
                className="data-heatmap-granularity"
              />
              <div className="data-heatmap-range-control" aria-label={UI_TEXT.accessibility.data.heatmapRange}>
                <button
                  type="button"
                  onClick={() => selectAdjacentHeatmapView(1)}
                  disabled={!canSelectOlderHeatmapView}
                  className="qp-control data-heatmap-range-arrow"
                  aria-label={UI_TEXT.accessibility.data.earlierRange}
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  className="qp-status data-heatmap-range-label"
                  disabled
                >
                  {selectedHeatmapViewLabel}
                </button>
                <button
                  type="button"
                  onClick={() => selectAdjacentHeatmapView(-1)}
                  disabled={!canSelectNewerHeatmapView}
                  className="qp-control data-heatmap-range-arrow"
                  aria-label={UI_TEXT.accessibility.data.newerRange}
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>

          <div
            className="data-heatmap data-heatmap-calendar mt-5"
          >
              <div className="data-heatmap-content">
                  <div
                    className="data-heatmap-scroll"
                    style={{ "--data-heatmap-week-count": visibleHeatmapRows.length } as CSSProperties}
                  >
                    <div className="data-heatmap-months" aria-hidden>
                      <span />
                      {visibleHeatmapRows.map((week) => (
                        <span key={`${selectedHeatmapViewKey}:${week.key}`}>{week.monthLabel}</span>
                      ))}
                    </div>
                    <div className="data-heatmap-body" aria-label={UI_TEXT.data.activityHeatmap}>
                      <div className="data-heatmap-weekdays" aria-hidden>
                        {UI_TEXT.date.heatmapWeekdays.map((weekday, index) => (
                          <span key={`${weekday}-${index}`}>{weekday}</span>
                        ))}
                      </div>
                      <div className="data-heatmap-weeks">
                        {visibleHeatmapRows.map((week) => {
                          const weeklyCell = weeklyHeatmapCellsByKey.get(week.key);
                          return (
                            <div key={`${selectedHeatmapViewKey}:${week.key}`} className="data-heatmap-week">
                              {week.cells.map((cell, cellIndex) => {
                                const hideRecentDailyFutureCell = heatmapGranularity === "daily"
                                  && selectedHeatmapView === "recent"
                                  && cell.isFuture;
                                if (hideRecentDailyFutureCell) {
                                  return null;
                                }

                                const isDailyFutureCell = heatmapGranularity === "daily" && cell.isFuture;
                                const isUnavailable = isDailyFutureCell || cell.isOutsideYear;
                                const canOpenHistoryDate = !cell.isFuture && !cell.isOutsideYear && Boolean(onOpenHistoryDate);
                                const tooltipLabel = heatmapGranularity === "weekly"
                                  ? weeklyCell?.label ?? cell.label
                                  : cell.label;
                                const isWeeklyFutureCell = heatmapGranularity === "weekly"
                                  && Boolean(weeklyCell?.isFuture);
                                const tooltipDisabled = heatmapGranularity === "weekly"
                                  ? cell.isOutsideYear || isWeeklyFutureCell
                                  : isUnavailable;
                                const isWeeklyFilledCell = heatmapGranularity === "weekly"
                                  && !cell.isOutsideYear
                                  && cellIndex >= HEATMAP_WEEKDAY_COUNT - (weeklyCell?.activeRows ?? 0);
                                const heatmapIntensity = heatmapGranularity === "weekly"
                                  ? isWeeklyFilledCell ? weeklyCell?.intensity ?? 0 : 0
                                  : cell.intensity;
                                return (
                                  <QuietTooltip
                                    key={`${selectedHeatmapViewKey}:${cell.key}`}
                                    label={tooltipLabel}
                                    placement="top"
                                    disabled={tooltipDisabled}
                                    className={`data-heatmap-tooltip-anchor ${
                                      tooltipDisabled ? "data-heatmap-tooltip-anchor-unavailable" : ""
                                    }`}
                                  >
                                    <span
                                      className={`data-heatmap-cell ${
                                        canOpenHistoryDate ? "data-heatmap-cell-openable" : ""
                                      } ${
                                        isDailyFutureCell || isWeeklyFutureCell ? "data-heatmap-cell-future" : ""
                                      } ${cell.isOutsideYear ? "data-heatmap-cell-outside" : ""}`}
                                      onDoubleClick={() => {
                                        if (canOpenHistoryDate) {
                                          onOpenHistoryDate?.(cell.date);
                                        }
                                      }}
                                      data-history-date={canOpenHistoryDate ? cell.date : undefined}
                                      style={{ "--heatmap-intensity": heatmapIntensity } as CSSProperties}
                                    />
                                  </QuietTooltip>
                                );
                              })}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
              </div>
            </div>
        </div>
      </div>

      <div className="qp-panel p-5 md:p-6 data-app-panel">
        <div className="data-app-panel-header">
          <div>
            <h3 className="font-semibold text-[var(--qp-text-primary)] text-sm">
              {UI_TEXT.data.appTrend}
            </h3>
          </div>
          <div className="data-app-header-actions">
            <div className={`data-app-selected-status ${selectedAppTrendApp ? "" : "data-app-selected-status-empty"}`}>
              {selectedAppTrendApp && icons[selectedAppTrendApp.exeName] ? (
                <img
                  src={icons[selectedAppTrendApp.exeName]}
                  alt=""
                  draggable={false}
                />
              ) : selectedAppTrendApp ? (
                getAppInitial(selectedAppTrendApp.appName)
              ) : (
                ""
              )}
            </div>
            <DataTrendRangeControl
              ariaLabel={UI_TEXT.accessibility.data.appTrendRange}
              selection={selectedAppTrendRange}
              onChange={setSelectedAppTrendRange}
            />
          </div>
        </div>

        {!visibleAppTrendViewModel ? (
          <div className="data-app-loading text-[var(--qp-text-tertiary)] text-xs" aria-hidden="true" />
        ) : visibleAppTrendViewModel.appOptions.length === 0 ? (
          <div className="data-app-loading text-[var(--qp-text-tertiary)] text-xs">
            {UI_TEXT.data.appTrendEmpty}
          </div>
        ) : (
          <div className="data-app-grid">
            <div className="data-app-sidebar">
              <label className="data-app-search">
                <Search size={14} aria-hidden />
                <input
                  value={appSearchQuery}
                  onChange={(event) => handleAppSearchQueryChange(event.target.value)}
                  placeholder={UI_TEXT.data.appSearchPlaceholder}
                  aria-label={UI_TEXT.data.appSearchPlaceholder}
                />
              </label>
              <div
                key={hasAppSearchQuery ? "searching" : "all"}
                ref={appListRef}
                className="data-app-list data-app-trend-list"
                aria-label={UI_TEXT.data.appTrendAppList}
              >
                {filteredAppOptions.length === 0 ? (
                  <div className="data-app-empty text-[var(--qp-text-tertiary)] text-xs">
                    {UI_TEXT.data.appTrendNoMatch}
                  </div>
                ) : filteredAppOptions.map((app) => {
                  const isSelected = selectedAppTrendApp?.appKey === app.appKey;
                  return (
                    <button
                      key={app.appKey}
                      type="button"
                      className={`data-app-option ${isSelected ? "data-app-option-selected" : ""}`}
                      onClick={() => setSelectedAppKey(app.appKey)}
                      aria-pressed={isSelected}
                    >
                      <span className="data-app-option-icon" aria-hidden>
                        {icons[app.exeName] ? (
                          <img src={icons[app.exeName]} alt="" draggable={false} />
                        ) : (
                          getAppInitial(app.appName)
                        )}
                      </span>
                      <span className="data-app-option-main">
                        <span className="data-app-option-name">{app.appName}</span>
                        <span className="data-app-option-meta">{Math.round(app.percentage)}% · {app.exeName}</span>
                      </span>
                      <span className="data-app-option-duration">
                        {formatDuration(app.totalDuration)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="data-app-chart-column">
              <div className="data-app-metric-strip">
                <div className="data-app-metric">
                  <span>{UI_TEXT.data.appTrendTotal}</span>
                  <strong>{formatDuration(selectedAppTrendApp?.totalDuration ?? 0)}</strong>
                </div>
                <div className="data-app-metric">
                  <span>{visibleAppTrendViewModel.granularity === "month" ? UI_TEXT.data.monthlyAverage : UI_TEXT.data.appTrendAverage}</span>
                  <strong>{formatDuration(selectedAppTrendApp?.averageDuration ?? 0)}</strong>
                </div>
                <div className="data-app-metric">
                  <span>{UI_TEXT.data.appTrendActiveDays}</span>
                  <strong>{selectedAppTrendApp?.activeDayCount ?? 0}</strong>
                </div>
                <div className="data-app-metric">
                  <span>{UI_TEXT.data.appTrendPeakDay}</span>
                  <strong>{appTrendPeakDay ? formatDuration(appTrendPeakDay.duration) : "-"}</strong>
                </div>
              </div>
              <div
                ref={appTrendChart.chartRef}
                className={`data-app-chart ${canOpenAppTrendHistory ? "data-chart-openable" : ""}`}
                onMouseDownCapture={(event) => {
                  preventChartTextSelection(event, canOpenAppTrendHistory);
                }}
                onDoubleClickCapture={handleAppTrendDoubleClickCapture}
              >
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  initialDimension={appTrendChart.initialDimension}
                >
                  <AreaChart
                    data={appTrendChartData}
                    margin={{ top: 10, right: 18, left: -20, bottom: 0 }}
                    onMouseMove={handleAppTrendMouseMove}
                    onMouseLeave={() => {
                      activeAppTrendDateRef.current = null;
                    }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--qp-border-subtle)" strokeOpacity={0.58} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "var(--qp-text-tertiary)" }}
                      axisLine={false}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={DATA_TREND_X_AXIS_MIN_TICK_GAP}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "var(--qp-text-tertiary)" }}
                      axisLine={false}
                      tickLine={false}
                      ticks={appTrendChartAxis.ticks}
                      domain={[0, appTrendChartAxis.domainMax]}
                      tickFormatter={(value) => formatChartHours(Number(value))}
                    />
                    <QuietChartTooltip
                      formatter={(value) => [
                        formatDuration(Number(value) * 3600000),
                        UI_TEXT.data.appTrendUsage,
                      ]}
                    />
                    <Area
                      type="monotone"
                      dataKey="hours"
                      stroke="var(--qp-accent-default)"
                      strokeWidth={2}
                      fill="var(--qp-accent-default)"
                      fillOpacity={0.1}
                      dot={{ fill: "var(--qp-accent-default)", r: 2.5 }}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

          </div>
        )}
      </div>
      </div>
    </div>
  );
}
