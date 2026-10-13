import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import {
  getCachedDataTrendSnapshot,
  type DataTrendSnapshot,
} from "../services/dataTrendSnapshot.ts";
import {
  resolveDataTrendRange,
  type DataTrendRangeSelection,
} from "../services/dataTrendRange.ts";
import { scheduleDataWorkAfterFirstPaint } from "../services/dataFirstPaintScheduler.ts";

const CACHED_DATA_REFRESH_IDLE_TIMEOUT_MS = 1_500;

interface UseDataTrendSnapshotParams {
  selection: DataTrendRangeSelection;
  refreshKey: number;
  loadSnapshot: (
    selection: DataTrendRangeSelection,
    nowMs: number,
    uiText: ReturnType<typeof useLocaleText>,
  ) => Promise<DataTrendSnapshot>;
  deferCachedRefresh?: boolean;
}

interface TrendReadState {
  nowMs: number;
  queryKey: string;
  snapshot: DataTrendSnapshot | null;
  status: "loading" | "ready" | "error";
}

export function useDataTrendSnapshot({
  deferCachedRefresh = true,
  selection,
  refreshKey,
  loadSnapshot,
}: UseDataTrendSnapshotParams) {
  const UI_TEXT = useLocaleText();
  const currentDateKey = formatLocalDateKey(new Date());
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const [state, setState] = useState<TrendReadState>(() => {
    const nowMs = Date.now();
    const range = resolveDataTrendRange(selection, nowMs, UI_TEXT);
    const snapshot = getCachedDataTrendSnapshot(range);
    return { nowMs, queryKey: range.cacheKey, snapshot, status: snapshot ? "ready" : "loading" };
  });
  const nowMs = state.nowMs;
  const resolvedRange = useMemo(
    () => resolveDataTrendRange(selection, nowMs, UI_TEXT),
    [selection, nowMs, UI_TEXT],
  );

  useEffect(() => {
    let cancelled = false;
    let cancelScheduledLoad: (() => void) | null = null;
    const nextNowMs = Date.now();
    const nextRange = resolveDataTrendRange(selection, nextNowMs, UI_TEXT);
    const nextCached = getCachedDataTrendSnapshot(nextRange);
    setState((current) => ({
      nowMs: nextNowMs,
      queryKey: nextRange.cacheKey,
      snapshot: current.queryKey === nextRange.cacheKey ? current.snapshot ?? nextCached : nextCached,
      status: "loading",
    }));

    const loadFreshSnapshot = async () => {
      try {
        const nextSnapshot = await loadSnapshot(selection, nextNowMs, UI_TEXT);
        if (cancelled) return;
        setState({ nowMs: nextNowMs, queryKey: nextRange.cacheKey, snapshot: nextSnapshot, status: "ready" });
      } catch (error) {
        if (cancelled) return;
        console.warn("Failed to read data trend:", error);
        setState((current) => ({ ...current, status: "error" }));
      }
    };

    if (nextCached && deferCachedRefresh && retryKey === 0) {
      cancelScheduledLoad = scheduleDataWorkAfterFirstPaint(
        () => { void loadFreshSnapshot(); },
        CACHED_DATA_REFRESH_IDLE_TIMEOUT_MS,
      );
    } else {
      void loadFreshSnapshot();
    }

    return () => {
      cancelled = true;
      cancelScheduledLoad?.();
    };
  }, [currentDateKey, deferCachedRefresh, loadSnapshot, refreshKey, retryKey, selection, UI_TEXT]);

  // Check identity during render, before effects, so a new range never displays the previous range's data.
  const matchesQuery = state.queryKey === resolvedRange.cacheKey;
  const snapshot = useMemo(() => matchesQuery && state.snapshot
    ? { ...state.snapshot, range: resolvedRange }
    : null, [matchesQuery, resolvedRange, state.snapshot]);

  return {
    hasFetchedOnce: Boolean(snapshot),
    loading: !matchesQuery || state.status === "loading",
    error: matchesQuery && state.status === "error",
    nowMs,
    resolvedRange,
    retry,
    snapshot,
  };
}
