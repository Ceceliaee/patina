import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { HistorySession } from "../../../shared/types/sessions.ts";
import type {
  WebActivitySegment,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
import { formatLocalDateKey, startOfLocalDay } from "../../../shared/lib/localDate.ts";
import {
  getCachedHistoryBootstrapSnapshot,
  loadPersistedHistoryBootstrapSnapshot,
  saveHistoryBootstrapSnapshot,
  type HistoryBootstrapIdentity,
} from "../services/historyBootstrapSnapshot.ts";
import {
  areHistoryWebFaviconsResolvedForSegments,
  getCachedHistoryWebFaviconsForSegments,
  loadHistoryDaySessionDetails,
  loadHistoryWebFaviconsForSegments,
  type AggregateSessionRecord,
  type HistorySnapshot,
  type HistorySnapshotLoadOptions,
} from "../services/historyReadModel.ts";
import {
  getHistorySnapshotCache,
  setHistorySnapshotCache,
} from "../services/historySnapshotCache.ts";

export type HistoryContentState =
  | "bootstrap"
  | "refreshing"
  | "ready"
  | "empty"
  | "cold-loading"
  | "error";

interface UseHistorySnapshotRuntimeOptions {
  getHistorySeedSnapshot: (date: Date) => HistorySnapshot | null;
  loadHistorySnapshot: (
    date: Date,
    rollingDayCount?: number,
    options?: HistorySnapshotLoadOptions,
  ) => Promise<HistorySnapshot>;
  mappingVersion: number;
  refreshEnabled: boolean;
  refreshKey: number;
  selectedDate: Date;
  titleRecordingEnabled: boolean;
  webActivityEnabled: boolean;
}

function formatHistoryDateCacheKey(date: Date): string {
  return formatLocalDateKey(startOfLocalDay(date));
}

function resolveSnapshotWebFavicons(snapshot: HistorySnapshot | null): Record<string, string> {
  if (!snapshot) return {};
  return {
    ...getCachedHistoryWebFaviconsForSegments(snapshot.dayWebSegments),
    ...snapshot.webDomainFavicons,
  };
}

function hasResolvedSnapshotWebFavicons(snapshot: HistorySnapshot | null): boolean {
  if (!snapshot || snapshot.dayWebSegments.length === 0) return true;
  if (areHistoryWebFaviconsResolvedForSegments(snapshot.dayWebSegments)) return true;

  return snapshot.dayWebSegments.every((segment) => (
    Boolean(snapshot.webDomainFavicons[segment.normalizedDomain]?.trim())
  ));
}

function recordsMatch(
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right).length) return false;
  return leftEntries.every(([key, value]) => right[key] === value);
}

export function useHistorySnapshotRuntime({
  getHistorySeedSnapshot,
  loadHistorySnapshot,
  mappingVersion,
  refreshEnabled,
  refreshKey,
  selectedDate,
  titleRecordingEnabled,
  webActivityEnabled,
}: UseHistorySnapshotRuntimeOptions) {
  const [initialSnapshotState] = useState(() => {
    const identity: HistoryBootstrapIdentity = {
      dateKey: formatHistoryDateCacheKey(selectedDate),
      mappingVersion,
      webActivityEnabled,
    };
    const cachedSnapshot = getHistorySnapshotCache(selectedDate, 7, webActivityEnabled);
    const bootstrapSnapshot = getCachedHistoryBootstrapSnapshot(identity)?.snapshot ?? null;
    const seedSnapshot = getHistorySeedSnapshot(selectedDate);
    return {
      source: cachedSnapshot
        ? "cache"
        : bootstrapSnapshot || seedSnapshot
          ? "bootstrap"
          : "cold",
      snapshot: cachedSnapshot ?? bootstrapSnapshot ?? seedSnapshot,
    } as const;
  });
  const initialVisibleSnapshot = initialSnapshotState.snapshot;
  const [rawDaySessions, setRawDaySessions] = useState<HistorySession[]>(
    () => initialVisibleSnapshot?.daySessions ?? [],
  );
  const [rawWeeklySessions, setRawWeeklySessions] = useState<HistorySession[]>(
    () => initialVisibleSnapshot?.weeklySessions ?? [],
  );
  const [rawDayAggregateSessions, setRawDayAggregateSessions] = useState<AggregateSessionRecord[]>(
    () => initialVisibleSnapshot?.dayAggregateSessions ?? [],
  );
  const [rawWeeklyAggregateSessions, setRawWeeklyAggregateSessions] = useState<AggregateSessionRecord[]>(
    () => initialVisibleSnapshot?.weeklyAggregateSessions ?? [],
  );
  const [snapshotIcons, setSnapshotIcons] = useState<Record<string, string>>(
    () => initialVisibleSnapshot?.icons ?? {},
  );
  const [rawDayWebSegments, setRawDayWebSegments] = useState<WebActivitySegment[]>(
    () => initialVisibleSnapshot?.dayWebSegments ?? [],
  );
  const [webDomainFavicons, setWebDomainFavicons] = useState<Record<string, string>>(
    () => resolveSnapshotWebFavicons(initialVisibleSnapshot),
  );
  const [webFaviconsReady, setWebFaviconsReady] = useState(
    () => !webActivityEnabled || hasResolvedSnapshotWebFavicons(initialVisibleSnapshot),
  );
  const [webDomainOverrides, setWebDomainOverrides] = useState<Record<string, WebDomainOverride>>(
    () => initialVisibleSnapshot?.webDomainOverrides ?? {},
  );
  const [nowMs, setNowMs] = useState(() => initialVisibleSnapshot?.fetchedAtMs ?? Date.now());
  const [contentState, setContentState] = useState<HistoryContentState>(() => {
    if (initialSnapshotState.source === "cache") return "refreshing";
    if (initialSnapshotState.source === "bootstrap") return "bootstrap";
    return "cold-loading";
  });
  const visibleDateKeyRef = useRef<string | null>(
    initialVisibleSnapshot ? formatHistoryDateCacheKey(selectedDate) : null,
  );
  const requestGenerationRef = useRef(0);

  const applyVisibleSnapshot = useCallback((
    snapshot: HistorySnapshot,
    dateKey: string,
    nextState: HistoryContentState,
    deferred: boolean = false,
  ) => {
    const nextWebDomainFavicons = resolveSnapshotWebFavicons(snapshot);
    const nextWebFaviconsReady = !webActivityEnabled
      || hasResolvedSnapshotWebFavicons(snapshot);
    const apply = () => {
      setRawDaySessions(snapshot.daySessions);
      setRawWeeklySessions(snapshot.weeklySessions);
      setRawDayAggregateSessions(snapshot.dayAggregateSessions ?? []);
      setRawWeeklyAggregateSessions(snapshot.weeklyAggregateSessions ?? []);
      setSnapshotIcons(snapshot.icons);
      setRawDayWebSegments(snapshot.dayWebSegments);
      setWebDomainFavicons(nextWebDomainFavicons);
      setWebFaviconsReady(nextWebFaviconsReady);
      setWebDomainOverrides(snapshot.webDomainOverrides);
      setNowMs(snapshot.fetchedAtMs);
      visibleDateKeyRef.current = dateKey;
      setContentState(nextState);
    };

    if (deferred) {
      startTransition(apply);
      return;
    }
    apply();
  }, [webActivityEnabled]);

  const clearVisibleSnapshot = useCallback(() => {
    setRawDaySessions([]);
    setRawWeeklySessions([]);
    setRawDayAggregateSessions([]);
    setRawWeeklyAggregateSessions([]);
    setSnapshotIcons({});
    setRawDayWebSegments([]);
    setWebDomainFavicons({});
    setWebFaviconsReady(true);
    setWebDomainOverrides({});
    visibleDateKeyRef.current = null;
  }, []);

  useEffect(() => {
    if (!refreshEnabled) return undefined;

    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const requestDate = new Date(selectedDate);
    const requestDateKey = formatHistoryDateCacheKey(requestDate);
    const requestIdentity: HistoryBootstrapIdentity = {
      dateKey: requestDateKey,
      mappingVersion,
      webActivityEnabled,
    };
    const cachedSnapshot = getHistorySnapshotCache(requestDate, 7, webActivityEnabled);
    const bootstrapSnapshot = getCachedHistoryBootstrapSnapshot(requestIdentity)?.snapshot ?? null;
    const seedSnapshot = getHistorySeedSnapshot(requestDate);
    let hasUsableSnapshot = false;

    if (cachedSnapshot) {
      hasUsableSnapshot = true;
      applyVisibleSnapshot(cachedSnapshot, requestDateKey, "refreshing");
    } else if (bootstrapSnapshot) {
      hasUsableSnapshot = true;
      applyVisibleSnapshot(bootstrapSnapshot, requestDateKey, "bootstrap");
    } else if (seedSnapshot) {
      hasUsableSnapshot = true;
      applyVisibleSnapshot(seedSnapshot, requestDateKey, "bootstrap");
    } else if (visibleDateKeyRef.current === requestDateKey) {
      hasUsableSnapshot = true;
      setContentState("refreshing");
    } else {
      clearVisibleSnapshot();
      setContentState("cold-loading");
    }

    const restorePersistedSnapshot = async () => {
      if (hasUsableSnapshot) return;

      const persisted = await loadPersistedHistoryBootstrapSnapshot();
      if (requestGenerationRef.current !== requestGeneration) return;
      if (visibleDateKeyRef.current === requestDateKey) return;
      if (
        persisted
        && persisted.identity.dateKey === requestIdentity.dateKey
        && persisted.identity.mappingVersion === requestIdentity.mappingVersion
        && persisted.identity.webActivityEnabled === requestIdentity.webActivityEnabled
      ) {
        hasUsableSnapshot = true;
        applyVisibleSnapshot(persisted.snapshot, requestDateKey, "bootstrap");
      }
    };

    const loadFreshSnapshot = async () => {
      try {
        const snapshot = await loadHistorySnapshot(requestDate, 7, {
          includeWebActivity: webActivityEnabled,
          includeTitleDetails: false,
        });
        if (requestGenerationRef.current !== requestGeneration) return;

        const nextState = snapshot.daySessions.length > 0
          || (snapshot.dayAggregateSessions?.length ?? 0) > 0
          || snapshot.dayWebSegments.length > 0
          ? "ready"
          : "empty";
        applyVisibleSnapshot(snapshot, requestDateKey, nextState, hasUsableSnapshot);
        void saveHistoryBootstrapSnapshot(snapshot, requestIdentity);

        if (titleRecordingEnabled) {
          void loadHistoryDaySessionDetails(requestDate).then((daySessions) => {
            if (requestGenerationRef.current !== requestGeneration) return;
            const cachedCoreSnapshot = getHistorySnapshotCache(
              requestDate,
              7,
              webActivityEnabled,
            );
            if (cachedCoreSnapshot) {
              setHistorySnapshotCache({
                ...cachedCoreSnapshot,
                daySessions,
              }, requestDate, 7, webActivityEnabled);
            }
            startTransition(() => setRawDaySessions(daySessions));
          }).catch((error) => {
            console.warn("History title detail enrichment failed", error);
          });
        }
      } catch (error) {
        if (requestGenerationRef.current !== requestGeneration) return;
        console.warn("History snapshot refresh failed", error);
        setContentState("error");
      }
    };

    void restorePersistedSnapshot();
    void loadFreshSnapshot();
    return () => {
      if (requestGenerationRef.current === requestGeneration) {
        requestGenerationRef.current += 1;
      }
    };
  }, [
    applyVisibleSnapshot,
    clearVisibleSnapshot,
    getHistorySeedSnapshot,
    loadHistorySnapshot,
    mappingVersion,
    refreshEnabled,
    refreshKey,
    selectedDate,
    titleRecordingEnabled,
    webActivityEnabled,
  ]);

  useEffect(() => {
    if (!webActivityEnabled || rawDayWebSegments.length === 0) {
      setWebDomainFavicons({});
      setWebFaviconsReady(true);
      return undefined;
    }

    let cancelled = false;
    void loadHistoryWebFaviconsForSegments(rawDayWebSegments).then((favicons) => {
      if (cancelled) return;
      startTransition(() => {
        setWebDomainFavicons((current) => recordsMatch(current, favicons) ? current : favicons);
        setWebFaviconsReady(true);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [rawDayWebSegments, webActivityEnabled]);

  return {
    contentState,
    nowMs,
    rawDaySessions,
    rawDayAggregateSessions,
    rawDayWebSegments,
    rawWeeklySessions,
    rawWeeklyAggregateSessions,
    setNowMs,
    snapshotIcons,
    visibleDateKey: visibleDateKeyRef.current,
    webDomainFavicons,
    webFaviconsReady,
    webDomainOverrides,
  };
}
