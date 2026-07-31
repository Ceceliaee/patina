import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  loadDataDestinationDetailDay,
  type DataDestinationDetailDayViewModel,
} from "../services/dataDestinationDetailReadModel.ts";
import {
  encodeDataDestinationDetailDayRequestKey,
  isDataDestinationDetailDateKeyAvailable,
  resolveDataDestinationFocusedDateKey,
  type DataDestinationDetailTarget,
} from "../services/dataDestinationDetailState.ts";
import {
  resolveDataTrendRange,
  toLocalDateKey,
  type DataTrendRangeSelection,
} from "../services/dataTrendRange.ts";

type DetailLoadStatus = "loading" | "refreshing" | "ready" | "error";

interface UseDataDestinationDetailParams {
  target: DataDestinationDetailTarget;
  selection: DataTrendRangeSelection;
  refreshKey: number;
  mappingVersion: number;
  mergeThresholdSecs: number;
}

interface DetailDayState {
  requestKey: string;
  viewModel: DataDestinationDetailDayViewModel | null;
  status: DetailLoadStatus;
  error: Error | null;
}

function toError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

export function useDataDestinationDetail({
  target,
  selection,
  refreshKey,
  mappingVersion,
  mergeThresholdSecs,
}: UseDataDestinationDetailParams) {
  const [nowMs] = useState(() => Date.now());
  const resolvedRange = useMemo(
    () => resolveDataTrendRange(selection, nowMs),
    [nowMs, selection],
  );
  const cacheVersion = `${mappingVersion}:${refreshKey}`;
  const targetIdentity = `${target.mode}:${target.key}`;
  const dayRequestRef = useRef<string | null>(null);
  const [dayRetryRevision, setDayRetryRevision] = useState(0);
  const [focusedDateKey, setFocusedDateKeyState] = useState(() => (
    resolveDataDestinationFocusedDateKey({
      activeDateKeys: [],
      previousDateKey: null,
      range: resolvedRange,
      nowMs,
    })
  ));
  const [dayState, setDayState] = useState<DetailDayState>({
    requestKey: "",
    viewModel: null,
    status: "loading",
    error: null,
  });

  useEffect(() => {
    setFocusedDateKeyState((current) => (
      resolveDataDestinationFocusedDateKey({
        activeDateKeys: [],
        previousDateKey: current,
        range: resolvedRange,
        nowMs,
      })
    ));
  }, [nowMs, resolvedRange]);

  useEffect(() => {
    const dayRequestKey = encodeDataDestinationDetailDayRequestKey(
      target,
      focusedDateKey,
      cacheVersion,
    );
    dayRequestRef.current = dayRequestKey;
    let cancelled = false;

    setDayState((current) => {
      const sameTarget = current.requestKey.startsWith(`${target.mode}:${target.key}:`);
      return {
        requestKey: dayRequestKey,
        viewModel: sameTarget ? current.viewModel : null,
        status: sameTarget && current.viewModel ? "refreshing" : "loading",
        error: null,
      };
    });

    void loadDataDestinationDetailDay(
      target,
      focusedDateKey,
      nowMs,
      mergeThresholdSecs,
    ).then((viewModel) => {
      if (cancelled || dayRequestRef.current !== dayRequestKey) return;
      startTransition(() => {
        setDayState({
          requestKey: dayRequestKey,
          viewModel,
          status: "ready",
          error: null,
        });
      });
    }).catch((error: unknown) => {
      if (cancelled || dayRequestRef.current !== dayRequestKey) return;
      setDayState((current) => ({
        ...current,
        requestKey: dayRequestKey,
        status: "error",
        error: toError(error),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [
    cacheVersion,
    dayRetryRevision,
    focusedDateKey,
    mergeThresholdSecs,
    nowMs,
    target,
    targetIdentity,
  ]);

  const setFocusedDateKey = useCallback((dateKey: string) => {
    if (!isDataDestinationDetailDateKeyAvailable(dateKey, nowMs)) return;
    setFocusedDateKeyState(dateKey);
  }, [nowMs]);
  const retryDay = useCallback(() => {
    setDayRetryRevision((current) => current + 1);
  }, []);

  return {
    nowMs,
    todayDateKey: toLocalDateKey(new Date(nowMs)),
    focusedDateKey,
    setFocusedDateKey,
    day: dayState,
    retryDay,
  };
}
