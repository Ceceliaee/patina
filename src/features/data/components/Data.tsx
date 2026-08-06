import { useLocaleText, type UiText } from "../../../shared/i18n/index.ts";
import { startTransition, type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, } from "react";
import { BarChart3 } from "lucide-react";

import {
  getIconThemeFallbackColor,
  useIconThemeColors,
} from "../../../shared/hooks/useIconThemeColors.ts";
import { useRequestedAppIcons } from "../../../shared/hooks/useRequestedAppIcons.ts";
import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import {
  buildDataAppTrendViewModel,
  buildDataAppTrendViewModelFromAggregate,
  buildDataTrendAggregateContext,
  buildDataTrendViewModelFromAggregate,
  buildDataTrendViewModel,
  getCachedDataHeatmapSessions,
  getCachedEarliestSessionStartTime,
  type DataAppTrendViewModel,
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
  buildDataDestinationIconSources,
  buildDataDestinationTrendSeries,
  encodeDataDestinationSelectionKey,
  reconcileDataDestinationSelection,
  replaceDataDestinationSelection,
  resolveDataDestinationMode,
  toggleDataDestinationSelection,
  type DataDestinationMode,
  type DataDestinationTrendOption,
} from "../services/dataDestinationState.ts";
import {
  getDataDestinationSessionSelectionRevision,
  getDataDestinationSessionSelectionState,
  rememberDataDestinationSessionOptions,
  rememberDataDestinationSessionSelectionRevision,
  rememberDataDestinationSessionSelectionState,
  resolveDataDestinationSessionOptions,
} from "../services/dataDestinationSessionState.ts";
import {
  getCachedDataBootstrapSnapshot,
  loadPersistedDataBootstrapSnapshot,
  saveDataBootstrapSnapshot,
  type DataBootstrapSnapshot,
} from "../services/dataBootstrapSnapshot.ts";
import { prewarmDataFirstScreen } from "../services/dataFirstScreenPrewarm.ts";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking";
import type { QuietToastTone } from "../../../shared/types/toast.ts";
import { resolveTrendDateFromChartEvent } from "../services/dataChartInteraction.ts";
import type { DataTrendSnapshot } from "../services/dataTrendSnapshot.ts";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import { useDataTrendSnapshot } from "../hooks/useDataTrendSnapshot.ts";
import { useDataWebActivityRuntime } from "../hooks/useDataWebActivityRuntime.ts";
import { useDataDetailEntry } from "../hooks/useDataDetailEntry.ts";
import DestinationDetailDialogEntry from "../../destination/components/DestinationDetailDialogEntry.tsx";
import { loadDataIconsForExecutables } from "../services/dataIconService.ts";
import { scheduleDataWorkAfterFirstPaint } from "../services/dataFirstPaintScheduler.ts";
import {
  dedupeDataAppOptions,
  filterDataAppOptionsForQuery,
} from "../services/dataAppSearch.ts";
import DataAppTrendPanel from "./DataAppTrendPanel.tsx";
import DataTrendPanel from "./DataTrendPanel.tsx";
import DataHeatmapPanel, { type HeatmapGranularity } from "./DataHeatmapPanel.tsx";
import { markDataNavigationStage } from "../services/dataNavigationPerformance.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import QuickAppClassificationEntry from "../../classification/components/QuickAppClassificationEntry.tsx";
import { useQuickAppClassificationLauncher } from "../../classification/hooks/useQuickAppClassificationLauncher.ts";
import { createQuickAppClassificationTarget } from "../../classification/types.ts";

interface Props {
  icons: Record<string, string>;
  refreshKey?: number;
  trackerHealth: TrackerHealthSnapshot;
  loadDataTrendSnapshot: (
    selection: DataTrendRangeSelection,
    nowMs: number,
    uiText: UiText,
  ) => Promise<DataTrendSnapshot>;
  mappingVersion?: number;
  mergeThresholdSecs: number;
  onOpenHistoryDate?: (dateKey: string) => void;
  uiLanguage: AppLanguage;
  webActivityEnabled: boolean;
  onToast?: (message: string, tone?: QuietToastTone) => void;
  onOverridesChanged: () => void;
  onQuickActionError: (message: string) => void;
}

type DataChartDimension = { width: number; height: number };
type DataChartDimensionKey = "overviewTrend" | "appTrend";
const CACHED_DATA_HEATMAP_REFRESH_DELAY_MS = 320;
const CACHED_DATA_HEATMAP_REFRESH_IDLE_TIMEOUT_MS = 1_500;
const DATA_OPEN_PREWARM_DELAY_MS = 500;
const DATA_OPEN_PREWARM_IDLE_TIMEOUT_MS = 2_000;
const DATA_STACKED_LAYOUT_QUERY = "(min-width: 901px) and (max-width: 1899px)";
const EMPTY_DATA_ICON_EXE_NAMES: string[] = [];
const EMPTY_DATA_APP_OPTIONS: DataAppTrendViewModel["appOptions"] = [];
const EMPTY_HEATMAP_ROWS: ReturnType<typeof buildActivityHeatmap> = [];
const DEFAULT_DATA_APP_CHART_AXIS: DataAppTrendViewModel["chartAxis"] = {
  domainMax: 3,
  ticks: [0, 1, 2, 3],
};
const dataChartDimensionCache: Partial<Record<DataChartDimensionKey, DataChartDimension>> = {};
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function toAppPanelOption(
  app: DataAppTrendViewModel["appOptions"][number],
  icons: Record<string, string>,
): DataDestinationTrendOption {
  const mapped = AppClassification.mapApp(app.exeName, { appName: app.appName });
  return {
    key: app.appKey,
    identityKeys: app.sourceAppKeys?.length ? [...app.sourceAppKeys] : [app.appKey],
    exeName: app.exeName,
    classificationCategory: mapped.category,
    unclassified: mapped.category === "other",
    displayName: app.appName,
    secondaryText: app.exeName,
    iconUrl: icons[app.exeName] ?? null,
    totalDuration: app.totalDuration,
    percentage: app.percentage,
    averageDuration: app.averageDuration,
    activeDayCount: app.activeDayCount,
  };
}

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
  const observerCleanupRef = useRef<(() => void) | null>(null);
  const [initialDimension, setInitialDimension] = useState<DataChartDimension>(
    () => dataChartDimensionCache[key] ?? getFallbackDimension(),
  );

  const chartRef = useCallback((element: HTMLDivElement | null) => {
    observerCleanupRef.current?.();
    observerCleanupRef.current = null;
    if (!element) return;

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
      observerCleanupRef.current = () => window.removeEventListener("resize", syncDimension);
      return;
    }

    const observer = new ResizeObserver(syncDimension);
    observer.observe(element);
    observerCleanupRef.current = () => observer.disconnect();
  }, [key]);

  useEffect(() => () => {
    observerCleanupRef.current?.();
    observerCleanupRef.current = null;
  }, []);

  return { chartRef, initialDimension };
}

export default function Data({
  icons,
  refreshKey = 0,
  trackerHealth,
  loadDataTrendSnapshot,
  mappingVersion = 0,
  mergeThresholdSecs,
  onOpenHistoryDate,
  onToast,
  onOverridesChanged,
  onQuickActionError,
  uiLanguage,
  webActivityEnabled,
}: Props) {
  const UI_TEXT = useLocaleText();
  const quickClassification = useQuickAppClassificationLauncher();
  const { openAtPointer: openQuickClassificationAtPointer } = quickClassification;
  const dataRootRef = useRef<HTMLDivElement | null>(null);
  const today = new Date();
  const currentYear = today.getFullYear();
  const [selectedTrendRange, setSelectedTrendRange] = useState<DataTrendRangeSelection>({ kind: "rolling", days: 7 });
  const [selectedAppTrendRange, setSelectedAppTrendRange] = useState<DataTrendRangeSelection>({ kind: "rolling", days: 7 });
  const [selectedAppKeys, setSelectedAppKeys] = useState<string[]>(
    () => getDataDestinationSessionSelectionState().appKeys,
  );
  const [selectedWebKeys, setSelectedWebKeys] = useState<string[]>(
    () => getDataDestinationSessionSelectionState().webKeys,
  );
  const appSelectionRevisionRef = useRef(
    getDataDestinationSessionSelectionRevision("app"),
  );
  const webSelectionRevisionRef = useRef(
    getDataDestinationSessionSelectionRevision("web"),
  );
  const [appSearchQuery, setAppSearchQuery] = useState("");
  const [destinationMode, setDestinationMode] = useState<DataDestinationMode>("app");
  const [presentedDestinationMode, setPresentedDestinationMode] =
    useState<DataDestinationMode>("app");
  const [freshReadModelsReady, setFreshReadModelsReady] = useState(false);
  const [destinationPanelCommitted, setDestinationPanelCommitted] = useState(false);
  const handleDestinationPanelCommitted = useCallback(() => {
    setDestinationPanelCommitted(true);
  }, []);
  const [initialCachedHeatmapSessions] = useState(() => getCachedDataHeatmapSessions("recent", Date.now()));
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
  const [selectedDestinationHeatmapView, setSelectedDestinationHeatmapView] =
    useState<HeatmapSelection>("recent");
  const [destinationHeatmapGranularity, setDestinationHeatmapGranularity] =
    useState<HeatmapGranularity>("daily");
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
  const [destinationHeatmapSnapshot, setDestinationHeatmapSnapshot] = useState<{
    loading: boolean;
    sessions: AggregateSessionRecord[];
  }>(() => ({
    loading: !initialCachedHeatmapSessions,
    sessions: initialCachedHeatmapSessions ?? [],
  }));
  const overviewTrendChart = useDataChartInitialDimension(
    "overviewTrend",
    getOverviewTrendChartInitialDimension,
  );
  const appTrendChart = useDataChartInitialDimension(
    "appTrend",
    getAppTrendChartInitialDimension,
  );
  const nowMs = overviewTrend.nowMs;
  const webActivity = useDataWebActivityRuntime({
    cacheVersion: `${mappingVersion}:${refreshKey}`,
    enabled: webActivityEnabled,
    heatmapNowMs: nowMs,
    heatmapSelection: selectedDestinationHeatmapView,
    mode: destinationMode,
    trendNowMs: appTrend.nowMs,
    trendRangeCacheKey: appTrend.resolvedRange.cacheKey,
    trendSelection: selectedAppTrendRange,
    uiLanguage,
    selectedDomains: selectedWebKeys,
  });
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
    const resolvedMode = resolveDataDestinationMode(webActivityEnabled, destinationMode);
    if (resolvedMode !== destinationMode) {
      setDestinationMode(resolvedMode);
    }
    if (!webActivityEnabled) {
      setPresentedDestinationMode("app");
    }
  }, [
    destinationMode,
    webActivityEnabled,
  ]);

  useEffect(() => {
    rememberDataDestinationSessionSelectionState({
      appKeys: selectedAppKeys,
      webKeys: selectedWebKeys,
    });
  }, [selectedAppKeys, selectedWebKeys]);

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

  useEffect(() => {
    let cancelled = false;
    const nowForRange = Date.now();
    const cachedSessions = getCachedDataHeatmapSessions(selectedDestinationHeatmapView, nowForRange);
    if (cachedSessions) {
      setDestinationHeatmapSnapshot({
        loading: false,
        sessions: cachedSessions,
      });
    } else {
      setDestinationHeatmapSnapshot({ loading: true, sessions: [] });
    }

    void loadDataHeatmapSnapshot(selectedDestinationHeatmapView, nowForRange).then((snapshot) => {
      if (cancelled) return;
      startTransition(() => {
        setDestinationHeatmapSnapshot({
          loading: false,
          sessions: snapshot.sessions,
        });
      });
      if (snapshot.earliestStartTime) {
        const earliestYear = new Date(snapshot.earliestStartTime).getFullYear();
        if (
          selectedDestinationHeatmapView !== "recent"
          && selectedDestinationHeatmapView < earliestYear
        ) {
          setSelectedDestinationHeatmapView(earliestYear);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [refreshKey, selectedDestinationHeatmapView]);

  const matchingBootstrapSnapshot = bootstrapSnapshot
    && bootstrapSnapshot.mappingVersion === mappingVersion
    && bootstrapSnapshot.uiLanguage === uiLanguage
    ? bootstrapSnapshot
    : null;
  const shouldDeferRuntimeReadModels = hasInitialBootstrapSnapshotRef.current
    && Boolean(matchingBootstrapSnapshot)
    && !freshReadModelsReady;
  const overviewTrendSnapshotForViewModel = shouldDeferRuntimeReadModels ? null : overviewTrend.snapshot;
  const appTrendSnapshotForViewModel = shouldDeferRuntimeReadModels ? null : appTrend.snapshot;

  useEffect(() => {
    if (!hasInitialBootstrapSnapshotRef.current || !matchingBootstrapSnapshot || freshReadModelsReady) {
      return undefined;
    }

    return scheduleDataWorkAfterFirstPaint(() => {
      setFreshReadModelsReady(true);
    });
  }, [freshReadModelsReady, matchingBootstrapSnapshot]);

  const sharedTrendAggregateContext = useMemo(() => {
    if (!overviewTrendSnapshotForViewModel || !appTrendSnapshotForViewModel) return null;
    const overviewRange = overviewTrendSnapshotForViewModel.range;
    const appRange = appTrendSnapshotForViewModel.range;
    if (
      overviewRange.cacheKey !== appRange.cacheKey
      || overviewRange.label !== appRange.label
      || overviewRange.granularity !== appRange.granularity
      || overviewRange.dayCount !== appRange.dayCount
      || overviewTrendSnapshotForViewModel.sessions !== appTrendSnapshotForViewModel.sessions
    ) {
      return null;
    }

    return buildDataTrendAggregateContext(
      overviewTrendSnapshotForViewModel.sessions,
      overviewRange,
      overviewTrend.nowMs,
      UI_TEXT,
      uiLanguage,
    );
  // Data aggregators read module-level locale/mapping state; these tokens explicitly invalidate that cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appTrendSnapshotForViewModel,
    mappingVersion,
    overviewTrend.nowMs,
    overviewTrendSnapshotForViewModel,
    uiLanguage,
    UI_TEXT,
  ]);

  const trendViewModel = useMemo(() => {
    if (sharedTrendAggregateContext) {
      return buildDataTrendViewModelFromAggregate(sharedTrendAggregateContext);
    }
    if (!overviewTrendSnapshotForViewModel) return null;
    return buildDataTrendViewModel(
      overviewTrendSnapshotForViewModel.sessions,
      overviewTrendSnapshotForViewModel.range,
      overviewTrend.nowMs,
      UI_TEXT,
      uiLanguage,
    );
  // Data view models read module-level locale/mapping state; these tokens explicitly invalidate that cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    mappingVersion,
    overviewTrend.nowMs,
    overviewTrendSnapshotForViewModel,
    sharedTrendAggregateContext,
    uiLanguage,
    UI_TEXT,
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
  const appTrendViewModel = useMemo(() => {
    if (sharedTrendAggregateContext) {
      return buildDataAppTrendViewModelFromAggregate(sharedTrendAggregateContext, selectedAppKeys);
    }
    if (!appTrendSnapshotForViewModel) return null;
    return buildDataAppTrendViewModel(
      appTrendSnapshotForViewModel.sessions,
      appTrendSnapshotForViewModel.range,
      appTrend.nowMs,
      selectedAppKeys,
      UI_TEXT,
      uiLanguage,
    );
  // App trend view models read module-level locale/mapping state; these tokens explicitly invalidate that cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appTrend.nowMs,
    appTrendSnapshotForViewModel,
    mappingVersion,
    selectedAppKeys,
    sharedTrendAggregateContext,
    uiLanguage,
    UI_TEXT,
  ]);
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
  const dataIconExeNames = useMemo(
    () => visibleAppTrendViewModel?.appOptions.map((app) => app.exeName) ?? EMPTY_DATA_ICON_EXE_NAMES,
    [visibleAppTrendViewModel?.appOptions],
  );
  const snapshotDataIcons = useMemo(() => ({
    ...(overviewTrend.snapshot?.icons ?? {}),
    ...(appTrend.snapshot?.icons ?? {}),
  }), [appTrend.snapshot, overviewTrend.snapshot]);
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

  const dedupedAppOptions = useMemo(() => {
    if (!visibleAppTrendViewModel) return EMPTY_DATA_APP_OPTIONS;
    return dedupeDataAppOptions(visibleAppTrendViewModel.appOptions);
  }, [visibleAppTrendViewModel]);
  const filteredAppOptions = useMemo(() => (
    filterDataAppOptionsForQuery(dedupedAppOptions, appSearchQuery)
  ), [appSearchQuery, dedupedAppOptions]);

  const hasAppSearchQuery = appSearchQuery.trim().length > 0;
  useEffect(() => {
    if (!visibleAppTrendViewModel) return;
    if (
      selectedAppKeys.length > 0
      && appSelectionRevisionRef.current === mappingVersion
    ) {
      return;
    }
    const reconciled = reconcileDataDestinationSelection(
      selectedAppKeys,
      dedupedAppOptions.map((app) => app.appKey),
    );
    appSelectionRevisionRef.current = mappingVersion;
    rememberDataDestinationSessionSelectionRevision("app", mappingVersion);
    if (encodeDataDestinationSelectionKey(reconciled) !== encodeDataDestinationSelectionKey(selectedAppKeys)) {
      setSelectedAppKeys(reconciled);
    }
  }, [dedupedAppOptions, mappingVersion, selectedAppKeys, visibleAppTrendViewModel]);

  useLayoutEffect(() => {
    appListRef.current?.scrollTo({ top: 0 });
  }, [hasAppSearchQuery]);

  const handleAppSearchQueryChange = useCallback((nextQuery: string) => {
    setAppSearchQuery(nextQuery);
    appListRef.current?.scrollTo({ top: 0 });
  }, []);
  const {
    hasSearchQuery: hasWebSearchQuery,
    heatmapEarliestStartTime: webHeatmapEarliestStartTime,
    heatmapLoading: webHeatmapLoading,
    heatmapReady: webHeatmapReady,
    heatmapRows: webHeatmapRows,
    panelOptions: webPanelOptions,
    searchQuery: webSearchQuery,
    selectedPanelOptions: webPanelSelectedOptions,
    trendError: webTrendError,
    trendRefreshFailed: webTrendRefreshFailed,
    trendRefreshing: webTrendRefreshing,
    trendViewModel: webTrendViewModel,
  } = webActivity;

  useEffect(() => {
    if (!webTrendViewModel) return;
    if (
      selectedWebKeys.length > 0
      && webSelectionRevisionRef.current === mappingVersion
    ) {
      return;
    }
    const reconciled = reconcileDataDestinationSelection(
      selectedWebKeys,
      webTrendViewModel.domainOptions.map((domain) => domain.normalizedDomain),
    );
    webSelectionRevisionRef.current = mappingVersion;
    rememberDataDestinationSessionSelectionRevision("web", mappingVersion);
    if (encodeDataDestinationSelectionKey(reconciled) !== encodeDataDestinationSelectionKey(selectedWebKeys)) {
      setSelectedWebKeys(reconciled);
    }
  }, [mappingVersion, selectedWebKeys, webTrendViewModel]);

  useLayoutEffect(() => {
    appListRef.current?.scrollTo({ top: 0 });
  }, [hasWebSearchQuery, presentedDestinationMode]);

  const appAllPanelOptions = useMemo<DataDestinationTrendOption[]>(() => {
    void mappingVersion;
    return dedupedAppOptions.map((app) => toAppPanelOption(app, dataIcons));
  }, [dataIcons, dedupedAppOptions, mappingVersion]);
  const appPanelOptions = useMemo<DataDestinationTrendOption[]>(() => {
    const visibleKeys = new Set(filteredAppOptions.map((app) => app.appKey));
    return appAllPanelOptions.filter((option) => visibleKeys.has(option.key));
  }, [appAllPanelOptions, filteredAppOptions]);
  const appPanelSelectedOptions = useMemo<DataDestinationTrendOption[]>(() => {
    void mappingVersion;
    return resolveDataDestinationSessionOptions(
      "app",
      (visibleAppTrendViewModel?.selectedApps ?? [])
        .map((app) => toAppPanelOption(app, dataIcons)),
      appAllPanelOptions,
    );
  }, [appAllPanelOptions, dataIcons, mappingVersion, visibleAppTrendViewModel?.selectedApps]);
  const webAllPanelOptions = useMemo<DataDestinationTrendOption[]>(() => (
    (webTrendViewModel?.domainOptions ?? []).map((domain) => ({
      key: domain.normalizedDomain,
      identityKeys: [domain.normalizedDomain],
      displayName: domain.displayName,
      secondaryText: domain.normalizedDomain,
      iconUrl: domain.faviconUrl,
      totalDuration: domain.totalDuration,
      percentage: domain.percentage,
      averageDuration: domain.averageDuration,
      activeDayCount: domain.activeDayCount,
    }))
  ), [webTrendViewModel?.domainOptions]);
  const resolvedWebPanelSelectedOptions = useMemo<DataDestinationTrendOption[]>(() => (
    resolveDataDestinationSessionOptions("web", webPanelSelectedOptions, webAllPanelOptions)
  ), [webAllPanelOptions, webPanelSelectedOptions]);

  useEffect(() => {
    rememberDataDestinationSessionOptions("app", appPanelSelectedOptions);
  }, [appPanelSelectedOptions]);

  useEffect(() => {
    rememberDataDestinationSessionOptions("web", resolvedWebPanelSelectedOptions);
  }, [resolvedWebPanelSelectedOptions]);
  const destinationIconSources = useMemo<Record<string, string>>(() => {
    return buildDataDestinationIconSources(appAllPanelOptions, webAllPanelOptions);
  }, [
    appAllPanelOptions,
    webAllPanelOptions,
  ]);
  const destinationIconColors = useIconThemeColors(destinationIconSources);

  const webDestinationReadyForPresentation = Boolean(webTrendViewModel) && webHeatmapReady;
  useLayoutEffect(() => {
    if (!webActivityEnabled || destinationMode === "app") {
      setPresentedDestinationMode("app");
      return;
    }
    if (
      presentedDestinationMode === "web"
      && !webTrendViewModel
      && !webTrendError
    ) {
      setPresentedDestinationMode("app");
      return;
    }
    if (webTrendError || webDestinationReadyForPresentation) {
      setPresentedDestinationMode("web");
    }
  }, [
    destinationMode,
    presentedDestinationMode,
    webActivityEnabled,
    webDestinationReadyForPresentation,
    webTrendError,
    webTrendViewModel,
  ]);

  const isWebDestination = presentedDestinationMode === "web";
  const destinationModeSwitchPending = destinationMode !== presentedDestinationMode;
  const destinationPanelReady = isWebDestination
    ? Boolean(webTrendViewModel)
    : Boolean(visibleAppTrendViewModel);
  const destinationPanelOptions = isWebDestination ? webPanelOptions : appPanelOptions;
  const destinationPanelSelectedOptions = isWebDestination
    ? resolvedWebPanelSelectedOptions
    : appPanelSelectedOptions;
  const destinationChartData = useMemo(() => (
    isWebDestination
      ? webTrendViewModel?.chartRows ?? []
      : visibleAppTrendViewModel?.chartRows ?? []
  ), [isWebDestination, visibleAppTrendViewModel?.chartRows, webTrendViewModel?.chartRows]);
  const destinationTrendSeries = useMemo(() => (
    buildDataDestinationTrendSeries(
      destinationPanelSelectedOptions,
      (option) => {
        const colorKey = `${isWebDestination ? "web" : "app"}:${option.key}`;
        return destinationIconColors[colorKey] ?? getIconThemeFallbackColor(colorKey);
      },
    )
  ), [destinationIconColors, destinationPanelSelectedOptions, isWebDestination]);
  const resolveDestinationOptionColor = useCallback((
    option: DataDestinationTrendOption,
    mode: DataDestinationMode = presentedDestinationMode,
  ) => {
    const selectedSeries = destinationTrendSeries.find((series) => (
      series.key === option.key && mode === presentedDestinationMode
    ));
    const colorKey = `${mode}:${option.key}`;
    return selectedSeries?.color
      ?? destinationIconColors[colorKey]
      ?? getIconThemeFallbackColor(colorKey);
  }, [
    destinationIconColors,
    destinationTrendSeries,
    presentedDestinationMode,
  ]);
  const destinationChartAxis = isWebDestination
    ? webTrendViewModel?.chartAxis ?? DEFAULT_DATA_APP_CHART_AXIS
    : visibleAppTrendViewModel?.chartAxis ?? DEFAULT_DATA_APP_CHART_AXIS;
  const destinationPeakDay = isWebDestination
    ? webTrendViewModel?.peakDay ?? null
    : visibleAppTrendViewModel?.peakDay ?? null;
  const destinationSummary = isWebDestination
    ? webTrendViewModel?.summary ?? { totalDuration: 0, averageDuration: 0, activeDayCount: 0 }
    : visibleAppTrendViewModel?.summary ?? { totalDuration: 0, averageDuration: 0, activeDayCount: 0 };
  const destinationGranularity = isWebDestination
    ? webTrendViewModel?.granularity ?? "day"
    : visibleAppTrendViewModel?.granularity ?? "day";
  const destinationCanOpenHistory = destinationGranularity === "day"
    && destinationPanelSelectedOptions.length > 0
    && Boolean(onOpenHistoryDate);
  const handleDestinationOptionSelect = useCallback((key: string, multi: boolean) => {
    const currentKeys = presentedDestinationMode === "web" ? selectedWebKeys : selectedAppKeys;
    const result = multi
      ? toggleDataDestinationSelection(currentKeys, key)
      : replaceDataDestinationSelection(key);
    if (presentedDestinationMode === "web") {
      setSelectedWebKeys(result.keys);
    } else {
      setSelectedAppKeys(result.keys);
    }
    if (result.outcome === "limit-reached") {
      onToast?.(UI_TEXT.data.selectionLimitReached, "warning");
    } else if (result.outcome === "last-item") {
      onToast?.(UI_TEXT.data.selectionLastItem, "warning");
    }
  }, [onToast, presentedDestinationMode, selectedAppKeys, selectedWebKeys, UI_TEXT]);
  const restoreDestinationDetailSelection = useCallback((selectionSnapshot: {
    appKeys: string[];
    webKeys: string[];
    mode: DataDestinationMode;
  }) => {
    setSelectedAppKeys(selectionSnapshot.appKeys);
    setSelectedWebKeys(selectionSnapshot.webKeys);
    setDestinationMode(selectionSnapshot.mode);
    setPresentedDestinationMode(selectionSnapshot.mode);
  }, []);
  const {
    request: destinationDetail,
    captureIntent: captureDestinationDetailIntent,
    open: openDestinationDetail,
    close: closeDestinationDetail,
  } = useDataDetailEntry({
    appKeys: selectedAppKeys,
    listRef: appListRef,
    mode: presentedDestinationMode,
    rangeSelection: selectedAppTrendRange,
    resolveOptionColor: resolveDestinationOptionColor,
    restoreSelectionSnapshot: restoreDestinationDetailSelection,
    webKeys: selectedWebKeys,
  });
  const handleOpenDestinationDetail = useCallback((
    option: DataDestinationTrendOption,
  ) => {
    openDestinationDetail(option);
  }, [openDestinationDetail]);
  const handleOpenQuickClassification = useCallback((
    option: DataDestinationTrendOption,
    anchor: { clientX: number; clientY: number },
    trigger: HTMLButtonElement,
  ) => {
    if (!option.exeName || !option.classificationCategory) return;
    openQuickClassificationAtPointer(
      createQuickAppClassificationTarget({
        exeName: option.exeName,
        displayName: option.displayName,
        category: option.classificationCategory,
      }),
      anchor,
      trigger,
    );
  }, [openQuickClassificationAtPointer]);

  const shouldDeferHeatmapRows = Boolean(
    hasInitialBootstrapSnapshotRef.current
    && matchingBootstrapSnapshot?.heatmapSelection === selectedHeatmapView
    && !freshReadModelsReady,
  );
  const heatmapRows = useMemo<ReturnType<typeof buildActivityHeatmap> | null>(() => {
    if (shouldDeferHeatmapRows) return null;
    return buildActivityHeatmap(yearSessions, selectedHeatmapView, nowMs, UI_TEXT, uiLanguage);
  }, [
    nowMs,
    selectedHeatmapView,
    shouldDeferHeatmapRows,
    yearSessions,
    UI_TEXT,
    uiLanguage,
  ]);
  const hasHeatmapRowsForSelectedView = yearSessionsView === selectedHeatmapView;
  const bootstrapHeatmapRows = matchingBootstrapSnapshot?.heatmapSelection === selectedHeatmapView
    ? matchingBootstrapSnapshot.heatmapRows
    : null;
  const freshHeatmapRows = heatmapRows && !heatmapLoading && hasHeatmapRowsForSelectedView ? heatmapRows : null;
  useEffect(() => {
    if (!freshHeatmapRows) return;

    lastHeatmapRowsRef.current = {
      selection: selectedHeatmapView,
      rows: freshHeatmapRows,
    };
  }, [freshHeatmapRows, selectedHeatmapView]);
  const lastHeatmapRows = lastHeatmapRowsRef.current?.selection === selectedHeatmapView
    ? lastHeatmapRowsRef.current.rows
    : null;
  const canUseBootstrapHeatmap = Boolean(
    bootstrapHeatmapRows && (shouldDeferHeatmapRows || heatmapLoading || !hasHeatmapRowsForSelectedView),
  );
  const shouldBuildHeatmapPlaceholderRows = !freshHeatmapRows && !lastHeatmapRows && !canUseBootstrapHeatmap;
  const heatmapPlaceholderRows = useMemo(() => (
    shouldBuildHeatmapPlaceholderRows
      ? buildActivityHeatmap([], selectedHeatmapView, nowMs, UI_TEXT, uiLanguage)
      : null
  ), [nowMs, selectedHeatmapView, shouldBuildHeatmapPlaceholderRows, UI_TEXT, uiLanguage]);
  const visibleHeatmapRows = freshHeatmapRows
    ?? lastHeatmapRows
    ?? (canUseBootstrapHeatmap ? bootstrapHeatmapRows : null)
    ?? heatmapPlaceholderRows
    ?? EMPTY_HEATMAP_ROWS;
  const heatmapGranularityOptions = useMemo<Array<{ value: HeatmapGranularity; label: string }>>(() => [
    { value: "daily", label: UI_TEXT.data.heatmapDaily },
    { value: "weekly", label: UI_TEXT.data.heatmapWeekly },
  ], [UI_TEXT]);
  const destinationAppHeatmapRows = useMemo(() => (
    buildActivityHeatmap(
      !isWebDestination && destinationPanelSelectedOptions.length > 0
        ? destinationHeatmapSnapshot.sessions
        : [],
      selectedDestinationHeatmapView,
      nowMs,
      UI_TEXT,
      uiLanguage,
      selectedAppKeys,
    )
  ), [
    destinationPanelSelectedOptions.length,
    destinationHeatmapSnapshot.sessions,
    isWebDestination,
    nowMs,
    selectedAppKeys,
    selectedDestinationHeatmapView,
    UI_TEXT,
    uiLanguage,
  ]);
  const visibleDestinationHeatmapRows = isWebDestination
    ? webHeatmapRows.length > 0 ? webHeatmapRows : destinationAppHeatmapRows
    : destinationAppHeatmapRows;
  const visibleDestinationHeatmapLoading = isWebDestination
    ? webHeatmapLoading
    : destinationHeatmapSnapshot.loading;
  const trustedReadModelsReady = Boolean(
    overviewTrend.snapshot
    && appTrend.snapshot
    && trendViewModel
    && appTrendViewModel,
  );
  const destinationContentReady = isWebDestination
    ? webHeatmapReady && !webHeatmapLoading
    : !destinationHeatmapSnapshot.loading;
  const dataContentComplete = Boolean(
    trustedReadModelsReady
    && freshHeatmapRows
    && !heatmapLoading
    && yearSessionsView === selectedHeatmapView
    && destinationContentReady
    && destinationPanelCommitted,
  );
  const destinationHeatmapYearOptions = buildYearOptions(
    isWebDestination ? webHeatmapEarliestStartTime : earliestStartTime,
    currentYear,
  );
  const destinationHeatmapViewOptions: HeatmapSelection[] =
    ["recent", ...destinationHeatmapYearOptions];
  const selectedDestinationHeatmapViewIndex = destinationHeatmapViewOptions.findIndex(
    (option) => option === selectedDestinationHeatmapView,
  );
  const selectAdjacentDestinationHeatmapView = (delta: number) => {
    const nextView = destinationHeatmapViewOptions[selectedDestinationHeatmapViewIndex + delta];
    if (nextView !== undefined) setSelectedDestinationHeatmapView(nextView);
  };
  const selectedHeatmapViewKey = String(selectedHeatmapView);
  const heatmapViewOptions: HeatmapSelection[] =
    ["recent", ...buildYearOptions(earliestStartTime, currentYear)];
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
  const handleAppTrendMouseMove = useCallback((event: unknown) => {
    activeAppTrendDateRef.current = destinationCanOpenHistory
      ? resolveTrendDateFromChartEvent(event, destinationChartData)
      : null;
  }, [destinationCanOpenHistory, destinationChartData]);
  const handleAppTrendDoubleClick = useCallback(() => {
    const dateKey = activeAppTrendDateRef.current;
    if (dateKey && destinationCanOpenHistory) {
      onOpenHistoryDate?.(dateKey);
    }
  }, [destinationCanOpenHistory, onOpenHistoryDate]);
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
  const handleAppTrendDoubleClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!destinationCanOpenHistory) {
      return;
    }

    event.preventDefault();
    handleAppTrendDoubleClick();
  }, [destinationCanOpenHistory, handleAppTrendDoubleClick]);
  const handleAppTrendMouseDownCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    preventChartTextSelection(event, destinationCanOpenHistory);
  }, [destinationCanOpenHistory, preventChartTextSelection]);
  const handleTrendMouseLeave = useCallback(() => {
    activeTrendDateRef.current = null;
  }, []);
  const handleAppTrendMouseLeave = useCallback(() => {
    activeAppTrendDateRef.current = null;
  }, []);

  useEffect(() => {
    if (!trendViewModel || !appTrendViewModel || !heatmapRows) return;
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

  useIsomorphicLayoutEffect(() => {
    markDataNavigationStage("rootMounted");
    const root = dataRootRef.current;
    if (root?.querySelector(".data-overview .data-trend-range-trigger")) {
      markDataNavigationStage("structureActive");
    }
  }, []);

  useIsomorphicLayoutEffect(() => {
    const root = dataRootRef.current;
    const overviewPanel = root?.querySelector<HTMLElement>(".data-overview");
    const destinationPanel = root?.querySelector<HTMLElement>(".data-app-panel");
    const scrollOwner = root?.querySelector<HTMLElement>(".data-page-scroll");
    if (!root || !overviewPanel || !destinationPanel || !scrollOwner) {
      return undefined;
    }

    let frameId: number | null = null;
    const syncStackedPanelHeight = () => {
      frameId = null;
      if (!window.matchMedia(DATA_STACKED_LAYOUT_QUERY).matches) {
        root.style.removeProperty("--data-stacked-panel-height");
        root.style.removeProperty("--data-stacked-scroll-end-space");
        return;
      }

      const overviewHeight = overviewPanel.getBoundingClientRect().height;
      if (overviewHeight > 0) {
        root.style.setProperty(
          "--data-stacked-panel-height",
          `${Math.round(overviewHeight)}px`,
        );
      }
      const destinationHeight = destinationPanel.getBoundingClientRect().height;
      const scrollEndSpace = Math.max(
        0,
        Math.round(scrollOwner.clientHeight - destinationHeight),
      );
      root.style.setProperty(
        "--data-stacked-scroll-end-space",
        `${scrollEndSpace}px`,
      );
    };
    const scheduleSync = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(syncStackedPanelHeight);
    };

    syncStackedPanelHeight();
    window.addEventListener("resize", scheduleSync);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleSync);
    observer?.observe(overviewPanel);
    observer?.observe(destinationPanel);
    observer?.observe(scrollOwner);

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
      window.removeEventListener("resize", scheduleSync);
      root.style.removeProperty("--data-stacked-panel-height");
      root.style.removeProperty("--data-stacked-scroll-end-space");
    };
  }, []);

  useEffect(() => {
    if (trustedReadModelsReady) {
      markDataNavigationStage("readModelReady");
    }
    if (dataContentComplete) {
      markDataNavigationStage("complete");
    }
  }, [dataContentComplete, trustedReadModelsReady]);

  return (
    <div
      ref={dataRootRef}
      data-data-content-state={
        dataContentComplete
          ? "complete"
          : trustedReadModelsReady
            ? "read-model-ready"
            : "structure-ready"
      }
      className="flex h-full min-h-0 flex-col gap-4 md:gap-5"
    >
      <QuietPageHeader
        icon={<BarChart3 size={18} />}
        title={UI_TEXT.data.title}
        subtitle={UI_TEXT.data.subtitle}
      />

      <div className="data-page-scroll min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
        <div className="data-dashboard-grid">
          <div className="qp-panel p-5 data-overview">
            <DataTrendPanel
              selection={selectedTrendRange}
              viewModel={visibleTrendViewModel}
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

          <DataAppTrendPanel
            onContentCommitted={handleDestinationPanelCommitted}
            destinationMode={destinationMode}
            showDestinationMode={webActivityEnabled}
            title={isWebDestination ? UI_TEXT.data.webTrend : UI_TEXT.data.appTrend}
            rangeAriaLabel={isWebDestination
              ? UI_TEXT.accessibility.data.webTrendRange
              : UI_TEXT.accessibility.data.appTrendRange}
            selection={selectedAppTrendRange}
            ready={destinationPanelReady}
            selectedOptions={destinationPanelSelectedOptions}
            trendSeries={destinationTrendSeries}
            summary={destinationSummary}
            filteredOptions={destinationPanelOptions}
            searchQuery={isWebDestination ? webSearchQuery : appSearchQuery}
            hasSearchQuery={isWebDestination ? hasWebSearchQuery : hasAppSearchQuery}
            searchPlaceholder={isWebDestination
              ? UI_TEXT.data.webSearchPlaceholder
              : UI_TEXT.data.appSearchPlaceholder}
            listAriaLabel={isWebDestination
              ? UI_TEXT.data.webTrendDomainList
              : UI_TEXT.data.appTrendAppList}
            emptyLabel={isWebDestination
              ? UI_TEXT.data.webTrendEmpty
              : UI_TEXT.data.appTrendEmpty}
            noMatchLabel={isWebDestination
              ? UI_TEXT.data.webTrendNoMatch
              : UI_TEXT.data.appTrendNoMatch}
            totalMetricLabel={isWebDestination
              ? UI_TEXT.data.webTrendTotal
              : UI_TEXT.data.appTrendTotal}
            usageMetricLabel={isWebDestination
              ? UI_TEXT.data.webTrendUsage
              : UI_TEXT.data.appTrendUsage}
            granularity={destinationGranularity}
            chartData={destinationChartData}
            heatmapContent={(
              <DataHeatmapPanel
                title={isWebDestination ? UI_TEXT.data.webHeatmap : UI_TEXT.data.appHeatmap}
                compact
                selectedHeatmapView={selectedDestinationHeatmapView}
                selectedHeatmapViewKey={`${presentedDestinationMode}:${encodeDataDestinationSelectionKey(
                  isWebDestination ? selectedWebKeys : selectedAppKeys,
                )}:${selectedDestinationHeatmapView}`}
                rows={visibleDestinationHeatmapRows}
                granularity={destinationHeatmapGranularity}
                granularityOptions={heatmapGranularityOptions}
                canSelectOlderHeatmapView={
                  selectedDestinationHeatmapViewIndex >= 0
                  && selectedDestinationHeatmapViewIndex < destinationHeatmapViewOptions.length - 1
                }
                canSelectNewerHeatmapView={selectedDestinationHeatmapViewIndex > 0}
                onGranularityChange={setDestinationHeatmapGranularity}
                onSelectAdjacentHeatmapView={selectAdjacentDestinationHeatmapView}
                onOpenHistoryDate={onOpenHistoryDate}
                loading={visibleDestinationHeatmapLoading}
              />
            )}
            chartAxis={destinationChartAxis}
            peakDay={destinationPeakDay}
            listRef={appListRef}
            chartRef={appTrendChart.chartRef}
            initialDimension={appTrendChart.initialDimension}
            canOpenHistory={destinationCanOpenHistory}
            errorMessage={isWebDestination ? webTrendError : null}
            refreshing={(isWebDestination && webTrendRefreshing) || destinationModeSwitchPending}
            refreshFailed={isWebDestination && webTrendRefreshFailed}
            onRetry={webActivity.retry}
            onDestinationModeChange={setDestinationMode}
            onSelectionChange={setSelectedAppTrendRange}
            onSearchQueryChange={isWebDestination
              ? webActivity.setSearchQuery
              : handleAppSearchQueryChange}
            onOptionSelect={handleDestinationOptionSelect}
            onOptionIntentStart={captureDestinationDetailIntent}
            onOptionOpenDetails={handleOpenDestinationDetail}
            activeQuickClassificationExeName={quickClassification.request?.target.exeName}
            onQuickClassificationPreload={quickClassification.preload}
            onQuickClassificationOpen={handleOpenQuickClassification}
            onMouseDownCapture={handleAppTrendMouseDownCapture}
            onDoubleClickCapture={handleAppTrendDoubleClickCapture}
            onMouseMove={handleAppTrendMouseMove}
            onMouseLeave={handleAppTrendMouseLeave}
          />
        </div>
      </div>
      {destinationDetail ? (
        <DestinationDetailDialogEntry
          key={`${destinationDetail.target.mode}:${destinationDetail.target.key}`}
          target={destinationDetail.target}
          initialDateKey={destinationDetail.initialDateKey}
          runtime={{ refreshKey, mappingVersion, mergeThresholdSecs, trackerHealth }}
          onClose={closeDestinationDetail}
        />
      ) : null}
      {quickClassification.request ? (
        <QuickAppClassificationEntry
          key={`${quickClassification.request.target.exeName}:${quickClassification.request.anchor.clientX}:${quickClassification.request.anchor.clientY}`}
          request={quickClassification.request}
          onClose={quickClassification.close}
          onSaved={onOverridesChanged}
          onError={onQuickActionError}
        />
      ) : null}
    </div>
  );
}
