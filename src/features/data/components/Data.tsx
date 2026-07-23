import { startTransition, type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import { useRequestedAppIcons } from "../../../shared/hooks/useRequestedAppIcons.ts";
import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import type { WebActivitySegment, WebDomainOverride } from "../../../shared/types/webActivity.ts";
import {
  buildDataTrendAggregateContext,
  buildDataTrendViewModel,
  getCachedDataHeatmapSessions,
  getCachedEarliestSessionStartTime,
  type DataTrendViewModel,
  type AggregateSessionRecord,
  loadDataHeatmapSnapshot,
} from "../services/dataReadModel.ts";
import {
  buildActivityHeatmap,
  buildYearOptions,
  type HeatmapSelection,
} from "../services/dataHeatmapReadModel.ts";
import {
  getCachedDataBootstrapSnapshot,
  loadPersistedDataBootstrapSnapshot,
  saveDataBootstrapSnapshot,
  type DataBootstrapSnapshot,
} from "../services/dataBootstrapSnapshot.ts";
import { prewarmDataFirstScreen } from "../services/dataFirstScreenPrewarm.ts";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking";
import { resolveTrendDateFromChartEvent } from "../services/dataChartInteraction.ts";
import type { DataTrendSnapshot } from "../services/dataTrendSnapshot.ts";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import { useDataTrendSnapshot } from "../hooks/useDataTrendSnapshot.ts";
import { loadDataIconsForExecutables } from "../services/dataIconService.ts";
import { scheduleDataWorkAfterFirstPaint } from "../services/dataFirstPaintScheduler.ts";
import DataTrendPanel from "./DataTrendPanel.tsx";
import DataHeatmapPanel, { type HeatmapGranularity } from "./DataHeatmapPanel.tsx";
import {
  getWebActivitySegmentsInRange,
  getWebFaviconsForDomains,
  loadWebDomainOverrides,
} from "../../../platform/persistence/webActivityRepository.ts";
import { useIconThemeColors } from "../../../shared/hooks/useIconThemeColors.ts";

interface Props {
  icons: Record<string, string>;
  refreshKey?: number;
  trackerHealth: TrackerHealthSnapshot;
  loadDataTrendSnapshot: (selection: DataTrendRangeSelection, nowMs?: number) => Promise<DataTrendSnapshot>;
  mappingVersion?: number;
  onOpenHistoryDate?: (dateKey: string) => void;
  uiLanguage: AppLanguage;
  webActivityEnabled: boolean;
}

type DataChartDimension = { width: number; height: number };
type DataChartDimensionKey = "overviewTrend";
const CACHED_DATA_HEATMAP_REFRESH_DELAY_MS = 320;
const CACHED_DATA_HEATMAP_REFRESH_IDLE_TIMEOUT_MS = 1_500;
const DATA_OPEN_PREWARM_DELAY_MS = 500;
const DATA_OPEN_PREWARM_IDLE_TIMEOUT_MS = 2_000;
const EMPTY_DATA_ICON_EXE_NAMES: string[] = [];
const EMPTY_HEATMAP_ROWS: ReturnType<typeof buildActivityHeatmap> = [];
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
  webActivityEnabled,
}: Props) {
  const today = new Date();
  const currentYear = today.getFullYear();
  const [selectedTrendRange, setSelectedTrendRange] = useState<DataTrendRangeSelection>({ kind: "rolling", days: 7 });
  const [freshReadModelsReady, setFreshReadModelsReady] = useState(false);
  const [initialCachedHeatmapSessions] = useState(() => getCachedDataHeatmapSessions("recent", Date.now()));
  const [bootstrapSnapshot, setBootstrapSnapshot] = useState<DataBootstrapSnapshot | null>(
    () => getCachedDataBootstrapSnapshot(),
  );
  const overviewTrend = useDataTrendSnapshot({
    selection: selectedTrendRange,
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
  const [webSegments, setWebSegments] = useState<WebActivitySegment[]>([]);
  const [webDomainFavicons, setWebDomainFavicons] = useState<Record<string, string>>({});
  const [webDomainOverrides, setWebDomainOverrides] = useState<Record<string, WebDomainOverride>>({});
  const overviewTrendChart = useDataChartInitialDimension(
    "overviewTrend",
    getOverviewTrendChartInitialDimension,
  );
  const nowMs = overviewTrend.nowMs;
  const lastTrendViewModelRef = useRef<{
    rangeCacheKey: string;
    viewModel: DataTrendViewModel;
  } | null>(null);
  const lastHeatmapRowsRef = useRef<{
    selection: HeatmapSelection;
    rows: ReturnType<typeof buildActivityHeatmap>;
  } | null>(null);
  const hasFetchedHeatmapOnceRef = useRef(Boolean(initialCachedHeatmapSessions));
  const activeTrendDateRef = useRef<string | null>(null);
  const hasInitialBootstrapSnapshotRef = useRef(Boolean(bootstrapSnapshot));
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
    return scheduleDataWorkAfterFirstPaint(() => {
      void prewarmDataFirstScreen({
        mappingVersion,
        reason: "data-opened",
        uiLanguage,
      });
    }, DATA_OPEN_PREWARM_IDLE_TIMEOUT_MS, DATA_OPEN_PREWARM_DELAY_MS);
  }, [mappingVersion, uiLanguage]);

  useEffect(() => {
    let cancelled = false;
    let cancelScheduledLoad: (() => void) | null = null;
    const loadYearSnapshot = async () => {
      const nowForRange = Date.now();
      try {
        const snapshot = await loadDataHeatmapSnapshot(selectedHeatmapView, nowForRange);
        if (cancelled) return;

        startTransition(() => {
          setEarliestStartTime(snapshot.earliestStartTime);
          setYearSessions(snapshot.sessions);
          setYearSessionsView(selectedHeatmapView);
        });
        hasFetchedHeatmapOnceRef.current = true;

        if (snapshot.earliestStartTime) {
          const earliestYear = new Date(snapshot.earliestStartTime).getFullYear();
          if (selectedHeatmapView !== "recent" && selectedHeatmapView < earliestYear) {
            startTransition(() => {
              setSelectedHeatmapView(earliestYear);
            });
          }
        }
      } finally {
        if (!cancelled) {
          setHeatmapLoading(false);
        }
      }
    };
    const scheduleLoadYear = () => {
      const nowForRange = Date.now();
      const cachedSessions = getCachedDataHeatmapSessions(selectedHeatmapView, nowForRange);

      if (cachedSessions) {
        startTransition(() => {
          setYearSessions(cachedSessions);
          setYearSessionsView(selectedHeatmapView);
        });
        hasFetchedHeatmapOnceRef.current = true;
        setHeatmapLoading(false);
      } else {
        setHeatmapLoading(true);
      }

      if (cachedSessions) {
        cancelScheduledLoad = scheduleDataWorkAfterFirstPaint(() => {
          void loadYearSnapshot();
        }, CACHED_DATA_HEATMAP_REFRESH_IDLE_TIMEOUT_MS, CACHED_DATA_HEATMAP_REFRESH_DELAY_MS);
        return;
      }

      void loadYearSnapshot();
    };

    scheduleLoadYear();
    return () => {
      cancelled = true;
      cancelScheduledLoad?.();
    };
  }, [selectedHeatmapView, refreshKey]);

  const matchingBootstrapSnapshot = bootstrapSnapshot
    && bootstrapSnapshot.mappingVersion === mappingVersion
    && bootstrapSnapshot.uiLanguage === uiLanguage
    ? bootstrapSnapshot
    : null;
  const shouldDeferRuntimeReadModels = hasInitialBootstrapSnapshotRef.current
    && Boolean(matchingBootstrapSnapshot)
    && !freshReadModelsReady;
  const overviewTrendSnapshotForViewModel = shouldDeferRuntimeReadModels ? null : overviewTrend.snapshot;

  useEffect(() => {
    if (!hasInitialBootstrapSnapshotRef.current || !matchingBootstrapSnapshot || freshReadModelsReady) {
      return undefined;
    }

    return scheduleDataWorkAfterFirstPaint(() => {
      setFreshReadModelsReady(true);
    });
  }, [freshReadModelsReady, matchingBootstrapSnapshot]);

  const overviewAggregateContext = useMemo(() => {
    if (!overviewTrendSnapshotForViewModel) return null;
    return buildDataTrendAggregateContext(
      overviewTrendSnapshotForViewModel.sessions,
      overviewTrendSnapshotForViewModel.range,
      overviewTrend.nowMs,
    );
  // Data aggregators read module-level locale/mapping state; these tokens explicitly invalidate that cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mappingVersion,
    overviewTrend.nowMs,
    overviewTrendSnapshotForViewModel,
    uiLanguage,
  ]);

  useEffect(() => {
    if (!webActivityEnabled || !overviewAggregateContext) return;

    let cancelled = false;
    const range = overviewAggregateContext.range;

    const loadWebData = async () => {
      try {
        const [segments, overrides] = await Promise.all([
          getWebActivitySegmentsInRange(range.startMs, range.endMs),
          loadWebDomainOverrides(),
        ]);
        if (cancelled) return;

        setWebSegments((prev) => {
          if (prev === segments) return prev;
          return segments;
        });
        setWebDomainOverrides((prev) => {
          if (prev === overrides) return prev;
          return overrides;
        });

        const domains = Array.from(new Set(segments.map((s) => s.normalizedDomain)));
        if (domains.length > 0) {
          const favicons = await getWebFaviconsForDomains(domains);
          if (!cancelled) {
            setWebDomainFavicons((prev) => {
              const prevKeys = Object.keys(prev).sort().join(",");
              const nextKeys = Object.keys(favicons).sort().join(",");
              if (prevKeys === nextKeys && prevKeys.length === 0) return prev;
              return favicons;
            });
          }
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to load web activity data for data panel:", error);
        }
      }
    };

    void loadWebData();
    return () => {
      cancelled = true;
    };
  }, [overviewAggregateContext, webActivityEnabled]);

  const webDomainIcons = useMemo(() => {
    if (!webActivityEnabled) return {};
    const next: Record<string, string> = { ...webDomainFavicons };
    for (const segment of webSegments) {
      if (segment.faviconUrl && !next[segment.normalizedDomain]) {
        next[segment.normalizedDomain] = segment.faviconUrl;
      }
    }
    return next;
  }, [webActivityEnabled, webDomainFavicons, webSegments]);

  const webDomainIconThemeColors = useIconThemeColors(webDomainIcons);

  const trendViewModel = useMemo(() => {
    if (!overviewTrendSnapshotForViewModel) return null;
    return buildDataTrendViewModel(
      overviewTrendSnapshotForViewModel.sessions,
      overviewTrendSnapshotForViewModel.range,
      overviewTrend.nowMs,
      webSegments,
    );
  // Data view models read module-level locale/mapping state; these tokens explicitly invalidate that cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mappingVersion,
    overviewTrend.nowMs,
    overviewTrendSnapshotForViewModel,
    uiLanguage,
    webSegments,
  ]);
  if (trendViewModel) {
    lastTrendViewModelRef.current = {
      rangeCacheKey: overviewTrend.resolvedRange.cacheKey,
      viewModel: trendViewModel,
    };
  }
  const bootstrapTrendViewModel = matchingBootstrapSnapshot?.overviewRangeCacheKey === overviewTrend.resolvedRange.cacheKey
    ? matchingBootstrapSnapshot.overviewTrendViewModel
    : null;
  const visibleTrendViewModel = trendViewModel
    ?? (lastTrendViewModelRef.current?.rangeCacheKey === overviewTrend.resolvedRange.cacheKey
      ? lastTrendViewModelRef.current.viewModel
      : null)
    ?? bootstrapTrendViewModel;
  const dataIconExeNames = useMemo(() => {
    if (!overviewAggregateContext) return EMPTY_DATA_ICON_EXE_NAMES;
    const exeNames = new Set<string>();
    for (const bucket of overviewAggregateContext.aggregate.appBuckets.values()) {
      exeNames.add(bucket.exeName);
    }
    return Array.from(exeNames);
  }, [overviewAggregateContext]);
  const snapshotDataIcons = useMemo(() => ({
    ...(overviewTrend.snapshot?.icons ?? {}),
  }), [overviewTrend.snapshot]);
  const baseDataIcons = useMemo(() => ({
    ...icons,
    ...snapshotDataIcons,
  }), [icons, snapshotDataIcons]);
  const handleDataIconsError = useCallback((error: unknown) => {
    console.warn("Failed to refresh data app icons:", error);
  }, []);
  const dataIcons = useRequestedAppIcons({
    baseIcons: baseDataIcons,
    exeNames: dataIconExeNames,
    loadIcons: loadDataIconsForExecutables,
    onError: handleDataIconsError,
  });

  const shouldDeferHeatmapRows = Boolean(
    hasInitialBootstrapSnapshotRef.current
    && matchingBootstrapSnapshot?.heatmapSelection === selectedHeatmapView
    && !freshReadModelsReady,
  );
  const heatmapRows = useMemo<ReturnType<typeof buildActivityHeatmap> | null>(() => {
    if (shouldDeferHeatmapRows) return null;
    return buildActivityHeatmap(yearSessions, selectedHeatmapView, nowMs);
  }, [nowMs, selectedHeatmapView, shouldDeferHeatmapRows, yearSessions]);
  const hasHeatmapRowsForSelectedView = yearSessionsView === selectedHeatmapView;
  if (heatmapRows && !heatmapLoading && hasHeatmapRowsForSelectedView) {
    lastHeatmapRowsRef.current = {
      selection: selectedHeatmapView,
      rows: heatmapRows,
    };
  }
  const bootstrapHeatmapRows = matchingBootstrapSnapshot?.heatmapSelection === selectedHeatmapView
    ? matchingBootstrapSnapshot.heatmapRows
    : null;
  const freshHeatmapRows = heatmapRows && !heatmapLoading && hasHeatmapRowsForSelectedView ? heatmapRows : null;
  const lastHeatmapRows = lastHeatmapRowsRef.current?.selection === selectedHeatmapView
    ? lastHeatmapRowsRef.current.rows
    : null;
  const canUseBootstrapHeatmap = Boolean(
    bootstrapHeatmapRows && (shouldDeferHeatmapRows || heatmapLoading || !hasHeatmapRowsForSelectedView),
  );
  const shouldBuildHeatmapPlaceholderRows = !freshHeatmapRows && !lastHeatmapRows && !canUseBootstrapHeatmap;
  const heatmapPlaceholderRows = useMemo(() => (
    shouldBuildHeatmapPlaceholderRows ? buildActivityHeatmap([], selectedHeatmapView, nowMs) : null
  ), [nowMs, selectedHeatmapView, shouldBuildHeatmapPlaceholderRows]);
  const visibleHeatmapRows = freshHeatmapRows
    ?? lastHeatmapRows
    ?? (canUseBootstrapHeatmap ? bootstrapHeatmapRows : null)
    ?? heatmapPlaceholderRows
    ?? EMPTY_HEATMAP_ROWS;
  const heatmapGranularityOptions = useMemo<Array<{ value: HeatmapGranularity; label: string }>>(() => [
    { value: "daily", label: UI_TEXT.data.heatmapDaily },
    { value: "weekly", label: UI_TEXT.data.heatmapWeekly },
  // UI_TEXT is module state; uiLanguage is its explicit invalidation signal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const selectAdjacentHeatmapView = useCallback((delta: number) => {
    if (selectedHeatmapViewIndex < 0) return;
    const nextView = heatmapViewOptions[selectedHeatmapViewIndex + delta];
    if (nextView !== undefined) {
      setHeatmapLoading(true);
      setSelectedHeatmapView(nextView);
    }
  }, [heatmapViewOptions, selectedHeatmapViewIndex]);
  const selectedHeatmapViewLabel = selectedHeatmapView === "recent"
    ? UI_TEXT.data.recentYear
    : String(selectedHeatmapView);
  const canOpenTrendHistory = visibleTrendViewModel?.granularity === "day" && Boolean(onOpenHistoryDate);
  const handleTrendMouseMove = useCallback((event: unknown) => {
    activeTrendDateRef.current = canOpenTrendHistory && visibleTrendViewModel
      ? resolveTrendDateFromChartEvent(event, visibleTrendViewModel.chartData)
      : null;
  }, [canOpenTrendHistory, visibleTrendViewModel]);
  const handleTrendDoubleClick = useCallback(() => {
    const dateKey = activeTrendDateRef.current;
    if (dateKey && canOpenTrendHistory) {
      onOpenHistoryDate?.(dateKey);
    }
  }, [canOpenTrendHistory, onOpenHistoryDate]);
  const preventChartTextSelection = useCallback((event: MouseEvent<HTMLDivElement>, canOpenHistory: boolean) => {
    if (canOpenHistory && event.detail > 1) {
      event.preventDefault();
    }
  }, []);
  const handleTrendMouseDownCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    preventChartTextSelection(event, canOpenTrendHistory);
  }, [canOpenTrendHistory, preventChartTextSelection]);
  const handleTrendDoubleClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!canOpenTrendHistory) {
      return;
    }

    event.preventDefault();
    handleTrendDoubleClick();
  }, [canOpenTrendHistory, handleTrendDoubleClick]);
  const handleTrendMouseLeave = useCallback(() => {
    activeTrendDateRef.current = null;
  }, []);

  useEffect(() => {
    if (!trendViewModel || !heatmapRows) return;
    if (heatmapLoading || yearSessionsView !== selectedHeatmapView) return;
    if (!overviewTrend.snapshot) return;

    const snapshot: DataBootstrapSnapshot = {
      createdAtMs: Date.now(),
      overviewRangeCacheKey: overviewTrend.snapshot.range.cacheKey,
      heatmapSelection: selectedHeatmapView,
      mappingVersion,
      uiLanguage,
      overviewTrendViewModel: trendViewModel,
      heatmapRows,
      earliestStartTime,
    };

    setBootstrapSnapshot(snapshot);
    void saveDataBootstrapSnapshot(snapshot);
  }, [
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
          <DataTrendPanel
            selection={selectedTrendRange}
            viewModel={visibleTrendViewModel}
            aggregateContext={overviewAggregateContext}
            dataIcons={dataIcons}
            webSegments={webSegments}
            webDomainOverrides={webDomainOverrides}
            webDomainFavicons={webDomainIcons}
            webDomainIconThemeColors={webDomainIconThemeColors}
            chartRef={overviewTrendChart.chartRef}
            initialDimension={overviewTrendChart.initialDimension}
            canOpenHistory={canOpenTrendHistory}
            onSelectionChange={setSelectedTrendRange}
            onMouseDownCapture={handleTrendMouseDownCapture}
            onDoubleClickCapture={handleTrendDoubleClickCapture}
            onMouseMove={handleTrendMouseMove}
            onMouseLeave={handleTrendMouseLeave}
          />

          <DataHeatmapPanel
            selectedHeatmapView={selectedHeatmapView}
            selectedHeatmapViewKey={selectedHeatmapViewKey}
            selectedHeatmapViewLabel={selectedHeatmapViewLabel}
            rows={visibleHeatmapRows}
            granularity={heatmapGranularity}
            granularityOptions={heatmapGranularityOptions}
            canSelectOlderHeatmapView={canSelectOlderHeatmapView}
            canSelectNewerHeatmapView={canSelectNewerHeatmapView}
            onGranularityChange={setHeatmapGranularity}
            onSelectAdjacentHeatmapView={selectAdjacentHeatmapView}
            onOpenHistoryDate={onOpenHistoryDate}
            loading={heatmapLoading}
          />
        </div>
      </div>
    </div>
  );
}
