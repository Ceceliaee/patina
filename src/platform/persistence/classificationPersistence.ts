import { commitClassificationSettingMutations } from "./classificationSettingsGateway.ts";
import {
  deleteSessionsByExeNames as deleteSessionsByExeNamesViaCommand,
  deleteSessionsByExeNamesBetween as deleteSessionsByExeNamesBetweenViaCommand,
} from "./persistenceWriteRuntimeGateway.ts";
import { getDB } from "./sqlite.ts";
import { invokeWithCommandError } from "./commandError.ts";
import { isPlainRecord } from "../../shared/lib/runtimeTypeGuards.ts";
import {
  loadActivityCatalogPage,
  type ActivityReadPath,
} from "./activityReadModelGateway.ts";

interface SettingKeyValueRow {
  key: string;
  value: string;
}

interface SettingKeyRow {
  key: string;
}

interface RawSessionExeNameRow {
  exe_name: string;
}

interface SessionExeNameRow {
  exeName: string;
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
  readPath: ActivityReadPath;
  fallbackReason: string | null;
  sourceRevision: number;
}

export interface RecordedAppCatalogQueryInput {
  cursor: RecordedAppCatalogCursor | null;
  searchQuery: string;
  limit: number;
}

interface RecordedAppCatalogQuery {
  sql: string;
  params: Array<string | number>;
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

export async function loadLegacyClassificationApps(nowMs: number): Promise<Array<{ exeName: string; appName: string }>> {
  const rows: unknown = await invokeWithCommandError("cmd_get_legacy_classification_apps", { nowMs });
  if (!Array.isArray(rows) || !rows.every((row) => isPlainRecord(row)
    && typeof row.exeName === "string" && typeof row.appName === "string")) {
    throw new Error("Received invalid legacy classification apps");
  }
  return rows;
}

function escapeSqlLikePattern(value: string): string {
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
                     ''
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
                     ''
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
                     ''
                   ) AS app_name,
                   bucket.last_seen_ms, 2 AS origin_rank, 0 AS has_native_records
            FROM bucket_app_times AS bucket
          ), grouped_apps AS (
            SELECT exe_name,
                   COALESCE(
                     MAX(CASE WHEN origin_rank = 0 THEN NULLIF(TRIM(app_name), '') END),
                     MAX(CASE WHEN origin_rank = 1 THEN NULLIF(TRIM(app_name), '') END),
                     MAX(CASE WHEN origin_rank = 2 THEN NULLIF(TRIM(app_name), '') END),
                     ''
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
  const page = await loadActivityCatalogPage(input);
  return {
    rows: page.rows.map((row) => ({
      rawExeName: row.rawExeName,
      appName: row.appName,
      lastSeenMs: row.lastSeenMs,
      hasNativeRecords: row.hasNativeRecords,
    })),
    nextCursor: page.nextCursor ?? input.cursor,
    hasMore: page.hasMore,
    readPath: page.readPath,
    fallbackReason: page.fallbackReason,
    sourceRevision: page.sourceRevision,
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
