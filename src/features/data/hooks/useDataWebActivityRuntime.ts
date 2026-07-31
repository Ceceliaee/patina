import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { AppLanguage } from "../../../shared/settings/appSettings.ts";
import type {
  DataDestinationMode,
  DataDestinationTrendOption,
  DataWebTrendPresentation,
} from "../services/dataDestinationState.ts";
import {
  encodeDataDestinationSelectionKey,
  resolveDataWebTrendPresentation,
} from "../services/dataDestinationState.ts";
import type { HeatmapSelection } from "../services/dataHeatmapReadModel.ts";
import type { HeatmapWeek } from "../services/dataHeatmapReadModel.ts";
import type { DataTrendRangeSelection } from "../services/dataTrendRange.ts";
import {
  buildDataWebActivityHeatmap,
  buildDataWebTrendViewModel,
  clearDataWebActivitySnapshotCache,
  getCachedDataWebTrendSnapshot,
  loadDataWebActivitySnapshot,
  loadDataWebHeatmapSnapshot,
  type DataWebHeatmapSnapshot,
  type DataWebTrendSnapshot,
} from "../services/dataWebActivityReadModel.ts";
import {
  createInitialDataWebHeatmapRequestState,
  reduceDataWebHeatmapRequestState,
  resolveDataWebHeatmapRequestState,
} from "../services/dataWebHeatmapRequestState.ts";

interface UseDataWebActivityRuntimeInput {
  cacheVersion: string;
  enabled: boolean;
  heatmapNowMs: number;
  heatmapSelection: HeatmapSelection;
  mode: DataDestinationMode;
  trendNowMs: number;
  trendRangeCacheKey: string;
  trendSelection: DataTrendRangeSelection;
  uiLanguage: AppLanguage;
  selectedDomains: readonly string[];
}

interface VersionedDataWebTrendSnapshot {
  cacheVersion: string;
  requestCacheKey: string;
  value: DataWebTrendSnapshot;
}

export function useDataWebActivityRuntime({
  cacheVersion,
  enabled,
  heatmapNowMs,
  heatmapSelection,
  mode,
  trendNowMs,
  trendRangeCacheKey,
  trendSelection,
  uiLanguage,
  selectedDomains,
}: UseDataWebActivityRuntimeInput) {
  const [searchQuery, setSearchQuery] = useState("");
  const [trendSnapshot, setTrendSnapshot] = useState<VersionedDataWebTrendSnapshot | null>(null);
  const [trendLoadingCacheKey, setTrendLoadingCacheKey] = useState<string | null>(null);
  const [trendErrorCacheKey, setTrendErrorCacheKey] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [heatmapState, dispatchHeatmap] = useReducer(
    reduceDataWebHeatmapRequestState<DataWebHeatmapSnapshot>,
    createInitialDataWebHeatmapRequestState<DataWebHeatmapSnapshot>(),
  );
  const trendRequestCacheKey = `${cacheVersion}:${trendRangeCacheKey}`;
  const selectedDomainKey = encodeDataDestinationSelectionKey(selectedDomains);
  const heatmapPresentationKey = `${heatmapSelection}:${selectedDomainKey}`;
  const heatmapRequestKey = `${cacheVersion}:${heatmapPresentationKey}`;
  const trendRequestRef = useRef({
    requestCacheKey: trendRequestCacheKey,
    selection: trendSelection,
    nowMs: trendNowMs,
    cacheVersion,
  });
  if (trendRequestRef.current.requestCacheKey !== trendRequestCacheKey) {
    trendRequestRef.current = {
      requestCacheKey: trendRequestCacheKey,
      selection: trendSelection,
      nowMs: trendNowMs,
      cacheVersion,
    };
  }

  useEffect(() => {
    clearDataWebActivitySnapshotCache();
    setTrendLoadingCacheKey(null);
    setTrendErrorCacheKey(null);
  }, [cacheVersion]);

  useEffect(() => {
    if (enabled) return;
    setTrendSnapshot(null);
    setTrendLoadingCacheKey(null);
    setTrendErrorCacheKey(null);
    dispatchHeatmap({ type: "reset" });
  }, [enabled]);

  useEffect(() => {
    if (!enabled || mode !== "web") return undefined;
    let cancelled = false;
    const request = trendRequestRef.current;
    const requestCacheKey = request.requestCacheKey;
    setTrendLoadingCacheKey(requestCacheKey);
    void loadDataWebActivitySnapshot({
      selection: request.selection,
      nowMs: request.nowMs,
      cacheVersion: request.cacheVersion,
    }).then((snapshot) => {
      if (!cancelled) {
        startTransition(() => {
          setTrendSnapshot({
            cacheVersion: request.cacheVersion,
            requestCacheKey,
            value: snapshot,
          });
          setTrendErrorCacheKey((current) => (
            current === requestCacheKey ? null : current
          ));
        });
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        console.warn("Failed to load data web activity snapshot:", error);
        setTrendErrorCacheKey(requestCacheKey);
        setTrendLoadingCacheKey((current) => (
          current === requestCacheKey ? null : current
        ));
      }
    }).finally(() => {
      if (!cancelled) {
        setTrendLoadingCacheKey((current) => (
          current === requestCacheKey ? null : current
        ));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    cacheVersion,
    enabled,
    mode,
    retryKey,
    trendRequestCacheKey,
  ]);

  useEffect(() => {
    if (!enabled || mode !== "web" || selectedDomains.length === 0) {
      return undefined;
    }
    let cancelled = false;
    dispatchHeatmap({
      type: "begin",
      presentationKey: heatmapPresentationKey,
      requestKey: heatmapRequestKey,
    });
    void loadDataWebHeatmapSnapshot({
      selection: heatmapSelection,
      normalizedDomains: selectedDomains,
      nowMs: heatmapNowMs,
      cacheVersion,
    }).then((snapshot) => {
      if (!cancelled) {
        startTransition(() => {
          dispatchHeatmap({
            type: "succeeded",
            presentationKey: heatmapPresentationKey,
            requestKey: heatmapRequestKey,
            snapshot,
          });
        });
      }
    }).catch((error: unknown) => {
      if (!cancelled) {
        console.warn("Failed to load data web heatmap snapshot:", error);
        dispatchHeatmap({
          type: "failed",
          presentationKey: heatmapPresentationKey,
          requestKey: heatmapRequestKey,
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    cacheVersion,
    enabled,
    heatmapNowMs,
    heatmapPresentationKey,
    heatmapRequestKey,
    heatmapSelection,
    mode,
    retryKey,
    selectedDomains,
  ]);

  const cachedTrendSnapshot = useMemo(() => (
    enabled && mode === "web"
      ? getCachedDataWebTrendSnapshot({
        selection: trendSelection,
        nowMs: trendNowMs,
        cacheVersion,
      })
      : null
  ), [
    cacheVersion,
    enabled,
    mode,
    trendNowMs,
    trendSelection,
  ]);
  const displayTrendSnapshot = useMemo<VersionedDataWebTrendSnapshot | null>(() => (
    cachedTrendSnapshot
      ? {
        cacheVersion,
        requestCacheKey: trendRequestCacheKey,
        value: cachedTrendSnapshot,
      }
      : trendSnapshot
  ), [
    cacheVersion,
    cachedTrendSnapshot,
    trendSnapshot,
    trendRequestCacheKey,
  ]);
  const trendPresentation: DataWebTrendPresentation = resolveDataWebTrendPresentation({
    webActivityEnabled: enabled,
    mode,
    requestedCacheKey: trendRequestCacheKey,
    loadingCacheKey: trendLoadingCacheKey,
    errorCacheKey: trendErrorCacheKey,
    snapshotCacheKey: displayTrendSnapshot?.requestCacheKey ?? null,
    snapshotCacheVersion: displayTrendSnapshot?.cacheVersion ?? null,
    cacheVersion,
  });
  const trendViewModel = useMemo(() => (
    displayTrendSnapshot
      ? buildDataWebTrendViewModel({ ...displayTrendSnapshot.value, selectedDomains })
      : null
  // UI_TEXT and locale are module state; uiLanguage explicitly invalidates labels.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [displayTrendSnapshot, selectedDomainKey, selectedDomains, uiLanguage]);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const filteredDomains = useMemo(() => (
    trendViewModel?.domainOptions.filter((domain) => (
      !normalizedQuery
      || domain.displayName.toLocaleLowerCase().includes(normalizedQuery)
      || domain.normalizedDomain.toLocaleLowerCase().includes(normalizedQuery)
    )) ?? []
  ), [normalizedQuery, trendViewModel]);

  const selectedTrendDomains = useMemo(
    () => trendViewModel?.selectedDomains ?? [],
    [trendViewModel?.selectedDomains],
  );
  const panelOptions = useMemo<DataDestinationTrendOption[]>(() => (
    filteredDomains.map((domain) => ({
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
  ), [filteredDomains]);
  const selectedPanelOptions = useMemo<DataDestinationTrendOption[]>(() => (
    selectedTrendDomains.map((domain) => ({
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
  ), [selectedTrendDomains]);

  const presentedHeatmapState = resolveDataWebHeatmapRequestState(
    heatmapState,
    heatmapPresentationKey,
    heatmapRequestKey,
  );
  const matchingHeatmapSnapshot = presentedHeatmapState.snapshot;
  const selectedDomainSet = new Set(selectedDomains);
  const heatmapCoverage = matchingHeatmapSnapshot?.domainCoverage
    .filter((coverage) => selectedDomainSet.has(coverage.normalizedDomain))
    .map((coverage) => coverage.earliestRecordedStartMs) ?? [];
  const fallbackCoverage = selectedTrendDomains
    .map((domain) => domain.earliestRecordedStartMs)
    .filter((value): value is number => value !== null);
  const availableCoverage = heatmapCoverage.length > 0 ? heatmapCoverage : fallbackCoverage;
  const heatmapEarliestStartTime = availableCoverage.length > 0
    ? Math.min(...availableCoverage)
    : null;
  const heatmapCompleteCoverageStartTime = availableCoverage.length === selectedDomains.length
    ? Math.max(...availableCoverage)
    : null;
  const currentHeatmapFailed = presentedHeatmapState.status === "cold-failed";
  const currentHeatmapRows = useMemo<HeatmapWeek[] | null>(() => (
    selectedDomains.length > 0 && (Boolean(matchingHeatmapSnapshot) || currentHeatmapFailed)
      ? buildDataWebActivityHeatmap({
        selection: heatmapSelection,
        nowMs: heatmapNowMs,
        normalizedDomains: selectedDomains,
        records: matchingHeatmapSnapshot?.records ?? [],
        earliestRecordedStartMs: heatmapCompleteCoverageStartTime,
        loadErrorMessage: currentHeatmapFailed
          ? UI_TEXT.data.webTrendError
          : null,
      })
      : null
  ), [
    currentHeatmapFailed,
    heatmapCompleteCoverageStartTime,
    heatmapNowMs,
    heatmapSelection,
    matchingHeatmapSnapshot,
    selectedDomains,
  ]);
  const placeholderHeatmapRows = useMemo(() => (
    selectedDomains.length > 0
      ? buildDataWebActivityHeatmap({
        selection: heatmapSelection,
        nowMs: heatmapNowMs,
        normalizedDomains: selectedDomains,
        records: [],
        earliestRecordedStartMs: null,
      })
      : []
  ), [
    heatmapNowMs,
    heatmapSelection,
    selectedDomains,
  ]);
  const heatmapRows = currentHeatmapRows
    ?? placeholderHeatmapRows;
  const heatmapColdLoading = presentedHeatmapState.status === "loading-cold";
  const heatmapReady = (trendViewModel?.domainOptions.length ?? 0) === 0
    || (
      selectedDomains.length > 0
      && presentedHeatmapState.status !== "idle"
      && presentedHeatmapState.status !== "loading-cold"
    );
  const heatmapRefreshFailed =
    presentedHeatmapState.status === "refresh-failed-with-retained-data";

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  return {
    hasSearchQuery: normalizedQuery.length > 0,
    heatmapEarliestStartTime,
    heatmapLoading: heatmapColdLoading,
    heatmapReady,
    heatmapRows,
    panelOptions,
    retry,
    searchQuery,
    selectedDomains,
    selectedPanelOptions,
    setSearchQuery,
    trendError: trendPresentation === "blocking-error" || currentHeatmapFailed
      ? UI_TEXT.data.webTrendError
      : null,
    trendRefreshFailed: trendPresentation === "refresh-error" || heatmapRefreshFailed,
    trendRefreshing: trendPresentation === "refreshing"
      || trendPresentation === "refreshing-stale"
      || presentedHeatmapState.status === "refreshing",
    trendViewModel,
  };
}
