import { commitClassificationSettingMutations } from "./classificationSettingsGateway.ts";
import {
  deleteSessionsByExeNames as deleteSessionsByExeNamesViaCommand,
  deleteSessionsByExeNamesBetween as deleteSessionsByExeNamesBetweenViaCommand,
} from "./persistenceWriteRuntimeGateway.ts";
import { getDB } from "./sqlite.ts";

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

interface RawObservedSessionStatRow {
  exe_name: string;
  app_name: string;
  total_duration: number;
  last_seen_ms: number;
}

export interface SessionExeNameRow {
  exeName: string;
}

export interface ObservedSessionStatRow {
  exeName: string;
  appName: string;
  totalDuration: number;
  lastSeenMs: number;
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
  const rows = await db.select<RawSessionExeNameRow[]>("SELECT DISTINCT exe_name FROM sessions");
  return rows.map((row) => ({
    exeName: row.exe_name,
  }));
}

export async function loadObservedSessionStats(
  sinceMs: number,
  nowMs: number,
): Promise<ObservedSessionStatRow[]> {
  const db = await getDB();
  const rows = await db.select<RawObservedSessionStatRow[]>(
    `SELECT exe_name,
            MAX(COALESCE(app_name, '')) AS app_name,
            SUM(COALESCE(duration, MAX(0, ? - start_time))) AS total_duration,
            MAX(start_time) AS last_seen_ms
     FROM sessions
     WHERE start_time >= ?
     GROUP BY exe_name`,
    [nowMs, sinceMs],
  );
  return rows.map((row) => ({
    exeName: row.exe_name,
    appName: row.app_name,
    totalDuration: row.total_duration,
    lastSeenMs: row.last_seen_ms,
  }));
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
