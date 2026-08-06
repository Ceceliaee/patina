import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import {
  getCachedDataTrendSnapshot,
  type DataTrendSnapshot,
} from "../services/dataTrendSnapshot.ts";
import {
  resolveDataTrendRange,
  type DataTrendRangeSelection,
} from "../services/dataTrendRange.ts";
import { scheduleDataWorkAfterFirstPaint } from "../services/dataFirstPaintScheduler.ts";

const CACHED_DATA_REFRESH_DELAY_MS = 320;
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

function areDataTrendSnapshotsEquivalent(
  left: DataTrendSnapshot | null,
  right: DataTrendSnapshot,
): boolean {
  return Boolean(
    left
    && left.fetchedAtMs === right.fetchedAtMs
    && left.range.cacheKey === right.range.cacheKey
    && left.sessions === right.sessions
    && left.icons === right.icons,
  );
}

export function useDataTrendSnapshot({
  deferCachedRefresh = true,
  selection,
  refreshKey,
  loadSnapshot,
}: UseDataTrendSnapshotParams) {
  const UI_TEXT = useLocaleText();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const resolvedRange = useMemo(
    () => resolveDataTrendRange(selection, nowMs, UI_TEXT),
    [selection, nowMs, UI_TEXT],
  );
  const cached = getCachedDataTrendSnapshot(resolvedRange);
  const [snapshot, setSnapshot] = useState<DataTrendSnapshot | null>(cached);
  const [loading, setLoading] = useState(!cached);
  const [hasFetchedOnce, setHasFetchedOnce] = useState(Boolean(cached));

  useEffect(() => {
    let cancelled = false;
    let cancelScheduledLoad: (() => void) | null = null;
    const nextNowMs = Date.now();
    const nextRange = resolveDataTrendRange(selection, nextNowMs, UI_TEXT);
    const nextCached = getCachedDataTrendSnapshot(nextRange);
    if (nextCached) {
      setSnapshot((current) => (
        areDataTrendSnapshotsEquivalent(current, nextCached) ? current : nextCached
      ));
      setNowMs((current) => current === nextCached.fetchedAtMs ? current : nextCached.fetchedAtMs);
      setHasFetchedOnce(true);
      setLoading(false);
    } else {
      setLoading(true);
    }

    const loadFreshSnapshot = () => {
      void loadSnapshot(selection, nextNowMs, UI_TEXT).then((nextSnapshot) => {
        if (cancelled) return;
        startTransition(() => {
          setSnapshot(nextSnapshot);
          setNowMs(nextSnapshot.fetchedAtMs);
          setHasFetchedOnce(true);
        });
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    };

    if (nextCached && deferCachedRefresh) {
      cancelScheduledLoad = scheduleDataWorkAfterFirstPaint(
        loadFreshSnapshot,
        CACHED_DATA_REFRESH_IDLE_TIMEOUT_MS,
        CACHED_DATA_REFRESH_DELAY_MS,
      );
    } else {
      loadFreshSnapshot();
    }

    return () => {
      cancelled = true;
      cancelScheduledLoad?.();
    };
  }, [deferCachedRefresh, loadSnapshot, refreshKey, selection, UI_TEXT]);

  return {
    hasFetchedOnce,
    loading,
    nowMs,
    resolvedRange,
    snapshot,
  };
}
