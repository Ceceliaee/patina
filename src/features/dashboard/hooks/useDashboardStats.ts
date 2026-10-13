import { appIconChangeAffects, subscribeAppIconChanges } from "../../../shared/hooks/appIconChanges.ts";
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import {
  buildDashboardReadModel,
  loadIconSnapshot,
  type DashboardReadModel,
  type DashboardSnapshot,
} from "../services/dashboardReadModel";
import { getRetryableMissingDashboardIconExecutables } from "../services/dashboardIconRuntimeCache";
import { getDashboardSnapshotCache } from "../services/dashboardSnapshotCache";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking";

interface UseStatsResult {
  dashboard: DashboardReadModel;
  icons: Record<string, string>;
  readState: DashboardReadState;
}

export interface DashboardReadState {
  status: "loading" | "ready" | "error";
  hasSnapshot: boolean;
  retry: () => void;
}

export function useDashboardStats(
  refreshIntervalSecs: number,
  refreshKey: number,
  trackerHealth: TrackerHealthSnapshot,
  loadDashboardSnapshot: (date?: Date) => Promise<DashboardSnapshot>,
  mappingVersion: number = 0,
  classificationReady: boolean = true,
  foregroundRefreshEnabled: boolean = true,
): UseStatsResult {
  const hasRequestedInitialSnapshotRef = useRef(false);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<{
    dateKey: string;
    snapshot: DashboardSnapshot | null;
    status: DashboardReadState["status"];
  }>(() => {
    const snapshot = getDashboardSnapshotCache();
    return { dateKey: formatLocalDateKey(new Date()), snapshot, status: snapshot ? "ready" : "loading" };
  });
  const [nowMs, setNowMs] = useState(() => state.snapshot?.fetchedAtMs ?? Date.now());
  const currentDateKey = formatLocalDateKey(new Date());
  const snapshot = state.dateKey === currentDateKey ? state.snapshot : null;
  const activityRecords = snapshot?.activityRecords ?? EMPTY_RECORDS;
  const yesterdayActivityRecords = snapshot?.yesterdayActivityRecords ?? EMPTY_RECORDS;
  const hasActiveSession = snapshot?.hasActiveSession ?? false;
  const iconNames = useMemo(() => activityRecords.map(item => item.exeName), [activityRecords]);
  const icons = snapshot?.icons ?? EMPTY_ICONS;

  const loadSnapshot = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const date = new Date();
    const dateKey = formatLocalDateKey(date);
    setState((current) => ({
      dateKey,
      snapshot: current.dateKey === dateKey ? current.snapshot : null,
      status: "loading",
    }));
    try {
      const nextSnapshot = await loadDashboardSnapshot(date);
      if (requestId !== requestIdRef.current) return;
      setState({ dateKey, snapshot: nextSnapshot, status: "ready" });
      setNowMs(nextSnapshot.fetchedAtMs);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      console.warn("Failed to load stats:", err);
      setState((current) => ({ ...current, status: "error" }));
    }
  }, [loadDashboardSnapshot]);

  useEffect(() => {
    if (!classificationReady || (hasRequestedInitialSnapshotRef.current && !foregroundRefreshEnabled)) return;
    hasRequestedInitialSnapshotRef.current = true;
    void loadSnapshot();
    return () => { requestIdRef.current += 1; };
  }, [classificationReady, currentDateKey, foregroundRefreshEnabled, refreshKey, loadSnapshot]);

  useEffect(() => {
    if (!classificationReady) return;
    let cancelled = false;
    const refreshIcons = (names: string[]) => {
      if (!names.length) return;
      void loadIconSnapshot(names).then((next) => {
        if (cancelled) return;
        startTransition(() => setState((current) => current.snapshot ? {
          ...current, snapshot: { ...current.snapshot, icons: { ...current.snapshot.icons, ...next.icons } },
        } : current));
      }).catch(console.warn);
    };
    const stop = subscribeAppIconChanges((exe) => {
      if (appIconChangeAffects(exe, iconNames)) refreshIcons(iconNames);
    });
    const hasLiveSession = hasActiveSession;
    const timer = foregroundRefreshEnabled && hasLiveSession && trackerHealth.status === "healthy"
      ? window.setInterval(() => {
        setNowMs(Date.now());
        void loadSnapshot();
        refreshIcons(getRetryableMissingDashboardIconExecutables(iconNames, icons));
      }, refreshIntervalSecs * 1000) : undefined;
    return () => { cancelled = true; stop(); window.clearInterval(timer); };
  }, [classificationReady, foregroundRefreshEnabled, hasActiveSession, icons, iconNames, loadSnapshot, refreshIntervalSecs, trackerHealth.status]);

  const dashboard = useMemo(
    () => buildDashboardReadModel(
      classificationReady ? activityRecords : [],
      trackerHealth,
      nowMs,
      classificationReady ? yesterdayActivityRecords : [],
    ),
    // The read model reads module-level classification mappings; this token is its explicit invalidation signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activityRecords, classificationReady, mappingVersion, nowMs, trackerHealth, yesterdayActivityRecords],
  );

  return {
    dashboard,
    icons,
    readState: {
      status: state.status,
      hasSnapshot: Boolean(snapshot) && classificationReady,
      retry: () => { void loadSnapshot(); },
    },
  };
}

const EMPTY_RECORDS: DashboardSnapshot["activityRecords"] = [];
const EMPTY_ICONS: Record<string, string> = {};
