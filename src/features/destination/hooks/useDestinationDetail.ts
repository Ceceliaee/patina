import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import {
  loadDestinationDetailDay,
  type DestinationDetailDayViewModel,
} from "../services/destinationDetailReadModel.ts";
import {
  encodeDestinationDetailDayRequestKey,
  isDestinationDetailDateKeyAvailable,
  resolveDestinationDetailInitialDateKey,
} from "../services/destinationDetailState.ts";
import type { DestinationDetailTarget } from "../types.ts";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking.ts";

type DetailLoadStatus = "loading" | "refreshing" | "ready" | "error";

interface Params {
  target: DestinationDetailTarget;
  initialDateKey: string;
  refreshKey: number;
  mappingVersion: number;
  mergeThresholdSecs: number;
  trackerHealth: TrackerHealthSnapshot;
}

interface DetailDayState {
  requestKey: string;
  viewModel: DestinationDetailDayViewModel | null;
  status: DetailLoadStatus;
  error: Error | null;
}

export function useDestinationDetail({
  target,
  initialDateKey,
  refreshKey,
  mappingVersion,
  mergeThresholdSecs,
  trackerHealth,
}: Params) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [focusedDateKey, setFocusedDateKeyState] = useState(() => (
    resolveDestinationDetailInitialDateKey(initialDateKey, nowMs)
  ));
  const requestRef = useRef<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const [dayState, setDayState] = useState<DetailDayState>({
    requestKey: "",
    viewModel: null,
    status: "loading",
    error: null,
  });
  const cacheVersion = `${mappingVersion}:${refreshKey}`;
  useEffect(() => {
    const requestNowMs = Date.now();
    setNowMs(requestNowMs);
    const requestKey = encodeDestinationDetailDayRequestKey(
      target,
      focusedDateKey,
      cacheVersion,
    );
    requestRef.current = requestKey;
    let cancelled = false;
    setDayState((current) => {
      const sameTarget = current.requestKey.startsWith(`${target.mode}:${target.key}:`);
      return {
        requestKey,
        viewModel: sameTarget ? current.viewModel : null,
        status: sameTarget && current.viewModel ? "refreshing" : "loading",
        error: null,
      };
    });
    void loadDestinationDetailDay(
      target,
      focusedDateKey,
      requestNowMs,
      mergeThresholdSecs,
      undefined,
      trackerHealth.status,
      trackerHealth.lastHeartbeatMs,
    )
      .then((viewModel) => {
        if (cancelled || requestRef.current !== requestKey) return;
        startTransition(() => setDayState((current) => cancelled || requestRef.current !== requestKey ? current : ({
          requestKey,
          viewModel,
          status: "ready",
          error: null,
        })));
      })
      .catch((error: unknown) => {
        if (cancelled || requestRef.current !== requestKey) return;
        setDayState((current) => ({
          ...current,
          status: "error",
          error: error instanceof Error ? error : new Error(String(error)),
        }));
      });
    return () => { cancelled = true; };
  }, [
    cacheVersion,
    focusedDateKey,
    mergeThresholdSecs,
    retryRevision,
    target,
    trackerHealth.lastHeartbeatMs,
    trackerHealth.status,
  ]);

  const setFocusedDateKey = useCallback((dateKey: string) => {
    if (isDestinationDetailDateKeyAvailable(dateKey, nowMs)) {
      setFocusedDateKeyState(dateKey);
    }
  }, [nowMs]);

  return {
    nowMs,
    todayDateKey: formatLocalDateKey(new Date(nowMs)),
    focusedDateKey,
    setFocusedDateKey,
    day: dayState,
    retryDay: () => setRetryRevision((current) => current + 1),
  };
}
