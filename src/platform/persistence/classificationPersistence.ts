import { executeWrite, getDB } from "./sqlite.ts";

export interface SettingKeyValueRow {
  key: string;
  value: string;
}

export interface SettingKeyRow {
  key: string;
}

export interface SessionExeNameRow {
  exe_name: string;
}

export interface ObservedSessionStatRow {
  exe_name: string;
  app_name: string;
  total_duration: number;
  last_seen_ms: number;
}

export async function upsertSettingValue(key: string, value: string): Promise<void> {
  await executeWrite(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function deleteSettingValue(key: string): Promise<void> {
  await executeWrite("DELETE FROM settings WHERE key = ?", [key]);
}

export async function deleteSettingsByKeyPrefix(keyPrefix: string): Promise<void> {
  await executeWrite("DELETE FROM settings WHERE key LIKE ?", [`${keyPrefix}%`]);
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
  return db.select<SessionExeNameRow[]>("SELECT DISTINCT exe_name FROM sessions");
}

export async function loadObservedSessionStats(
  sinceMs: number,
  nowMs: number,
): Promise<ObservedSessionStatRow[]> {
  const db = await getDB();
  return db.select<ObservedSessionStatRow[]>(
    `SELECT exe_name,
            MAX(COALESCE(app_name, '')) AS app_name,
            SUM(COALESCE(duration, MAX(0, ? - start_time))) AS total_duration,
            MAX(start_time) AS last_seen_ms
     FROM sessions
     WHERE start_time >= ?
     GROUP BY exe_name`,
    [nowMs, sinceMs],
  );
}

function buildInClausePlaceholders(values: readonly string[]): string {
  return values.map(() => "?").join(", ");
}

export async function deleteSessionsByExeNames(exeNames: string[]): Promise<void> {
  if (exeNames.length === 0) {
    return;
  }
  const placeholders = buildInClausePlaceholders(exeNames);
  await executeWrite(
    `DELETE FROM sessions WHERE exe_name IN (${placeholders})`,
    exeNames,
  );
}

export async function deleteSessionsByExeNamesBetween(
  exeNames: string[],
  startTime: number,
  endTime: number,
): Promise<void> {
  if (exeNames.length === 0) {
    return;
  }
  const placeholders = buildInClausePlaceholders(exeNames);
  await executeWrite(
    `DELETE FROM sessions
     WHERE exe_name IN (${placeholders})
       AND start_time >= ?
       AND start_time < ?`,
    [...exeNames, startTime, endTime],
  );
}
