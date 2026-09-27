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
