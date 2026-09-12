import { useCallback, useEffect, useMemo, useState } from "react";
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import {
  getCachedDataHeatmapSessions,
  getCachedEarliestSessionStartTime,
  loadDataHeatmapSnapshot,
} from "../services/dataHeatmapSnapshot.ts";
import { getHeatmapSelectionKey, type HeatmapSelection } from "../services/dataHeatmapReadModel.ts";
import type { AggregateSessionRecord } from "../services/dataReadModel.ts";
import { scheduleDataWorkAfterFirstPaint } from "../services/dataFirstPaintScheduler.ts";

interface HeatmapReadState {
  queryKey: string;
  sessions: AggregateSessionRecord[] | null;
  earliestStartTime: number | null;
  status: "loading" | "ready" | "error";
}

const EMPTY_SESSIONS: AggregateSessionRecord[] = [];
const CACHED_REFRESH_IDLE_TIMEOUT_MS = 1_500;

export function useDataHeatmapSnapshot(
  selection: HeatmapSelection,
  refreshKey: number,
) {
  const currentDateKey = formatLocalDateKey(new Date());
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const queryKey = useMemo(() => getHeatmapSelectionKey(selection, nowMs), [selection, nowMs]);
  const [state, setState] = useState<HeatmapReadState>(() => {
    const sessions = getCachedDataHeatmapSessions(selection, nowMs) ?? null;
    return {
      queryKey,
      sessions,
      earliestStartTime: getCachedEarliestSessionStartTime() ?? null,
      status: sessions ? "ready" : "loading",
    };
  });

  useEffect(() => {
    let cancelled = false;
    const nextNowMs = Date.now();
    const nextKey = getHeatmapSelectionKey(selection, nextNowMs);
    const cachedSessions = getCachedDataHeatmapSessions(selection, nextNowMs) ?? null;
    setNowMs(nextNowMs);
    setState((current) => ({
      ...current,
      queryKey: nextKey,
      sessions: current.queryKey === nextKey ? current.sessions ?? cachedSessions : cachedSessions,
      status: "loading",
    }));

    const load = async () => {
      try {
        const snapshot = await loadDataHeatmapSnapshot(selection, nextNowMs);
        if (cancelled) return;
        setState({
          queryKey: nextKey,
          sessions: snapshot.sessions,
          earliestStartTime: snapshot.earliestStartTime,
          status: "ready",
        });
      } catch (error) {
        if (cancelled) return;
        console.warn("Failed to read data heatmap:", error);
        setState((current) => ({ ...current, status: "error" }));
      }
    };
    let cancelScheduledLoad: (() => void) | undefined;
    if (cachedSessions && retryKey === 0) {
      cancelScheduledLoad = scheduleDataWorkAfterFirstPaint(
        () => { void load(); }, CACHED_REFRESH_IDLE_TIMEOUT_MS,
      );
    } else {
      void load();
    }

    return () => {
      cancelled = true;
      cancelScheduledLoad?.();
    };
  }, [currentDateKey, refreshKey, retryKey, selection]);

  const matchesQuery = state.queryKey === queryKey;
  const hasSnapshot = matchesQuery && state.sessions !== null;
  return {
    sessions: matchesQuery ? state.sessions ?? EMPTY_SESSIONS : EMPTY_SESSIONS,
    hasSnapshot,
    earliestStartTime: state.earliestStartTime,
    loading: !matchesQuery || state.status === "loading",
    error: matchesQuery && state.status === "error",
    nowMs,
    retry,
  };
}
