import { commitClassificationSettingMutations } from "./classificationSettingsGateway.ts";
import {
  deleteSessionsByExeNames as deleteSessionsByExeNamesViaCommand,
  deleteSessionsByExeNamesBetween as deleteSessionsByExeNamesBetweenViaCommand,
} from "./persistenceWriteRuntimeGateway.ts";
import { getDB } from "./sqlite.ts";
import {
  resolveNativeSessionPrecedence,
  type TimeRecordOrigin,
} from "./nativeSessionPrecedence.ts";

export interface SettingKeyValueRow {
  key: string;
  value: string;
}

export interface SettingKeyRow {
  key: string;
}

interface RawSessionExeNameRow {
  exe_name: string;
}

export interface RawObservedSessionCandidateRow {
  record_id: number;
  origin: TimeRecordOrigin;
  exe_name: string;
  app_name: string;
  start_time: number;
  effective_end_time: number;
  capacity_end_time: number | null;
}

export interface SessionExeNameRow {
  exeName: string;
}

export interface ObservedSessionStatRow {
  exeName: string;
  appName: string;
  totalDuration: number;
  lastSeenMs: number;
  hasNativeRecords: boolean;
}

export interface RecordedAppCatalogCursor {
  lastSeenMs: number;
  rawExeName: string;
}

export interface RecordedAppCatalogRow {
  rawExeName: string;
  appName: string;
  lastSeenMs: number;
  hasNativeRecords: boolean;
}

export interface RecordedAppCatalogPage {
  rows: RecordedAppCatalogRow[];
  nextCursor: RecordedAppCatalogCursor | null;
  hasMore: boolean;
}

export interface RecordedAppCatalogQueryInput {
  cursor: RecordedAppCatalogCursor | null;
  searchQuery: string;
  limit: number;
}

export interface RecordedAppCatalogQuery {
  sql: string;
  params: Array<string | number>;
}

interface MutableObservedSessionStat extends ObservedSessionStatRow {
  appNameOriginRank: number;
  appNameLastSeenMs: number;
}

const APP_NAME_ORIGIN_RANK: Record<TimeRecordOrigin, number> = {
  native: 0,
  import_exact: 1,
  import_bucket: 2,
};

function clipObservedCandidate(
  row: RawObservedSessionCandidateRow,
  sinceMs: number,
  nowMs: number,
) {
  if (row.origin !== "import_bucket") {
    return {
      startTime: Math.max(sinceMs, row.start_time),
      endTime: Math.min(nowMs, row.effective_end_time),
      capacityEndTime: undefined,
    };
  }

  const originalCapacityEnd = row.capacity_end_time ?? row.effective_end_time;
  const clippedStart = Math.max(sinceMs, row.start_time);
  const clippedCapacityEnd = Math.min(nowMs, originalCapacityEnd);
  const originalCapacity = Math.max(0, originalCapacityEnd - row.start_time);
  const clippedCapacity = Math.max(0, clippedCapacityEnd - clippedStart);
  const requestedDuration = Math.max(0, row.effective_end_time - row.start_time);
  const clippedRequestedDuration = originalCapacity > 0
    ? Math.round(requestedDuration * clippedCapacity / originalCapacity)
    : 0;
  return {
    startTime: clippedStart,
    endTime: clippedStart + Math.min(clippedCapacity, clippedRequestedDuration),
    capacityEndTime: clippedCapacityEnd,
  };
}

export function buildObservedSessionStats(
  candidates: RawObservedSessionCandidateRow[],
  sinceMs: number,
  nowMs: number,
): ObservedSessionStatRow[] {
  const effectiveRanges = resolveNativeSessionPrecedence(candidates.map((row, index) => {
    const clipped = clipObservedCandidate(row, sinceMs, nowMs);
    return {
      key: `${row.origin}:${row.record_id}:${index}`,
      origin: row.origin,
      ...clipped,
      value: row,
    };
  }));
  const aggregated = new Map<string, MutableObservedSessionStat>();

  for (const range of effectiveRanges) {
    const row = range.value;
    if (!row) continue;
    const duration = Math.max(0, range.endTime - range.startTime);
    if (duration <= 0) continue;
    const originRank = APP_NAME_ORIGIN_RANK[row.origin];
    const previous = aggregated.get(row.exe_name);
    if (!previous) {
      aggregated.set(row.exe_name, {
        exeName: row.exe_name,
        appName: row.app_name?.trim() || row.exe_name,
        totalDuration: duration,
        lastSeenMs: range.startTime,
        hasNativeRecords: row.origin === "native",
        appNameOriginRank: originRank,
        appNameLastSeenMs: range.startTime,
      });
      continue;
    }

    previous.totalDuration += duration;
    previous.hasNativeRecords ||= row.origin === "native";
    previous.lastSeenMs = Math.max(previous.lastSeenMs, range.startTime);
    if (
      originRank < previous.appNameOriginRank
      || (originRank === previous.appNameOriginRank && range.startTime > previous.appNameLastSeenMs)
    ) {
      previous.appName = row.app_name?.trim() || row.exe_name;
      previous.appNameOriginRank = originRank;
      previous.appNameLastSeenMs = range.startTime;
    }
  }

  return Array.from(aggregated.values()).map((row) => ({
    exeName: row.exeName,
    appName: row.appName,
    totalDuration: row.totalDuration,
    lastSeenMs: row.lastSeenMs,
    hasNativeRecords: row.hasNativeRecords,
  }));
}

export async function upsertSettingValue(key: string, value: string): Promise<void> {
  await commitClassificationSettingMutations([{ key, value }]);
}

export async function deleteSettingValue(key: string): Promise<void> {
  await commitClassificationSettingMutations([{ key, value: null }]);
}

export async function loadSettingValue(key: string): Promise<string | null> {
  const db = await getDB();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ? LIMIT 1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function loadSettingRowsByKeyPrefix(keyPrefix: string): Promise<SettingKeyValueRow[]> {
  const db = await getDB();
  return db.select<SettingKeyValueRow[]>(
    "SELECT key, value FROM settings WHERE key LIKE ?",
    [`${keyPrefix}%`],
  );
}

export async function loadSettingKeysByKeyPrefix(keyPrefix: string): Promise<SettingKeyRow[]> {
  const db = await getDB();
  return db.select<SettingKeyRow[]>(
    "SELECT key FROM settings WHERE key LIKE ?",
    [`${keyPrefix}%`],
  );
}

export async function loadDistinctSessionExeNames(): Promise<SessionExeNameRow[]> {
  const db = await getDB();
  const rows = await db.select<RawSessionExeNameRow[]>(
    `SELECT DISTINCT exe_name
     FROM (
       SELECT exe_name FROM sessions
       UNION ALL
       SELECT exe_name FROM import_exact_sessions
       UNION ALL
       SELECT exe_name FROM import_time_buckets
     )`,
  );
  return rows.map((row) => ({
    exeName: row.exe_name,
  }));
}

export async function loadObservedSessionStats(
  sinceMs: number,
  nowMs: number,
): Promise<ObservedSessionStatRow[]> {
  const db = await getDB();
  const candidates = await db.select<RawObservedSessionCandidateRow[]>(
    `SELECT record_id, origin, exe_name, app_name, start_time,
            effective_end_time, capacity_end_time
     FROM (
       SELECT id AS record_id, 'native' AS origin, exe_name, app_name, start_time,
              COALESCE(end_time, ?) AS effective_end_time,
              NULL AS capacity_end_time
       FROM sessions
       WHERE start_time < ? AND COALESCE(end_time, ?) > ?
       UNION ALL
       SELECT id AS record_id, 'import_exact' AS origin, exe_name, app_name, start_time,
              end_time AS effective_end_time,
              NULL AS capacity_end_time
       FROM import_exact_sessions
       WHERE start_time < ? AND end_time > ?
       UNION ALL
       SELECT id AS record_id, 'import_bucket' AS origin, exe_name,
              COALESCE(NULLIF(app_name, ''), exe_name) AS app_name,
              bucket_start_time AS start_time,
              bucket_start_time + duration AS effective_end_time,
              bucket_start_time + 3600000 AS capacity_end_time
       FROM import_time_buckets
       WHERE bucket_start_time < ? AND bucket_start_time + 3600000 > ?
     )
     ORDER BY start_time ASC, origin ASC, record_id ASC`,
    [nowMs, nowMs, nowMs, sinceMs, nowMs, sinceMs, nowMs, sinceMs],
  );
  return buildObservedSessionStats(candidates, sinceMs, nowMs);
}

export function escapeSqlLikePattern(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

export function buildRecordedAppCatalogQuery({
  cursor,
  searchQuery,
  limit,
}: RecordedAppCatalogQueryInput): RecordedAppCatalogQuery {
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const searchPattern = `%${escapeSqlLikePattern(normalizedSearch)}%`;
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
  const hasCursor = cursor !== null;

  return {
    sql: `WITH native_app_times AS (
            SELECT exe_name, MAX(start_time) AS last_seen_ms
            FROM sessions
            WHERE exe_name <> ''
            GROUP BY exe_name
          ), exact_app_times AS (
            SELECT exe_name, MAX(start_time) AS last_seen_ms
            FROM import_exact_sessions
            WHERE exe_name <> ''
            GROUP BY exe_name
          ), bucket_app_times AS (
            SELECT exe_name, MAX(bucket_start_time) AS last_seen_ms
            FROM import_time_buckets
            WHERE exe_name <> ''
            GROUP BY exe_name
          ), raw_observed_apps AS (
            SELECT native.exe_name,
                   COALESCE(
                     (SELECT NULLIF(TRIM(session.app_name), '')
                      FROM sessions AS session
                      WHERE session.exe_name = native.exe_name
                        AND NULLIF(TRIM(session.app_name), '') IS NOT NULL
                      ORDER BY session.start_time DESC
                      LIMIT 1),
                     native.exe_name
                   ) AS app_name,
                   native.last_seen_ms, 0 AS origin_rank, 1 AS has_native_records
            FROM native_app_times AS native
            UNION ALL
            SELECT exact.exe_name,
                   COALESCE(
                     (SELECT NULLIF(TRIM(imported.app_name), '')
                      FROM import_exact_sessions AS imported
                      WHERE imported.exe_name = exact.exe_name
                        AND NULLIF(TRIM(imported.app_name), '') IS NOT NULL
                      ORDER BY imported.start_time DESC
                      LIMIT 1),
                     exact.exe_name
                   ) AS app_name,
                   exact.last_seen_ms, 1 AS origin_rank, 0 AS has_native_records
            FROM exact_app_times AS exact
            UNION ALL
            SELECT bucket.exe_name,
                   COALESCE(
                     (SELECT NULLIF(TRIM(imported_bucket.app_name), '')
                      FROM import_time_buckets AS imported_bucket
                      WHERE imported_bucket.exe_name = bucket.exe_name
                        AND NULLIF(TRIM(imported_bucket.app_name), '') IS NOT NULL
                      ORDER BY imported_bucket.bucket_start_time DESC
                      LIMIT 1),
                     bucket.exe_name
                   ) AS app_name,
                   bucket.last_seen_ms, 2 AS origin_rank, 0 AS has_native_records
            FROM bucket_app_times AS bucket
          ), grouped_apps AS (
            SELECT exe_name,
                   COALESCE(
                     MAX(CASE WHEN origin_rank = 0 THEN NULLIF(TRIM(app_name), '') END),
                     MAX(CASE WHEN origin_rank = 1 THEN NULLIF(TRIM(app_name), '') END),
                     MAX(CASE WHEN origin_rank = 2 THEN NULLIF(TRIM(app_name), '') END),
                     exe_name
                   ) AS app_name,
                   MAX(last_seen_ms) AS last_seen_ms,
                   MAX(has_native_records) AS has_native_records
            FROM raw_observed_apps
            GROUP BY exe_name
          )
          SELECT exe_name, app_name, last_seen_ms, has_native_records
          FROM grouped_apps
          WHERE (? = 0
                 OR LOWER(exe_name) LIKE ? ESCAPE '\\'
                 OR LOWER(app_name) LIKE ? ESCAPE '\\')
            AND (? = 0
                 OR last_seen_ms < ?
                 OR (last_seen_ms = ? AND exe_name > ?))
          ORDER BY last_seen_ms DESC, exe_name ASC
          LIMIT ?`,
    params: [
      normalizedSearch ? 1 : 0,
      searchPattern,
      searchPattern,
      hasCursor ? 1 : 0,
      cursor?.lastSeenMs ?? 0,
      cursor?.lastSeenMs ?? 0,
      cursor?.rawExeName ?? "",
      safeLimit,
    ],
  };
}

export async function loadRecordedAppCatalogPage(
  input: RecordedAppCatalogQueryInput,
): Promise<RecordedAppCatalogPage> {
  const db = await getDB();
  const query = buildRecordedAppCatalogQuery(input);
  const rows = await db.select<Array<{
    exe_name: string;
    app_name: string;
    last_seen_ms: number;
    has_native_records: number;
  }>>(query.sql, query.params);
  const mappedRows = rows.map((row) => ({
    rawExeName: row.exe_name,
    appName: row.app_name,
    lastSeenMs: Math.max(0, Number(row.last_seen_ms ?? 0)),
    hasNativeRecords: Number(row.has_native_records) === 1,
  }));
  const last = mappedRows[mappedRows.length - 1];
  return {
    rows: mappedRows,
    nextCursor: last
      ? { lastSeenMs: last.lastSeenMs, rawExeName: last.rawExeName }
      : input.cursor,
    hasMore: mappedRows.length === Math.min(500, Math.max(1, Math.trunc(input.limit))),
  };
}

export async function deleteSessionsByExeNames(exeNames: string[]): Promise<void> {
  if (exeNames.length === 0) {
    return;
  }
  await deleteSessionsByExeNamesViaCommand(exeNames);
}

export async function deleteSessionsByExeNamesBetween(
  exeNames: string[],
  startTime: number,
  endTime: number,
): Promise<void> {
  if (exeNames.length === 0) {
    return;
  }
  await deleteSessionsByExeNamesBetweenViaCommand(exeNames, startTime, endTime);
}
