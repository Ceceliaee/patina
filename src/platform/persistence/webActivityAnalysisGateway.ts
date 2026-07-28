import { invokeWithCommandError } from "./commandError.ts";

export interface WebActivityAggregateRecord {
  normalizedDomain: string;
  bucketStartMs: number;
  durationMs: number;
}

export interface WebActivityDomainCoverage {
  normalizedDomain: string;
  earliestRecordedStartMs: number;
}

export interface WebActivityAggregateRange {
  records: WebActivityAggregateRecord[];
  domainCoverage: WebActivityDomainCoverage[];
}

const MAX_WEB_ACTIVITY_BUCKETS_PER_REQUEST = 400;
export const MAX_WEB_ACTIVITY_DOMAINS_PER_REQUEST = 7;

export type WebActivityDomainFilter = string | readonly string[] | null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNormalizedDomain(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && value.length > 0;
}

function normalizeDomainFilter(filter: WebActivityDomainFilter): string | string[] | null {
  if (filter === null) return null;
  if (typeof filter === "string") {
    if (!isNormalizedDomain(filter)) {
      throw new Error("Web activity aggregate domain is invalid");
    }
    return filter;
  }
  if (filter.length === 0 || filter.length > MAX_WEB_ACTIVITY_DOMAINS_PER_REQUEST) {
    throw new Error("Web activity aggregate domain selection is invalid");
  }
  if (!filter.every(isNormalizedDomain)) {
    throw new Error("Web activity aggregate domain is invalid");
  }
  return Array.from(new Set(filter));
}

function isAggregateRecord(value: unknown): value is WebActivityAggregateRecord {
  return isRecord(value)
    && isNormalizedDomain(value.normalizedDomain)
    && isFiniteNonNegativeNumber(value.bucketStartMs)
    && isFiniteNonNegativeNumber(value.durationMs);
}

function isDomainCoverage(value: unknown): value is WebActivityDomainCoverage {
  return isRecord(value)
    && isNormalizedDomain(value.normalizedDomain)
    && isFiniteNonNegativeNumber(value.earliestRecordedStartMs);
}

export function parseWebActivityAggregateRange(value: unknown): WebActivityAggregateRange {
  if (!isRecord(value)
    || !Array.isArray(value.records)
    || !value.records.every(isAggregateRecord)
    || !Array.isArray(value.domainCoverage)
    || !value.domainCoverage.every(isDomainCoverage)) {
    throw new Error("Received invalid web activity aggregate payload");
  }

  const recordKeys = new Set<string>();
  const coverageKeys = new Set<string>();
  const records = value.records.map((record) => {
    const typedRecord = record as WebActivityAggregateRecord;
    const key = `${typedRecord.normalizedDomain}\u0000${typedRecord.bucketStartMs}`;
    if (recordKeys.has(key)) {
      throw new Error("Received duplicate web activity aggregate record");
    }
    recordKeys.add(key);
    return {
      normalizedDomain: typedRecord.normalizedDomain,
      bucketStartMs: typedRecord.bucketStartMs,
      durationMs: typedRecord.durationMs,
    };
  });
  const domainCoverage = value.domainCoverage.map((coverage) => {
    const typedCoverage = coverage as WebActivityDomainCoverage;
    if (coverageKeys.has(typedCoverage.normalizedDomain)) {
      throw new Error("Received duplicate web activity domain coverage");
    }
    coverageKeys.add(typedCoverage.normalizedDomain);
    return {
      normalizedDomain: typedCoverage.normalizedDomain,
      earliestRecordedStartMs: typedCoverage.earliestRecordedStartMs,
    };
  });

  return { records, domainCoverage };
}

function validateWebActivityAggregateInput(
  startMs: number,
  endMs: number,
  bucketBoundariesMs: number[],
) {
  if (!Number.isSafeInteger(startMs)
    || !Number.isSafeInteger(endMs)
    || startMs < 0
    || endMs <= startMs
    || bucketBoundariesMs.length < 2
    || bucketBoundariesMs[0] !== startMs
    || bucketBoundariesMs[bucketBoundariesMs.length - 1] !== endMs
    || bucketBoundariesMs.some((boundary) => !Number.isSafeInteger(boundary) || boundary < 0)
    || bucketBoundariesMs.some((boundary, index) => index > 0 && boundary <= bucketBoundariesMs[index - 1])) {
    throw new Error("Web activity aggregate range is invalid");
  }
}

async function readWebActivityAggregateRangeChunk(
  startMs: number,
  endMs: number,
  bucketBoundariesMs: number[],
  domainFilter: string | string[] | null,
): Promise<WebActivityAggregateRange> {
  return parseWebActivityAggregateRange(await invokeWithCommandError(
    "cmd_get_web_activity_aggregate_range",
    {
      startMs,
      endMs,
      bucketBoundariesMs,
      normalizedDomain: typeof domainFilter === "string" ? domainFilter : null,
      normalizedDomains: Array.isArray(domainFilter) ? domainFilter : null,
    },
  ));
}

export async function loadWebActivityAggregateRange(
  startMs: number,
  endMs: number,
  bucketBoundariesMs: number[],
  domainFilter: WebActivityDomainFilter = null,
  readChunk: (
    startMs: number,
    endMs: number,
    bucketBoundariesMs: number[],
    domainFilter: string | string[] | null,
  ) => Promise<WebActivityAggregateRange> = readWebActivityAggregateRangeChunk,
): Promise<WebActivityAggregateRange> {
  validateWebActivityAggregateInput(startMs, endMs, bucketBoundariesMs);
  const normalizedFilter = normalizeDomainFilter(domainFilter);
  const recordMap = new Map<string, WebActivityAggregateRecord>();
  const coverageMap = new Map<string, WebActivityDomainCoverage>();

  for (let boundaryIndex = 0; boundaryIndex < bucketBoundariesMs.length - 1; boundaryIndex += MAX_WEB_ACTIVITY_BUCKETS_PER_REQUEST) {
    const chunkBoundaries = bucketBoundariesMs.slice(
      boundaryIndex,
      Math.min(bucketBoundariesMs.length, boundaryIndex + MAX_WEB_ACTIVITY_BUCKETS_PER_REQUEST + 1),
    );
    const chunk = await readChunk(
      chunkBoundaries[0],
      chunkBoundaries[chunkBoundaries.length - 1] ?? chunkBoundaries[0],
      chunkBoundaries,
      normalizedFilter,
    );

    for (const record of chunk.records) {
      const key = `${record.normalizedDomain}\u0000${record.bucketStartMs}`;
      const previous = recordMap.get(key);
      const durationMs = (previous?.durationMs ?? 0) + record.durationMs;
      if (!Number.isSafeInteger(durationMs)) {
        throw new Error("Web activity aggregate duration overflowed");
      }
      recordMap.set(key, {
        ...record,
        durationMs,
      });
    }
    for (const coverage of chunk.domainCoverage) {
      const previous = coverageMap.get(coverage.normalizedDomain);
      if (!previous || coverage.earliestRecordedStartMs < previous.earliestRecordedStartMs) {
        coverageMap.set(coverage.normalizedDomain, coverage);
      }
    }
  }

  return {
    records: Array.from(recordMap.values()).sort((left, right) => (
      left.normalizedDomain.localeCompare(right.normalizedDomain)
      || left.bucketStartMs - right.bucketStartMs
    )),
    domainCoverage: Array.from(coverageMap.values()).sort((left, right) => (
      left.normalizedDomain.localeCompare(right.normalizedDomain)
    )),
  };
}
