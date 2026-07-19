import { ProcessMapper } from "../../../shared/classification/processMapper.ts";
import {
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
export const CLASSIFICATION_APP_CATALOG_RAW_PAGE_LIMIT = 120;
export const CLASSIFICATION_APP_CATALOG_MAX_RAW_PAGES = 4;

export interface ClassificationAppCatalogBatchInput {
  cursor: RecordedAppCatalogCursor | null;
  searchQuery: string;
  seenExeNames: readonly string[];
}

export interface ClassificationAppCatalogBatchDeps {
  loadRecordedPage: (input: {
    cursor: RecordedAppCatalogCursor | null;
    searchQuery: string;
    limit: number;
  }) => Promise<RecordedAppCatalogPage>;
}

export interface ClassificationAppCatalogBatchResult {
  candidates: ObservedAppCandidate[];
  nextCursor: RecordedAppCatalogCursor | null;
  hasMore: boolean;
}

interface ClassificationAppCatalogLoadAllInput {
  requestedGeneration?: number;
  onBatch: (candidates: ObservedAppCandidate[], hasMore: boolean) => void;
}

function toRecordedCandidate(row: RecordedAppCatalogRow): ObservedAppCandidate | null {
  const canonicalExe = resolveCanonicalExecutable(row.rawExeName);
  if (!canonicalExe || !shouldTrackProcess(row.rawExeName, { appName: row.appName })) {
    return null;
  }
  const mapped = ProcessMapper.map(canonicalExe, { appName: row.appName });
  if (mapped.category === "system") {
    return null;
  }
  return {
    exeName: canonicalExe,
    appName: row.appName.trim() || mapped.name || canonicalExe,
    totalDuration: 0,
    lastSeenMs: Math.max(0, row.lastSeenMs),
    hasNativeRecords: row.hasNativeRecords,
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
  let cursor = input.cursor;
  let recordedSourceExhausted = false;
  let rawPagesConsumed = 0;
  let stoppedInsidePage = false;

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
    rawPagesConsumed += 1;
    if (page.rows.length === 0) {
      recordedSourceExhausted = !page.hasMore;
      cursor = page.nextCursor;
      break;
    }

    for (const row of page.rows) {
      cursor = { lastSeenMs: row.lastSeenMs, rawExeName: row.rawExeName };
      const candidate = toRecordedCandidate(row);
      if (!candidate) continue;
      const existing = candidates.find((item) => item.exeName === candidate.exeName);
      if (existing) {
        existing.lastSeenMs = Math.max(existing.lastSeenMs, candidate.lastSeenMs);
        existing.hasNativeRecords ||= candidate.hasNativeRecords;
        continue;
      }
      if (seen.has(candidate.exeName)) continue;
      seen.add(candidate.exeName);
      candidates.push(candidate);
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
    nextCursor: cursor,
    hasMore: stoppedInsidePage || !recordedSourceExhausted,
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
    let cursor: RecordedAppCatalogCursor | null = null;
    const seenExeNames: string[] = [];

    let hasMore = true;
    while (hasMore) {
      const previousCursor = cursor;
      let result: ClassificationAppCatalogBatchResult;
      try {
        result = await loadClassificationAppCatalogBatch({
          cursor: previousCursor,
          searchQuery: "",
          seenExeNames,
        }, this.deps);
      } catch (error) {
        if (requestGeneration !== this.generation) return false;
        throw error;
      }
      if (requestGeneration !== this.generation) return false;

      cursor = result.nextCursor;
      seenExeNames.push(...result.candidates.map((candidate) => candidate.exeName));
      hasMore = result.hasMore;
      input.onBatch(result.candidates, hasMore);

      const recordedCursorAdvanced = previousCursor?.lastSeenMs !== result.nextCursor?.lastSeenMs
        || previousCursor?.rawExeName !== result.nextCursor?.rawExeName;
      if (hasMore && result.candidates.length === 0 && !recordedCursorAdvanced) {
        throw new Error("Classification app catalog made no progress");
      }
    }
    return true;
  }
}
