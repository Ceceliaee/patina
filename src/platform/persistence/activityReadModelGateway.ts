import { invokeWithCommandError } from "./commandError.ts";
import {
  isFiniteNumber,
  isNullableString,
  isPlainRecord as isRecord,
} from "../../shared/lib/runtimeTypeGuards.ts";

export type ActivityReadPath = "projection" | "facts" | "hybrid";

interface ActivityCatalogCursor {
  lastSeenMs: number;
  rawExeName: string;
}

interface ActivityCatalogRow {
  rawExeName: string;
  appName: string;
  lastSeenMs: number;
  hasNativeRecords: boolean;
  hasImportExactRecords: boolean;
  hasImportBucketRecords: boolean;
}

interface ActivityCatalogPage {
  rows: ActivityCatalogRow[];
  nextCursor: ActivityCatalogCursor | null;
  hasMore: boolean;
  readPath: ActivityReadPath;
  fallbackReason: string | null;
  sourceRevision: number;
}

interface ActivityAggregateRecord {
  appName: string;
  exeName: string;
  startTime: number;
  endTime: number;
}

interface ActivityAggregateRange {
  records: ActivityAggregateRecord[];
  readPath: ActivityReadPath;
  fallbackReason: string | null;
  sourceRevision: number;
  projectionRowCount: number;
  factRowCount: number;
  hasActiveSession: boolean;
}

function isReadPath(value: unknown): value is ActivityReadPath {
  return value === "projection" || value === "facts" || value === "hybrid";
}

function isCatalogCursor(value: unknown): value is ActivityCatalogCursor {
  return isRecord(value)
    && isFiniteNumber(value.lastSeenMs)
    && typeof value.rawExeName === "string";
}

function isCatalogRow(value: unknown): value is ActivityCatalogRow {
  return isRecord(value)
    && typeof value.rawExeName === "string"
    && typeof value.appName === "string"
    && isFiniteNumber(value.lastSeenMs)
    && typeof value.hasNativeRecords === "boolean"
    && typeof value.hasImportExactRecords === "boolean"
    && typeof value.hasImportBucketRecords === "boolean";
}

export function parseActivityCatalogPage(value: unknown): ActivityCatalogPage {
  if (!isRecord(value)
    || !Array.isArray(value.rows)
    || !value.rows.every(isCatalogRow)
    || !(value.nextCursor === null || isCatalogCursor(value.nextCursor))
    || typeof value.hasMore !== "boolean"
    || !isReadPath(value.readPath)
    || !isNullableString(value.fallbackReason)
    || !isFiniteNumber(value.sourceRevision)) {
    throw new Error("Received invalid activity catalog payload");
  }
  return value as unknown as ActivityCatalogPage;
}

function isAggregateRecord(value: unknown): value is ActivityAggregateRecord {
  return isRecord(value)
    && typeof value.appName === "string"
    && typeof value.exeName === "string"
    && isFiniteNumber(value.startTime)
    && isFiniteNumber(value.endTime)
    && value.endTime >= value.startTime;
}

export function parseActivityAggregateRange(value: unknown): ActivityAggregateRange {
  if (!isRecord(value)
    || !Array.isArray(value.records)
    || !value.records.every(isAggregateRecord)
    || !isReadPath(value.readPath)
    || !isNullableString(value.fallbackReason)
    || !isFiniteNumber(value.sourceRevision)
    || !isFiniteNumber(value.projectionRowCount)
    || !isFiniteNumber(value.factRowCount)
    || typeof value.hasActiveSession !== "boolean") {
    throw new Error("Received invalid activity aggregate payload");
  }
  return value as unknown as ActivityAggregateRange;
}

export async function loadActivityCatalogPage(input: {
  cursor: ActivityCatalogCursor | null;
  searchQuery: string;
  limit: number;
}): Promise<ActivityCatalogPage> {
  return parseActivityCatalogPage(await invokeWithCommandError(
    "cmd_get_recorded_app_catalog_page",
    input,
  ));
}

export async function loadActivityAggregateRange(
  startMs: number,
  endMs: number,
  bucketBoundariesMs?: number[],
): Promise<ActivityAggregateRange> {
  return parseActivityAggregateRange(await invokeWithCommandError(
    "cmd_get_activity_aggregate_range",
    { startMs, endMs, bucketBoundariesMs: bucketBoundariesMs ?? null },
  ));
}
