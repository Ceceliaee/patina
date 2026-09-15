import { useLocaleText, type UiText } from "../../../shared/i18n/index.ts";
import { type MouseEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, } from "react";
import { BarChart3 } from "lucide-react";

import {
  getIconThemeFallbackColor,
  useIconThemeColors,
} from "../../../shared/hooks/useIconThemeColors.ts";
import { useRequestedAppIcons } from "../../../shared/hooks/useRequestedAppIcons.ts";
import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import {
  buildDataAppTrendViewModelFromAggregate,
  buildDataTrendAggregateContext,
  buildDataTrendViewModelFromAggregate,
  buildDataTrendViewModel,
  toAppPanelOption,
  type DataAppTrendViewModel,
} from "../services/dataReadModel.ts";
import {
  buildActivityHeatmap,
  buildYearOptions,
  isDataHeatmapSelectionSettled,
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
  type DataDestinationDetailMode,
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
  buildDataCategoryTrendViewModelFromAggregate,
  filterDataCategoryOptionsForQuery,
  resolveDataCategorySourceAppKeys,
  type DataCategoryTrendViewModel,
} from "../services/dataCategoryTrendReadModel.ts";
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
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import { resolveTrendDateFromChartEvent } from "../services/dataChartInteraction.ts";
import type { DataTrendSnapshot } from "../services/dataTrendSnapshot.ts";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import { useDataTrendSnapshot } from "../hooks/useDataTrendSnapshot.ts";
import { useDataChartInitialDimension } from "../hooks/useDataChartInitialDimension.ts";
import { useDataHeatmapSnapshot } from "../hooks/useDataHeatmapSnapshot.ts";
import { useDataStackedLayout } from "../hooks/useDataStackedLayout.ts";
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
import QuickClassificationEntry from "../../classification/components/QuickClassificationEntry.tsx";
import { useQuickClassificationLauncher } from "../../classification/hooks/useQuickClassificationLauncher.ts";
import {
  createQuickAppClassificationTarget,
  createQuickWebClassificationTarget,
  getQuickClassificationTargetKey,
} from "../../classification/types.ts";

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

const DATA_OPEN_PREWARM_DELAY_MS = 500;
const DATA_OPEN_PREWARM_IDLE_TIMEOUT_MS = 2_000;
const EMPTY_DATA_ICON_EXE_NAMES: string[] = [];
const EMPTY_DATA_APP_OPTIONS: DataAppTrendViewModel["appOptions"] = [];
const EMPTY_DATA_CATEGORY_OPTIONS: DataCategoryTrendViewModel["categoryOptions"] = [];
const EMPTY_HEATMAP_ROWS: ReturnType<typeof buildActivityHeatmap> = [];
const DEFAULT_DATA_APP_CHART_AXIS: DataAppTrendViewModel["chartAxis"] = {
  domainMax: 3,
  ticks: [0, 1, 2, 3],
};
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function toCategoryPanelOption(
  category: DataCategoryTrendViewModel["categoryOptions"][number],
  uiText: UiText,
): DataDestinationTrendOption {
  return {
    key: category.category,
    identityKeys: [],
    classificationCategory: category.category,
    accentColor: category.color,
    displayName: category.displayName,
    secondaryText: uiText.data.categoryMemberCount(category.appCount),
    iconUrl: null,
    totalDuration: category.totalDuration,
    percentage: category.percentage,
    averageDuration: category.averageDuration,
    activeDayCount: category.activeDayCount,
  };
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
  const quickClassification = useQuickClassificationLauncher();
  const { openAtPointer: openQuickClassificationAtPointer } = quickClassification;
  const dataRootRef = useRef<HTMLDivElement | null>(null);
  useDataStackedLayout(dataRootRef);
  const today = new Date();
  const currentYear = today.getFullYear();
  const [selectedTrendRange, setSelectedTrendRange] = useState<DataTrendRangeSelection>({ kind: "rolling", days: 7 });
  const [selectedAppTrendRange, setSelectedAppTrendRange] = useState<DataTrendRangeSelection>({ kind: "rolling", days: 7 });
  const [selectedAppKeys, setSelectedAppKeys] = useState<string[]>(
    () => getDataDestinationSessionSelectionState().appKeys,
  );
  const [selectedCategoryKeys, setSelectedCategoryKeys] = useState<string[]>(
    () => getDataDestinationSessionSelectionState().categoryKeys,
  );
  const [selectedWebKeys, setSelectedWebKeys] = useState<string[]>(
    () => getDataDestinationSessionSelectionState().webKeys,
  );
  const appSelectionRevisionRef = useRef(
    getDataDestinationSessionSelectionRevision("app"),
  );
  const categorySelectionRevisionRef = useRef(
    getDataDestinationSessionSelectionRevision("category"),
  );
  const webSelectionRevisionRef = useRef(
    getDataDestinationSessionSelectionRevision("web"),
  );
  const [appSearchQuery, setAppSearchQuery] = useState("");
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [destinationMode, setDestinationMode] = useState<DataDestinationMode>("app");
  const [presentedDestinationMode, setPresentedDestinationMode] =
    useState<DataDestinationMode>("app");
  const [freshReadModelsReady, setFreshReadModelsReady] = useState(false);
  const [destinationPanelCommitted, setDestinationPanelCommitted] = useState(false);
  const handleDestinationPanelCommitted = useCallback(() => {
    setDestinationPanelCommitted(true);
  }, []);
  const [selectedHeatmapView, setSelectedHeatmapView] = useState<HeatmapSelection>("recent");
  const overviewHeatmap = useDataHeatmapSnapshot(selectedHeatmapView, refreshKey);
  const earliestStartTime = overviewHeatmap.earliestStartTime;
  const allTimeStartDateKey = formatLocalDateKey(
    earliestStartTime === null ? today : new Date(earliestStartTime),
  );
  const allTimeEndDateKey = formatLocalDateKey(today);
  const effectiveSelectedTrendRange = useMemo<DataTrendRangeSelection>(() => (
    selectedTrendRange.kind === "all"
      ? {
        kind: "all",
        startDateKey: allTimeStartDateKey,
        endDateKey: allTimeEndDateKey,
      }
      : selectedTrendRange
  ), [allTimeEndDateKey, allTimeStartDateKey, selectedTrendRange]);
  const effectiveSelectedAppTrendRange = useMemo<DataTrendRangeSelection>(() => (
    selectedAppTrendRange.kind === "all"
      ? {
        kind: "all",
        startDateKey: allTimeStartDateKey,
        endDateKey: allTimeEndDateKey,
      }
      : selectedAppTrendRange
  ), [allTimeEndDateKey, allTimeStartDateKey, selectedAppTrendRange]);
  const [bootstrapSnapshot, setBootstrapSnapshot] = useState<DataBootstrapSnapshot | null>(
    () => getCachedDataBootstrapSnapshot(),
  );
  const overviewTrend = useDataTrendSnapshot({
    selection: effectiveSelectedTrendRange,
    refreshKey,
    loadSnapshot: loadDataTrendSnapshot,
  });
  const appTrend = useDataTrendSnapshot({
    selection: effectiveSelectedAppTrendRange,
    refreshKey,
    loadSnapshot: loadDataTrendSnapshot,
  });
  const [heatmapGranularity, setHeatmapGranularity] = useState<HeatmapGranularity>("daily");
  const [selectedDestinationHeatmapView, setSelectedDestinationHeatmapView] =
    useState<HeatmapSelection>("recent");
  const [destinationHeatmapGranularity, setDestinationHeatmapGranularity] =
    useState<HeatmapGranularity>("daily");
  const destinationHeatmapSnapshot = useDataHeatmapSnapshot(selectedDestinationHeatmapView, refreshKey);
  const yearSessions = overviewHeatmap.sessions;
  const yearSessionsView = overviewHeatmap.hasSnapshot ? selectedHeatmapView : null;
  const heatmapLoading = overviewHeatmap.loading;
  const heatmapError = overviewHeatmap.error;
  const overviewTrendChart = useDataChartInitialDimension("overviewTrend");
  const appTrendChart = useDataChartInitialDimension("appTrend");
  const nowMs = overviewTrend.nowMs;
  const webActivity = useDataWebActivityRuntime({
    cacheVersion: `${mappingVersion}:${refreshKey}`,
    enabled: webActivityEnabled,
    heatmapNowMs: nowMs,
    heatmapSelection: selectedDestinationHeatmapView,
    mode: destinationMode,
    trendNowMs: appTrend.nowMs,
    trendRangeCacheKey: appTrend.resolvedRange.cacheKey,
    trendSelection: effectiveSelectedAppTrendRange,
    uiLanguage,
    selectedDomains: selectedWebKeys,
  });
  const appListRef = useRef<HTMLDivElement | null>(null);
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
    if (!webActivityEnabled && presentedDestinationMode === "web") {
      setPresentedDestinationMode("app");
    }
  }, [
    destinationMode,
    presentedDestinationMode,
    webActivityEnabled,
  ]);

  useEffect(() => {
    rememberDataDestinationSessionSelectionState({
      appKeys: selectedAppKeys,
      categoryKeys: selectedCategoryKeys,
      webKeys: selectedWebKeys,
    });
  }, [selectedAppKeys, selectedCategoryKeys, selectedWebKeys]);

  useEffect(() => {
    if (earliestStartTime === null) return;
    const earliestYear = new Date(earliestStartTime).getFullYear();
    if (selectedHeatmapView !== "recent" && selectedHeatmapView < earliestYear) {
      setSelectedHeatmapView(earliestYear);
    }
    if (selectedDestinationHeatmapView !== "recent" && selectedDestinationHeatmapView < earliestYear) {
      setSelectedDestinationHeatmapView(earliestYear);
    }
  }, [earliestStartTime, selectedDestinationHeatmapView, selectedHeatmapView]);

  const matchingBootstrapSnapshot = bootstrapSnapshot
    && bootstrapSnapshot.mappingVersion === mappingVersion
    && bootstrapSnapshot.uiLanguage === uiLanguage
    && formatLocalDateKey(new Date(bootstrapSnapshot.createdAtMs)) === formatLocalDateKey(today)
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
  const bootstrapTrendViewModel = matchingBootstrapSnapshot?.overviewRangeCacheKey === overviewTrend.resolvedRange.cacheKey
    ? matchingBootstrapSnapshot.overviewTrendViewModel
    : null;
  const visibleTrendViewModel = trendViewModel ?? bootstrapTrendViewModel;
  const appTrendAggregateContext = useMemo(() => {
    if (sharedTrendAggregateContext) return sharedTrendAggregateContext;
    if (!appTrendSnapshotForViewModel) return null;
    return buildDataTrendAggregateContext(
      appTrendSnapshotForViewModel.sessions,
      appTrendSnapshotForViewModel.range,
      appTrend.nowMs,
      UI_TEXT,
      uiLanguage,
    );
  // App trend view models read module-level locale/mapping state; these tokens explicitly invalidate that cache.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appTrend.nowMs,
    appTrendSnapshotForViewModel,
    mappingVersion,
    sharedTrendAggregateContext,
    uiLanguage,
    UI_TEXT,
  ]);
  const appTrendViewModel = useMemo(() => appTrendAggregateContext
    ? buildDataAppTrendViewModelFromAggregate(appTrendAggregateContext, selectedAppKeys)
    : null, [appTrendAggregateContext, selectedAppKeys]);
  const bootstrapAppTrendViewModel = matchingBootstrapSnapshot?.appRangeCacheKey === appTrend.resolvedRange.cacheKey
    ? matchingBootstrapSnapshot.appTrendViewModel
    : null;
  const visibleAppTrendViewModel = appTrendViewModel ?? bootstrapAppTrendViewModel;
  const visibleCategoryTrendViewModel = useMemo(() => {
    return appTrendAggregateContext
      ? buildDataCategoryTrendViewModelFromAggregate(appTrendAggregateContext, selectedCategoryKeys)
      : null;
  // Category grouping reads module-level classification state; mappingVersion owns invalidation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appTrendAggregateContext,
    mappingVersion,
    selectedCategoryKeys,
  ]);
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
      selectedAppKeys.map((key) => AppClassification.resolveStatisticalApp(key)),
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
  const categoryOptions = visibleCategoryTrendViewModel?.categoryOptions
    ?? EMPTY_DATA_CATEGORY_OPTIONS;
  const filteredCategoryOptions = useMemo(() => (
    filterDataCategoryOptionsForQuery(categoryOptions, categorySearchQuery)
  ), [categoryOptions, categorySearchQuery]);
  const hasCategorySearchQuery = categorySearchQuery.trim().length > 0;

  useEffect(() => {
    if (!visibleCategoryTrendViewModel) return;
    if (
      selectedCategoryKeys.length > 0
      && categorySelectionRevisionRef.current === mappingVersion
    ) {
      return;
    }
    const reconciled = reconcileDataDestinationSelection(
      selectedCategoryKeys,
      categoryOptions.map((category) => category.category),
    );
    categorySelectionRevisionRef.current = mappingVersion;
    rememberDataDestinationSessionSelectionRevision("category", mappingVersion);
    if (
      encodeDataDestinationSelectionKey(reconciled)
      !== encodeDataDestinationSelectionKey(selectedCategoryKeys)
    ) {
      setSelectedCategoryKeys(reconciled);
    }
  }, [categoryOptions, mappingVersion, selectedCategoryKeys, visibleCategoryTrendViewModel]);

  const handleCategorySearchQueryChange = useCallback((nextQuery: string) => {
    setCategorySearchQuery(nextQuery);
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
  }, [hasCategorySearchQuery, hasWebSearchQuery, presentedDestinationMode]);

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
  const categoryAllPanelOptions = useMemo<DataDestinationTrendOption[]>(() => (
    categoryOptions.map((category) => toCategoryPanelOption(category, UI_TEXT))
  ), [categoryOptions, UI_TEXT]);
  const categoryPanelOptions = useMemo<DataDestinationTrendOption[]>(() => {
    const visibleKeys = new Set<string>(
      filteredCategoryOptions.map((category) => category.category),
    );
    return categoryAllPanelOptions.filter((option) => visibleKeys.has(option.key));
  }, [categoryAllPanelOptions, filteredCategoryOptions]);
  const categoryPanelSelectedOptions = useMemo<DataDestinationTrendOption[]>(() => (
    resolveDataDestinationSessionOptions(
      "category",
      (visibleCategoryTrendViewModel?.selectedCategories ?? [])
        .map((category) => toCategoryPanelOption(category, UI_TEXT)),
      categoryAllPanelOptions,
    )
  ), [categoryAllPanelOptions, UI_TEXT, visibleCategoryTrendViewModel?.selectedCategories]);
  const webAllPanelOptions = useMemo<DataDestinationTrendOption[]>(() => (
    (webTrendViewModel?.domainOptions ?? []).map((domain) => ({
      key: domain.normalizedDomain,
      identityKeys: [domain.normalizedDomain],
      normalizedDomain: domain.normalizedDomain,
      classificationCategory: domain.category,
      unclassified: domain.unclassified,
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
    rememberDataDestinationSessionOptions("category", categoryPanelSelectedOptions);
  }, [categoryPanelSelectedOptions]);

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
    if (destinationMode !== "web") {
      setPresentedDestinationMode(destinationMode);
      return;
    }
    if (!webActivityEnabled) {
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
  const isCategoryDestination = presentedDestinationMode === "category";
  const availableDestinationModes = useMemo<DataDestinationMode[]>(() => (
    webActivityEnabled ? ["app", "category", "web"] : ["app", "category"]
  ), [webActivityEnabled]);
  const destinationModeSwitchPending = destinationMode !== presentedDestinationMode;
  const destinationViewModel = isWebDestination
    ? webTrendViewModel
    : isCategoryDestination ? visibleCategoryTrendViewModel : visibleAppTrendViewModel;
  const destinationPanelReady = Boolean(destinationViewModel);
  const destinationPanelOptions = isWebDestination
    ? webPanelOptions
    : isCategoryDestination ? categoryPanelOptions : appPanelOptions;
  const destinationPanelSelectedOptions = isWebDestination
    ? resolvedWebPanelSelectedOptions
    : isCategoryDestination ? categoryPanelSelectedOptions : appPanelSelectedOptions;
  const destinationChartData = useMemo(
    () => destinationViewModel?.chartRows ?? [],
    [destinationViewModel],
  );
  const destinationTrendSeries = useMemo(() => (
    buildDataDestinationTrendSeries(
      destinationPanelSelectedOptions,
      (option) => {
        if (isCategoryDestination && option.accentColor) {
          return option.accentColor;
        }
        const colorKey = `${isWebDestination ? "web" : "app"}:${option.key}`;
        return destinationIconColors[colorKey] ?? getIconThemeFallbackColor(colorKey);
      },
    )
  ), [
    destinationIconColors,
    destinationPanelSelectedOptions,
    isCategoryDestination,
    isWebDestination,
  ]);
  const resolveDestinationOptionColor = useCallback((
    option: DataDestinationTrendOption,
    mode: DataDestinationMode = presentedDestinationMode,
  ) => {
    const selectedSeries = destinationTrendSeries.find((series) => (
      series.key === option.key && mode === presentedDestinationMode
    ));
    if (option.accentColor) {
      return selectedSeries?.color ?? option.accentColor;
    }
    const colorKey = `${mode}:${option.key}`;
    return selectedSeries?.color
      ?? destinationIconColors[colorKey]
      ?? getIconThemeFallbackColor(colorKey);
  }, [
    destinationIconColors,
    destinationTrendSeries,
    presentedDestinationMode,
  ]);
  const destinationChartAxis = destinationViewModel?.chartAxis ?? DEFAULT_DATA_APP_CHART_AXIS;
  const destinationPeakDay = destinationViewModel?.peakDay ?? null;
  const destinationSummary = destinationViewModel?.summary
    ?? { totalDuration: 0, averageDuration: 0, activeDayCount: 0 };
  const destinationGranularity = destinationViewModel?.granularity ?? "day";
  const destinationTrendSelection = destinationViewModel?.range.selection ?? effectiveSelectedAppTrendRange;
  const destinationCanOpenHistory = destinationGranularity === "day"
    && destinationPanelSelectedOptions.length > 0
    && Boolean(onOpenHistoryDate);
  const destinationTitle = isWebDestination
    ? UI_TEXT.data.webTrend
    : isCategoryDestination ? UI_TEXT.data.categoryTrend : UI_TEXT.data.appTrend;
  const destinationRangeAriaLabel = isWebDestination
    ? UI_TEXT.accessibility.data.webTrendRange
    : isCategoryDestination
      ? UI_TEXT.accessibility.data.categoryTrendRange
      : UI_TEXT.accessibility.data.appTrendRange;
  const destinationSearchQuery = isWebDestination
    ? webSearchQuery
    : isCategoryDestination ? categorySearchQuery : appSearchQuery;
  const destinationHasSearchQuery = isWebDestination
    ? hasWebSearchQuery
    : isCategoryDestination ? hasCategorySearchQuery : hasAppSearchQuery;
  const destinationSearchPlaceholder = isWebDestination
    ? UI_TEXT.data.webSearchPlaceholder
    : isCategoryDestination
      ? UI_TEXT.data.categorySearchPlaceholder
      : UI_TEXT.data.appSearchPlaceholder;
  const destinationListAriaLabel = isWebDestination
    ? UI_TEXT.data.webTrendDomainList
    : isCategoryDestination
      ? UI_TEXT.data.categoryTrendCategoryList
      : UI_TEXT.data.appTrendAppList;
  const destinationEmptyLabel = isWebDestination
    ? UI_TEXT.data.webTrendEmpty
    : isCategoryDestination ? UI_TEXT.data.categoryTrendEmpty : UI_TEXT.data.appTrendEmpty;
  const destinationNoMatchLabel = isWebDestination
    ? UI_TEXT.data.webTrendNoMatch
    : isCategoryDestination ? UI_TEXT.data.categoryTrendNoMatch : UI_TEXT.data.appTrendNoMatch;
  const destinationTotalMetricLabel = isWebDestination
    ? UI_TEXT.data.webTrendTotal
    : UI_TEXT.data.appTrendTotal;
  const destinationUsageMetricLabel = isWebDestination
    ? UI_TEXT.data.webTrendUsage
    : isCategoryDestination ? UI_TEXT.data.categoryTrend : UI_TEXT.data.appTrendUsage;
  const destinationInteractionHint = isCategoryDestination
    ? UI_TEXT.data.categoryInteractionHint
    : UI_TEXT.data.interactionHint;
  const destinationHeatmapTitle = isWebDestination
    ? UI_TEXT.data.webHeatmap
    : isCategoryDestination ? UI_TEXT.data.categoryHeatmap : UI_TEXT.data.appHeatmap;
  const destinationSelectionKeys = isWebDestination
    ? selectedWebKeys
    : isCategoryDestination ? selectedCategoryKeys : selectedAppKeys;
  const destinationSupportsObjectActions = !isCategoryDestination;
  const handleDestinationOptionSelect = useCallback((key: string, multi: boolean) => {
    const currentKeys = presentedDestinationMode === "web"
      ? selectedWebKeys
      : presentedDestinationMode === "category" ? selectedCategoryKeys : selectedAppKeys;
    const result = multi
      ? toggleDataDestinationSelection(currentKeys, key)
      : replaceDataDestinationSelection(key);
    if (presentedDestinationMode === "web") {
      setSelectedWebKeys(result.keys);
    } else if (presentedDestinationMode === "category") {
      setSelectedCategoryKeys(result.keys);
    } else {
      setSelectedAppKeys(result.keys);
    }
    if (result.outcome === "limit-reached") {
      onToast?.(UI_TEXT.data.selectionLimitReached, "warning");
    } else if (result.outcome === "last-item") {
      onToast?.(UI_TEXT.data.selectionLastItem, "warning");
    }
  }, [
    onToast,
    presentedDestinationMode,
    selectedAppKeys,
    selectedCategoryKeys,
    selectedWebKeys,
    UI_TEXT,
  ]);
  const restoreDestinationDetailSelection = useCallback((selectionSnapshot: {
    appKeys: string[];
    webKeys: string[];
    mode: DataDestinationDetailMode;
  }) => {
    setSelectedAppKeys(selectionSnapshot.appKeys);
    setSelectedWebKeys(selectionSnapshot.webKeys);
    setDestinationMode(selectionSnapshot.mode);
    setPresentedDestinationMode(selectionSnapshot.mode);
  }, []);
  const destinationDetailMode: DataDestinationDetailMode = isWebDestination ? "web" : "app";
  const {
    request: destinationDetail,
    captureIntent: captureDestinationDetailIntent,
    open: openDestinationDetail,
    close: closeDestinationDetail,
  } = useDataDetailEntry({
    appKeys: selectedAppKeys,
    listRef: appListRef,
    mode: destinationDetailMode,
    rangeSelection: destinationTrendSelection,
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
    if (!option.classificationCategory) return;
    const target = option.exeName
      ? createQuickAppClassificationTarget({
        exeName: option.exeName,
        displayName: option.displayName,
        category: option.classificationCategory,
      })
      : option.normalizedDomain
        ? createQuickWebClassificationTarget({
          normalizedDomain: option.normalizedDomain,
          displayName: option.displayName,
          category: option.classificationCategory,
        })
        : null;
    if (!target) return;
    openQuickClassificationAtPointer(
      target,
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
  const freshHeatmapRows = heatmapRows && hasHeatmapRowsForSelectedView ? heatmapRows : null;
  const canUseBootstrapHeatmap = Boolean(
    bootstrapHeatmapRows && (shouldDeferHeatmapRows || heatmapLoading || !hasHeatmapRowsForSelectedView),
  );
  const shouldBuildHeatmapPlaceholderRows = !freshHeatmapRows && !canUseBootstrapHeatmap;
  const heatmapPlaceholderRows = useMemo(() => (
    shouldBuildHeatmapPlaceholderRows
      ? buildActivityHeatmap([], selectedHeatmapView, nowMs, UI_TEXT, uiLanguage)
      : null
  ), [nowMs, selectedHeatmapView, shouldBuildHeatmapPlaceholderRows, UI_TEXT, uiLanguage]);
  const visibleHeatmapRows = freshHeatmapRows
    ?? (canUseBootstrapHeatmap ? bootstrapHeatmapRows : null)
    ?? heatmapPlaceholderRows
    ?? EMPTY_HEATMAP_ROWS;
  const heatmapColdError = heatmapError && !heatmapLoading
    && !freshHeatmapRows
    && !canUseBootstrapHeatmap;
  const heatmapGranularityOptions = useMemo<Array<{ value: HeatmapGranularity; label: string }>>(() => [
    { value: "daily", label: UI_TEXT.data.heatmapDaily },
    { value: "weekly", label: UI_TEXT.data.heatmapWeekly },
  ], [UI_TEXT]);
  const selectedCategoryHeatmapAppKeys = useMemo(() => (
    isCategoryDestination
      ? resolveDataCategorySourceAppKeys(
        destinationHeatmapSnapshot.sessions,
        selectedCategoryKeys,
      )
      : []
  ), [
    destinationHeatmapSnapshot.sessions,
    isCategoryDestination,
    selectedCategoryKeys,
  ]);
  const selectedDestinationAppKeys = isCategoryDestination
    ? selectedCategoryHeatmapAppKeys
    : selectedAppKeys;
  const destinationAppHeatmapRows = useMemo(() => (
    buildActivityHeatmap(
      !isWebDestination && destinationPanelSelectedOptions.length > 0
        ? destinationHeatmapSnapshot.sessions
        : [],
      selectedDestinationHeatmapView,
      nowMs,
      UI_TEXT,
      uiLanguage,
      selectedDestinationAppKeys,
    )
  ), [
    destinationPanelSelectedOptions.length,
    destinationHeatmapSnapshot.sessions,
    isWebDestination,
    nowMs,
    selectedDestinationAppKeys,
    selectedDestinationHeatmapView,
    UI_TEXT,
    uiLanguage,
  ]);
  const visibleDestinationHeatmapRows = isWebDestination && webHeatmapRows.length > 0
    ? webHeatmapRows
    : destinationAppHeatmapRows;
  const visibleDestinationHeatmapLoading = isWebDestination
    ? webHeatmapLoading
    : destinationHeatmapSnapshot.loading && !destinationHeatmapSnapshot.hasSnapshot;
  const destinationHeatmapColdError = !isWebDestination
    && destinationHeatmapSnapshot.error
    && !destinationHeatmapSnapshot.hasSnapshot;
  const trustedReadModelsReady = Boolean(
    overviewTrend.snapshot
    && appTrend.snapshot
    && trendViewModel
    && appTrendViewModel,
  );
  const destinationContentReady = isWebDestination
    ? webHeatmapReady && !webHeatmapLoading
    : !destinationHeatmapSnapshot.loading
      && (destinationHeatmapSnapshot.hasSnapshot || destinationHeatmapSnapshot.error);
  const dataContentComplete = Boolean(
    trustedReadModelsReady
    && (freshHeatmapRows || heatmapColdError)
    && isDataHeatmapSelectionSettled(yearSessionsView, selectedHeatmapView, heatmapColdError)
    && destinationContentReady
    && destinationPanelCommitted,
  );
  const destinationHeatmapYearOptions = buildYearOptions(
    isWebDestination ? webHeatmapEarliestStartTime : earliestStartTime,
    currentYear,
  );
  const destinationHeatmapViewOptions: HeatmapSelection[] =
    ["recent", ...destinationHeatmapYearOptions];
  const selectedDestinationHeatmapViewIndex = destinationHeatmapViewOptions.indexOf(selectedDestinationHeatmapView);
  const selectAdjacentDestinationHeatmapView = (delta: number) => {
    const nextView = destinationHeatmapViewOptions[selectedDestinationHeatmapViewIndex + delta];
    if (nextView !== undefined) setSelectedDestinationHeatmapView(nextView);
  };
  const selectedHeatmapViewKey = String(selectedHeatmapView);
  const heatmapViewOptions: HeatmapSelection[] =
    ["recent", ...buildYearOptions(earliestStartTime, currentYear)];
  const selectedHeatmapViewIndex = heatmapViewOptions.indexOf(selectedHeatmapView);
  const canSelectOlderHeatmapView = selectedHeatmapViewIndex >= 0
    && selectedHeatmapViewIndex < heatmapViewOptions.length - 1;
  const canSelectNewerHeatmapView = selectedHeatmapViewIndex > 0;
  const selectAdjacentHeatmapView = (delta: number) => {
    if (selectedHeatmapViewIndex < 0) return;
    const nextView = heatmapViewOptions[selectedHeatmapViewIndex + delta];
    if (nextView !== undefined) {
      setSelectedHeatmapView(nextView);
    }
  };
  const canOpenTrendHistory = visibleTrendViewModel?.granularity === "day" && Boolean(onOpenHistoryDate);
  const handleTrendMouseMove = useCallback((event: unknown) => {
    activeTrendDateRef.current = canOpenTrendHistory && visibleTrendViewModel
      ? resolveTrendDateFromChartEvent(event, visibleTrendViewModel.chartData)
      : null;
  }, [canOpenTrendHistory, visibleTrendViewModel]);
  const handleAppTrendMouseMove = useCallback((event: unknown) => {
    activeAppTrendDateRef.current = destinationCanOpenHistory
      ? resolveTrendDateFromChartEvent(event, destinationChartData)
      : null;
  }, [destinationCanOpenHistory, destinationChartData]);
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
    const dateKey = activeTrendDateRef.current;
    if (dateKey) onOpenHistoryDate?.(dateKey);
  }, [canOpenTrendHistory, onOpenHistoryDate]);
  const handleAppTrendDoubleClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!destinationCanOpenHistory) {
      return;
    }

    event.preventDefault();
    const dateKey = activeAppTrendDateRef.current;
    if (dateKey) onOpenHistoryDate?.(dateKey);
  }, [destinationCanOpenHistory, onOpenHistoryDate]);
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

      <div className="data-page-scroll min-h-0 flex-1 overflow-y-auto pr-1 qp-scroll-region qp-scroll-region-stable">
        <div className="data-dashboard-grid">
          <div className="qp-panel p-5 data-overview">
            <DataTrendPanel
              allTimeEndDateKey={allTimeEndDateKey}
              allTimeStartDateKey={allTimeStartDateKey}
              selection={effectiveSelectedTrendRange}
              readState={{ ...overviewTrend, viewModel: visibleTrendViewModel }}
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
              loading={heatmapLoading && !overviewHeatmap.hasSnapshot && !canUseBootstrapHeatmap}
              errorMessage={heatmapColdError ? UI_TEXT.data.heatmapError : null}
              refreshFailed={heatmapError && !heatmapColdError}
              onRetry={overviewHeatmap.retry}
            />
          </div>

          <DataAppTrendPanel
            allTimeEndDateKey={allTimeEndDateKey}
            allTimeStartDateKey={allTimeStartDateKey}
            onContentCommitted={handleDestinationPanelCommitted}
            destinationMode={destinationMode}
            availableDestinationModes={availableDestinationModes}
            title={destinationTitle}
            rangeAriaLabel={destinationRangeAriaLabel}
            selection={destinationTrendSelection}
            ready={destinationPanelReady}
            selectedOptions={destinationPanelSelectedOptions}
            trendSeries={destinationTrendSeries}
            summary={destinationSummary}
            filteredOptions={destinationPanelOptions}
            searchQuery={destinationSearchQuery}
            hasSearchQuery={destinationHasSearchQuery}
            searchPlaceholder={destinationSearchPlaceholder}
            listAriaLabel={destinationListAriaLabel}
            emptyLabel={destinationEmptyLabel}
            noMatchLabel={destinationNoMatchLabel}
            totalMetricLabel={destinationTotalMetricLabel}
            usageMetricLabel={destinationUsageMetricLabel}
            interactionHint={destinationInteractionHint}
            supportsDestinationDetails={destinationSupportsObjectActions}
            supportsQuickClassification={destinationSupportsObjectActions}
            granularity={destinationGranularity}
            chartData={destinationChartData}
            heatmapContent={(
              <DataHeatmapPanel
                title={destinationHeatmapTitle}
                compact
                selectedHeatmapView={selectedDestinationHeatmapView}
                selectedHeatmapViewKey={`${presentedDestinationMode}:${encodeDataDestinationSelectionKey(
                  destinationSelectionKeys,
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
                errorMessage={
                  destinationHeatmapColdError ? UI_TEXT.data.heatmapError : null
                }
                refreshFailed={
                  !isWebDestination
                  && destinationHeatmapSnapshot.error
                  && destinationHeatmapSnapshot.hasSnapshot
                }
                onRetry={destinationHeatmapSnapshot.retry}
              />
            )}
            chartAxis={destinationChartAxis}
            peakDay={destinationPeakDay}
            listRef={appListRef}
            chartRef={appTrendChart.chartRef}
            initialDimension={appTrendChart.initialDimension}
            canOpenHistory={destinationCanOpenHistory}
            errorMessage={isWebDestination
              ? webTrendError
              : appTrend.error && !destinationPanelReady ? UI_TEXT.common.readFailed : null}
            refreshing={(isWebDestination ? webTrendRefreshing : appTrend.loading) || destinationModeSwitchPending}
            refreshFailed={isWebDestination ? webTrendRefreshFailed : appTrend.error && destinationPanelReady}
            onRetry={isWebDestination ? webActivity.retry : appTrend.retry}
            onDestinationModeChange={setDestinationMode}
            onSelectionChange={setSelectedAppTrendRange}
            onSearchQueryChange={isWebDestination
              ? webActivity.setSearchQuery
              : isCategoryDestination
                ? handleCategorySearchQueryChange
                : handleAppSearchQueryChange}
            onOptionSelect={handleDestinationOptionSelect}
            onOptionIntentStart={captureDestinationDetailIntent}
            onOptionOpenDetails={handleOpenDestinationDetail}
            activeQuickClassificationTargetKey={quickClassification.request
              ? getQuickClassificationTargetKey(quickClassification.request.target)
              : null}
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
        <QuickClassificationEntry
          key={`${getQuickClassificationTargetKey(quickClassification.request.target)}:${quickClassification.request.anchor.clientX}:${quickClassification.request.anchor.clientY}`}
          request={quickClassification.request}
          onClose={quickClassification.close}
          onSaved={onOverridesChanged}
          onError={onQuickActionError}
        />
      ) : null}
    </div>
  );
}
