import { ProcessMapper } from "../../../shared/classification/processMapper.ts";
import {
  normalizeExecutable,
  resolveCanonicalExecutable,
  shouldTrackProcess,
} from "../../../shared/classification/processNormalization.ts";
import type {
  RecordedAppCatalogCursor,
  RecordedAppCatalogPage,
  RecordedAppCatalogRow,
} from "../../../platform/persistence/classificationPersistence.ts";
export type { RecordedAppCatalogCursor } from "../../../platform/persistence/classificationPersistence.ts";
import type { ObservedAppCandidate } from "./classificationStore.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";

export const CLASSIFICATION_APP_CATALOG_CARD_LIMIT = 60;
const CLASSIFICATION_APP_CATALOG_RAW_PAGE_LIMIT = 120;
export const CLASSIFICATION_APP_CATALOG_MAX_RAW_PAGES = 4;

interface ClassificationAppCatalogBatchInput {
  cursor: RecordedAppCatalogCursor | null;
  searchQuery: string;
  seenExeNames: readonly string[];
}

interface ClassificationAppCatalogBatchDeps {
  loadRecordedPage: (input: {
    cursor: RecordedAppCatalogCursor | null;
    searchQuery: string;
    limit: number;
  }) => Promise<RecordedAppCatalogPage>;
}

interface ClassificationAppCatalogBatchResult {
  candidates: ObservedAppCandidate[];
  displayNameRanks: Record<string, number>;
  nextCursor: RecordedAppCatalogCursor | null;
  hasMore: boolean;
  sourceRevision: number;
}

interface ClassificationAppCatalogLoadAllInput {
  requestedGeneration?: number;
  onBatch: (candidates: ObservedAppCandidate[], hasMore: boolean) => void;
}

interface ClassificationAppCatalogLoadResult {
  candidates: ObservedAppCandidate[];
  sourceRevision: number;
}

type ClassificationAppCatalogSnapshotStatus =
  | "cold"
  | "ready"
  | "refreshing"
  | "error";

export interface CompleteAppCatalogSnapshot {
  candidates: ObservedAppCandidate[];
  sourceRevision: number;
  completedAtMs: number;
}

interface ClassificationAppCatalogSnapshotState {
  status: ClassificationAppCatalogSnapshotStatus;
  committed: CompleteAppCatalogSnapshot | null;
  requestGeneration: number;
  error: unknown | null;
}

interface ClassificationAppCatalogLoader {
  loadAll: ClassificationAppCatalogController["loadAll"];
}

export class ClassificationAppCatalogRevisionChangedError extends Error {
  constructor() {
    super("Classification app catalog revision changed during pagination");
    this.name = "ClassificationAppCatalogRevisionChangedError";
  }
}

interface RankedRecordedCandidate {
  candidate: ObservedAppCandidate;
  displayNameRank: number;
}

function toRecordedCandidate(row: RecordedAppCatalogRow): RankedRecordedCandidate | null {
  const canonicalExe = resolveCanonicalExecutable(row.rawExeName);
  if (!canonicalExe || !shouldTrackProcess(row.rawExeName, { appName: row.appName })) {
    return null;
  }
  const isCanonicalExecutable = normalizeExecutable(row.rawExeName) === canonicalExe;
  const runtimeAppName = row.appName.trim();
  const mapped = ProcessMapper.mapWithoutOverride(
    canonicalExe,
    isCanonicalExecutable ? { appName: runtimeAppName } : {},
  );
  return {
    candidate: {
      exeName: canonicalExe,
      appName: mapped.name,
      totalDuration: 0,
      lastSeenMs: Math.max(0, row.lastSeenMs),
      hasNativeRecords: row.hasNativeRecords,
    },
    displayNameRank: isCanonicalExecutable
      ? (runtimeAppName ? 2 : 1)
      : 0,
  };
}

export function countClassificationCandidates(
  candidates: readonly ObservedAppCandidate[],
  resolveTrackingEnabled: (candidate: ObservedAppCandidate) => boolean,
  resolveCategory: (candidate: ObservedAppCandidate) => UserAssignableAppCategory,
) {
  const included = candidates.filter(resolveTrackingEnabled);
  const other = included.filter((candidate) => resolveCategory(candidate) === "other").length;
  return {
    all: included.length,
    other,
    classified: included.length - other,
    excluded: candidates.length - included.length,
  };
}

export async function loadClassificationAppCatalogBatch(
  input: ClassificationAppCatalogBatchInput,
  deps: ClassificationAppCatalogBatchDeps,
): Promise<ClassificationAppCatalogBatchResult> {
  const seen = new Set(input.seenExeNames.map(resolveCanonicalExecutable).filter(Boolean));
  const candidates: ObservedAppCandidate[] = [];
  const displayNameRanks = new Map<string, number>();
  let cursor = input.cursor;
  let recordedSourceExhausted = false;
  let rawPagesConsumed = 0;
  let stoppedInsidePage = false;
  let sourceRevision: number | null = null;

  while (
    candidates.length < CLASSIFICATION_APP_CATALOG_CARD_LIMIT
    && rawPagesConsumed < CLASSIFICATION_APP_CATALOG_MAX_RAW_PAGES
    && !recordedSourceExhausted
  ) {
    const page = await deps.loadRecordedPage({
      cursor,
      searchQuery: input.searchQuery,
      limit: CLASSIFICATION_APP_CATALOG_RAW_PAGE_LIMIT,
    });
    const pageRevision = page.sourceRevision ?? 0;
    if (sourceRevision === null) {
      sourceRevision = pageRevision;
    } else if (sourceRevision !== pageRevision) {
      throw new ClassificationAppCatalogRevisionChangedError();
    }
    rawPagesConsumed += 1;
    if (page.rows.length === 0) {
      recordedSourceExhausted = !page.hasMore;
      cursor = page.nextCursor;
      break;
    }

    for (const row of page.rows) {
      cursor = { lastSeenMs: row.lastSeenMs, rawExeName: row.rawExeName };
      const rankedCandidate = toRecordedCandidate(row);
      if (!rankedCandidate) continue;
      const { candidate, displayNameRank } = rankedCandidate;
      const existing = candidates.find((item) => item.exeName === candidate.exeName);
      if (existing) {
        existing.lastSeenMs = Math.max(existing.lastSeenMs, candidate.lastSeenMs);
        existing.hasNativeRecords ||= candidate.hasNativeRecords;
        const existingRank = displayNameRanks.get(candidate.exeName) ?? 0;
        if (displayNameRank > existingRank) {
          existing.appName = candidate.appName;
          displayNameRanks.set(candidate.exeName, displayNameRank);
        }
        continue;
      }
      if (seen.has(candidate.exeName)) continue;
      seen.add(candidate.exeName);
      candidates.push(candidate);
      displayNameRanks.set(candidate.exeName, displayNameRank);
      if (candidates.length >= CLASSIFICATION_APP_CATALOG_CARD_LIMIT) {
        stoppedInsidePage = true;
        break;
      }
    }

    if (stoppedInsidePage) break;
    recordedSourceExhausted = !page.hasMore;
    cursor = page.nextCursor;
  }

  return {
    candidates,
    displayNameRanks: Object.fromEntries(displayNameRanks),
    nextCursor: cursor,
    hasMore: stoppedInsidePage || !recordedSourceExhausted,
    sourceRevision: sourceRevision ?? 0,
  };
}

export class ClassificationAppCatalogController {
  private readonly deps: ClassificationAppCatalogBatchDeps;
  private generation = 0;

  constructor(deps: ClassificationAppCatalogBatchDeps) {
    this.deps = deps;
  }

  invalidate() {
    this.generation += 1;
    return this.generation;
  }

  async loadAll(input: ClassificationAppCatalogLoadAllInput) {
    const requestGeneration = input.requestedGeneration ?? this.invalidate();
    this.generation = requestGeneration;
    const revisionRetryLimit = 1;

    for (let attempt = 0; attempt <= revisionRetryLimit; attempt += 1) {
      let cursor: RecordedAppCatalogCursor | null = null;
      const accumulatedCandidates = new Map<string, ObservedAppCandidate>();
      const accumulatedDisplayNameRanks = new Map<string, number>();
      let expectedRevision: number | null = null;
      let hasMore = true;

      try {
        while (hasMore) {
          const previousCursor = cursor;
          const result = await loadClassificationAppCatalogBatch({
            cursor: previousCursor,
            searchQuery: "",
            seenExeNames: [],
          }, this.deps);
          if (requestGeneration !== this.generation) return false;
          if (expectedRevision === null) {
            expectedRevision = result.sourceRevision;
          } else if (expectedRevision !== result.sourceRevision) {
            throw new ClassificationAppCatalogRevisionChangedError();
          }

          cursor = result.nextCursor;
          hasMore = result.hasMore;
          const updates = result.candidates.map((candidate) => {
            const incomingRank = result.displayNameRanks[candidate.exeName] ?? 0;
            const existing = accumulatedCandidates.get(candidate.exeName);
            if (!existing) {
              const inserted = { ...candidate };
              accumulatedCandidates.set(candidate.exeName, inserted);
              accumulatedDisplayNameRanks.set(candidate.exeName, incomingRank);
              return { ...inserted };
            }

            existing.lastSeenMs = Math.max(existing.lastSeenMs, candidate.lastSeenMs);
            existing.totalDuration = Math.max(existing.totalDuration, candidate.totalDuration);
            existing.hasNativeRecords ||= candidate.hasNativeRecords;
            const existingRank = accumulatedDisplayNameRanks.get(candidate.exeName) ?? 0;
            if (incomingRank > existingRank) {
              existing.appName = candidate.appName;
              accumulatedDisplayNameRanks.set(candidate.exeName, incomingRank);
            }
            return { ...existing };
          });

          const recordedCursorAdvanced = previousCursor?.lastSeenMs !== result.nextCursor?.lastSeenMs
            || previousCursor?.rawExeName !== result.nextCursor?.rawExeName;
          if (hasMore && updates.length === 0 && !recordedCursorAdvanced) {
            throw new Error("Classification app catalog made no progress");
          }
        }
      } catch (error) {
        if (requestGeneration !== this.generation) return false;
        if (
          error instanceof ClassificationAppCatalogRevisionChangedError
          && attempt < revisionRetryLimit
        ) {
          continue;
        }
        throw error;
      }

      const candidates = Array.from(
        accumulatedCandidates.values(),
        (candidate) => ({ ...candidate }),
      );
      input.onBatch(candidates, false);
      return {
        candidates,
        sourceRevision: expectedRevision ?? 0,
      } satisfies ClassificationAppCatalogLoadResult;
    }

    throw new ClassificationAppCatalogRevisionChangedError();
  }
}

function candidateSnapshotsEqual(
  left: readonly ObservedAppCandidate[],
  right: readonly ObservedAppCandidate[],
) {
  return left.length === right.length && left.every((candidate, index) => {
    const other = right[index];
    return candidate.exeName === other?.exeName
      && candidate.appName === other.appName
      && candidate.totalDuration === other.totalDuration
      && candidate.lastSeenMs === other.lastSeenMs
      && candidate.hasNativeRecords === other.hasNativeRecords;
  });
}

export class ClassificationAppCatalogSnapshotStore {
  private readonly createController: () => ClassificationAppCatalogLoader;
  private readonly nowMs: () => number;
  private state: ClassificationAppCatalogSnapshotState = {
    status: "cold",
    committed: null,
    requestGeneration: 0,
    error: null,
  };
  private listeners = new Set<() => void>();
  private inFlight: {
    generation: number;
    promise: Promise<CompleteAppCatalogSnapshot | null>;
  } | null = null;
  private stale = true;

  constructor(input: {
    createController: () => ClassificationAppCatalogLoader;
    nowMs?: () => number;
  }) {
    this.createController = input.createController;
    this.nowMs = input.nowMs ?? (() => Date.now());
  }

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(next: ClassificationAppCatalogSnapshotState) {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  invalidate(input: { discardCommitted?: boolean } = {}) {
    const requestGeneration = this.state.requestGeneration + 1;
    this.stale = true;
    this.publish({
      status: "cold",
      committed: input.discardCommitted ? null : this.state.committed,
      requestGeneration,
      error: null,
    });
  }

  ensureLoaded() {
    if (this.state.committed && !this.stale) {
      return Promise.resolve(this.state.committed);
    }
    return this.refresh();
  }

  prewarm() {
    return this.ensureLoaded();
  }

  retry() {
    return this.refresh();
  }

  refresh(): Promise<CompleteAppCatalogSnapshot | null> {
    const generation = this.state.requestGeneration + 1;
    if (this.inFlight?.generation === this.state.requestGeneration) {
      return this.inFlight.promise;
    }

    const committedAtStart = this.state.committed;
    this.publish({
      status: committedAtStart ? "refreshing" : "cold",
      committed: committedAtStart,
      requestGeneration: generation,
      error: null,
    });

    const promise = this.createController().loadAll({
      onBatch: () => undefined,
    }).then((result) => {
      if (!result || this.state.requestGeneration !== generation) {
        return this.state.committed;
      }
      const candidates = committedAtStart
        && committedAtStart.sourceRevision === result.sourceRevision
        && candidateSnapshotsEqual(committedAtStart.candidates, result.candidates)
        ? committedAtStart.candidates
        : result.candidates;
      const committed = committedAtStart
        && committedAtStart.sourceRevision === result.sourceRevision
        && candidates === committedAtStart.candidates
        ? committedAtStart
        : {
          candidates,
          sourceRevision: result.sourceRevision,
          completedAtMs: this.nowMs(),
        };
      this.stale = false;
      this.publish({
        status: "ready",
        committed,
        requestGeneration: generation,
        error: null,
      });
      return committed;
    }).catch((error: unknown) => {
      if (this.state.requestGeneration === generation) {
        this.publish({
          status: "error",
          committed: committedAtStart,
          requestGeneration: generation,
          error,
        });
      }
      return Promise.reject(error);
    }).finally(() => {
      if (this.inFlight?.generation === generation) {
        this.inFlight = null;
      }
    });

    this.inFlight = { generation, promise };
    return promise;
  }
}
