import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
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

interface PresentedDataWebHeatmap {
  selection: HeatmapSelection;
  rows: HeatmapWeek[];
  earliestStartTime: number | null;
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
  const [heatmapSnapshot, setHeatmapSnapshot] = useState<DataWebHeatmapSnapshot | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapErrorKey, setHeatmapErrorKey] = useState<string | null>(null);
  const lastHeatmapPresentationRef = useRef<PresentedDataWebHeatmap | null>(null);
  const trendRequestCacheKey = `${cacheVersion}:${trendRangeCacheKey}`;
  const selectedDomainKey = encodeDataDestinationSelectionKey(selectedDomains);
  const heatmapRequestKey = `${cacheVersion}:${heatmapSelection}:${selectedDomainKey}`;
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
    setHeatmapLoading(false);
    setHeatmapErrorKey(null);
  }, [cacheVersion]);

  useEffect(() => {
    if (enabled) return;
    setTrendSnapshot(null);
    setTrendLoadingCacheKey(null);
    setTrendErrorCacheKey(null);
    setHeatmapSnapshot(null);
    setHeatmapLoading(false);
    setHeatmapErrorKey(null);
    lastHeatmapPresentationRef.current = null;
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
    setHeatmapLoading(true);
    setHeatmapErrorKey(null);
    void loadDataWebHeatmapSnapshot({
      selection: heatmapSelection,
      normalizedDomains: selectedDomains,
      nowMs: heatmapNowMs,
      cacheVersion,
    }).then((snapshot) => {
      if (!cancelled) startTransition(() => setHeatmapSnapshot(snapshot));
    }).catch((error: unknown) => {
      if (!cancelled) {
        console.warn("Failed to load data web heatmap snapshot:", error);
        setHeatmapSnapshot(null);
        setHeatmapErrorKey(heatmapRequestKey);
      }
    }).finally(() => {
      if (!cancelled) setHeatmapLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    cacheVersion,
    enabled,
    heatmapNowMs,
    heatmapRequestKey,
    heatmapSelection,
    mode,
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
      displayName: domain.displayName,
      secondaryText: domain.normalizedDomain,
      iconUrl: domain.faviconUrl,
      totalDuration: domain.totalDuration,
      percentage: domain.percentage,
      averageDuration: domain.averageDuration,
      activeDayCount: domain.activeDayCount,
    }))
  ), [selectedTrendDomains]);

  const matchingHeatmapSnapshot = heatmapSnapshot
    && heatmapSnapshot.selection === heatmapSelection
    && encodeDataDestinationSelectionKey(heatmapSnapshot.normalizedDomains) === selectedDomainKey
    ? heatmapSnapshot
    : null;
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
  const currentHeatmapFailed = !matchingHeatmapSnapshot
    && heatmapErrorKey === heatmapRequestKey;
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
  if (matchingHeatmapSnapshot && currentHeatmapRows) {
    lastHeatmapPresentationRef.current = {
      selection: heatmapSelection,
      rows: currentHeatmapRows,
      earliestStartTime: heatmapEarliestStartTime,
    };
  }
  const retainedHeatmapPresentation = !currentHeatmapFailed
    && lastHeatmapPresentationRef.current?.selection === heatmapSelection
    ? lastHeatmapPresentationRef.current
    : null;
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
    ?? retainedHeatmapPresentation?.rows
    ?? placeholderHeatmapRows;
  const presentedHeatmapEarliestStartTime = matchingHeatmapSnapshot
    ? heatmapEarliestStartTime
    : retainedHeatmapPresentation?.earliestStartTime ?? heatmapEarliestStartTime;
  const heatmapColdLoading = heatmapLoading
    && !currentHeatmapRows
    && !retainedHeatmapPresentation;
  const heatmapReady = (trendViewModel?.domainOptions.length ?? 0) === 0
    || (
      selectedDomains.length > 0
      && (
        Boolean(matchingHeatmapSnapshot)
        || heatmapErrorKey === heatmapRequestKey
      )
    );

  const retry = useCallback(() => setRetryKey((value) => value + 1), []);

  return {
    hasSearchQuery: normalizedQuery.length > 0,
    heatmapEarliestStartTime: presentedHeatmapEarliestStartTime,
    heatmapLoading: heatmapColdLoading,
    heatmapReady,
    heatmapRows,
    panelOptions,
    retry,
    searchQuery,
    selectedDomains,
    selectedPanelOptions,
    setSearchQuery,
    trendError: trendPresentation === "blocking-error"
      ? UI_TEXT.data.webTrendError
      : null,
    trendRefreshFailed: trendPresentation === "refresh-error",
    trendRefreshing: trendPresentation === "refreshing"
      || trendPresentation === "refreshing-stale",
    trendViewModel,
  };
}
