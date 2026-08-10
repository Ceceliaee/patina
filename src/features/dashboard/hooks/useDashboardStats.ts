import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HistorySession } from "../../../shared/types/sessions";
import {
  buildDashboardReadModel,
  loadIconSnapshot,
  type DashboardReadModel,
  type DashboardSnapshot,
  type ImportedDashboardBucket,
} from "../services/dashboardReadModel";
import { getRetryableMissingDashboardIconExecutables } from "../services/dashboardIconRuntimeCache";
import { getDashboardSnapshotCache } from "../services/dashboardSnapshotCache";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking";

interface UseStatsResult {
  dashboard: DashboardReadModel;
  icons: Record<string, string>;
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
  const initialSnapshot = getDashboardSnapshotCache();
  const hasRequestedInitialSnapshotRef = useRef(false);
  const [rawSessions, setRawSessions] = useState<HistorySession[]>(
    () => initialSnapshot?.sessions ?? [],
  );
  const [rawYesterdaySessions, setRawYesterdaySessions] = useState<HistorySession[]>(
    () => initialSnapshot?.yesterdaySessions ?? [],
  );
  const [importedBuckets, setImportedBuckets] = useState<ImportedDashboardBucket[]>(
    () => initialSnapshot?.importedBuckets ?? [],
  );
  const [yesterdayImportedBuckets, setYesterdayImportedBuckets] = useState<ImportedDashboardBucket[]>(
    () => initialSnapshot?.yesterdayImportedBuckets ?? [],
  );
  const [aggregateIncludesExactFacts, setAggregateIncludesExactFacts] = useState(
    () => initialSnapshot?.aggregateIncludesExactFacts ?? false,
  );
  const [hasActiveSession, setHasActiveSession] = useState(
    () => initialSnapshot?.hasActiveSession ?? false,
  );
  const [icons, setIcons] = useState<Record<string, string>>(
    () => initialSnapshot?.icons ?? {},
  );
  const [nowMs, setNowMs] = useState(() => initialSnapshot?.fetchedAtMs ?? Date.now());

  const loadSnapshot = useCallback(async () => {
    try {
      const snapshot = await loadDashboardSnapshot(new Date());

      startTransition(() => {
        setRawSessions(snapshot.sessions);
        setRawYesterdaySessions(snapshot.yesterdaySessions ?? []);
        setImportedBuckets(snapshot.importedBuckets ?? []);
        setYesterdayImportedBuckets(snapshot.yesterdayImportedBuckets ?? []);
        setAggregateIncludesExactFacts(snapshot.aggregateIncludesExactFacts ?? false);
        setHasActiveSession(snapshot.hasActiveSession ?? false);
        setIcons(snapshot.icons);
        setNowMs(snapshot.fetchedAtMs);
      });
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
  }, [loadDashboardSnapshot]);

  useEffect(() => {
    if (!classificationReady || hasRequestedInitialSnapshotRef.current) return;
    hasRequestedInitialSnapshotRef.current = true;

    void loadSnapshot();
  }, [classificationReady, loadSnapshot]);

  useEffect(() => {
    if (refreshKey === 0 || !classificationReady || !foregroundRefreshEnabled) return;
    void loadSnapshot();
  }, [classificationReady, foregroundRefreshEnabled, refreshKey, loadSnapshot]);

  useEffect(() => {
    const hasLiveSession = hasActiveSession
      || rawSessions.some((session) => session.endTime === null);
    if (!classificationReady || !foregroundRefreshEnabled || !hasLiveSession || trackerHealth.status !== "healthy") {
      return;
    }

    const iconExeNames = [...rawSessions, ...importedBuckets].map((session) => session.exeName);

    const timer = window.setInterval(() => {
      setNowMs(Date.now());
      if (aggregateIncludesExactFacts) {
        void loadSnapshot();
      }

      const missingIconExeNames = getRetryableMissingDashboardIconExecutables(
        iconExeNames,
        icons,
      );

      if (missingIconExeNames.length > 0) {
        void loadIconSnapshot(missingIconExeNames)
          .then((snapshot) => {
            startTransition(() => {
              setIcons((currentIcons) => ({
                ...currentIcons,
                ...snapshot.icons,
              }));
            });
          })
          .catch((error) => {
            console.warn("Failed to refresh icon cache:", error);
          });
      }
    }, refreshIntervalSecs * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [aggregateIncludesExactFacts, classificationReady, foregroundRefreshEnabled, hasActiveSession, icons, importedBuckets, loadSnapshot, rawSessions, refreshIntervalSecs, trackerHealth.status]);

  const dashboard = useMemo(
    () => buildDashboardReadModel(
      classificationReady ? rawSessions : [],
      trackerHealth,
      nowMs,
      classificationReady ? rawYesterdaySessions : [],
      classificationReady ? importedBuckets : [],
      classificationReady ? yesterdayImportedBuckets : [],
      aggregateIncludesExactFacts,
    ),
    // The read model reads module-level classification mappings; this token is its explicit invalidation signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aggregateIncludesExactFacts, classificationReady, importedBuckets, mappingVersion, nowMs, rawSessions, rawYesterdaySessions, trackerHealth, yesterdayImportedBuckets],
  );

  return {
    dashboard,
    icons,
  };
}
